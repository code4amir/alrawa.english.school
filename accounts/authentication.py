from django.conf import settings
from django.core.exceptions import ValidationError
from rest_framework.authentication import BaseAuthentication
from rest_framework.exceptions import AuthenticationFailed, PermissionDenied
from rest_framework_simplejwt.authentication import JWTAuthentication
from rest_framework_simplejwt.tokens import AccessToken
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework.authentication import CSRFCheck
import jwt


def _dummy_get_response(request):
    return None


class CookieJWTAuthentication(JWTAuthentication):
    """JWT authentication that reads tokens from httponly cookies.

    Header-based auth (Authorization: Bearer) cannot be forged cross-origin,
    so it is inherently CSRF-safe. Cookie-based auth is the vulnerable path:
    enforce CSRF there so a cross-site request carrying only cookies is
    rejected unless it echoes a valid X-CSRFToken.
    """

    def enforce_csrf(self, request):
        check = CSRFCheck(_dummy_get_response)
        # populates request.META['CSRF_COOKIE'], which is used in process_view()
        check.process_request(request)
        reason = check.process_view(request, None, (), {})
        if reason:
            # CSRF failed, bail with explicit error message
            raise PermissionDenied('CSRF Failed: %s' % reason)

    def authenticate(self, request):
        # Try Authorization header first (backward compat).
        # If it fails (e.g. PIN token without user_id), fall through quietly.
        try:
            header_result = super().authenticate(request)
            if header_result:
                return header_result
        except AuthenticationFailed:
            pass

        # Fall back to cookie
        raw_token = request.COOKIES.get(settings.SIMPLE_JWT.get('ACCESS_COOKIE', 'access_token'))
        if not raw_token:
            return None

        try:
            validated_token = self.get_validated_token(raw_token)
        except Exception:
            return None

        # Cookie-auth is the CSRF-vulnerable path: require a valid token.
        self.enforce_csrf(request)

        try:
            return self.get_user(validated_token), validated_token
        except Exception:
            return None


class PinAuthentication(BaseAuthentication):
    """PIN JWT auth for mobile endpoints. Sets request.user to Teacher instance."""

    def authenticate(self, request):
        auth = request.headers.get('Authorization', '')
        if not auth.startswith('Bearer '):
            return None
        raw = auth.split(' ', 1)[1]
        if not raw:
            return None
        try:
            validated = AccessToken(raw)
            if not validated.get('pin_auth'):
                return None
            teacher_id = validated.get('teacher_id')
            if not teacher_id:
                return None
            from teachers.models import Teacher
            teacher = Teacher.objects.get(id=teacher_id, deleted_at__isnull=True)
            teacher.is_authenticated = True  # ponytail: duck-punch for DRF compat
            return (teacher, validated)
        except (TokenError, Teacher.DoesNotExist):
            return None


class SupabaseJWTAuthentication(BaseAuthentication):
    """Phase 2: accept Supabase (GoTrue) access tokens.

    Additive and dormant until configured: returns None (fall through to the
    next authenticator) unless SUPABASE_JWT_SECRET is set AND the token's
    issuer matches SUPABASE_JWT_ISSUER. A token that claims to be Supabase
    but fails verification raises AuthenticationFailed (401) — it is never
    silently passed to the next authenticator.

    The JWT `sub` claim is the user's UUID, which equals Django User.pk
    because scripts/migrate-users-to-supabase.py preserves UUIDs.

    Bearer tokens are CSRF-safe (not auto-attached by the browser), so no
    CSRF enforcement is needed here — same reasoning as the header path in
    CookieJWTAuthentication.
    """

    def authenticate(self, request):
        secret = getattr(settings, "SUPABASE_JWT_SECRET", "") or ""
        issuer = getattr(settings, "SUPABASE_JWT_ISSUER", "") or ""
        if not secret or not issuer:
            return None  # dormant — SimpleJWT/cookie path unchanged

        auth = request.headers.get("Authorization", "")
        if not auth.startswith("Bearer "):
            return None
        raw = auth.split(" ", 1)[1].strip()
        if not raw:
            return None

        # Peek at the unverified payload to decide whether this token is
        # Supabase-issued before spending a signature check on it.
        try:
            unverified = jwt.decode(raw, options={"verify_signature": False})
        except jwt.PyJWTError:
            return None  # not even a JWT — let other authenticators try
        if unverified.get("iss") != issuer:
            return None  # SimpleJWT token or foreign issuer — not ours

        try:
            payload = jwt.decode(
                raw,
                secret,
                algorithms=["HS256"],
                audience="authenticated",
                issuer=issuer,
                options={"require": ["exp", "iss", "sub"]},
            )
        except jwt.ExpiredSignatureError:
            raise AuthenticationFailed("Supabase token expired")
        except jwt.PyJWTError as exc:
            raise AuthenticationFailed(f"Invalid Supabase token: {exc}")

        sub = payload.get("sub") or ""
        try:
            from django.contrib.auth import get_user_model
            user = get_user_model().objects.get(pk=sub)
        except (ValidationError, get_user_model().DoesNotExist):
            raise AuthenticationFailed("User not found for Supabase token")
        if not user.is_active:
            raise AuthenticationFailed("User inactive or deleted")
        return (user, payload)

    def authenticate_header(self, request):
        return "Bearer"
