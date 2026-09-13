import base64
import logging
from django.utils import timezone
from django.shortcuts import redirect
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError, APIException
from rest_framework.response import Response
from rest_framework import status
from core.supabase_storage import upload_photo, delete_photo, get_signed_url

logger = logging.getLogger(__name__)


class PhotoUploadFailed(APIException):
    status_code = 502
    default_detail = 'Photo storage upload failed. Please try again.'
    default_code = 'photo_upload_failed'


class PhotoUrlMixin:
    """Mixin that provides hasPhoto and photoUrl serializer methods."""
    photo_url_prefix = ''

    def get_hasPhoto(self, obj):
        return bool(obj.photo_path)

    def get_photoUrl(self, obj):
        if obj.photo_path:
            # Fast redirect URL (NO proxy param): the photo endpoint answers
            # with a tiny 302 to a signed Supabase URL, so image bytes stream
            # straight from storage and Django never touches them. The 302
            # itself stays no-store (this URL is deterministic per object),
            # while the signed target rotates on every re-upload — browsers
            # cache each target immutably and can never go stale. A 30-student
            # list costs 30 tiny parallel redirects instead of 30 full-body
            # Django downloads.
            from django.core import signing
            token = signing.dumps({'id': str(obj.id)}, salt='photo-access')
            path = f"/api/{self.photo_url_prefix}/{obj.id}/photo/?token={token}"
            request = self.context.get('request')
            if request:
                return request.build_absolute_uri(path)
            return path
        return None


class PhotoHandleMixin:
    photo_prefix = ''

    def perform_create(self, serializer):
        instance = serializer.save()
        self._handle_photo(instance, self.request.data.get('photo'))

    def perform_update(self, serializer):
        instance = self.get_object()
        self._handle_photo(instance, self.request.data.get('photo'))
        serializer.save()

    def perform_destroy(self, instance):
        if instance.photo_path:
            delete_photo(instance.photo_path)
        instance.deleted_at = timezone.now()
        instance.save(update_fields=['deleted_at'])

    ALLOWED_PHOTO_MIME_PREFIXES = {
        'data:image/jpeg', 'data:image/png', 'data:image/webp', 'data:image/gif',
    }
    MAX_PHOTO_SIZE = 5 * 1024 * 1024

    def _handle_photo(self, instance, photo_data):
        if not photo_data:
            if instance.photo_path:
                delete_photo(instance.photo_path)
                instance.photo_path = None
                instance.save(update_fields=['photo_path'])
            return
        if photo_data.startswith('http'):
            return
        # Standard data URLs are "data:image/jpeg;base64,<payload>" — strip the
        # ";base64" marker before whitelisting, otherwise the comparison below
        # ALWAYS fails and every photo upload is silently rejected.
        mime_prefix = photo_data.split(',', 1)[0].split(';', 1)[0] if ',' in photo_data else ''
        if mime_prefix and mime_prefix not in self.ALLOWED_PHOTO_MIME_PREFIXES:
            logger.error("Rejected photo upload with disallowed MIME type: %s", mime_prefix)
            raise ValidationError({'photo': f'Unsupported image type: {mime_prefix}. Allowed: jpeg, png, webp, gif.'})
        path = f"{self.photo_prefix}/{instance.id}.jpg"
        try:
            raw = base64.b64decode(photo_data.split(',', 1)[-1] if ',' in photo_data else photo_data)
        except (ValueError, OSError) as e:
            logger.error("Photo handle failed for %s/%s: %s", self.photo_prefix, instance.id, e)
            raise ValidationError({'photo': 'Invalid image data.'})
        if len(raw) > self.MAX_PHOTO_SIZE:
            logger.error("Rejected photo upload of %d bytes (max %d)", len(raw), self.MAX_PHOTO_SIZE)
            raise ValidationError({'photo': f'Image too large (max {self.MAX_PHOTO_SIZE} bytes).'})
        try:
            ok = upload_photo(path, raw)
        except Exception as e:
            logger.error("Supabase upload raised for %s/%s: %s", self.photo_prefix, instance.id, e)
            raise PhotoUploadFailed()
        if not ok:
            logger.error("Supabase upload returned false for %s/%s", self.photo_prefix, instance.id)
            raise PhotoUploadFailed()
        instance.photo_path = path
        instance.save(update_fields=['photo_path'])

    @action(detail=True, methods=['get'])
    def photo(self, request, pk=None):
        from django.core import signing
        token = request.query_params.get('token')
        authenticated = request.user and request.user.is_authenticated
        
        if not authenticated:
            if not token:
                return Response({'error': 'Authentication required'}, status=401)
            try:
                data = signing.loads(token, salt='photo-access', max_age=3600)
                if str(data.get('id')) != str(pk):
                    return Response({'error': 'Invalid token'}, status=403)
            except Exception:
                logger.exception('Invalid or expired photo token for pk=%s', pk)
                return Response({'error': 'Invalid or expired token'}, status=403)

        instance = self.get_object()
        if instance.photo_path:
            url = get_signed_url(instance.photo_path)
            if url:
                # no-store: the photoUrl token is deterministic per object, so
                # without this the browser serves its cached (stale) image
                # forever after a photo is re-uploaded.
                # Default is a cheap 302 (Django never touches image bytes);
                # full-body proxy only for explicit ?proxy=1 legacy callers.
                if request.query_params.get('proxy'):
                    import urllib.request
                    from django.http import HttpResponse
                    try:
                        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
                        resp = urllib.request.urlopen(req, timeout=10)
                        content_type = resp.headers.get('Content-Type', 'image/jpeg')
                        r = HttpResponse(resp.read(), content_type=content_type)
                        r['Cache-Control'] = 'no-store, max-age=0'
                        return r
                    except Exception as e:
                        logger.error("Photo proxy failed for pk=%s: %s", pk, e)
                redirect_resp = redirect(url)
                redirect_resp['Cache-Control'] = 'no-store, max-age=0'
                return redirect_resp
        return Response({'error': 'No photo'}, status=404)

    @action(detail=True, methods=['post'])
    def restore(self, request, pk=None):
        self.check_permissions(request)
        model_class = self.get_serializer().Meta.model
        try:
            instance = model_class.objects.get(pk=pk)
        except model_class.DoesNotExist:
            raise NotFound(f"{model_class.__name__} not found.")
        # Mirror perform_destroy class-teacher scoping for student-like models:
        # non-admin callers may only restore rows in classes they manage.
        school_class_id = getattr(instance, 'school_class_id', None)
        if school_class_id:
            from accounts.permissions import can_manage_students, is_admin_or_superuser
            if not is_admin_or_superuser(request.user):
                if not can_manage_students(request.user, school_class_id):
                    raise PermissionDenied('You are not the class teacher of this class.')
        instance.deleted_at = None
        instance.save(update_fields=['deleted_at'])
        from core.audit import log_audit
        log_audit('restore', model_class._meta.model_name, entity_id=str(pk), request=request)
        serializer_class = self.get_serializer_class()
        return Response(serializer_class(instance).data)
