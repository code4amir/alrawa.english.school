import uuid
from django.conf import settings
from django.db import models


class Holiday(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    date = models.DateField(unique=True)
    name = models.CharField(max_length=255)
    type = models.CharField(
        max_length=10,
        choices=[('public', 'Public'), ('school', 'School Event')],
        default='public',
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-date']

    def __str__(self):
        return f"{self.name} ({self.date})"


class AttendanceRecord(models.Model):
    STATUS_CHOICES = [
        ('present', 'Present'),
        ('absent', 'Absent'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    student = models.ForeignKey(
        'students.Student', on_delete=models.PROTECT,
        related_name='attendance_records',
    )
    school_class = models.ForeignKey('core.SchoolClass', on_delete=models.CASCADE)
    date = models.DateField()
    term = models.CharField(max_length=255)
    session = models.CharField(max_length=255)
    status = models.CharField(max_length=10, choices=STATUS_CHOICES)
    marked_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
        null=True, blank=True,
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['student', 'date'], name='unique_student_date'),
        ]
        indexes = [
            models.Index(fields=['school_class', 'date']),
            models.Index(fields=['student', 'date']),
            models.Index(fields=['term', 'session']),
        ]
        ordering = ['-date']

    def __str__(self):
        return f"{self.student.name} - {self.date}: {self.status}"
