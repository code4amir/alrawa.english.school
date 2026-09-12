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

    def validate(self, attrs):
        # Phase 0: backend max-marks check. Previously only the frontend
        # clamped, so any API client could store Math: 999 silently.
        marks = attrs.get('marks')
        if isinstance(marks, dict) and marks:
            student = attrs.get('student') or getattr(self.instance, 'student', None)
            class_id = getattr(student, 'school_class_id', None)
            if class_id:
                from core.models import Subject
                limits = dict(Subject.objects.filter(
                    school_class_id=class_id).values_list('name', 'full_marks'))
                bad = {}
                for key, val in marks.items():
                    if val is None or isinstance(val, bool):
                        continue
                    try:
                        num = float(val)
                    except (TypeError, ValueError):
                        bad[key] = f'not a number: {val!r}'
                        continue
                    full = limits.get(key)
                    if full is not None and num > full:
                        bad[key] = f'{val} exceeds full marks {full}'
                if bad:
                    raise serializers.ValidationError({'marks': bad})
        return attrs


class ResultLockSerializer(serializers.ModelSerializer):
    className = serializers.CharField(source='school_class.name', read_only=True)
    lockedBy = serializers.CharField(source='locked_by.name', read_only=True)

    class Meta:
        model = ResultLock
        fields = ['id', 'school_class', 'className', 'session', 'term',
                  'locked_by', 'lockedBy', 'locked_at']
        read_only_fields = ['id', 'locked_by', 'locked_at']
