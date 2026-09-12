import uuid
from django.db import models
from django.db.models import Q


class SchoolClass(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=255, unique=True)
    order = models.IntegerField(default=0)

    class Meta:
        ordering = ['order', 'name']
        verbose_name = 'school class'
        verbose_name_plural = 'school classes'

    def __str__(self):
        return self.name


class Subject(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=255)
    full_marks = models.IntegerField()
    order = models.IntegerField(default=0)
    school_class = models.ForeignKey(
        SchoolClass, on_delete=models.CASCADE,
        related_name='subjects'
    )

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['name', 'school_class'], name='unique_subject_per_class'),
        ]
        ordering = ['order', 'name']
        verbose_name = 'subject'
        verbose_name_plural = 'subjects'

    def __str__(self):
        return f"{self.name} ({self.school_class.name})"


class AcademicYear(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=255, unique=True)
    start_date = models.DateField()
    end_date = models.DateField()
    is_active = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-start_date']
        verbose_name = 'academic year'
        verbose_name_plural = 'academic years'

    def __str__(self):
        return self.name


class SchoolSetting(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    key = models.CharField(max_length=255, unique=True)
    value = models.TextField()

    class Meta:
        verbose_name = 'school setting'
        verbose_name_plural = 'school settings'

    def __str__(self):
        return self.key


class AuditLog(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user_id = models.CharField(max_length=100, blank=True, null=True)
    user_name = models.CharField(max_length=255, blank=True, null=True)
    action = models.CharField(max_length=50)
    entity_type = models.CharField(max_length=50)
    entity_id = models.CharField(max_length=100, blank=True, null=True)
    details = models.TextField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [
            models.Index(fields=['created_at']),
            models.Index(fields=['entity_type', 'entity_id']),
            models.Index(fields=['action']),
            models.Index(fields=['user_id']),
        ]
        ordering = ['-created_at']
        verbose_name = 'audit log'
        verbose_name_plural = 'audit logs'

    def __str__(self):
        return f"{self.action} on {self.entity_type} by {self.user_id}"


class Category(models.Model):
    CATEGORY_TYPES = [
        ('INCOME', 'Income'),
        ('EXPENSE', 'Expense'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    type = models.CharField(max_length=20, choices=CATEGORY_TYPES)
    name = models.CharField(max_length=100)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['type', 'name'], name='unique_category_type_name'),
        ]
        ordering = ['type', 'name']
        verbose_name = 'category'
        verbose_name_plural = 'categories'

    def __str__(self):
        return f"{self.name} ({self.type})"


class Program(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=255, unique=True)
    active = models.BooleanField(default=True)

    class Meta:
        ordering = ['name']
        verbose_name = 'program'
        verbose_name_plural = 'programs'

    def __str__(self):
        return self.name


class StudentIdCounter(models.Model):
    id = models.CharField(primary_key=True, max_length=20, default='singleton')
    prefix = models.CharField(max_length=10, default='S')
    next_value = models.IntegerField(default=1)
    pad_length = models.IntegerField(default=6)

    def __str__(self):
        return f"{self.prefix}{str(self.next_value).zfill(self.pad_length)}"


class ServiceType(models.Model):
    FREQUENCY_CHOICES = [
        ('MONTHLY', 'Monthly'),
        ('YEARLY', 'Yearly'),
        ('ONE_TIME', 'One Time'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=255, unique=True)
    default_amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    frequency = models.CharField(max_length=20, choices=FREQUENCY_CHOICES, default='MONTHLY')
    active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['name']
        verbose_name = 'service type'
        verbose_name_plural = 'service types'

    def __str__(self):
        return self.name


class AgentFinding(models.Model):
    """Shared message board for monitor agents (Phase 1).

    Agents never call each other — they write findings here, read each
    other's, and the admin board UI renders them. Human data is never
    auto-repaired; a finding is evidence + a pointer, nothing more.
    """

    SEVERITIES = [
        ('info', 'Info'),
        ('warning', 'Warning'),
        ('critical', 'Critical'),
    ]
    STATUSES = [
        ('open', 'Open'),
        ('acked', 'Acknowledged'),
        ('resolved', 'Resolved'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    agent = models.CharField(max_length=50)
    severity = models.CharField(max_length=20, choices=SEVERITIES, default='info')
    entity_type = models.CharField(max_length=50, blank=True, default='')
    entity_id = models.CharField(max_length=100, blank=True, null=True)
    summary = models.CharField(max_length=500)
    details = models.JSONField(blank=True, default=dict)
    status = models.CharField(max_length=20, choices=STATUSES, default='open')
    resolution = models.CharField(max_length=500, blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['status', 'agent']),
            models.Index(fields=['status', '-created_at']),
        ]
        constraints = [
            # One open finding per agent+entity: re-reports update in place
            # instead of spamming the board every run.
            models.UniqueConstraint(
                fields=['agent', 'entity_type', 'entity_id'],
                condition=Q(status='open'),
                name='unique_open_finding_per_agent_entity'),
        ]

    def __str__(self):
        return f"[{self.severity}] {self.agent}: {self.summary[:80]}"
