from rest_framework import serializers
from django.db import transaction as db_transaction
from .models import Student, StudentService
from core.models import StudentIdCounter, SchoolClass
from core.mixins import PhotoUrlMixin


class StudentSerializer(PhotoUrlMixin, serializers.ModelSerializer):
    photo_url_prefix = 'students'
    classId = serializers.UUIDField(source='school_class_id', read_only=True, allow_null=True)
    schoolClass = serializers.PrimaryKeyRelatedField(
        queryset=SchoolClass.objects.all(),
        source='school_class',
        required=False,
        allow_null=True,
    )
    className = serializers.CharField(source='school_class.name', read_only=True, allow_null=True)
    studentId = serializers.CharField(source='student_id', read_only=True)
    fatherName = serializers.CharField(source='father_name', read_only=True, allow_null=True)
    motherName = serializers.CharField(source='mother_name', read_only=True, allow_null=True)
    hasPhoto = serializers.SerializerMethodField()
    hasGraduated = serializers.SerializerMethodField()
    photoUrl = serializers.SerializerMethodField()
    createdAt = serializers.DateTimeField(source='created_at', read_only=True)
    services = serializers.SerializerMethodField()

    class Meta:
        model = Student
        fields = [
            'id', 'studentId', 'schoolClass', 'classId', 'className', 'roll',
            'session', 'name', 'fatherName', 'motherName', 'contact',
            'hasPhoto', 'hasGraduated', 'photoUrl', 'createdAt', 'services',
        ]
        read_only_fields = ['id', 'studentId', 'createdAt']
        # Disable DRF's auto-generated UniqueTogetherValidator for the
        # conditional UniqueConstraint(roll, school_class, condition=Q(roll__gt='')).
        # DRF ignores the condition and demands BOTH fields on every create,
        # wrongly rejecting classless students (model allows null class).
        validators = []

    def validate(self, attrs):
        roll = attrs.get('roll')
        school_class = attrs.get('school_class')
        # Mirror the model's conditional uniqueness: only enforced when
        # roll is non-empty and a class is set (matches Q(roll__gt='')).
        if roll and school_class:
            qs = Student.objects.filter(roll=roll, school_class=school_class)
            if self.instance:
                qs = qs.exclude(pk=self.instance.pk)
            if qs.exists():
                raise serializers.ValidationError({
                    'roll': 'A student with this roll already exists in this class.'
                })
        return attrs

    def get_hasGraduated(self, obj):
        return obj.graduated_at is not None

    def get_services(self, obj):
        # NOTE: do NOT add .select_related() here — it bypasses the prefetch cache
        # and fires one extra DB query per student (N+1). 'services__service_type'
        # is prefetched by the view, so service_type is already attached.
        qs = obj.services.all()
        return StudentServiceSerializer(qs, many=True).data

    def create(self, validated_data):
        with db_transaction.atomic():
            counter, _ = StudentIdCounter.objects.select_for_update().get_or_create(
                id='singleton',
                defaults={'prefix': 'S', 'next_value': 1, 'pad_length': 6}
            )
            student_id = f"{counter.prefix}{str(counter.next_value).zfill(counter.pad_length)}"
            validated_data['student_id'] = student_id
            counter.next_value += 1
            counter.save(update_fields=['next_value'])
        return super().create(validated_data)


class ImportSerializer(serializers.Serializer):
    file = serializers.FileField()


class StudentServiceSerializer(serializers.ModelSerializer):
    serviceTypeId = serializers.UUIDField(source='service_type_id', read_only=True)
    serviceName = serializers.CharField(source='service_type.name', read_only=True)
    serviceAmount = serializers.DecimalField(source='service_type.default_amount', read_only=True, max_digits=12, decimal_places=2)
    serviceFrequency = serializers.CharField(source='service_type.frequency', read_only=True)
    startsAt = serializers.CharField(source='starts_at', read_only=True, allow_null=True)
    endsAt = serializers.CharField(source='ends_at', read_only=True, allow_null=True)
    autoAssigned = serializers.BooleanField(source='auto_assigned', read_only=True)
    createdAt = serializers.DateTimeField(source='created_at', read_only=True)

    class Meta:
        model = StudentService
        fields = ['id', 'serviceTypeId', 'serviceName', 'serviceAmount', 'serviceFrequency',
                   'active', 'startsAt', 'endsAt', 'autoAssigned', 'createdAt']


class StudentServiceToggleSerializer(serializers.Serializer):
    studentId = serializers.UUIDField()
    serviceTypeId = serializers.UUIDField()
    active = serializers.BooleanField()
    starts_at = serializers.CharField(required=False, allow_null=True, allow_blank=True)
    ends_at = serializers.CharField(required=False, allow_null=True, allow_blank=True)
