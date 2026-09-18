import json
import logging
from django.conf import settings
from .models import PushSubscription, NotificationLog

logger = logging.getLogger(__name__)

try:
    from pywebpush import webpush as _webpush, WebPushException
except ImportError:
    _webpush = None
    WebPushException = Exception


def notify(user, title, body, url=None, icon=None):
    subs = list(PushSubscription.objects.filter(user=user))
    if not subs:
        return 0
    payload = _build_payload(title, body, url, icon)
    vapid_claims = _vapid_claims()
    sent = 0
    for sub in subs:
        if _deliver_to_sub(sub, payload, vapid_claims) == 'sent':
            sent += 1
    return sent


def _deliver_to_sub(sub, payload, vapid_claims):
    """Push one payload to one subscription. No DB reads.

    Returns 'sent', 'gone' (410 — sub deleted), or 'failed'.
    """
    try:
        _webpush(
            subscription_info={
                'endpoint': sub.endpoint,
                'keys': {'p256dh': sub.p256dh_key, 'auth': sub.auth_key},
            },
            data=payload,
            vapid_private_key=settings.VAPID_PRIVATE_KEY,
            vapid_claims=vapid_claims,
        )
        return 'sent'
    except WebPushException as e:
        if hasattr(e, 'response') and e.response and e.response.status_code == 410:
            sub.delete()
            return 'gone'
        logger.warning('Push send failed for %s: %s', sub.endpoint[:50], e)
        return 'failed'
    except Exception as e:
        logger.error('Push error for %s: %s', sub.endpoint[:50], e)
        return 'failed'


def _build_payload(title, body, url=None, icon=None):
    return json.dumps({
        'title': title,
        'body': body,
        'icon': icon or '/icon-192.svg',
        'data': {'url': url or '/'},
    })


def _vapid_claims():
    return {
        'sub': f'mailto:{settings.VAPID_CLAIM_EMAIL}',
    }


def _delivery_error(user, sent):
    """Map a push outcome to the NotificationLog error string.

    - None only when at least one push was actually delivered.
    - 'no_subscription' when the user has zero push subscriptions.
    - 'push_failed' when subs exist but nothing was delivered.
    """
    if sent and sent > 0:
        return None
    if PushSubscription.objects.filter(user=user).exists():
        return 'push_failed'
    return 'no_subscription'


def count_linked_parents(student_id):
    """Number of parent accounts linked to a student (no side effects)."

    Used by the dues-reminder dry-run to report how many parents *would*
    be notified, without sending anything.
    """
    from django.contrib.auth import get_user_model
    User = get_user_model()
    return User.objects.filter(
        role='parent',
        parent_links__student_id=student_id,
    ).distinct().count()


def notify_parents_of_student(student_id, event_type, title, body, url=None):
    from django.contrib.auth import get_user_model
    User = get_user_model()
    parents = User.objects.filter(
        role='parent',
        parent_links__student_id=student_id,
    ).distinct()

    for parent in parents:
        sent = 0
        err = None
        try:
            sent = notify(parent, title, body, url)
            if err is None:
                err = _delivery_error(parent, sent)
        except Exception as e:
            err = str(e)
            logger.exception('Error notifying %s: %s', parent.email, e)
        NotificationLog.objects.create(
            user=parent,
            event_type=event_type,
            title=title,
            body=body,
            payload={'student_id': str(student_id), 'url': url},
            error=err,
        )
    return parents.count()


def notify_parents_of_students(student_ids, event_type, title, body, url=None):
    """Batched fan-out to the parents of many students.

    Flat query cost regardless of student count: ONE links query, ONE
    users query, ONE push-subscription query, ONE bulk NotificationLog
    insert. Students with no linked parents cost nothing (no per-student
    lookups at all). Recipients, content, payloads and error strings are
    identical to calling notify_parents_of_student per student.
    """
    from django.contrib.auth import get_user_model
    from parents.models import ParentStudentLink
    User = get_user_model()
    sids = [str(s) for s in student_ids]
    if not sids:
        return 0
    links = ParentStudentLink.objects.filter(
        student_id__in=sids,
    ).values_list('student_id', 'parent_id')
    by_student = {}
    parent_ids = set()
    for stu_id, par_id in links:
        by_student.setdefault(str(stu_id), []).append(par_id)
        parent_ids.add(par_id)
    if not parent_ids:
        return 0
    parents = {str(u.id): u for u in User.objects.filter(id__in=parent_ids)}
    subs_by_user = {}
    for sub in PushSubscription.objects.filter(user_id__in=parent_ids):
        subs_by_user.setdefault(str(sub.user_id), []).append(sub)
    payload = _build_payload(title, body, url)
    vapid_claims = _vapid_claims()
    logs = []
    count = 0
    for stu_key, pids in by_student.items():
        for pid in pids:
            parent = parents.get(str(pid))
            if parent is None:
                continue
            subs = subs_by_user.get(str(pid), [])
            sent = 0
            err = None
            try:
                for sub in subs:
                    if _deliver_to_sub(sub, payload, vapid_claims) == 'sent':
                        sent += 1
                if sent > 0:
                    err = None
                # A 410-gone sub is deleted by _deliver_to_sub (pk cleared),
                # so only surviving subs count — same as _delivery_error's
                # re-check after notify() deleted the dead ones.
                elif any(s.pk for s in subs):
                    err = 'push_failed'
                else:
                    err = 'no_subscription'
            except Exception as e:
                err = str(e)
                logger.exception('Error notifying %s: %s', parent.email, e)
            logs.append(NotificationLog(
                user=parent,
                event_type=event_type,
                title=title,
                body=body,
                payload={'student_id': stu_key, 'url': url},
                error=err,
            ))
            count += 1
    if logs:
        NotificationLog.objects.bulk_create(logs)
    return count


def notify_parents_of_class(class_id, event_type, title, body, url=None):
    from django.contrib.auth import get_user_model
    User = get_user_model()
    from parents.models import ParentStudentLink
    parent_ids = ParentStudentLink.objects.filter(
        student__school_class_id=class_id,
    ).values_list('parent_id', flat=True).distinct()
    parents = User.objects.filter(id__in=parent_ids)

    count = 0
    for parent in parents:
        sent = 0
        err = None
        try:
            sent = notify(parent, title, body, url)
            if err is None:
                err = _delivery_error(parent, sent)
        except Exception as e:
            err = str(e)
            logger.exception('Error notifying %s: %s', parent.email, e)
        NotificationLog.objects.create(
            user=parent,
            event_type=event_type,
            title=title,
            body=body,
            payload={'class_id': str(class_id), 'url': url},
            error=err,
        )
        count += 1
    return count


def notify_all_parents(title, body, url=None, event_type='announcement'):
    from django.contrib.auth import get_user_model
    User = get_user_model()
    parents = User.objects.filter(role='parent')

    count = 0
    for parent in parents:
        sent = 0
        err = None
        try:
            sent = notify(parent, title, body, url)
            if err is None:
                err = _delivery_error(parent, sent)
        except Exception as e:
            err = str(e)
            logger.exception('Error notifying %s: %s', parent.email, e)
        NotificationLog.objects.create(
            user=parent,
            event_type=event_type,
            title=title,
            body=body,
            payload={'url': url},
            error=err,
        )
        count += 1
    return count


MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
               'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']


def _fmt_month(month):
    """'2026-03' -> 'Mar 2026'"""
    try:
        y, m = month.split('-')
        return f"{MONTH_NAMES[int(m) - 1]} {y}"
    except (ValueError, IndexError):
        return month


def compose_dues_body(fees):
    """Line-item breakdown of unpaid fees, ONLY up to the current month.

    fees = DefaulterService.compute() result[0]['fees']:
        [{name, amount, paid, type: 'onetime'|'global'|'recurring', months?: [...]}]
    Future months and already-paid items are excluded. Category names come from
    the FeeSchedule rows, so any fee category (Tuition, Admission, Hifz, ...)
    is covered automatically with no hardcoding.

    Returns a list of strings like:
        "Tuition fees: Mar 2026, Apr 2026 — 1500.00/mo"
        "Admission fees: 5000.00"
    """
    from django.utils import timezone
    now = timezone.now()
    current_ym = f"{now.year}-{now.month:02d}"
    lines = []
    for fee in fees:
        if fee.get('paid'):
            continue
        if fee['type'] in ('onetime', 'global'):
            lines.append(f"{fee['name']}: {fee['amount']:,.2f}")
        elif fee['type'] == 'recurring' and fee.get('months'):
            unpaid = sorted(
                m['month'] for m in fee['months']
                if not m.get('paid') and m['month'] <= current_ym
            )
            if unpaid:
                months_str = ', '.join(_fmt_month(m) for m in unpaid)
                lines.append(f"{fee['name']}: {months_str} — {fee['amount']:,.2f}/mo")
    return lines


def notify_parents_dues(student_id, fees, note=''):
    """Send a dues-reminder push + log to all linked parents of a student.

    Returns the number of parents notified (0 if the student has no unpaid
    dues up to the current month — nothing is sent in that case).
    """
    lines = compose_dues_body(fees)
    if not lines:
        return 0
    title = 'Fee Dues Reminder'
    body = 'You have dues:\n' + '\n'.join(lines)
    if note:
        body += f"\n\n{note}"
    return notify_parents_of_student(
        student_id, 'dues_reminder', title, body,
        url=f'/#/parent/fees/{student_id}',
    )
