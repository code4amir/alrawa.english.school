import uuid
from django.db import models
from django.db.models import Q


class Teacher(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.OneToOneField(
        'accounts.User', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='teacher_profile',
    )
    designation = models.CharField(max_length=255)
    name = models.CharField(max_length=255)
    email = models.EmailField(blank=True, default='')
    contact = models.CharField(max_length=255, blank=True, default='')
    photo_path = models.TextField(blank=True, default='')
    pin = models.CharField(max_length=128, blank=True, default='')
    deleted_at = models.DateTimeField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = 'Teacher'
        verbose_name_plural = 'Teachers'
        indexes = [
            models.Index(fields=['name']),
            models.Index(fields=['designation']),
            models.Index(fields=['deleted_at']),
        ]

    def __str__(self):
        return f"{self.name} ({self.designation})"


class ClassTeacher(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    teacher = models.ForeignKey(
        Teacher, on_delete=models.CASCADE, related_name='class_teacher_of',
    )
    school_class = models.ForeignKey(
        'core.SchoolClass', on_delete=models.CASCADE, related_name='class_teachers',
    )
    is_primary = models.BooleanField(default=False, help_text='Lead class teacher — at most one per class')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = 'Class Teacher'
        verbose_name_plural = 'Class Teachers'
        constraints = [
            models.UniqueConstraint(
                fields=['teacher', 'school_class'],
                name='unique_class_teacher',
            ),
            models.UniqueConstraint(
                fields=['school_class'],
                condition=Q(is_primary=True),
                name='one_primary_class_teacher',
            ),
        ]

    def __str__(self):
        return f"{self.teacher.name} → {self.school_class.name}"


class TeacherSubject(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    teacher = models.ForeignKey(
        Teacher, on_delete=models.CASCADE, related_name='subject_assignments',
    )
    subject = models.ForeignKey(
        'core.Subject', on_delete=models.CASCADE, related_name='teacher_assignments',
    )
    school_class = models.ForeignKey(
        'core.SchoolClass', on_delete=models.CASCADE, related_name='subject_teachers',
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = 'Teacher Subject'
        verbose_name_plural = 'Teacher Subjects'
        constraints = [
            models.UniqueConstraint(
                fields=['teacher', 'subject', 'school_class'],
                name='unique_teacher_subject_class',
            ),
        ]

    def __str__(self):
        return f"{self.teacher.name} → {self.subject.name} ({self.school_class.name})"
