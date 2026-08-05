import calendar
import json
import logging
import os
from datetime import date
from decimal import Decimal
from django.db.models import Sum, Count, Q
from django.utils import timezone
from django.conf import settings
from rest_framework import permissions, status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .permissions import IsParentOfStudent
from .models import ParentStudentLink, StudentConnectLink, PushSubscription, Announcement, NotificationLog
from accounts.permissions import require_permission
from accounts.throttles import ConnectReadRateThrottle, ConnectWriteRateThrottle
from core.audit import log_audit
from .connect import (
    current_active_link, issue_link, can_manage_connect,
    id_facts_match, sibling_students, family_parent_exists,
)
from .serializers import (
    ParentStudentSerializer, ParentAttendanceSerializer,
    ParentFeeStatusSerializer, ParentResultSerializer,
)
from students.models import Student
from attendance.models import AttendanceRecord, Holiday
from results.models import Result
from finance.models import FeeSchedule, StudentFeeAssignment, Transaction
from core.models import SchoolSetting

logger = logging.getLogger(__name__)

WEEKEND_DAYS_DEFAULT = '4,5'


def _get_weekend_set():
    try:
        raw = SchoolSetting.objects.get(key='weekend_days').value
        return {int(x.strip()) for x in raw.split(',') if x.strip().isdigit()}
    except SchoolSetting.DoesNotExist:
        return {int(x) for x in WEEKEND_DAYS_DEFAULT.split(',')}


def _get_holiday_dates(year=None, month=None):
    qs = Holiday.objects.all()
    if year:
        qs = qs.filter(date__year=year)
    if month is not None:
        qs = qs.filter(date__month=month)
    return set(qs.values_list('date', flat=True))


class MyStudentsView(APIView):
    permission_classes = [IsParentOfStudent]

    def get(self, request):
        student_ids = request.user.parent_links.values_list('student_id', flat=True)
        students = Student.objects.filter(
            id__in=student_ids, deleted_at__isnull=True
        ).select_related('school_class').order_by('name')

        data = [{
            'id': s.id,
            'studentId': s.student_id,
            'name': s.name,
            'roll': s.roll,
            'className': s.school_class.name if s.school_class else '',
            'session': s.session,
            'photoUrl': None,
        } for s in students]
        return Response(ParentStudentSerializer(data, many=True).data)


class StudentAttendanceView(APIView):
    permission_classes = [IsParentOfStudent]

    def get(self, request, student_id):
        parent_student_ids = set(
            request.user.parent_links.values_list('student_id', flat=True)
        )
        if student_id not in parent_student_ids:
            return Response({'error': 'Student not found'}, status=404)

        try:
            student = Student.objects.get(id=student_id)
        except Student.DoesNotExist:
            return Response({'error': 'Student not found'}, status=404)

        year = request.query_params.get('year')
        month = request.query_params.get('month')
        today = timezone.now().date()
        year = int(year) if year else today.year
        month = int(month) if month else today.month

        records = AttendanceRecord.objects.filter(
            student_id=student_id,
            date__year=year,
            date__month=month,
        ).order_by('date')

        weekend_set = _get_weekend_set()
        known_holidays = _get_holiday_dates(year=year, month=month)

        class_date_records = AttendanceRecord.objects.filter(
            school_class=student.school_class,
            date__year=year,
            date__month=month,
        ).values('date').annotate(
            total=Count('student', distinct=True),
            absent_count=Count('id', filter=Q(status='absent')),
        )

        all_absent_dates = {
            row['date'] for row in class_date_records
            if row['total'] == row['absent_count']
        }

        records_by_date = {r.date: r.status for r in records}

        _, days_in_month = calendar.monthrange(year, month)
        days = []
        for day in range(1, days_in_month + 1):
            d = date(year, month, day)
            entry = {'date': d.isoformat(), 'weekday': d.weekday()}
            if d.weekday() in weekend_set:
                entry['type'] = 'weekend'
                entry['status'] = None
            elif d in known_holidays:
                entry['type'] = 'holiday'
                entry['status'] = None
            elif d in all_absent_dates:
                entry['type'] = 'de_facto_holiday'
                entry['status'] = None
            elif d in records_by_date:
                entry['type'] = 'marked'
                entry['status'] = records_by_date[d]
            else:
                entry['type'] = 'unmarked'
                entry['status'] = None
            days.append(entry)

        data = {
            'student': {'id': str(student.id), 'name': student.name, 'roll': student.roll},
            'year': year,
            'month': month,
            'days': days,
        }
        return Response(ParentAttendanceSerializer(data).data)


class StudentFeesView(APIView):
    permission_classes = [IsParentOfStudent]

    def get(self, request, student_id):
        parent_student_ids = set(
            request.user.parent_links.values_list('student_id', flat=True)
        )
        if student_id not in parent_student_ids:
            return Response({'error': 'Student not found'}, status=404)

        try:
            student = Student.objects.get(id=student_id)
        except Student.DoesNotExist:
            return Response({'error': 'Student not found'}, status=404)

        assignments = StudentFeeAssignment.objects.filter(
            student_id=student_id, active=True
        ).select_related('fee_schedule')

        schedules = []
        total_due = Decimal('0.00')
        for a in assignments:
            fs = a.fee_schedule
            schedules.append({
                'category': fs.category,
                'amount': fs.amount,
                'frequency': fs.frequency,
                'assigned': True,
            })
            total_due += fs.amount

        paid_agg = Transaction.objects.filter(
            student_id=student_id,
            transaction_type='INCOME',
            is_cancelled=False,
        ).aggregate(total=Sum('amount'))
        total_paid = paid_agg['total'] or Decimal('0.00')

        data = {
            'totalDue': total_due,
            'totalPaid': total_paid,
            'balance': total_due - total_paid,
            'schedules': schedules,
        }
        return Response(ParentFeeStatusSerializer(data).data)


class StudentResultsView(APIView):
    permission_classes = [IsParentOfStudent]

    def get(self, request, student_id):
        parent_student_ids = set(
            request.user.parent_links.values_list('student_id', flat=True)
        )
        if student_id not in parent_student_ids:
            return Response({'error': 'Student not found'}, status=404)

        results = Result.objects.filter(student_id=student_id)
        session = request.query_params.get('session')
        term = request.query_params.get('term')
        if session:
            results = results.filter(session=session)
        if term:
            results = results.filter(term=term)

        setting = SchoolSetting.objects.filter(key='published_terms').first()
        published = {}
        if setting and setting.value:
            try:
                published = json.loads(setting.value)
            except (json.JSONDecodeError, TypeError):
                published = {}

        published_sessions = list(published.keys())
        if published_sessions:
            results = results.filter(session__in=published_sessions)

        results = results.order_by('-created_at')

        data = [{
            'id': r.id,
            'session': r.session,
            'term': r.term,
            'marks': r.marks,
            'comment': r.comment,
            'createdAt': r.created_at.isoformat(),
        } for r in results if str(r.term) in published.get(r.session, [])]
        return Response(ParentResultSerializer(data, many=True).data)


class PushSubscribeView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        data = request.data
        endpoint = data.get('endpoint')
        p256dh = data.get('keys', {}).get('p256dh')
        auth = data.get('keys', {}).get('auth')
        if not endpoint or not p256dh or not auth:
            return Response({'error': 'Missing subscription data'}, status=400)

        sub, created = PushSubscription.objects.update_or_create(
            user=request.user,
            endpoint=endpoint,
            defaults={
                'p256dh_key': p256dh,
                'auth_key': auth,
                'user_agent': request.META.get('HTTP_USER_AGENT', ''),
            },
        )
        return Response({'status': 'subscribed'}, status=201 if created else 200)

    def delete(self, request):
        endpoint = request.data.get('endpoint')
        if endpoint:
            PushSubscription.objects.filter(user=request.user, endpoint=endpoint).delete()
        else:
            PushSubscription.objects.filter(user=request.user).delete()
        return Response({'status': 'unsubscribed'})


class VapidKeyView(APIView):
    permission_classes = []

    def get(self, request):
        val = os.environ.get('VAPID_PUBLIC_KEY', '')
        return Response({'publicKey': val})


class AnnouncementListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        qs = Announcement.objects.select_related('school_class')
        # Class scoping: parents see all-school + their linked children's class announcements
        if request.user.role == 'parent':
            class_ids = list(
                ParentStudentLink.objects.filter(parent=request.user)
                .values_list('student__school_class_id', flat=True)
            )
            from django.db.models import Q
            qs = qs.filter(Q(school_class__isnull=True) | Q(school_class_id__in=class_ids))
        announcements = qs[:20]
        data = [{
            'id': a.id,
            'title': a.title,
            'body': a.body,
            'author': a.author.name if a.author else 'Admin',
            'school_class': {'id': a.school_class.id, 'name': a.school_class.name} if a.school_class else None,
            'createdAt': a.created_at.isoformat(),
        } for a in announcements]
        return Response(data)

    def post(self, request):
        perm = require_permission('students:write')()
        if not perm.has_permission(request, self):
            return Response({'error': 'Permission denied'}, status=403)
        title = request.data.get('title')
        body = request.data.get('body', '')
        school_class_id = request.data.get('school_class_id')
        if not title:
            return Response({'error': 'Title required'}, status=400)
        kwargs = {'author': request.user, 'title': title, 'body': body}
        if school_class_id:
            kwargs['school_class_id'] = school_class_id
        announcement = Announcement.objects.create(**kwargs)
        from .services import notify_all_parents, notify_parents_of_class
        if school_class_id:
            notify_parents_of_class(school_class_id, 'announcement', title, body, url='/#/parent/announcements')
        else:
            notify_all_parents(title, body, url='/#/parent/announcements')
        return Response({
            'id': announcement.id,
            'title': announcement.title,
            'body': announcement.body,
            'school_class': {'id': announcement.school_class.id, 'name': announcement.school_class.name} if announcement.school_class else None,
            'createdAt': announcement.created_at.isoformat(),
        }, status=201)


class ParentNotificationsView(APIView):
    """A parent's own notification history (dues reminders, fee receipts, ...).

    Read-only, scoped to the requesting user — a parent can never see another
    parent's notifications. Newest first, capped at the 50 most recent rows.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        if request.user.role != 'parent':
            return Response({'error': 'Parents only'}, status=403)
        rows = NotificationLog.objects.filter(user=request.user).order_by('-sent_at')[:50]
        data = [{
            'id': n.id,
            'eventType': n.event_type,
            'title': n.title,
            'body': n.body,
            'payload': n.payload,
            'sentAt': n.sent_at.isoformat(),
        } for n in rows]
        return Response(data)


class ParentLinkView(APIView):
    permission_classes = [require_permission('users:write')]

    def get(self, request):
        links = ParentStudentLink.objects.select_related('parent', 'student').all()
        data = [{
            'id': link.id,
            'parentId': link.parent.id,
            'parentName': link.parent.name,
            'parentEmail': link.parent.email,
            'studentId': link.student.id,
            'studentName': link.student.name,
            'studentRoll': link.student.roll,
            'createdAt': link.created_at.isoformat(),
        } for link in links]
        return Response(data)

    def post(self, request):
        parent_id = request.data.get('parentId')
        student_id = request.data.get('studentId')
        if not parent_id or not student_id:
            return Response({'error': 'parentId and studentId required'}, status=400)
        from django.contrib.auth import get_user_model
        User = get_user_model()
        try:
            parent = User.objects.get(id=parent_id, role='parent')
        except User.DoesNotExist:
            return Response({'error': 'Parent not found'}, status=404)
        try:
            student = Student.objects.get(id=student_id)
        except Student.DoesNotExist:
            return Response({'error': 'Student not found'}, status=404)
        link, created = ParentStudentLink.objects.get_or_create(parent=parent, student=student)
        if not created:
            return Response({'error': 'Link already exists'}, status=409)
        return Response({'id': link.id, 'parentName': parent.name, 'studentName': student.name}, status=201)

    def delete(self, request):
        link_id = request.data.get('id')
        if not link_id:
            return Response({'error': 'id required'}, status=400)
        deleted, _ = ParentStudentLink.objects.filter(id=link_id).delete()
        if not deleted:
            return Response({'error': 'Link not found'}, status=404)
        return Response({'status': 'deleted'})


# ---------------------------------------------------------------------------
# Guardian connect (magic link) — public claim + admin link management
# ---------------------------------------------------------------------------

def _set_auth_cookies(response, user):
    """Mirror CustomTokenObtainPairView cookie behaviour (JWT auth cookies)."""
    from rest_framework_simplejwt.tokens import RefreshToken
    refresh = RefreshToken.for_user(user)
    access = str(refresh.access_token)
    sj = settings.SIMPLE_JWT
    response.set_cookie(
        sj['ACCESS_COOKIE'], access,
        httponly=True, secure=sj['AUTH_COOKIE_SECURE'],
        samesite=sj['AUTH_COOKIE_SAMESITE'],
        max_age=int(sj['ACCESS_TOKEN_LIFETIME'].total_seconds()),
    )
    response.set_cookie(
        sj['REFRESH_COOKIE'], str(refresh),
        httponly=True, secure=sj['AUTH_COOKIE_SECURE'],
        samesite=sj['AUTH_COOKIE_SAMESITE'],
        max_age=int(sj['REFRESH_TOKEN_LIFETIME'].total_seconds()),
    )
    return response


class StudentConnectView(APIView):
    """Public magic-link endpoints: inspect a link and claim the student.

    GET  → metadata for the connect page (valid/claimed/… + UI hints).
    POST → claim:
      - authenticated parent: sibling-overlap auto-links; otherwise the
        ID-card facts must match (authorization).
      - anonymous mode='login'  : parent signs in with their existing
        guardian account, then claims (same sibling/ID authorization).
      - anonymous mode='create' : first child in a family — ID-card facts
        gate, then a guardian account is created and logged in.
    """

    permission_classes = [permissions.AllowAny]

    def get_throttles(self):
        if self.request.method == 'GET':
            return [ConnectReadRateThrottle()]
        return [ConnectWriteRateThrottle()]

    def _get_link(self, token):
        return StudentConnectLink.objects.select_related(
            'student', 'student__school_class',
        ).filter(token=token).first()

    def _link_student(self, link, student, user, now, action='connect_claim'):
        ParentStudentLink.objects.get_or_create(parent=user, student=student)
        link.claimed_by = user
        link.claimed_at = now
        link.save(update_fields=['claimed_by', 'claimed_at'])
        log_audit(action, 'student', entity_id=str(student.id),
                  details={'token': link.token[:8], 'parent': user.email},
                  request=self.request)

    def _authorize_user(self, user, student, request):
        """Can this guardian claim this student? (sibling overlap or ID facts)"""
        if ParentStudentLink.objects.filter(parent=user, student=student).exists():
            return 'already'
        sibs = sibling_students(student)
        overlap = sibs is not None and ParentStudentLink.objects.filter(
            parent=user, student__in=sibs,
        ).exists()
        if overlap:
            return 'ok'
        if id_facts_match(
            student,
            request.data.get('fatherName') or '',
            request.data.get('motherName') or '',
            request.data.get('contact') or '',
        ):
            return 'ok'
        return 'id_mismatch'

    def get(self, request, token):
        link = self._get_link(token)
        if link is None:
            return Response({'valid': False, 'status': 'invalid'})
        if link.revoked_at:
            return Response({'valid': False, 'status': 'revoked'})
        if link.expires_at <= timezone.now():
            return Response({'valid': False, 'status': 'expired'})
        student = link.student

        if link.claimed_at and link.claimed_by_id:
            return Response({
                'valid': True,
                'status': 'claimed',
                'claimedByMe': (
                    request.user.is_authenticated
                    and str(request.user.id) == str(link.claimed_by_id)
                ),
                'studentName': student.name,
                'className': student.school_class.name if student.school_class else '',
            })

        user = request.user
        return Response({
            'valid': True,
            'status': 'unclaimed',
            'studentName': student.name,
            'studentRoll': student.roll,
            'className': student.school_class.name if student.school_class else '',
            'hasIdFacts': bool(
                (student.contact or '').strip()
                or (student.father_name or '').strip()
                or (student.mother_name or '').strip()
            ),
            'authenticated': bool(user.is_authenticated),
            'isParent': bool(user.is_authenticated and user.role == 'parent'),
            'alreadyLinked': bool(
                user.is_authenticated
                and ParentStudentLink.objects.filter(parent=user, student=student).exists()
            ),
            'familyLinked': family_parent_exists(student),
        })

    def post(self, request, token):
        link = self._get_link(token)
        if link is None:
            return Response({'error': 'This link is not valid.'}, status=404)
        if link.revoked_at:
            return Response({'error': 'This link has been revoked by the school.'}, status=410)
        if link.expires_at <= timezone.now():
            return Response({'error': 'This link has expired. Ask the school for a new one.'}, status=410)
        student = link.student
        now = timezone.now()

        if link.claimed_at and link.claimed_by_id:
            if request.user.is_authenticated and str(request.user.id) == str(link.claimed_by_id):
                return Response({'status': 'already_linked', 'studentName': student.name})
            return Response(
                {'error': 'This student is already connected to another guardian account.'},
                status=409,
            )

        # ---- authenticated parent ----
        if request.user.is_authenticated:
            user = request.user
            if user.role != 'parent':
                return Response(
                    {'error': 'Only a guardian account can claim a student link.'}, status=403,
                )
            auth = self._authorize_user(user, student, request)
            if auth == 'already':
                return Response({'status': 'already_linked', 'studentName': student.name})
            if auth == 'id_mismatch':
                return Response(
                    {'error': 'The ID card details did not match this student.'}, status=409,
                )
            self._link_student(link, student, user, now)
            return Response({'status': 'linked', 'studentName': student.name}, status=201)

        # ---- anonymous ----
        mode = request.data.get('mode')
        if mode == 'login':
            return self._claim_anon_login(request, link, student, now)
        if mode == 'create':
            return self._claim_anon_create(request, link, student, now)
        return Response({'error': 'Invalid request.'}, status=400)

    def _claim_anon_login(self, request, link, student, now):
        from django.contrib.auth import get_user_model
        User = get_user_model()
        email = (request.data.get('email') or '').strip()
        password = request.data.get('password') or ''
        if not email or not password:
            return Response({'error': 'Email and password are required.'}, status=400)
        user = User.objects.filter(email__iexact=email).first()
        if not user or not user.check_password(password) or not user.is_active:
            return Response({'error': 'Invalid email or password.'}, status=401)
        if user.role != 'parent':
            return Response(
                {'error': 'This account is not a guardian account. Sign in with the guardian account.'},
                status=403,
            )
        auth = self._authorize_user(user, student, request)
        if auth == 'already':
            return Response({'status': 'already_linked', 'studentName': student.name, 'loggedIn': True})
        if auth == 'id_mismatch':
            return Response(
                {'error': 'The ID card details did not match this student.'}, status=409,
            )
        self._link_student(link, student, user, now)
        response = Response({'status': 'linked', 'studentName': student.name, 'loggedIn': True}, status=201)
        return _set_auth_cookies(response, user)

    def _claim_anon_create(self, request, link, student, now):
        from django.contrib.auth import get_user_model
        User = get_user_model()
        if family_parent_exists(student):
            return Response(
                {'error': 'This family is already connected — sign in with your existing guardian account instead.',
                 'code': 'family_exists'},
                status=409,
            )
        name = (request.data.get('name') or '').strip()
        email = (request.data.get('email') or '').strip()
        password = request.data.get('password') or ''
        if not name or not email or not password:
            return Response({'error': 'Name, email and password are required.'}, status=400)
        if len(password) < 8:
            return Response({'error': 'Password must be at least 8 characters.'}, status=400)
        if User.objects.filter(email__iexact=email).exists():
            return Response(
                {'error': 'This email is already registered. Sign in with it instead.',
                 'code': 'email_exists'},
                status=409,
            )
        if not id_facts_match(
            student,
            request.data.get('fatherName') or '',
            request.data.get('motherName') or '',
            request.data.get('contact') or '',
        ):
            return Response(
                {'error': 'The ID card details did not match this student. Check the details printed on the ID card.'},
                status=409,
            )
        user = User.objects.create_user(
            email=email, password=password, name=name,
            role='parent', email_verified=True,
        )
        try:
            ParentStudentLink.objects.create(parent=user, student=student)
            self._link_student(link, student, user, now, action='connect_create')
        except Exception:
            user.delete()
            raise
        log_audit('connect_create', 'student', entity_id=str(student.id),
                  details={'email': email, 'token': link.token[:8]}, request=request)
        response = Response({'status': 'created', 'studentName': student.name, 'loggedIn': True}, status=201)
        return _set_auth_cookies(response, user)


class StudentConnectLinkAdminView(APIView):
    """Admin / monitor / class-teacher link management for one student.

    GET  → current shareable link (creates one lazily on first fetch).
    POST {action: 'revoke'}      → invalidate the current link.
    POST {action: 'regenerate'}  → invalidate + issue a fresh link.
    """

    permission_classes = [IsAuthenticated]

    def _get_student(self, request, student_id):
        try:
            student = Student.objects.get(id=student_id, deleted_at__isnull=True)
        except Student.DoesNotExist:
            return None, Response({'error': 'Student not found'}, status=404)
        if not can_manage_connect(request.user, student):
            return None, Response(
                {'error': 'You can only manage connection links for your own class.'},
                status=403,
            )
        return student, None

    def _active_payload(self, link):
        return {
            'status': 'active',
            'token': link.token,
            'expiresAt': link.expires_at.isoformat(),
            'createdAt': link.created_at.isoformat(),
        }

    def get(self, request, student_id):
        student, err = self._get_student(request, student_id)
        if err:
            return err
        active = current_active_link(student)
        if active is not None:
            return Response(self._active_payload(active))
        # No active link — show the last one's state rather than resurrecting it
        # (a revoked/consumed link stays dead until the staff explicitly re-issues one).
        last = StudentConnectLink.objects.filter(student=student).order_by('-created_at').first()
        if last is not None:
            if last.claimed_at and last.claimed_by_id:
                return Response({
                    'status': 'claimed',
                    'claimedBy': last.claimed_by.email if last.claimed_by else '',
                    'claimedAt': last.claimed_at.isoformat() if last.claimed_at else None,
                })
            return Response({'status': 'revoked'})
        # First ever link for this student — lazily issue one.
        active = issue_link(student, request.user)
        log_audit('create_connect_link', 'student', entity_id=str(student.id),
                  details={'token': active.token[:8]}, request=request)
        return Response(self._active_payload(active))

    def post(self, request, student_id):
        student, err = self._get_student(request, student_id)
        if err:
            return err
        action = request.data.get('action', 'revoke')
        active = current_active_link(student)

        if action == 'generate':
            if active is None:
                active = issue_link(student, request.user)
                log_audit('create_connect_link', 'student', entity_id=str(student.id),
                          details={'token': active.token[:8]}, request=request)
            return Response(self._active_payload(active))

        if action == 'regenerate':
            if active is not None:
                active.revoked_at = timezone.now()
                active.save(update_fields=['revoked_at'])
                log_audit('revoke_connect_link', 'student', entity_id=str(student.id),
                          details={'token': active.token[:8]}, request=request)
            link = issue_link(student, request.user)
            log_audit('create_connect_link', 'student', entity_id=str(student.id),
                      details={'token': link.token[:8]}, request=request)
            return Response(self._active_payload(link))

        if active is not None:
            active.revoked_at = timezone.now()
            active.save(update_fields=['revoked_at'])
            log_audit('revoke_connect_link', 'student', entity_id=str(student.id),
                      details={'token': active.token[:8]}, request=request)
            return Response({'status': 'revoked'})
        return Response({'status': 'none'})
