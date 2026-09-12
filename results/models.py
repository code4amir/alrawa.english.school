import uuid
from django.conf import settings
from django.db import models


class Result(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    student = models.ForeignKey(
        'students.Student', on_delete=models.PROTECT,
        related_name='results'
    )
    session = models.CharField(max_length=255, default='')
    term = models.CharField(max_length=255)
    marks = models.JSONField(default=dict)
    attendance = models.JSONField(blank=True, null=True)
    comment = models.TextField(blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = 'Result'
        verbose_name_plural = 'Results'
        constraints = [
            models.UniqueConstraint(fields=['student', 'term', 'session'], name='unique_result_per_student_term_session'),
        ]
        indexes = [
            models.Index(fields=['session']),
            models.Index(fields=['student', 'session']),
            models.Index(fields=['session', 'term']),
        ]

    def __str__(self):
        return f"{self.student.name} - {self.term} ({self.session})"


class ResultLock(models.Model):
    """Finalize switch per class × session × term (C3).

    While a lock row exists, non-admin writes to any Result in that slice
    are rejected — the sabotage/accident window shrinks from "forever" to
    "the entry weeks". Only admins (results:admin) create/delete locks.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    school_class = models.ForeignKey(
        'core.SchoolClass', on_delete=models.CASCADE,
        related_name='result_locks',
    )
    session = models.CharField(max_length=255, default='')
    term = models.CharField(max_length=255)
    locked_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
        null=True, blank=True, related_name='result_locks_made',
    )
    locked_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['school_class', 'session', 'term'],
                name='unique_lock_per_class_session_term'),
        ]

    def __str__(self):
        return f"Locked: {self.school_class.name} - {self.term} ({self.session})"
