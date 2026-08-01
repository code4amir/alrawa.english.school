from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response
from django.db import models
from django.utils import timezone
from .models import Student, StudentService
from .serializers import StudentSerializer, StudentServiceToggleSerializer
from accounts.permissions import require_permission, can_manage_students, is_admin_or_superuser, require_photo_access
from core.mixins import PhotoHandleMixin
from core.audit import log_audit
from core.models import SchoolClass


class StudentViewSet(PhotoHandleMixin, viewsets.ModelViewSet):
    serializer_class = StudentSerializer
    photo_prefix = 'students'
    filterset_fields = ['school_class_id', 'session']

    def list(self, request, *args, **kwargs):
        if request.query_params.get('all') == 'true':
            qs = self.get_queryset().order_by('name')
            serializer = self.get_serializer(qs, many=True)
            return Response(serializer.data)
        return super().list(request, *args, **kwargs)

    def get_permissions(self):
        if self.action == 'photo':
            return [require_photo_access('students:read')()]
        if self.action in ['list', 'retrieve', 'class_results']:
            return [require_permission('students:read')()]
        return [require_permission('students:write')()]

    def get_queryset(self):
        qs = Student.objects.select_related('school_class').prefetch_related('services__service_type').all()
        show_archived = self.request.query_params.get('archived', 'false').lower() == 'true'
        search = self.request.query_params.get('search')
        class_id = self.request.query_params.get('class_id')
        class_name = self.request.query_params.get('class_name')\
            or self.request.query_params.get('className')

        if not show_archived:
            qs = qs.filter(deleted_at__isnull=True)
        if class_id:
            qs = qs.filter(school_class_id=class_id)
        if class_name:
            qs = qs.filter(school_class__name=class_name)
        if search:
            qs = qs.filter(
                models.Q(name__icontains=search) |
                models.Q(student_id__icontains=search) |
                models.Q(roll__icontains=search)
            )
        return qs

    def perform_create(self, serializer):
        school_class = serializer.validated_data.get('school_class')
        if school_class and not is_admin_or_superuser(self.request.user):
            if not can_manage_students(self.request.user, school_class.id):
                raise PermissionDenied('You are not the class teacher of this class.')
        obj = serializer.save()
        log_audit('create', 'student', entity_id=obj.pk, request=self.request)

    def perform_destroy(self, instance):
        if instance.school_class_id and not is_admin_or_superuser(self.request.user):
            if not can_manage_students(self.request.user, instance.school_class_id):
                raise PermissionDenied('You are not the class teacher of this class.')
        entity_id = str(instance.pk)
        super().perform_destroy(instance)
        log_audit('delete', 'student', entity_id=entity_id, request=self.request)

    @action(detail=True, methods=['post'])
    def graduate(self, request, pk=None):
        student = self.get_object()
        if student.school_class_id and not is_admin_or_superuser(request.user):
            if not can_manage_students(request.user, student.school_class_id):
                raise PermissionDenied('You are not the class teacher of this class.')
        student.graduated_at = timezone.now()
        student.save(update_fields=['graduated_at'])
        log_audit('graduate', 'student', entity_id=student.pk, request=request)
        return Response(StudentSerializer(student).data)

    @action(detail=True, methods=['post'])
    def ungraduate(self, request, pk=None):
        student = self.get_object()
        if student.school_class_id and not is_admin_or_superuser(request.user):
            if not can_manage_students(request.user, student.school_class_id):
                raise PermissionDenied('You are not the class teacher of this class.')
        student.graduated_at = None
        student.save(update_fields=['graduated_at'])
        log_audit('ungraduate', 'student', entity_id=student.pk, request=request)
        return Response(StudentSerializer(student).data)

    @action(detail=False, methods=['post'], url_path='import')
    def import_students(self, request):
        students_data = request.data.get('students', [])
        if not students_data:
            return Response({'error': 'No students data provided'}, status=400)
        created = 0
        errors = []
        for i, row in enumerate(students_data):
            try:
                school_class = None
                class_name = row.get('class', '').strip()
                if class_name:
                    school_class = SchoolClass.objects.filter(name__iexact=class_name).first()
                serializer = StudentSerializer(data={
                    'name': row.get('name', '').strip(),
                    'roll': row.get('roll', '').strip(),
                })
                if serializer.is_valid():
                    student = serializer.save()
                    if school_class:
                        student.school_class = school_class
                    if row.get('fatherName'):
                        student.father_name = row.get('fatherName', '').strip()
                    if row.get('motherName'):
                        student.mother_name = row.get('motherName', '').strip()
                    if row.get('contact'):
                        student.contact = row.get('contact', '').strip()
                    student.save()
                    created += 1
                else:
                    errors.append({'row': i + 1, 'error': str(serializer.errors)})
            except Exception as e:
                errors.append({'row': i + 1, 'error': str(e)})
        return Response({'created': created, 'errors': errors})

    @action(detail=False, methods=['post'])
    def graduate_class(self, request):
        class_id = request.data.get('class_id')
        if not class_id:
            return Response({'error': 'class_id required'}, status=400)
        if not is_admin_or_superuser(request.user):
            if not can_manage_students(request.user, class_id):
                raise PermissionDenied('You are not the class teacher of this class.')
        count = Student.objects.filter(
            school_class_id=class_id, deleted_at__isnull=True
        ).update(graduated_at=timezone.now())
        log_audit('graduate_class', 'student', details={'class_id': class_id, 'count': count}, request=request)
        return Response({'status': 'ok', 'count': count})

    @action(detail=True, methods=['post'])
    def toggle_service(self, request, pk=None):
        student = self.get_object()
        serializer = StudentServiceToggleSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        from .services import toggle_student_service
        result = toggle_student_service(
            student_id=student.id,
            service_type_id=data['serviceTypeId'],
            active=data['active'],
            starts_at=data.get('starts_at'),
            ends_at=data.get('ends_at'),
        )
        log_audit('toggle_service', 'student_service',
                  entity_id=result['student_service']['id'],
                  details={'student_id': str(student.id), 'active': data['active']},
                  request=request)
        return Response(result)

    @action(detail=False, methods=['post'])
    def bulk_toggle_service(self, request):
        service_type_id = request.data.get('service_type_id')
        student_ids = request.data.get('student_ids', [])
        class_id = request.data.get('class_id')
        active = request.data.get('active', True)
        starts_at = request.data.get('starts_at')
        ends_at = request.data.get('ends_at')

        if not service_type_id:
            return Response({'error': 'service_type_id required'}, status=400)

        if class_id:
            student_ids = list(Student.objects.filter(
                school_class_id=class_id, deleted_at__isnull=True
            ).values_list('id', flat=True))
            if not student_ids:
                return Response({'error': 'No students found in this class'}, status=400)
        elif not student_ids:
            return Response({'error': 'class_id or student_ids required'}, status=400)

        from .services import bulk_set_student_service
        results = bulk_set_student_service(
            service_type_id=service_type_id,
            student_ids=student_ids,
            active=active,
            starts_at=starts_at,
            ends_at=ends_at,
        )
        ok = sum(1 for r in results if r.get('status') == 'ok')
        log_audit('bulk_toggle_service', 'student_service',
                  details={'service_type_id': str(service_type_id), 'class_id': str(class_id) if class_id else None,
                           'count': len(results), 'ok': ok},
                  request=request)
        return Response({'results': results, 'total': len(results), 'ok': ok, 'errors': len(results) - ok})

    @action(detail=False, methods=['get'])
    def service_summary(self, request):
        """Per-class enrollment overview: total students + active count per service."""
        from django.db.models import Count
        class_totals = Student.objects.filter(deleted_at__isnull=True).values(
            'school_class_id', 'school_class__name'
        ).annotate(total=Count('id')).order_by('school_class__name')
        svc_counts = StudentService.objects.filter(active=True).values(
            'student__school_class_id', 'service_type_id'
        ).annotate(n=Count('id'))
        svc_map: dict = {}
        for c in svc_counts:
            svc_map.setdefault(c['student__school_class_id'], {})[str(c['service_type_id'])] = c['n']
        rows = [{
            'classId': str(x['school_class_id']),
            'className': x['school_class__name'],
            'total': x['total'],
            'services': svc_map.get(x['school_class_id'], {}),
        } for x in class_totals]
        return Response(rows)
