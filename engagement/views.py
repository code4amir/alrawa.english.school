from datetime import date, timedelta
from django.db.models import Count, Q, Exists, OuterRef
from rest_framework import viewsets, status
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated

from .models import (
    DailyQuiz, QuizResponse, DailyRiddle, RiddleResponse,
    DailyTip, WeeklyChallenge, ChallengeResponse, MoodCheckin,
    LessonPlan, TeacherStreak,
)
from .serializers import (
    DailyQuizSerializer, QuizResponseSerializer,
    DailyRiddleSerializer, RiddleResponseSerializer,
    DailyTipSerializer, WeeklyChallengeSerializer, ChallengeResponseSerializer,
    MoodCheckinSerializer, MoodHistorySerializer, LessonPlanSerializer,
    TeacherStreakSerializer, LeaderboardEntrySerializer,
)
from .ai_service import generate_quiz, generate_riddle, generate_tip, generate_challenge


def _is_teacher_or_admin(user):
    return user.is_superuser or getattr(user, 'role', None) in ('admin', 'teacher')


def _update_streak(user):
    today = date.today()
    streak, _ = TeacherStreak.objects.get_or_create(user=user)
    if streak.last_active_date == today:
        return streak
    if streak.last_active_date == today - timedelta(days=1):
        streak.current_streak += 1
    else:
        streak.current_streak = 1
    streak.longest_streak = max(streak.longest_streak, streak.current_streak)
    streak.last_active_date = today
    streak.total_days_active += 1
    streak.save()
    return streak


class QuizViewSet(viewsets.GenericViewSet):
    permission_classes = [IsAuthenticated]

    def get_permissions(self):
        if self.action in ['today', 'answer', 'leaderboard']:
            return [IsAuthenticated()]
        return super().get_permissions()

    @action(detail=False, methods=['get'])
    def today(self, request):
        today_date = date.today()
        quiz = DailyQuiz.objects.filter(quiz_date=today_date).first()
        if not quiz:
            quiz_data, source = generate_quiz()
            quiz = DailyQuiz.objects.create(
                question=quiz_data['question'],
                option_a=quiz_data['option_a'],
                option_b=quiz_data['option_b'],
                option_c=quiz_data['option_c'],
                option_d=quiz_data['option_d'],
                correct_answer=quiz_data['correct_answer'],
                category=quiz_data.get('category', 'general'),
                explanation=quiz_data.get('explanation', ''),
                quiz_date=today_date,
                generated_by=source,
            )
        return Response(DailyQuizSerializer(quiz, context={'request': request}).data)

    @action(detail=False, methods=['post'])
    def answer(self, request):
        today_date = date.today()
        quiz = DailyQuiz.objects.filter(quiz_date=today_date).first()
        if not quiz:
            return Response({'error': 'No quiz for today'}, status=404)

        if QuizResponse.objects.filter(user=request.user, question=quiz).exists():
            return Response({'error': 'Already answered today\'s quiz'}, status=400)

        selected = request.data.get('selectedAnswer', '')
        if selected not in ('a', 'b', 'c', 'd'):
            return Response({'error': 'Invalid answer'}, status=400)

        is_correct = selected == quiz.correct_answer
        response = QuizResponse.objects.create(
            user=request.user,
            question=quiz,
            selected_answer=selected,
            is_correct=is_correct,
        )
        _update_streak(request.user)

        return Response({
            'isCorrect': is_correct,
            'correctAnswer': quiz.correct_answer,
            'explanation': quiz.explanation,
        })

    @action(detail=False, methods=['get'])
    def leaderboard(self, request):
        days = int(request.query_params.get('days', 7))
        since = date.today() - timedelta(days=days)

        leaders = (
            QuizResponse.objects
            .filter(answered_at__date__gte=since)
            .values('user_id', 'user__name')
            .annotate(
                correctAnswers=Count('id', filter=Q(is_correct=True)),
                totalAnswers=Count('id'),
            )
            .order_by('-correctAnswers')[:20]
        )

        result = []
        for entry in leaders:
            total = entry['totalAnswers']
            correct = entry['correctAnswers']
            result.append({
                'userId': entry['user_id'],
                'userName': entry['user__name'],
                'correctAnswers': correct,
                'totalAnswers': total,
                'accuracy': round(correct / total * 100, 1) if total > 0 else 0,
            })

        return Response(result)


class RiddleViewSet(viewsets.GenericViewSet):
    permission_classes = [IsAuthenticated]

    @action(detail=False, methods=['get'])
    def today(self, request):
        today_date = date.today()
        riddle = DailyRiddle.objects.filter(riddle_date=today_date).first()
        if not riddle:
            riddle_data, source = generate_riddle()
            riddle = DailyRiddle.objects.create(
                question=riddle_data['question'],
                hint=riddle_data.get('hint', ''),
                answer=riddle_data['answer'],
                riddle_date=today_date,
                generated_by=source,
            )

        serializer = DailyRiddleSerializer(riddle, context={'request': request})
        data = serializer.data

        if data['hasResponded']:
            response = RiddleResponse.objects.filter(user=request.user, riddle=riddle).first()
            data['yourGuess'] = response.guess if response else None
            data['isCorrect'] = response.is_correct if response else False
            data['answer'] = riddle.answer

        return Response(data)

    @action(detail=False, methods=['post'])
    def guess(self, request):
        today_date = date.today()
        riddle = DailyRiddle.objects.filter(riddle_date=today_date).first()
        if not riddle:
            return Response({'error': 'No riddle for today'}, status=404)

        if RiddleResponse.objects.filter(user=request.user, riddle=riddle).exists():
            return Response({'error': 'Already guessed today\'s riddle'}, status=400)

        guess_text = request.data.get('guess', '').strip()
        if not guess_text:
            return Response({'error': 'Guess is required'}, status=400)

        is_correct = guess_text.lower() == riddle.answer.lower()
        response = RiddleResponse.objects.create(
            user=request.user,
            riddle=riddle,
            guess=guess_text,
            is_correct=is_correct,
        )
        _update_streak(request.user)

        return Response({
            'isCorrect': is_correct,
            'correctAnswer': riddle.answer,
        })


class TipViewSet(viewsets.GenericViewSet):
    permission_classes = [IsAuthenticated]

    @action(detail=False, methods=['get'])
    def today(self, request):
        today_date = date.today()
        tips = DailyTip.objects.filter(tip_date=today_date)
        if not tips.exists():
            categories = ['classroom', 'assessment', 'engagement', 'general']
            for cat in categories:
                tip_text, source = generate_tip(cat)
                DailyTip.objects.get_or_create(
                    tip_date=today_date,
                    category=cat,
                    defaults={'tip': tip_text, 'generated_by': source},
                )
            tips = DailyTip.objects.filter(tip_date=today_date)

        return Response(DailyTipSerializer(tips, many=True).data)


class ChallengeViewSet(viewsets.GenericViewSet):
    permission_classes = [IsAuthenticated]

    @action(detail=False, methods=['get'])
    def active(self, request):
        today_date = date.today()
        challenges = WeeklyChallenge.objects.filter(
            is_active=True, start_date__lte=today_date, end_date__gte=today_date,
        ).annotate(
            # Kill the per-row N+1: get_hasResponded/get_responseCount in the
            # serializer read these annotations instead of querying per row.
            _has_responded=Exists(
                ChallengeResponse.objects.filter(user=request.user, challenge=OuterRef('pk'))
            ),
            _response_count=Count('responses'),
        )

        if not challenges.exists():
            challenge_data, source = generate_challenge()
            end = today_date + timedelta(days=6)
            challenge = WeeklyChallenge.objects.create(
                title=challenge_data['title'],
                description=challenge_data['description'],
                challenge_type=challenge_data.get('challenge_type', 'text'),
                start_date=today_date,
                end_date=end,
                generated_by=source,
            )
            challenges = WeeklyChallenge.objects.filter(id=challenge.id)

        return Response(WeeklyChallengeSerializer(challenges, many=True, context={'request': request}).data)

    @action(detail=True, methods=['post'])
    def respond(self, request, pk=None):
        challenge = self.get_object()
        today_date = date.today()

        if not (challenge.start_date <= today_date <= challenge.end_date):
            return Response({'error': 'Challenge is not active'}, status=400)

        if ChallengeResponse.objects.filter(user=request.user, challenge=challenge).exists():
            return Response({'error': 'Already responded to this challenge'}, status=400)

        text_response = request.data.get('textResponse', '')
        emoji_response = request.data.get('emojiResponse', '')

        if challenge.challenge_type == 'emoji' and not emoji_response:
            return Response({'error': 'Emoji response required'}, status=400)
        if challenge.challenge_type == 'text' and not text_response:
            return Response({'error': 'Text response required'}, status=400)

        response = ChallengeResponse.objects.create(
            user=request.user,
            challenge=challenge,
            text_response=text_response,
            emoji_response=emoji_response,
        )
        _update_streak(request.user)

        return Response({'status': 'ok', 'responseCount': challenge.responses.count()})


class MoodViewSet(viewsets.GenericViewSet):
    permission_classes = [IsAuthenticated]

    @action(detail=False, methods=['post'])
    def checkin(self, request):
        today_date = date.today()
        mood_val = request.data.get('mood')
        if mood_val not in (1, 2, 3, 4, 5):
            return Response({'error': 'Mood must be 1-5'}, status=400)

        mood_obj, created = MoodCheckin.objects.update_or_create(
            user=request.user,
            checkin_date=today_date,
            defaults={'mood': mood_val},
        )
        _update_streak(request.user)

        return Response(MoodCheckinSerializer(mood_obj).data)

    @action(detail=False, methods=['get'])
    def history(self, request):
        days = int(request.query_params.get('days', 30))
        since = date.today() - timedelta(days=days)
        moods = MoodCheckin.objects.filter(
            user=request.user, checkin_date__gte=since,
        ).order_by('-checkin_date')
        return Response(MoodHistorySerializer(moods, many=True).data)

    @action(detail=False, methods=['get'])
    def aggregate(self, request):
        from accounts.permissions import is_admin_or_superuser
        if not is_admin_or_superuser(request.user):
            return Response({'error': 'Admin only'}, status=403)

        days = int(request.query_params.get('days', 7))
        since = date.today() - timedelta(days=days)

        from django.db.models import Avg
        agg = MoodCheckin.objects.filter(
            checkin_date__gte=since,
        ).aggregate(
            avg_mood=Avg('mood'),
            total_checkins=Count('id'),
        )

        by_day = (
            MoodCheckin.objects
            .filter(checkin_date__gte=since)
            .values('checkin_date')
            .annotate(avg_mood=Avg('mood'), count=Count('id'))
            .order_by('checkin_date')
        )

        return Response({
            'avgMood': round(agg['avg_mood'] or 0, 1),
            'totalCheckins': agg['total_checkins'],
            'byDay': list(by_day),
        })


class LessonPlanViewSet(viewsets.ModelViewSet):
    serializer_class = LessonPlanSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        plan_date = self.request.query_params.get('date')
        qs = LessonPlan.objects.filter(user=self.request.user)
        if plan_date:
            qs = qs.filter(plan_date=plan_date)
        else:
            qs = qs.filter(plan_date=date.today())
        return qs.order_by('created_at')

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)

    @action(detail=False, methods=['get'])
    def week(self, request):
        today = date.today()
        start = today - timedelta(days=today.weekday())
        end = start + timedelta(days=6)
        plans = LessonPlan.objects.filter(
            user=request.user, plan_date__gte=start, plan_date__lte=end,
        ).order_by('plan_date', 'created_at')
        return Response(LessonPlanSerializer(plans, many=True).data)


class StreakViewSet(viewsets.GenericViewSet):
    permission_classes = [IsAuthenticated]

    @action(detail=False, methods=['get'])
    def me(self, request):
        streak, _ = TeacherStreak.objects.get_or_create(user=request.user)
        return Response(TeacherStreakSerializer(streak).data)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def regenerate_content(request):
    from accounts.permissions import is_admin_or_superuser
    if not is_admin_or_superuser(request.user):
        return Response({'error': 'Admin only'}, status=403)

    content_type = request.data.get('type', 'all')
    today_date = date.today()
    results = {}

    if content_type in ('all', 'quiz'):
        quiz_data, source = generate_quiz()
        quiz, _ = DailyQuiz.objects.update_or_create(
            quiz_date=today_date,
            defaults={
                'question': quiz_data['question'],
                'option_a': quiz_data['option_a'],
                'option_b': quiz_data['option_b'],
                'option_c': quiz_data['option_c'],
                'option_d': quiz_data['option_d'],
                'correct_answer': quiz_data['correct_answer'],
                'category': quiz_data.get('category', 'general'),
                'explanation': quiz_data.get('explanation', ''),
                'generated_by': source,
            },
        )
        results['quiz'] = 'regenerated'

    if content_type in ('all', 'riddle'):
        riddle_data, source = generate_riddle()
        riddle, _ = DailyRiddle.objects.update_or_create(
            riddle_date=today_date,
            defaults={
                'question': riddle_data['question'],
                'hint': riddle_data.get('hint', ''),
                'answer': riddle_data['answer'],
                'generated_by': source,
            },
        )
        results['riddle'] = 'regenerated'

    if content_type in ('all', 'tip'):
        for cat in ['classroom', 'assessment', 'engagement', 'general']:
            tip_text, source = generate_tip(cat)
            DailyTip.objects.update_or_create(
                tip_date=today_date,
                category=cat,
                defaults={'tip': tip_text, 'generated_by': source},
            )
        results['tips'] = 'regenerated'

    if content_type in ('all', 'challenge'):
        challenge_data, source = generate_challenge()
        end = today_date + timedelta(days=6)
        WeeklyChallenge.objects.update_or_create(
            start_date=today_date,
            defaults={
                'title': challenge_data['title'],
                'description': challenge_data['description'],
                'challenge_type': challenge_data.get('challenge_type', 'text'),
                'end_date': end,
                'generated_by': source,
            },
        )
        results['challenge'] = 'regenerated'

    return Response({'status': 'ok', 'results': results})
