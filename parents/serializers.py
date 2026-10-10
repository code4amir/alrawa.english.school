from rest_framework import serializers


class ParentStudentSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    studentId = serializers.CharField()
    name = serializers.CharField()
    roll = serializers.CharField()
    className = serializers.CharField(source='school_class.name', read_only=True, allow_null=True)
    session = serializers.CharField()
    photoUrl = serializers.URLField(allow_null=True)


class ParentAttendanceDaySerializer(serializers.Serializer):
    date = serializers.DateField()
    weekday = serializers.IntegerField()
    type = serializers.CharField()
    status = serializers.CharField(allow_null=True, default=None)


class ParentAttendanceSerializer(serializers.Serializer):
    student = serializers.DictField()
    year = serializers.IntegerField()
    month = serializers.IntegerField()
    days = ParentAttendanceDaySerializer(many=True)


class ParentFeeScheduleItemSerializer(serializers.Serializer):
    category = serializers.CharField()
    amount = serializers.DecimalField(max_digits=12, decimal_places=2)
    frequency = serializers.CharField()
    assigned = serializers.BooleanField()


class ParentFeeStatusSerializer(serializers.Serializer):
    totalDue = serializers.DecimalField(max_digits=12, decimal_places=2)
    totalPaid = serializers.DecimalField(max_digits=12, decimal_places=2)
    balance = serializers.DecimalField(max_digits=12, decimal_places=2)
    schedules = ParentFeeScheduleItemSerializer(many=True)


class ParentPaymentLineSerializer(serializers.Serializer):
    category = serializers.CharField()
    amount = serializers.FloatField()
    periods = serializers.ListField(child=serializers.CharField(), required=False)


class ParentPaymentSerializer(serializers.Serializer):
    reference = serializers.CharField()
    amount = serializers.DecimalField(max_digits=12, decimal_places=2)
    category = serializers.CharField()
    method = serializers.CharField()
    date = serializers.DateField()
    isCancelled = serializers.BooleanField()
    # Category-wise split for the receipt; empty falls back to `category`.
    breakdown = ParentPaymentLineSerializer(many=True, required=False)


class ParentResultSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    session = serializers.CharField()
    term = serializers.CharField()
    marks = serializers.JSONField()
    comment = serializers.CharField(allow_null=True)
    createdAt = serializers.DateTimeField()
