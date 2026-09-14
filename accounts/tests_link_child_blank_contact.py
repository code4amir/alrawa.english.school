from django.test import TestCase
from rest_framework.test import APIClient
from django.contrib.auth import get_user_model
from rest_framework_simplejwt.tokens import RefreshToken
from students.models import Student
from core.models import SchoolClass
from parents.models import ParentStudentLink

User = get_user_model()


class LinkChildBlankContactTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.parent = User.objects.create_user(
            email='blankcontact@test.com', name='Parent', password='pass12345',
            role='parent', email_verified=True,
        )
        self.klass = SchoolClass.objects.create(name='Class 5')
        self.student_a = Student.objects.create(
            student_id='S-BLANK-1', name='Blank One', contact='',
            school_class=self.klass,
        )
        self.student_b = Student.objects.create(
            student_id='S-BLANK-2', name='Blank Two', contact='',
            school_class=self.klass,
        )
        refresh = RefreshToken.for_user(self.parent)
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {refresh.access_token}')

    def test_blank_contact_links_only_requested_student(self):
        res = self.client.post('/api/auth/link-child/', {'student_id': 'S-BLANK-1'})
        self.assertEqual(res.status_code, 201, res.data)
        self.assertTrue(
            ParentStudentLink.objects.filter(parent=self.parent, student=self.student_a).exists()
        )
        self.assertFalse(
            ParentStudentLink.objects.filter(parent=self.parent, student=self.student_b).exists()
        )


class LinkChildSiblingFanoutTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.parent = User.objects.create_user(
            email='siblingfan@test.com', name='Parent', password='pass12345',
            role='parent', email_verified=True,
        )
        self.klass = SchoolClass.objects.create(name='Class 6')
        self.student_a = Student.objects.create(
            student_id='S-SIB-1', name='Sib One', contact='01710000009',
            school_class=self.klass,
        )
        self.student_b = Student.objects.create(
            student_id='S-SIB-2', name='Sib Two', contact='01710000009',
            school_class=self.klass,
        )
        refresh = RefreshToken.for_user(self.parent)
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {refresh.access_token}')

    def test_shared_contact_links_siblings_too(self):
        res = self.client.post('/api/auth/link-child/', {'student_id': 'S-SIB-1'})
        self.assertEqual(res.status_code, 201, res.data)
        self.assertTrue(
            ParentStudentLink.objects.filter(parent=self.parent, student=self.student_a).exists()
        )
        self.assertTrue(
            ParentStudentLink.objects.filter(parent=self.parent, student=self.student_b).exists()
        )
