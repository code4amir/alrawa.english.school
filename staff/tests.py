from django.test import TestCase
from rest_framework.test import APIClient
from django.contrib.auth import get_user_model
from rest_framework_simplejwt.tokens import RefreshToken
from .models import Staff

User = get_user_model()


def _auth(client):
    user = User.objects.create_superuser(email='admin@test.com', name='Admin', password='testpass123')
    refresh = RefreshToken.for_user(user)
    client.credentials(HTTP_AUTHORIZATION=f'Bearer {refresh.access_token}')
    return user


class StaffTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        _auth(self.client)

    def test_create_staff(self):
        res = self.client.post('/api/staff/', {'name': 'Staff 1', 'role': 'Clerk', 'contact': '123', 'email': 'staff@test.com'})
        self.assertEqual(res.status_code, 201)
        self.assertEqual(Staff.objects.count(), 1)
        self.assertIn('hasPhoto', res.data)

    def test_list_staff(self):
        Staff.objects.create(name='S1', role='Clerk')
        Staff.objects.create(name='S2', role='Guard')
        res = self.client.get('/api/staff/')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(res.data['results']), 2)

    def test_retrieve_staff(self):
        s = Staff.objects.create(name='S1', role='Clerk')
        res = self.client.get(f'/api/staff/{s.id}/')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['name'], 'S1')

    def test_update_staff(self):
        s = Staff.objects.create(name='S1', role='Clerk')
        res = self.client.put(f'/api/staff/{s.id}/', {'name': 'Updated', 'role': 'Accountant'})
        self.assertEqual(res.status_code, 200)
        s.refresh_from_db()
        self.assertEqual(s.name, 'Updated')

    def test_delete_staff_soft(self):
        s = Staff.objects.create(name='S1', role='Clerk')
        res = self.client.delete(f'/api/staff/{s.id}/')
        self.assertEqual(res.status_code, 204)
        s.refresh_from_db()
        self.assertIsNotNone(s.deleted_at)

    def test_restore_staff(self):
        s = Staff.objects.create(name='S1', role='Clerk')
        self.client.delete(f'/api/staff/{s.id}/')
        res = self.client.post(f'/api/staff/{s.id}/restore/')
        self.assertEqual(res.status_code, 200)
        s.refresh_from_db()
        self.assertIsNone(s.deleted_at)

    def test_photo_no_photo(self):
        s = Staff.objects.create(name='S1', role='Clerk')
        res = self.client.get(f'/api/staff/{s.id}/photo/')
        self.assertEqual(res.status_code, 404)

    def test_serializer_has_photo(self):
        s = Staff.objects.create(name='S1', role='Clerk')
        res = self.client.get(f'/api/staff/{s.id}/')
        self.assertIn('hasPhoto', res.data)

    def test_create_staff_missing_name(self):
        res = self.client.post('/api/staff/', {'role': 'Clerk'})
        self.assertEqual(res.status_code, 400)


class MonitorStaffAccessTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.monitor = User.objects.create_user(
            email='monitor@test.com', name='Monitor', password='testpass123', role='monitor')
        refresh = RefreshToken.for_user(self.monitor)
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {refresh.access_token}')

    def test_monitor_can_create_staff(self):
        res = self.client.post('/api/staff/', {'name': 'Guard 1', 'role': 'Guard'})
        self.assertEqual(res.status_code, 201)

    def test_monitor_can_update_and_delete_staff(self):
        s = Staff.objects.create(name='S1', role='Clerk')
        res = self.client.put(f'/api/staff/{s.id}/', {'name': 'S1x', 'role': 'Clerk'})
        self.assertEqual(res.status_code, 200)
        res = self.client.delete(f'/api/staff/{s.id}/')
        self.assertEqual(res.status_code, 204)
