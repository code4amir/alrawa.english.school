from rest_framework import serializers
from .models import User


class UserSerializer(serializers.ModelSerializer):
    hasTeacherProfile = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ['id', 'email', 'name', 'role', 'email_verified', 'image', 'is_active', 'date_joined', 'hasTeacherProfile']
        read_only_fields = ['id', 'email', 'role', 'email_verified', 'is_active', 'date_joined']

    def get_hasTeacherProfile(self, obj):
        return getattr(obj, 'teacher_profile', None) is not None

    def to_representation(self, instance):
        data = super().to_representation(instance)
        data['emailVerified'] = data.pop('email_verified', False)
        data['createdAt'] = data.pop('date_joined', None)
        data['mustChangePassword'] = instance.must_change_password
        return data


class CreateStaffSerializer(serializers.Serializer):
    name = serializers.CharField()
    email = serializers.EmailField()
    role = serializers.ChoiceField(choices=User.ROLE_CHOICES)
    password = serializers.CharField(min_length=8)
    teacher_id = serializers.CharField(required=False, allow_null=True)


class UserListSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ['id', 'name', 'email', 'role', 'is_active', 'date_joined']

    def to_representation(self, instance):
        data = super().to_representation(instance)
        data['createdAt'] = data.pop('date_joined', None)
        return data


class UserRoleSerializer(serializers.Serializer):
    role = serializers.ChoiceField(choices=User.ROLE_CHOICES)


class RegisterSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, min_length=8)
    child_name = serializers.CharField(required=False, allow_blank=True)
    roll = serializers.CharField(required=False, allow_blank=True)
    phone = serializers.CharField(required=False, allow_blank=True)
    father_name = serializers.CharField(required=False, allow_blank=True)
    mother_name = serializers.CharField(required=False, allow_blank=True)

    class Meta:
        model = User
        fields = ['email', 'name', 'password', 'child_name', 'roll', 'phone', 'father_name', 'mother_name']

    def create(self, validated_data):
        validated_data.pop('child_name', None)
        validated_data.pop('roll', None)
        validated_data.pop('phone', None)
        validated_data.pop('father_name', None)
        validated_data.pop('mother_name', None)
        user = User.objects.create_user(
            email=validated_data['email'],
            password=validated_data['password'],
            name=validated_data['name'],
        )
        return user


class RequestPasswordResetSerializer(serializers.Serializer):
    email = serializers.EmailField()


class ResetPasswordSerializer(serializers.Serializer):
    token = serializers.CharField()
    password = serializers.CharField(write_only=True, min_length=8)


class ChangePasswordSerializer(serializers.Serializer):
    current_password = serializers.CharField(write_only=True)
    new_password = serializers.CharField(write_only=True, min_length=8)
    # Optional attendance PIN (6 digits). REQUIRED when the user is on the
    # forced first-login flow (must_change_password) and has a linked
    # Teacher profile — enforced in validate() so it can never be skipped
    # from the client. Accepted (optional) on voluntary password changes too.
    pin = serializers.CharField(write_only=True, required=False, allow_blank=True, max_length=6)

    WEAK_PINS = {
        '123456', '654321', '111111', '222222', '333333', '444444',
        '555555', '666666', '777777', '888888', '999999', '000000',
        '012345', '123123', '112233', '121212',
    }

    def validate_current_password(self, value):
        user = self.context['request'].user
        if not user.check_password(value):
            raise serializers.ValidationError('Current password is incorrect')
        return value

    def validate_pin(self, value):
        if not value:
            return value
        if not value.isdigit() or len(value) != 6:
            raise serializers.ValidationError('PIN must be exactly 6 digits')
        if value in self.WEAK_PINS:
            raise serializers.ValidationError('PIN is too easy to guess — choose a different one')
        return value

    def validate(self, attrs):
        user = self.context['request'].user
        if user.must_change_password and not attrs.get('pin'):
            teacher_profile = getattr(user, 'teacher_profile', None)
            if teacher_profile is not None:
                raise serializers.ValidationError(
                    {'pin': 'Attendance PIN is required for your first login.'}
                )
        return attrs


class LinkChildSerializer(serializers.Serializer):
    child_name = serializers.CharField(required=False, allow_blank=True)
    roll = serializers.CharField(required=False, allow_blank=True)
    phone = serializers.CharField(required=False, allow_blank=True)
    father_name = serializers.CharField(required=False, allow_blank=True)
    mother_name = serializers.CharField(required=False, allow_blank=True)
    student_id = serializers.CharField(required=False, allow_blank=True)
