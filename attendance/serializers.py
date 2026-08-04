from rest_framework import serializers
from .models import AttendanceRecord, Holiday


class HolidaySerializer(serializers.ModelSerializer):
    createdAt = serializers.DateTimeField(source='created_at', read_only=True)

    class Meta:
        model = Holiday
        fields = ['id', 'date', 'name', 'type', 'createdAt']


class BulkHolidaySerializer(serializers.Serializer):
    start_date = serializers.DateField()
    end_date = serializers.DateField()
    name = serializers.CharField(max_length=255)
    type = serializers.ChoiceField(choices=Holiday._meta.get_field('type').choices, default='public')

    def validate(self, attrs):
        if attrs['end_date'] < attrs['start_date']:
            raise serializers.ValidationError({'end_date': 'end_date cannot be before start_date.'})
        return attrs


class AttendanceRecordSerializer(serializers.ModelSerializer):
    studentName = serializers.CharField(source='student.name', read_only=True)
    studentRoll = serializers.CharField(source='student.roll', read_only=True)
    createdAt = serializers.DateTimeField(source='created_at', read_only=True)
    updatedAt = serializers.DateTimeField(source='updated_at', read_only=True)

    class Meta:
        model = AttendanceRecord
        fields = [
            'id', 'student', 'studentName', 'studentRoll',
            'school_class', 'date', 'term', 'session',
            'status', 'marked_by', 'createdAt', 'updatedAt',
        ]
        read_only_fields = ['id', 'marked_by', 'createdAt', 'updatedAt']


class BatchAttendanceSerializer(serializers.Serializer):
    school_class = serializers.UUIDField()
    date = serializers.DateField()
    term = serializers.CharField()
    session = serializers.CharField()
    records = serializers.DictField(
        child=serializers.ChoiceField(choices=['present', 'absent']),
    )

    def validate_records(self, value):
        if not value:
            raise serializers.ValidationError('At least one student record is required.')
        return value


class AttendanceSummarySerializer(serializers.Serializer):
    present = serializers.IntegerField()
    absent = serializers.IntegerField()
    late = serializers.IntegerField()
    excused = serializers.IntegerField()
    total_school_days = serializers.IntegerField()
    holidays = serializers.IntegerField()
    weekends = serializers.IntegerField()
    unmarked = serializers.IntegerField()
