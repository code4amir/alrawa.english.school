"""Regression tests for the scheduler non-integer pk guard.

Non-integer ids must return 404, never bubble into the upstream-error
handler as 502.
"""
from django.test import TestCase
from rest_framework.test import APIClient
from django.contrib.auth import get_user_model
from rest_framework_simplejwt.tokens import RefreshToken

User = get_user_model()


def _auth(client):
    user = User.objects.create_superuser(
        email='admin@test.com', name='Admin', password='testpass123')
    refresh = RefreshToken.for_user(user)
    client.credentials(HTTP_AUTHORIZATION=f'Bearer {refresh.access_token}')
    return user


class SchedulerPkTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        _auth(self.client)

    def test_retrieve_non_int_pk_404(self):
        res = self.client.get('/api/scheduler/abc/')
        self.assertEqual(res.status_code, 404, res.content[:300])

    def test_update_non_int_pk_404(self):
        res = self.client.put('/api/scheduler/abc/', {}, format='json')
        self.assertEqual(res.status_code, 404, res.content[:300])

    def test_destroy_non_int_pk_404(self):
        res = self.client.delete('/api/scheduler/abc/')
        self.assertEqual(res.status_code, 404, res.content[:300])

    def test_run_non_int_pk_404(self):
        res = self.client.post('/api/scheduler/abc/run/')
        self.assertEqual(res.status_code, 404, res.content[:300])
