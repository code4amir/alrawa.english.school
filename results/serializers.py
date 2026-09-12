from rest_framework import serializers
from .models import Result, ResultLock


SUBJECT_KEY_MAP = {
    'General knowledge': 'General Knowledge',
    'Religion & Quran Learning': 'Religion and Quran Learning',
    'Quran Learning': 'Religion and Quran Learning',
}


class ResultSerializer(serializers.ModelSerializer):
    studentName = serializers.CharField(source='student.name', read_only=True)
    studentRoll = serializers.CharField(source='student.roll', read_only=True)
    createdAt = serializers.DateTimeField(source='created_at', read_only=True)
    studentId = serializers.UUIDField(source='student.id', read_only=True)
    marks = serializers.JSONField()

    class Meta:
        model = Result
        fields = ['id', 'student', 'studentId', 'session', 'term', 'marks', 'attendance',
                   'comment', 'studentName', 'studentRoll', 'createdAt']
        read_only_fields = ['id', 'createdAt', 'studentId']

    def validate_marks(self, value):
        if not isinstance(value, dict):
            return value
        normalized = {}
        for key, val in value.items():
            canonical = SUBJECT_KEY_MAP.get(key, key)
            if canonical not in normalized:
                normalized[canonical] = val
        return normalized


class ResultLockSerializer(serializers.ModelSerializer):
    className = serializers.CharField(source='school_class.name', read_only=True)
    lockedBy = serializers.CharField(source='locked_by.name', read_only=True)

    class Meta:
        model = ResultLock
        fields = ['id', 'school_class', 'className', 'session', 'term',
                  'locked_by', 'lockedBy', 'locked_at']
        read_only_fields = ['id', 'locked_by', 'locked_at']
