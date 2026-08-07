"""Admit card generation endpoint.

Returns a class roster (active students only) along with the data needed to
render a per-student admit card for a given term/session: subject list, photo
URL, result+attendance (if entered for that term), exam settings, and a
co-ordinator signature note.

Endpoint:  GET /api/classes/<uuid:class_id>/admit-cards/?term=<n>&session=<s>
Permission: students:read (admin / monitor / teacher / parent-with-link)
"""

import logging
from rest_framework import serializers
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response
from rest_framework.exceptions import ValidationError

from accounts.permissions import require_permission
from core.models import SchoolClass, Subject, SchoolSetting
from students.models import Student
from results.models import Result

logger = logging.getLogger(__name__)

TERM_LABEL_MAP = {'1': '1st Term', '2': '2nd Term', '3': '3rd Term'}


def _photo_url(student):
    """Token-based photo URL, mirroring core.mixins.PhotoUrlMixin format."""
    if student.photo_path:
        from django.core import signing
        token = signing.dumps({'id': str(student.id)}, salt='photo-access')
        return f'/api/students/{student.id}/photo/?token={token}&proxy=1'
    return None


@api_view(['GET'])
@permission_classes([require_permission('students:read')])
def class_admit_cards(request, class_id):
    """Return all active students in a class + subjects + per-term results."""
    try:
        school_class = SchoolClass.objects.get(id=class_id)
    except SchoolClass.DoesNotExist:
        raise ValidationError({'class_id': 'Class not found.'})

    term = (request.query_params.get('term') or '1')
    session = request.query_params.get('session') or ''

    subjects = list(school_class.subjects.all().order_by('order', 'name'))

    # Scope students — parents only see their linked students
    base_qs = Student.objects.select_related('school_class')
    if getattr(request.user, 'role', None) == 'parent':
        student_ids = request.user.parent_links.values_list('student_id', flat=True)
        base_qs = base_qs.filter(id__in=student_ids)

    students = list(base_qs.filter(
        school_class=school_class, deleted_at__isnull=True,
    ).order_by('roll', 'name'))

    # Single query to fetch all results for this class+session+term
    results_by_student = {}
    if session:
        res_qs = Result.objects.filter(
            student__in=students, session=session, term=str(term)
        )
        for r in res_qs:
            results_by_student[r.student_id] = {
                'marks': r.marks or {},
                'attendance': r.attendance,
                'comment': r.comment or '',
            }

    # Exam settings (optional)
    exam_type = SchoolSetting.objects.filter(key='exam_type').values_list('value', flat=True).first() or ''
    exam_terms_setting = SchoolSetting.objects.filter(key='exam_terms').values_list('value', flat=True).first() or ''

    term_label = exam_terms_setting or TERM_LABEL_MAP.get(term, f'Term {term}')

    student_data = []
    for s in students:
        r = results_by_student.get(s.id)
        student_data.append({
            'id': str(s.id),
            'studentId': s.student_id,
            'name': s.name,
            'roll': s.roll or '',
            'session': s.session or '',
            'fatherName': s.father_name or '',
            'motherName': s.mother_name or '',
            'contact': s.contact or '',
            'className': s.school_class.name if s.school_class else '',
            'photoUrl': _photo_url(s) or None,
            'hasPhoto': bool(s.photo_path),
            'result': r,
        })

    return Response({
        'className': school_class.name,
        'session': session,
        'term': term,
        'termLabel': term_label,
        'examType': exam_type,
        'subjects': [{'id': str(s.id), 'name': s.name, 'fullMarks': s.full_marks} for s in subjects],
        'coordinatorSignatureNote': 'This is to certify that the above student is duly enrolled and eligible to appear for the said examination.',
        'students': student_data,
    })
