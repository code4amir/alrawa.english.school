import secrets
import logging
from datetime import timedelta
from django.core.mail import send_mail
from django.conf import settings
from django.utils import timezone
from rest_framework import generics, permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework.exceptions import AuthenticationFailed
from django.contrib.auth import get_user_model
from django.contrib.auth.hashers import make_password
from django.db import transaction as db_transaction
from django.http import JsonResponse
from rest_framework_simplejwt.views import TokenObtainPairView
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
from .serializers import (
    UserSerializer, UserListSerializer, UserRoleSerializer, RegisterSerializer,
    RequestPasswordResetSerializer, ResetPasswordSerializer,
    ChangePasswordSerializer, LinkChildSerializer, CreateStaffSerializer,
)
from .permissions import require_permission
from .throttles import (
    LoginRateThrottle, RegisterRateThrottle, RefreshRateThrottle,
    VerifyEmailRateThrottle, PasswordResetRateThrottle,
)
from .models import EmailVerification, PasswordReset

User = get_user_model()

logger = logging.getLogger(__name__)


def _send_verification_email(user):
    token = secrets.token_urlsafe(32)
    EmailVerification.objects.create(
        user=user,
        token=token,
        expires_at=timezone.now() + timedelta(hours=24),
    )
    verify_url = f'{settings.FRONTEND_URL}/#/verify-email?token={token}'
    try:
        send_mail(
            subject='Verify your email - AL RAWA English School',
            message=f'Click the link to verify your email:\n\n{verify_url}\n\nThis link expires in 24 hours.',
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[user.email],
            fail_silently=False,
        )
    except Exception:
        logger.exception('Failed to send verification email to %s', user.email)


class CustomTokenObtainPairSerializer(TokenObtainPairSerializer):
    def validate(self, attrs):
        data = super().validate(attrs)
        if not self.user.email_verified:
            raise AuthenticationFailed('Email not verified. Please verify your email before logging in.')
        return data


class CustomTokenObtainPairView(TokenObtainPairView):
    serializer_class = CustomTokenObtainPairSerializer
    throttle_classes = [LoginRateThrottle]

    def post(self, request, *args, **kwargs):
        response = super().post(request, *args, **kwargs)
        if response.status_code == 200:
            refresh = response.data.get('refresh')
            access = response.data.get('access')
            from django.middleware.csrf import get_token
            response.data = {'access': access, 'refresh': refresh, 'detail': 'Login successful', 'csrfToken': get_token(request)}
            response.set_cookie(
                settings.SIMPLE_JWT['ACCESS_COOKIE'],
                access,
                httponly=True,
                secure=settings.SIMPLE_JWT['AUTH_COOKIE_SECURE'],
                samesite=settings.SIMPLE_JWT['AUTH_COOKIE_SAMESITE'],
                max_age=int(settings.SIMPLE_JWT['ACCESS_TOKEN_LIFETIME'].total_seconds()),
            )
            response.set_cookie(
                settings.SIMPLE_JWT['REFRESH_COOKIE'],
                refresh,
                httponly=True,
                secure=settings.SIMPLE_JWT['AUTH_COOKIE_SECURE'],
                samesite=settings.SIMPLE_JWT['AUTH_COOKIE_SAMESITE'],
                max_age=int(settings.SIMPLE_JWT['REFRESH_TOKEN_LIFETIME'].total_seconds()),
            )
        return response


class CustomTokenRefreshView(APIView):
    permission_classes = []
    throttle_classes = [RefreshRateThrottle]

    def post(self, request):
        refresh_token = request.COOKIES.get(settings.SIMPLE_JWT['REFRESH_COOKIE'])
        if not refresh_token:
            return Response({'detail': 'Refresh token not found'}, status=status.HTTP_401_UNAUTHORIZED)
        try:
            refresh = RefreshToken(refresh_token)
            # Reject refresh for users who no longer exist or were deactivated
            # (e.g. hard-deleted accounts) — a deleted user's refresh cookie
            # must not keep minting access tokens.
            user_id = refresh.get('user_id')
            if not user_id or not User.objects.filter(pk=user_id, is_active=True).exists():
                return Response({'detail': 'Invalid refresh token'}, status=status.HTTP_401_UNAUTHORIZED)
            access = str(refresh.access_token)
            from django.middleware.csrf import get_token
            data = {'access': access, 'detail': 'Token refreshed', 'csrfToken': get_token(request)}
            response = Response(data, status=status.HTTP_200_OK)
            response.set_cookie(
                settings.SIMPLE_JWT['ACCESS_COOKIE'],
                access,
                httponly=True,
                secure=settings.SIMPLE_JWT['AUTH_COOKIE_SECURE'],
                samesite=settings.SIMPLE_JWT['AUTH_COOKIE_SAMESITE'],
                max_age=int(settings.SIMPLE_JWT['ACCESS_TOKEN_LIFETIME'].total_seconds()),
            )
            if settings.SIMPLE_JWT.get('ROTATE_REFRESH_TOKENS'):
                new_refresh = str(refresh)
                response.set_cookie(
                    settings.SIMPLE_JWT['REFRESH_COOKIE'],
                    new_refresh,
                    httponly=True,
                    secure=settings.SIMPLE_JWT['AUTH_COOKIE_SECURE'],
                    samesite=settings.SIMPLE_JWT['AUTH_COOKIE_SAMESITE'],
                    max_age=int(settings.SIMPLE_JWT['REFRESH_TOKEN_LIFETIME'].total_seconds()),
                )
            return response
        except Exception:
            logger.exception('Refresh token failed')
            return Response({'detail': 'Invalid refresh token'}, status=status.HTTP_401_UNAUTHORIZED)


class RegisterView(generics.CreateAPIView):
    queryset = User.objects.all()
    serializer_class = RegisterSerializer
    permission_classes = [permissions.AllowAny]
    throttle_classes = [RegisterRateThrottle]

    def create(self, request, *args, **kwargs):
        from django.db import transaction as db_transaction
        from teachers.models import Teacher
        with db_transaction.atomic():
            is_first = not User.objects.select_for_update().exists()
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        linked_child = False
        if is_first:
            user.role = 'admin'
            user.email_verified = True
            user.save(update_fields=['role', 'email_verified'])
        else:
            existing_teacher = Teacher.objects.filter(email__iexact=user.email, user__isnull=True, deleted_at__isnull=True).first()
            if existing_teacher:
                existing_teacher.user = user
                existing_teacher.save(update_fields=['user'])
                user.role = 'teacher'
                user.save(update_fields=['role'])
                _send_verification_email(user)
            else:
                # Parent registration: auto-link child when student details are provided
                child_name = (request.data.get('child_name') or '').strip()
                phone = (request.data.get('phone') or '').strip()
                if child_name and phone:
                    from students.models import Student
                    from parents.models import ParentStudentLink
                    filters = {
                        'name__iexact': child_name,
                        'contact': phone,
                        'deleted_at__isnull': True,
                    }
                    roll = (request.data.get('roll') or '').strip()
                    father_name = (request.data.get('father_name') or '').strip()
                    mother_name = (request.data.get('mother_name') or '').strip()
                    if roll:
                        filters['roll'] = roll
                    if father_name:
                        filters['father_name__iexact'] = father_name
                    if mother_name:
                        filters['mother_name__iexact'] = mother_name
                    student = Student.objects.filter(**filters).first()
                    if student:
                        ParentStudentLink.objects.get_or_create(parent=user, student=student)
                        for sib in Student.objects.filter(contact=phone, deleted_at__isnull=True).exclude(id=student.id):
                            ParentStudentLink.objects.get_or_create(parent=user, student=sib)
                        user.role = 'parent'
                        user.save(update_fields=['role'])
                        linked_child = True
                _send_verification_email(user)
        data = UserSerializer(user).data
        if not is_first:
            data['linkedChild'] = linked_child
        return Response(data, status=status.HTTP_201_CREATED)


class CreateStaffView(APIView):
    permission_classes = [require_permission('users:write')]

    def post(self, request):
        serializer = CreateStaffSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        from django.db import transaction as db_transaction
        with db_transaction.atomic():
            user = User.objects.create_user(
                email=data['email'],
                password=data['password'],
                name=data['name'],
                role=data['role'],
                email_verified=True,
                must_change_password=True,
            )
            teacher_id = data.get('teacher_id')
            if teacher_id:
                from teachers.models import Teacher
                teacher = Teacher.objects.filter(
                    id=teacher_id, user__isnull=True, deleted_at__isnull=True
                ).first()
                if not teacher:
                    user.delete()
                    return Response({'error': 'Teacher not found or already linked'}, status=400)
                teacher.user = user
                teacher.save(update_fields=['user'])
        return Response({**UserSerializer(user).data, 'mustChangePassword': True}, status=201)


class MeView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        return Response(UserSerializer(request.user).data)

    def put(self, request):
        serializer = UserSerializer(request.user, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)


class LogoutView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        # Blacklist the refresh token before deleting cookies.
        refresh_token = request.COOKIES.get(settings.SIMPLE_JWT['REFRESH_COOKIE'])
        if refresh_token:
            try:
                from rest_framework_simplejwt.tokens import RefreshToken
                token = RefreshToken(refresh_token)
                token.blacklist()
            except Exception:
                pass  # token already expired/invalid — still safe to clear cookies
        response = Response({'detail': 'Logged out'}, status=status.HTTP_200_OK)
        response.delete_cookie(
            settings.SIMPLE_JWT['ACCESS_COOKIE'],
            samesite=settings.SIMPLE_JWT['AUTH_COOKIE_SAMESITE'],
        )
        response.delete_cookie(
            settings.SIMPLE_JWT['REFRESH_COOKIE'],
            samesite=settings.SIMPLE_JWT['AUTH_COOKIE_SAMESITE'],
        )
        return response


class GetAllUsersView(generics.ListAPIView):
    queryset = User.objects.all()
    serializer_class = UserListSerializer
    permission_classes = [require_permission('users:read')]


class UpdateUserRoleView(generics.UpdateAPIView):
    queryset = User.objects.all()
    serializer_class = UserRoleSerializer
    permission_classes = [require_permission('users:write')]

    def update(self, request, *args, **kwargs):
        partial = kwargs.pop('partial', False)
        instance = self.get_object()
        serializer = self.get_serializer(instance, data=request.data, partial=partial)
        serializer.is_valid(raise_exception=True)
        instance.role = serializer.validated_data['role']
        instance.save(update_fields=['role'])
        return Response(UserSerializer(instance).data)


class DeleteUserView(generics.DestroyAPIView):
    queryset = User.objects.all()
    permission_classes = [require_permission('users:write')]

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        if instance == request.user:
            return Response(
                {'error': 'Cannot delete yourself'},
                status=status.HTTP_400_BAD_REQUEST
            )
        if instance.role == 'admin' and not User.objects.filter(role='admin', is_active=True).exclude(pk=instance.pk).exists():
            return Response(
                {'error': 'Cannot delete the last admin account'},
                status=status.HTTP_400_BAD_REQUEST
            )
        # HARD delete: the row is removed from the database (no soft-delete on
        # User). Reverse relations are either CASCADE (only the user's own rows:
        # engagement responses/streaks, suggestions, password resets,
        # verifications) or SET_NULL (Teacher.user, attendance.marked_by,
        # ai_query logs) — no school data is lost. Refresh tokens stop working
        # immediately via the user-existence check in CustomTokenRefreshView.
        instance.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class AuthGetSessionView(APIView):
    permission_classes = []

    def get(self, request):
        from django.middleware.csrf import get_token
        try:
            from accounts.authentication import CookieJWTAuthentication
            auth_result = CookieJWTAuthentication().authenticate(request)
            if auth_result:
                user, _ = auth_result
                return JsonResponse({'user': {
                    'id': str(user.id),
                    'name': user.name,
                    'email': user.email,
                    'role': user.role,
                    'image': user.image,
                    'emailVerified': user.email_verified,
                    'mustChangePassword': user.must_change_password,
                    'hasTeacherProfile': getattr(user, 'teacher_profile', None) is not None,
                }, 'csrfToken': get_token(request)})
        except (AuthenticationFailed, Exception):
            pass
        return JsonResponse({'user': None, 'csrfToken': get_token(request)})


class RoleChoicesView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        from .models import User
        return Response([
            {'value': code, 'label': label}
            for code, label in User.ROLE_CHOICES
        ])


class SendVerificationView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        user = request.user
        if user.email_verified:
            return Response({'detail': 'Email already verified.'}, status=400)

        EmailVerification.objects.filter(user=user, used=False).update(used=True)
        _send_verification_email(user)
        return Response({'detail': 'Verification email sent.'})


class VerifyEmailView(APIView):
    permission_classes = []
    throttle_classes = [VerifyEmailRateThrottle]

    def post(self, request):
        token = request.data.get('token', '') or request.query_params.get('token', '')
        if not token:
            return Response({'error': 'Token required.'}, status=400)

        try:
            verification = EmailVerification.objects.get(token=token)
        except EmailVerification.DoesNotExist:
            return Response({'error': 'Invalid token.'}, status=400)

        if not verification.is_valid():
            return Response({'error': 'Token expired or already used.'}, status=400)

        verification.used = True
        verification.save(update_fields=['used'])

        verification.user.email_verified = True
        verification.user.save(update_fields=['email_verified'])

        return Response({'detail': 'Email verified successfully.'})


class RequestPasswordResetView(APIView):
    permission_classes = []
    throttle_classes = [PasswordResetRateThrottle]

    def post(self, request):
        serializer = RequestPasswordResetSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        email = serializer.validated_data['email']
        try:
            user = User.objects.get(email=email, is_active=True)
        except User.DoesNotExist:
            return Response({'detail': 'If an account with that email exists, a reset link has been sent.'})

        token = secrets.token_urlsafe(32)
        PasswordReset.objects.create(
            user=user,
            token=token,
            expires_at=timezone.now() + timedelta(hours=1),
        )
        reset_url = f'{settings.FRONTEND_URL}/#/reset-password?token={token}'
        try:
            send_mail(
                subject='Reset your password - AL RAWA English School',
                message=(
                    f'You requested a password reset.\n\n'
                    f'Click the link to reset your password:\n{reset_url}\n\n'
                    f'This link expires in 1 hour.\n'
                    f'If you did not request this, please ignore this email.'
                ),
                from_email=settings.DEFAULT_FROM_EMAIL,
                recipient_list=[user.email],
                fail_silently=False,
            )
        except Exception:
            logger.exception('Failed to send password reset email to %s', user.email)

        return Response({'detail': 'If an account with that email exists, a reset link has been sent.'})


class ResetPasswordView(APIView):
    permission_classes = []
    throttle_classes = [PasswordResetRateThrottle]

    def post(self, request):
        serializer = ResetPasswordSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        token = serializer.validated_data['token']
        try:
            reset = PasswordReset.objects.get(token=token)
        except PasswordReset.DoesNotExist:
            return Response({'error': 'Invalid token.'}, status=400)

        if not reset.is_valid():
            return Response({'error': 'Token expired or already used.'}, status=400)

        reset.used = True
        reset.save(update_fields=['used'])

        reset.user.set_password(serializer.validated_data['password'])
        reset.user.save(update_fields=['password'])

        return Response({'detail': 'Password reset successful.'})


class ChangePasswordView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        serializer = ChangePasswordSerializer(data=request.data, context={'request': request})
        serializer.is_valid(raise_exception=True)
        pin = serializer.validated_data.get('pin')
        with db_transaction.atomic():
            request.user.set_password(serializer.validated_data['new_password'])
            request.user.must_change_password = False
            request.user.save(update_fields=['password', 'must_change_password'])
            if pin:
                teacher_profile = getattr(request.user, 'teacher_profile', None)
                if teacher_profile is not None:
                    teacher_profile.pin = make_password(pin)
                    teacher_profile.save(update_fields=['pin'])
        return Response({'detail': 'Password changed successfully.'})


class LinkChildView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        from students.models import Student
        from parents.models import ParentStudentLink
        import json

        if request.user.email:
            from core.models import SchoolSetting
            setting = SchoolSetting.objects.filter(key='blocked_parent_emails').first()
            if setting:
                blocked = json.loads(setting.value)
                if request.user.email.lower() in [e.lower() for e in blocked]:
                    return Response(
                        {'error': 'Your email is not authorized to link children. Contact the school.'},
                        status=403,
                    )

        serializer = LinkChildSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        student_id = data.get('student_id', '').strip()
        if student_id:
            student = Student.objects.filter(
                student_id=student_id, deleted_at__isnull=True,
            ).first()
            if not student:
                return Response({'error': 'Student not found with that ID'}, status=400)
        elif data.get('child_name') and data.get('phone'):
            filters = {
                'name__iexact': data['child_name'],
                'contact': data['phone'],
                'deleted_at__isnull': True,
            }
            # Only narrow by optional fields the parent actually provided.
            if data.get('roll'):
                filters['roll'] = data['roll']
            if data.get('father_name'):
                filters['father_name__iexact'] = data['father_name']
            if data.get('mother_name'):
                filters['mother_name__iexact'] = data['mother_name']
            student = Student.objects.filter(**filters).first()
            if not student:
                return Response(
                    {'error': 'Student not found with these details. Check with the school.'},
                    status=400,
                )
        else:
            return Response(
                {'error': 'Provide studentId OR child details (name + phone required)'},
                status=400,
            )

        if ParentStudentLink.objects.filter(parent=request.user, student=student).exists():
            return Response({'error': 'Already linked'}, status=409)

        siblings = Student.objects.filter(
            contact=student.contact, deleted_at__isnull=True,
        )
        for sib in siblings:
            ParentStudentLink.objects.get_or_create(parent=request.user, student=sib)

        return Response({
            'status': 'linked',
            'studentName': student.name,
            'className': student.school_class.name if student.school_class else '',
        }, status=201)


class UnlinkChildView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        from parents.models import ParentStudentLink
        student_id = request.data.get('studentId')
        if not student_id:
            return Response({'error': 'studentId required'}, status=400)
        deleted, _ = ParentStudentLink.objects.filter(
            parent=request.user, student_id=student_id,
        ).delete()
        if deleted:
            return Response({'status': 'unlinked'})
        return Response({'error': 'Link not found'}, status=404)
