from django.db import models
from django.db.models import Q
import uuid


class Student(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    school_class = models.ForeignKey(
        'core.SchoolClass', on_delete=models.SET_NULL,
        blank=True, null=True, related_name='students'
    )
    program = models.ForeignKey(
        'core.Program', on_delete=models.SET_NULL,
        blank=True, null=True, related_name='students'
    )
    student_id = models.CharField(max_length=20, unique=True)
    roll = models.CharField(max_length=255, blank=True, default='')
    session = models.CharField(max_length=255, blank=True, default='')
    name = models.CharField(max_length=255)
    father_name = models.CharField(max_length=255, blank=True, default='')
    mother_name = models.CharField(max_length=255, blank=True, default='')
    contact = models.CharField(max_length=255, blank=True, default='')
    photo_path = models.TextField(blank=True, default='')
    deleted_at = models.DateTimeField(blank=True, null=True)
    graduated_at = models.DateTimeField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = 'Student'
        verbose_name_plural = 'Students'
        indexes = [
            models.Index(fields=['session']),
            models.Index(fields=['school_class_id', 'deleted_at'], name='student_class_active_idx'),
            models.Index(fields=['deleted_at', 'session'], name='student_session_active_idx'),
        ]
        constraints = [
            models.UniqueConstraint(fields=['roll', 'school_class'], name='unique_roll_per_class', condition=Q(roll__gt='')),
        ]

    def __str__(self):
        return f"{self.name} ({self.student_id})"


class StudentService(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    student = models.ForeignKey(
        Student, on_delete=models.CASCADE,
        related_name='services'
    )
    service_type = models.ForeignKey(
        'core.ServiceType', on_delete=models.CASCADE,
        related_name='student_services'
    )
    active = models.BooleanField(default=True)
    starts_at = models.CharField(max_length=7, blank=True, null=True, help_text='Month string YYYY-MM')
    ends_at = models.CharField(max_length=7, blank=True, null=True, help_text='Month string YYYY-MM')
    auto_assigned = models.BooleanField(default=True, help_text='Auto-managed by student service toggle')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['student', 'service_type'], name='unique_student_service'),
        ]
        verbose_name = 'student service'
        verbose_name_plural = 'student services'

    def __str__(self):
        return f"{self.student.name} - {self.service_type.name}"
