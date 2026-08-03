"""Guardian-connect (magic link) service logic.

Pure helpers used by the connect endpoints:

- `normalize_phone` / `normalize_name`: tolerant normalization so a parent
  typing the ID-card facts from a WhatsApp screenshot matches the student
  record even with stray spaces, punctuation, "Md." prefixes or phone
  formatting differences (01... vs +8801...).
- `id_facts_match`: the possession+knowledge gate — the claimer must show
  they know this student's ID-card details (father / mother / contact).
- `sibling_students`: students sharing a family signal (contact, father or
  mother name) — the backbone of 2nd/3rd-child family resolution.
- `can_manage_connect`: admin / monitor / class teacher (of that class) may
  generate & revoke links.
"""
from django.db.models import Q
from django.utils import timezone

from parents.models import ParentStudentLink, StudentConnectLink
from teachers.models import ClassTeacher

CONNECT_LINK_TTL_DAYS = 90


def normalize_phone(value):
    if not value:
        return ''
    digits = ''.join(ch for ch in str(value) if ch.isdigit())
    if digits.startswith('880') and len(digits) > 11:
        digits = digits[3:]
    if digits.startswith('0') and len(digits) == 11:
        digits = digits[1:]
    return digits


def normalize_name(value):
    if not value:
        return ''
    return ''.join(ch.lower() for ch in str(value) if ch.isalnum())


def _name_match(a, b):
    """Case/space/punctuation-insensitive, tolerant of prefixes/suffixes."""
    na, nb = normalize_name(a), normalize_name(b)
    if not na or not nb:
        return False
    if na == nb:
        return True
    if len(na) >= 3 and (na in nb or nb in na):
        return True
    return False


def id_facts_match(student, father_name='', mother_name='', contact=''):
    """Gate: does the submitted ID-card info match this student's record?

    - Contact (phone) is the strongest single signal: if the record has a
      contact, it must match, and at least one of father/mother must also
      match when either is present on the record.
    - If the record has no contact but has names, every present name must
      match.
    - If the record has NO family facts at all (thin-gate fallback) the
      check passes — there is nothing to verify against.
    """
    s_contact = (student.contact or '').strip()
    s_father = (student.father_name or '').strip()
    s_mother = (student.mother_name or '').strip()

    has_facts = bool(s_contact or s_father or s_mother)
    if not has_facts:
        return True  # thin gate — no ID data on file

    if s_contact:
        if normalize_phone(contact) != normalize_phone(s_contact):
            return False
        if s_father or s_mother:
            father_ok = _name_match(father_name, s_father) if s_father else False
            mother_ok = _name_match(mother_name, s_mother) if s_mother else False
            return father_ok or mother_ok
        return True  # contact only on record

    # no contact on record — use the names we have
    if s_father and s_mother:
        return _name_match(father_name, s_father) and _name_match(mother_name, s_mother)
    if s_father:
        return _name_match(father_name, s_father)
    if s_mother:
        return _name_match(mother_name, s_mother)
    return True


def sibling_students(student):
    """Students sharing a family signal with this student (excluding it)."""
    q = Q()
    if (student.contact or '').strip():
        q |= Q(contact=student.contact.strip())
    if (student.father_name or '').strip():
        q |= Q(father_name__iexact=student.father_name.strip())
    if (student.mother_name or '').strip():
        q |= Q(mother_name__iexact=student.mother_name.strip())
    if not q:
        return None
    from students.models import Student
    return Student.objects.filter(q).exclude(id=student.id).exclude(deleted_at__isnull=False)


def family_parent_exists(student):
    """Is any sibling of this student already linked to a guardian account?"""
    sibs = sibling_students(student)
    if sibs is None:
        return False
    return ParentStudentLink.objects.filter(student__in=sibs).exists()


def current_active_link(student):
    """The student's currently-shareable link, or None."""
    return StudentConnectLink.objects.filter(
        student=student,
        revoked_at__isnull=True,
        claimed_at__isnull=True,
        expires_at__gt=timezone.now(),
    ).order_by('-created_at').first()


def issue_link(student, user):
    """Create a fresh shareable link for the student."""
    import secrets
    return StudentConnectLink.objects.create(
        student=student,
        token=secrets.token_urlsafe(24),
        created_by=user if (user and user.is_authenticated) else None,
        expires_at=timezone.now() + timezone.timedelta(days=CONNECT_LINK_TTL_DAYS),
    )


def can_manage_connect(user, student):
    """Admin, monitor, or the class teacher of the student's class."""
    if not user or not user.is_authenticated:
        return False
    if user.role in ('admin', 'monitor'):
        return True
    if user.role == 'teacher':
        return ClassTeacher.objects.filter(
            teacher__user=user,
            school_class=student.school_class,
        ).exists()
    return False
