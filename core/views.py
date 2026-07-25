import logging
from rest_framework import viewsets, status, generics
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.exceptions import ValidationError
from django.db.models import Count, Q, Subquery, OuterRef
from .models import SchoolClass, Subject, AcademicYear, SchoolSetting, AuditLog, Category, ServiceType
from students.models import Student
from books.models import Book
from .serializers import (
    SchoolClassSerializer, SchoolClassReorderSerializer,
    SubjectSerializer, AcademicYearSerializer,
    SchoolSettingSerializer, AuditLogSerializer, CategorySerializer,
    PromoteAllSerializer, ServiceTypeSerializer,
)
from accounts.permissions import require_permission
from .services import promote_all as promote_all_service, auto_create_fee_schedules_for_service
from .audit import log_audit, AuditLogMixin

logger = logging.getLogger(__name__)


class ClassViewSet(AuditLogMixin, viewsets.ModelViewSet):
    queryset = SchoolClass.objects.annotate(
        student_count=Subquery(
            Student.objects.filter(school_class=OuterRef('pk'), deleted_at__isnull=True)
            .order_by().values('school_class').annotate(c=Count('pk')).values('c')
        ),
        book_count=Subquery(
            Book.objects.filter(school_class=OuterRef('pk'))
            .order_by().values('school_class').annotate(c=Count('pk')).values('c')
        ),
        subject_count=Subquery(
            Subject.objects.filter(school_class=OuterRef('pk'))
            .order_by().values('school_class').annotate(c=Count('pk')).values('c')
        ),
    )
    serializer_class = SchoolClassSerializer

    def get_permissions(self):
        if self.action in ['list', 'retrieve']:
            return [require_permission('classes:read')()]
        return [require_permission('classes:write')()]

    @action(detail=False, methods=['post'])
    def reorder(self, request):
        serializer = SchoolClassReorderSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        for idx, class_id in enumerate(serializer.validated_data['order']):
            SchoolClass.objects.filter(pk=class_id).update(order=idx)
        log_audit('reorder', 'class', details={'order': serializer.validated_data['order']}, request=request)
        return Response({'status': 'ok'})

    @action(detail=False, methods=['post'])
    def promote_all(self, request):
        serializer = PromoteAllSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        is_dry_run = request.query_params.get('dryRun') == 'true'

        try:
            result = promote_all_service(data, is_dry_run)
            if 'error' in result:
                return Response(
                    {'error': result['error']},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            log_audit('promote_all', 'class', details=result, request=request)
            return Response(result)
        except Exception as e:
            logger.exception('promote_all failed')
            return Response(
                {'error': f'Promotion failed: {e}'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )


class SubjectViewSet(viewsets.ModelViewSet):
    queryset = Subject.objects.select_related('school_class').all()
    serializer_class = SubjectSerializer
    filterset_fields = ['school_class_id']

    def get_permissions(self):
        if self.action in ['list', 'retrieve']:
            return [require_permission('subjects:read')()]
        if self.action == 'destroy':
            return [require_permission('subjects:admin')()]
        return [require_permission('subjects:write')()]

    def get_queryset(self):
        qs = super().get_queryset()
        class_id = self.kwargs.get('class_id') or self.request.query_params.get('class_id')
        if class_id:
            qs = qs.filter(school_class_id=class_id)
        return qs

    def perform_create(self, serializer):
        class_id = self.kwargs.get('class_id')
        if class_id:
            max_order = Subject.objects.filter(school_class_id=class_id).order_by('-order').values_list('order', flat=True).first() or 0
            obj = serializer.save(school_class_id=class_id, order=max_order + 1)
        else:
            obj = serializer.save()
        log_audit('create', 'subject', entity_id=obj.pk, request=self.request)


class AcademicYearViewSet(viewsets.ModelViewSet):
    queryset = AcademicYear.objects.all()
    serializer_class = AcademicYearSerializer

    def get_permissions(
self):
        if self.action in ['list', 'retrieve']:
            return [require_permission('academic-years:read')()]
        return [require_permission('academic-years:write')()]

    def perform_create(self, serializer):
        if serializer.validated_data.get('is_active'):
            AcademicYear.objects.filter(is_active=True).update(is_active=False)
        obj = serializer.save()
        log_audit('create', 'academic_year', entity_id=obj.pk, request=self.request)

    def perform_update(self, serializer):
        if serializer.validated_data.get('is_active'):
            AcademicYear.objects.filter(is_active=True).update(is_active=False)
        obj = serializer.save()
        log_audit('update', 'academic_year', entity_id=obj.pk, request=self.request)


class SettingView(generics.GenericAPIView):
    queryset = SchoolSetting.objects.all()
    serializer_class = SchoolSettingSerializer

    def get_permissions(self):
        if self.request.method == 'GET':
            return [require_permission('classes:read')()]
        return [require_permission('users:write')()]

    def get(self, request):
        key = request.query_params.get('key')
        if key:
            from django.shortcuts import get_object_or_404
            obj = get_object_or_404(SchoolSetting, key=key)
            return Response(SchoolSettingSerializer(obj).data)
        settings = {s.key: s.value for s in SchoolSetting.objects.all()}
        if not settings:
            settings = {
                'school_name': 'AL RAWA English School',
                'address': '',
                'phone': '',
                'email': '',
                'website': '',
            }
        return Response(settings)

    ALLOWED_SETTING_KEYS = {
        'school_name', 'address', 'phone', 'email', 'website',
        'academic_year', 'exam_type', 'exam_terms',
        'weekend_days',
    }

    def put(self, request):
        data = request.data
        unknown = [k for k in data if k not in self.ALLOWED_SETTING_KEYS and k != 'id']
        if unknown:
            raise ValidationError(f"Unknown setting keys: {', '.join(unknown)}")
        for key, value in data.items():
            if key == 'id':
                continue
            SchoolSetting.objects.update_or_create(
                key=key,
                defaults={'value': str(value) if value is not None else ''},
            )
        log_audit('update', 'setting', details={'keys': list(data.keys())}, request=request)
        settings = {s.key: s.value for s in SchoolSetting.objects.all()}
        return Response(settings)


class AuditLogViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = AuditLog.objects.all()
    serializer_class = AuditLogSerializer
    permission_classes = [require_permission('audit:read')]
    filterset_fields = ['action', 'entity_type', 'user_id']
    search_fields = ['entity_id', 'details']
    ordering_fields = ['created_at']


class CategoryViewSet(AuditLogMixin, viewsets.ModelViewSet):
    queryset = Category.objects.all()
    serializer_class = CategorySerializer

    def get_permissions(self):
        if self.action in ['list', 'retrieve']:
            return [require_permission('finance:read')()]
        return [require_permission('finance:write')()]

    def get_queryset(self):
        qs = super().get_queryset()
        type_filter = self.request.query_params.get('type')
        if type_filter:
            qs = qs.filter(type=type_filter.upper())
        return qs


class DashboardSummaryView(generics.GenericAPIView):
    permission_classes = [require_permission('students:read')]

    def get(self, request):
        from django.core.cache import cache
        from students.models import Student
        from teachers.models import Teacher
        from staff.models import Staff
        from .models import SchoolClass
        from books.models import Book

        cache_key = 'dashboard_summary'
        data = cache.get(cache_key)
        if data is None:
            data = {
                'studentCount': Student.objects.filter(deleted_at__isnull=True).count(),
                'teacherCount': Teacher.objects.filter(deleted_at__isnull=True).count(),
                'staffCount': Staff.objects.filter(deleted_at__isnull=True).count(),
                'classCount': SchoolClass.objects.count(),
                'bookCount': Book.objects.count(),
            }
            cache.set(cache_key, data, 60)
        return Response(data)


class SetupStatusView(generics.GenericAPIView):
    permission_classes = []

    def get(self, request):
        from accounts.models import User
        has_users = User.objects.exists()
        return Response({
            'initialized': has_users,
        })


class SetupInitView(generics.GenericAPIView):
    permission_classes = []
    throttle_scope = 'setup'

    def post(self, request):
        from django.db import transaction
        from accounts.models import User
        from accounts.serializers import RegisterSerializer
        with transaction.atomic():
            if User.objects.select_for_update().exists():
                return Response({'error': 'Setup already completed. Use normal registration.'}, status=403)
            serializer = RegisterSerializer(data=request.data)
            serializer.is_valid(raise_exception=True)
            user = serializer.save()
            user.role = 'admin'
            user.email_verified = True
            user.save(update_fields=['role', 'email_verified'])
        return Response({
            'user': {'id': str(user.id), 'name': user.name, 'email': user.email, 'role': user.role}
        })


class ServiceTypeViewSet(viewsets.ModelViewSet):
    queryset = ServiceType.objects.all()
    serializer_class = ServiceTypeSerializer

    def get_permissions(self):
        if self.action in ['list', 'retrieve']:
            return [require_permission('classes:read')()]
        return [require_permission('finance:write')()]

    def perform_create(self, serializer):
        obj = serializer.save()
        # Auto-create FeeSchedules for all active academic years
        created = auto_create_fee_schedules_for_service(obj)
        log_audit('create', 'service_type', entity_id=obj.pk, request=self.request)
        if created:
            logger.info(f'Auto-created {len(created)} FeeSchedules for ServiceType "{obj.name}"')

