from django.test import TestCase
from rest_framework.test import APIClient
from django.contrib.auth import get_user_model
from rest_framework_simplejwt.tokens import RefreshToken

User = get_user_model()


class AccountTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = User.objects.create_superuser(
            email='admin@test.com', name='Admin', password='testpass123', email_verified=True
        )

    def _auth(self, user=None):
        u = user or self.admin
        refresh = RefreshToken.for_user(u)
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {refresh.access_token}')

    def test_login(self):
        res = self.client.post('/api/auth/login/', {'email': 'admin@test.com', 'password': 'testpass123'})
        self.assertEqual(res.status_code, 200)
        self.assertIn('access_token', res.cookies)
        self.assertIn('refresh_token', res.cookies)
        self.assertIn('access', res.data)
        self.assertNotIn('refresh', res.data)  # refresh is cookie-only now

    def test_login_wrong_password(self):
        res = self.client.post('/api/auth/login/', {'email': 'admin@test.com', 'password': 'wrong'})
        self.assertEqual(res.status_code, 401)

    def test_login_unverified_email(self):
        User.objects.create_user(email='unverified@test.com', name='Unverified', password='testpass123', email_verified=False)
        res = self.client.post('/api/auth/login/', {'email': 'unverified@test.com', 'password': 'testpass123'})
        self.assertEqual(res.status_code, 401)
        self.assertIn('Email not verified', str(res.data))

    def test_get_session(self):
        self._auth()
        res = self.client.get('/api/auth/get-session/')
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data['user']['email'], 'admin@test.com')

    def test_get_session_unauthorized(self):
        res = self.client.get('/api/auth/get-session/')
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertIsNone(data['user'])

    def test_refresh_token(self):
        refresh = RefreshToken.for_user(self.admin)
        self.client.cookies['refresh_token'] = str(refresh)
        res = self.client.post('/api/auth/refresh/')
        self.assertEqual(res.status_code, 200)
        self.assertIn('access_token', res.cookies)

    def test_list_users(self):
        self._auth()
        res = self.client.get('/api/users/')
        self.assertEqual(res.status_code, 200)
        self.assertGreaterEqual(len(res.data), 1)

    def test_update_user_role(self):
        self._auth()
        user = User.objects.create_user(name='Staff', email='staff@test.com', password='pass123', role='teacher')
        res = self.client.put(f'/api/users/{user.id}/role/', {'role': 'admin'})
        self.assertEqual(res.status_code, 200)
        user.refresh_from_db()
        self.assertEqual(user.role, 'admin')

    def test_delete_user(self):
        self._auth()
        user = User.objects.create_user(name='Del', email='del@test.com', password='pass123', role='teacher')
        res = self.client.delete(f'/api/users/{user.id}/')
        self.assertEqual(res.status_code, 204)
        self.assertEqual(User.objects.count(), 1)
