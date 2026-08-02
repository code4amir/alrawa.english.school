from rest_framework import serializers
from .models import Teacher, ClassTeacher, TeacherSubject
from core.mixins import PhotoUrlMixin


class ClassTeacherSerializer(serializers.ModelSerializer):
    className = serializers.CharField(source='school_class.name', read_only=True)
    classId = serializers.UUIDField(source='school_class.id', read_only=True)

    class Meta:
        model = ClassTeacher
        fields = ['id', 'classId', 'className', 'is_primary', 'created_at']
        read_only_fields = ['id', 'created_at']


class TeacherSubjectSerializer(serializers.ModelSerializer):
    className = serializers.CharField(source='school_class.name', read_only=True)
    classId = serializers.UUIDField(source='school_class.id', read_only=True)
    subjectName = serializers.CharField(source='subject.name', read_only=True)
    subjectId = serializers.UUIDField(source='subject.id', read_only=True)

    class Meta:
        model = TeacherSubject
        fields = ['id', 'subjectId', 'subjectName', 'classId', 'className', 'created_at']
        read_only_fields = ['id', 'created_at']


class TeacherSerializer(PhotoUrlMixin, serializers.ModelSerializer):
    photo_url_prefix = 'teachers'
    designation = serializers.CharField(read_only=True)
    hasPhoto = serializers.SerializerMethodField()
    photoUrl = serializers.SerializerMethodField()
    createdAt = serializers.DateTimeField(source='created_at', read_only=True)
    userId = serializers.UUIDField(source='user.id', read_only=True)
    email = serializers.EmailField(read_only=True)
    classTeacherOf = serializers.SerializerMethodField()
    subjectAssignments = serializers.SerializerMethodField()

    class Meta:
        model = Teacher
        fields = [
            'id', 'name', 'contact', 'email', 'designation', 'userId',
            'hasPhoto', 'photoUrl', 'createdAt',
            'classTeacherOf', 'subjectAssignments',
        ]
        read_only_fields = ['id', 'createdAt']

    def get_classTeacherOf(self, obj):
        # The view prefetches 'class_teacher_of__school_class'; calling
        # .all() on the manager uses that cache. A .select_related() here
        # would bypass the cache and fire one query per teacher (N+1).
        return ClassTeacherSerializer(obj.class_teacher_of.all(), many=True).data

    def get_subjectAssignments(self, obj):
        # Same as above: 'subject_assignments__subject',
        # 'subject_assignments__school_class' are prefetched by the view.
        return TeacherSubjectSerializer(obj.subject_assignments.all(), many=True).data


class AssignClassTeacherSerializer(serializers.Serializer):
    classId = serializers.UUIDField()
    isPrimary = serializers.BooleanField(required=False, default=False)


class RemoveClassTeacherSerializer(serializers.Serializer):
    classId = serializers.UUIDField()


class AssignSubjectSerializer(serializers.Serializer):
    subjectId = serializers.UUIDField()
    classId = serializers.UUIDField()


class RemoveSubjectSerializer(serializers.Serializer):
    subjectId = serializers.UUIDField()
    classId = serializers.UUIDField()
