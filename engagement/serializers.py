from rest_framework import serializers
from .models import (
    DailyQuiz, QuizResponse, DailyRiddle, RiddleResponse,
    DailyTip, WeeklyChallenge, ChallengeResponse, MoodCheckin,
    LessonPlan, TeacherStreak,
)


class DailyQuizSerializer(serializers.ModelSerializer):
    hasResponded = serializers.SerializerMethodField()

    class Meta:
        model = DailyQuiz
        fields = ['id', 'question', 'option_a', 'option_b', 'option_c', 'option_d',
                  'category', 'quiz_date', 'explanation', 'hasResponded']
        read_only_fields = ['id', 'quiz_date']

    def get_hasResponded(self, obj):
        request = self.context.get('request')
        if not request or not request.user.is_authenticated:
            return False
        return QuizResponse.objects.filter(user=request.user, question=obj).exists()


class QuizResponseSerializer(serializers.ModelSerializer):
    isCorrect = serializers.BooleanField(source='is_correct', read_only=True)

    class Meta:
        model = QuizResponse
        fields = ['id', 'question', 'selectedAnswer', 'isCorrect', 'answeredAt']
        read_only_fields = ['id', 'isCorrect', 'answeredAt']

    def validate_selectedAnswer(self, value):
        if value not in ('a', 'b', 'c', 'd'):
            raise serializers.ValidationError('Must be a, b, c, or d')
        return value


class DailyRiddleSerializer(serializers.ModelSerializer):
    hasResponded = serializers.SerializerMethodField()
    showAnswer = serializers.SerializerMethodField()

    class Meta:
        model = DailyRiddle
        fields = ['id', 'question', 'hint', 'riddle_date', 'hasResponded', 'showAnswer']
        read_only_fields = ['id', 'riddle_date']

    def get_hasResponded(self, obj):
        request = self.context.get('request')
        if not request or not request.user.is_authenticated:
            return False
        return RiddleResponse.objects.filter(user=request.user, riddle=obj).exists()

    def get_showAnswer(self, obj):
        request = self.context.get('request')
        if not request or not request.user.is_authenticated:
            return False
        return RiddleResponse.objects.filter(user=request.user, riddle=obj).exists()


class RiddleResponseSerializer(serializers.ModelSerializer):
    isCorrect = serializers.BooleanField(source='is_correct', read_only=True)
    correctAnswer = serializers.SerializerMethodField()

    class Meta:
        model = RiddleResponse
        fields = ['id', 'riddle', 'guess', 'isCorrect', 'correctAnswer', 'answeredAt']
        read_only_fields = ['id', 'isCorrect', 'correctAnswer', 'answeredAt']

    def get_correctAnswer(self, obj):
        return obj.riddle.answer if obj.is_correct else obj.riddle.answer


class DailyTipSerializer(serializers.ModelSerializer):
    class Meta:
        model = DailyTip
        fields = ['id', 'tip', 'category', 'tip_date']
        read_only_fields = ['id', 'tip_date']


class WeeklyChallengeSerializer(serializers.ModelSerializer):
    hasResponded = serializers.SerializerMethodField()
    responseCount = serializers.SerializerMethodField()

    class Meta:
        model = WeeklyChallenge
        fields = ['id', 'title', 'description', 'challenge_type', 'start_date', 'end_date',
                  'hasResponded', 'responseCount']
        read_only_fields = ['id', 'start_date', 'end_date']

    def get_hasResponded(self, obj):
        # Prefer the view's annotation (avoids 1 query per row on list views).
        if hasattr(obj, '_has_responded'):
            return obj._has_responded
        request = self.context.get('request')
        if not request or not request.user.is_authenticated:
            return False
        return ChallengeResponse.objects.filter(user=request.user, challenge=obj).exists()

    def get_responseCount(self, obj):
        # Prefer the view's annotation (avoids 1 query per row on list views).
        if hasattr(obj, '_response_count'):
            return obj._response_count
        return obj.responses.count()


class ChallengeResponseSerializer(serializers.ModelSerializer):
    class Meta:
        model = ChallengeResponse
        fields = ['id', 'challenge', 'textResponse', 'emojiResponse', 'respondedAt']
        read_only_fields = ['id', 'respondedAt']

    def validate(self, data):
        challenge = data.get('challenge')
        if challenge and challenge.challenge_type == 'emoji' and not data.get('emojiResponse'):
            raise serializers.ValidationError({'emojiResponse': 'Required for emoji challenges'})
        return data


class MoodCheckinSerializer(serializers.ModelSerializer):
    moodDisplay = serializers.SerializerMethodField()

    class Meta:
        model = MoodCheckin
        fields = ['id', 'mood', 'moodDisplay', 'checkin_date', 'created_at']
        read_only_fields = ['id', 'created_at']

    def get_moodDisplay(self, obj):
        return obj.get_mood_display()


class MoodHistorySerializer(serializers.ModelSerializer):
    moodDisplay = serializers.SerializerMethodField()

    class Meta:
        model = MoodCheckin
        fields = ['mood', 'moodDisplay', 'checkin_date']

    def get_moodDisplay(self, obj):
        return obj.get_mood_display()


class LessonPlanSerializer(serializers.ModelSerializer):
    className = serializers.CharField(source='class_name')

    class Meta:
        model = LessonPlan
        fields = ['id', 'plan_date', 'className', 'subject', 'notes', 'created_at']
        read_only_fields = ['id', 'created_at']


class TeacherStreakSerializer(serializers.ModelSerializer):
    class Meta:
        model = TeacherStreak
        fields = ['current_streak', 'longest_streak', 'last_active_date', 'total_days_active']
        read_only_fields = fields


class LeaderboardEntrySerializer(serializers.Serializer):
    userId = serializers.UUIDField()
    userName = serializers.CharField()
    correctAnswers = serializers.IntegerField()
    totalAnswers = serializers.IntegerField()
    accuracy = serializers.FloatField()
