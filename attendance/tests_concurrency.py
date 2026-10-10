"""Concurrent attendance writes.

Two teachers marking DIFFERENT classes at the same moment must never
interfere. Two teachers marking the SAME class/date is a genuine
last-write-wins race (no lock, no lockout) — documented here so the
behavior is pinned rather than accidental.
"""
import threading

from django.contrib.auth import get_user_model
from django.db import connections
from django.test import TestCase, TransactionTestCase
from rest_framework.test import APIClient

from core.models import SchoolClass
from students.models import Student
from teachers.models import ClassTeacher, Teacher
from attendance.models import AttendanceRecord

User = get_user_model()


def _mk_teacher_user(email, klass):
    user = User.objects.create_user(
        email=email, name=email.split('@')[0], password='x', role='teacher',
        email_verified=True)
    t = Teacher.objects.create(name=user.name, designation='T')
    t.user = user
    t.save(update_fields=['user'])
    ClassTeacher.objects.create(teacher=t, school_class=klass)
    return user, t


class AttendanceConcurrencyTests(TransactionTestCase):
    """Real threads + real connections: proves the DB constraint, not mocks."""

    reset_sequences = True

    def setUp(self):
        self.classes = [SchoolClass.objects.create(name=f'C{i}', order=i) for i in range(4)]
        self.students = []
        for i, k in enumerate(self.classes):
            self.students.append([
                Student.objects.create(
                    name=f'S{i}-{j}', student_id=f'X{i}{j}', school_class=k)
                for j in range(5)
            ])
        self.u1, self.t1 = _mk_teacher_user('t1@x.com', self.classes[0])
        self.u2, self.t2 = _mk_teacher_user('t2@x.com', self.classes[1])

    def _client(self, user):
        c = APIClient()
        c.force_authenticate(user)
        return c

    def _post(self, client, klass, students, date='2026-09-15', status='present'):
        records = {str(s.id): status for s in students}
        res = client.post('/api/attendance/batch/', {
            'school_class': str(klass.id), 'date': date,
            'term': '1', 'session': '2026', 'records': records,
        }, format='json')
        return res

    def test_two_teachers_different_classes_both_persist(self):
        """Different classes, same date, fired simultaneously: no loss."""
        results = {}

        def work(tag, client, klass, students):
            try:
                results[tag] = self._post(client, klass, students)
            finally:
                connections.close_all()

        threads = [
            threading.Thread(target=work, args=('a', self._client(self.u1),
                                               self.classes[0], self.students[0])),
            threading.Thread(target=work, args=('b', self._client(self.u2),
                                               self.classes[1], self.students[1])),
        ]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=30)

        self.assertEqual(results['a'].status_code, 200)
        self.assertEqual(results['b'].status_code, 200)
        # Every student from BOTH classes saved — nothing clobbered.
        for s in self.students[0]:
            self.assertTrue(
                AttendanceRecord.objects.filter(
                    student=s, date='2026-09-15', status='present').exists(),
                msg=f'{s.name} lost')
        for s in self.students[1]:
            self.assertTrue(
                AttendanceRecord.objects.filter(
                    student=s, date='2026-09-15', status='present').exists(),
                msg=f'{s.name} lost')

    def test_every_student_in_class_persists_together(self):
        """One submit writes the WHOLE class - no partial class saved."""
        res = self._post(self._client(self.u1), self.classes[0], self.students[0])
        self.assertEqual(res.status_code, 200)
        self.assertEqual(
            AttendanceRecord.objects.filter(
                school_class=self.classes[0], date='2026-09-15').count(), 5)

    def test_same_class_double_submit_is_last_write_wins(self):
        """Documented race: no lock, so the second submit overwrites."""
        self._post(self._client(self.u1), self.classes[0],
                   self.students[0], status='present')
        res = self._post(self._client(self.u1), self.classes[0],
                         self.students[0], status='absent')
        self.assertEqual(res.status_code, 200)
        # Still exactly one row per student (no duplicates).
        self.assertEqual(
            AttendanceRecord.objects.filter(
                school_class=self.classes[0], date='2026-09-15').count(), 5)
        self.assertEqual(
            AttendanceRecord.objects.filter(
                school_class=self.classes[0], date='2026-09-15',
                status='absent').count(), 5)

    def test_unique_constraint_blocks_duplicate_rows(self):
        """The DB, not just the app, prevents two rows per student/date."""
        from django.db import IntegrityError, transaction
        s = self.students[0][0]
        AttendanceRecord.objects.create(
            student=s, school_class=self.classes[0], date='2026-09-15',
            term='1', session='2026', status='present')
        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                AttendanceRecord.objects.create(
                    student=s, school_class=self.classes[0], date='2026-09-15',
                    term='1', session='2026', status='absent')
