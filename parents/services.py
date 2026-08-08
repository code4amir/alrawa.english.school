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
    subs = PushSubscription.objects.filter(user=user)
    if not subs.exists():
        return 0

    payload = json.dumps({
        'title': title,
        'body': body,
        'icon': icon or '/icon-192.svg',
        'data': {'url': url or '/'},
    })

    vapid_claims = {
        'sub': f'mailto:{settings.VAPID_CLAIM_EMAIL}',
    }
    sent = 0
    for sub in subs:
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
            sent += 1
        except WebPushException as e:
            if hasattr(e, 'response') and e.response and e.response.status_code == 410:
                sub.delete()
            logger.warning('Push send failed for %s: %s', sub.endpoint[:50], e)
        except Exception as e:
            logger.error('Push error for %s: %s', sub.endpoint[:50], e)
    return sent


def count_linked_parents(student_id):
    """Number of parent accounts linked to a student (no side effects).

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
