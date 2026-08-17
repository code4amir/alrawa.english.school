"""Phase 2 tests: SupabaseJWTAuthentication (accounts/authentication.py).

Run via the alrawa launcher (redaction-proof env injection):
  python scripts/dev-backend.py test accounts.tests_supabase_auth -v 2
"""
import time
import uuid

import jwt
from django.test import TestCase, override_settings
from rest_framework.exceptions import AuthenticationFailed
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.test import APIRequestFactory
from rest_framework.views import APIView

from accounts.authentication import SupabaseJWTAuthentication
from accounts.models import User

TEST_SECRET = "test-s…cret"
TEST_ISSUER = "http://127.0.0.1:54321/auth/v1"

CONFIGURED = {
    "SUPABASE_JWT_SECRET": TEST_SECRET,
    "SUPABASE_JWT_ISSUER": TEST_ISSUER,
}


def make_token(sub, signing_key=None, issuer=TEST_ISSUER, aud="authenticated",
               exp_delta=3600, **extra):
    # NOTE: default resolved here — the tooling redaction layer rewrites
    # literal 'secret=' kwarg defaults into '***'.
    if signing_key is None:
        signing_key = TEST_SECRET
    payload = {
        "iss": issuer,
        "sub": sub,
        "aud": aud,
        "exp": int(time.time()) + exp_delta,
        "iat": int(time.time()),
        "role": "authenticated",
    }
    payload.update(extra)
    return jwt.encode(payload, signing_key, algorithm="HS256")


def request_with_bearer(token):
    factory = APIRequestFactory()
    request = factory.get("/api/anything/")
    if token is not None:
        request.META["HTTP_AUTHORIZATION"] = f"Bearer {token}"
    return request


class _ProtectedView(APIView):
    """Minimal IsAuthenticated view to exercise the full DRF auth chain."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response({"user_id": str(request.user.id)})


@override_settings(**CONFIGURED)
class SupabaseJWTAuthenticationTests(TestCase):
    def setUp(self):
        self.auth = SupabaseJWTAuthentication()
        self.user = User.objects.create_user(
            email="sbuser@alrawa.test", name="SB User", role="teacher",
        )

    # --- happy path -------------------------------------------------------
    def test_valid_token_returns_user(self):
        token = make_token(str(self.user.id))
        user, payload = self.auth.authenticate(request_with_bearer(token))
        self.assertEqual(user.id, self.user.id)
        self.assertEqual(payload["sub"], str(self.user.id))

    def test_valid_token_through_full_drf_chain(self):
        """Supabase token must authenticate via DEFAULT_AUTHENTICATION_CLASSES
        (CookieJWT first, Supabase second) on a protected view."""
        token = make_token(str(self.user.id))
        response = _ProtectedView.as_view()(request_with_bearer(token))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["user_id"], str(self.user.id))

    # --- fall-through (returns None, next authenticator decides) ----------
    def test_no_auth_header_returns_none(self):
        self.assertIsNone(self.auth.authenticate(request_with_bearer(None)))

    def test_non_bearer_header_returns_none(self):
        request = request_with_bearer(None)
        request.META["HTTP_AUTHORIZATION"] = "Basic abc"
        self.assertIsNone(self.auth.authenticate(request))

    def test_non_jwt_bearer_returns_none(self):
        self.assertIsNone(self.auth.authenticate(request_with_bearer("not-a-jwt")))

    def test_foreign_issuer_returns_none(self):
        """SimpleJWT / foreign tokens fall through to other authenticators."""
        token = make_token(str(self.user.id), issuer="http://django-simplejwt")
        self.assertIsNone(self.auth.authenticate(request_with_bearer(token)))

    @override_settings(SUPABASE_JWT_SECRET="", SUPABASE_JWT_ISSUER="")
    def test_dormant_when_unconfigured(self):
        """Without secret+issuer the class is a no-op (production default)."""
        token = make_token(str(self.user.id))
        self.assertIsNone(self.auth.authenticate(request_with_bearer(token)))

    # --- rejection (raises AuthenticationFailed -> 401) -------------------
    def test_expired_token_rejected(self):
        token = make_token(str(self.user.id), exp_delta=-100)
        with self.assertRaises(AuthenticationFailed):
            self.auth.authenticate(request_with_bearer(token))

    def test_wrong_signature_rejected(self):
        token = make_token(str(self.user.id), signing_key="wrong-signing-key")
        with self.assertRaises(AuthenticationFailed):
            self.auth.authenticate(request_with_bearer(token))

    def test_wrong_audience_rejected(self):
        token = make_token(str(self.user.id), aud="service_role")
        with self.assertRaises(AuthenticationFailed):
            self.auth.authenticate(request_with_bearer(token))

    def test_unknown_sub_rejected(self):
        token = make_token(str(uuid.uuid4()))
        with self.assertRaises(AuthenticationFailed):
            self.auth.authenticate(request_with_bearer(token))

    def test_inactive_user_rejected(self):
        self.user.is_active = False
        self.user.save()
        token = make_token(str(self.user.id))
        with self.assertRaises(AuthenticationFailed):
            self.auth.authenticate(request_with_bearer(token))

    def test_missing_sub_rejected(self):
        payload = {
            "iss": TEST_ISSUER, "aud": "authenticated",
            "exp": int(time.time()) + 3600,
        }
        token = jwt.encode(payload, TEST_SECRET, algorithm="HS256")
        with self.assertRaises(AuthenticationFailed):
            self.auth.authenticate(request_with_bearer(token))

    # --- get-session integration ------------------------------------------
    def test_get_session_accepts_supabase_token(self):
        token = make_token(str(self.user.id))
        response = self.client.get(
            "/api/auth/get-session/",
            HTTP_AUTHORIZATION=f"Bearer {token}",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["user"]["id"], str(self.user.id))
        self.assertEqual(response.json()["user"]["role"], "teacher")

    def test_get_session_anonymous_still_works(self):
        response = self.client.get("/api/auth/get-session/")
        self.assertEqual(response.status_code, 200)
        self.assertIsNone(response.json()["user"])


# --- JWKS mode (modern GoTrue signs ES256; no shared secret) ---------------
from unittest.mock import patch as mock_patch

from cryptography.hazmat.primitives.asymmetric import ec


class _StubSigningKey:
    def __init__(self, key):
        self.key = key


class _StubJWKClient:
    def __init__(self, public_key):
        self._public_key = public_key

    def get_signing_key_from_jwt(self, raw_token):
        return _StubSigningKey(self._public_key)


def make_es256_token(sub, private_key, issuer=TEST_ISSUER, aud="authenticated",
                     exp_delta=3600, **extra):
    payload = {
        "iss": issuer,
        "sub": sub,
        "aud": aud,
        "exp": int(time.time()) + exp_delta,
        "iat": int(time.time()),
        "role": "authenticated",
    }
    payload.update(extra)
    return jwt.encode(payload, private_key, algorithm="ES256",
                      headers={"kid": "test-kid"})


@override_settings(SUPABASE_JWT_SECRET="", SUPABASE_JWT_ISSUER=TEST_ISSUER)
class SupabaseJWKSModeTests(TestCase):
    """JWKS verification path: ES256 tokens, public key via (stubbed) JWKS."""

    def setUp(self):
        self.auth = SupabaseJWTAuthentication()
        self.user = User.objects.create_user(
            email="jwksuser@alrawa.test", name="JWKS User", role="teacher",
        )
        self.private_key = ec.generate_private_key(ec.SECP256R1())
        self.public_key = self.private_key.public_key()
        self.client_patcher = mock_patch.object(
            SupabaseJWTAuthentication, "_get_jwks_client",
            return_value=_StubJWKClient(self.public_key),
        )
        self.client_patcher.start()
        self.addCleanup(self.client_patcher.stop)

    def test_valid_es256_token_returns_user(self):
        token = make_es256_token(str(self.user.id), self.private_key)
        user, payload = self.auth.authenticate(request_with_bearer(token))
        self.assertEqual(user.id, self.user.id)
        self.assertEqual(payload["sub"], str(self.user.id))

    def test_valid_es256_token_through_full_drf_chain(self):
        token = make_es256_token(str(self.user.id), self.private_key)
        response = _ProtectedView.as_view()(request_with_bearer(token))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["user_id"], str(self.user.id))

    def test_wrong_key_rejected(self):
        other_key = ec.generate_private_key(ec.SECP256R1())
        token = make_es256_token(str(self.user.id), other_key)
        with self.assertRaises(AuthenticationFailed):
            self.auth.authenticate(request_with_bearer(token))

    def test_expired_es256_rejected(self):
        token = make_es256_token(str(self.user.id), self.private_key, exp_delta=-100)
        with self.assertRaises(AuthenticationFailed):
            self.auth.authenticate(request_with_bearer(token))

    def test_hs256_token_rejected_in_jwks_mode(self):
        """Algorithm-confusion guard: an HS256 token must not pass when the
        authenticator is in JWKS mode (only ES256/RS256 allowed)."""
        token = make_token(str(self.user.id))  # HS256 helper
        with self.assertRaises(AuthenticationFailed):
            self.auth.authenticate(request_with_bearer(token))

    def test_get_session_accepts_es256_token(self):
        token = make_es256_token(str(self.user.id), self.private_key)
        response = self.client.get(
            "/api/auth/get-session/",
            HTTP_AUTHORIZATION=f"Bearer {token}",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["user"]["id"], str(self.user.id))
