from django.contrib import admin
from .models import Student, StudentService


@admin.register(Student)
class StudentAdmin(admin.ModelAdmin):
    list_display = ('name', 'student_id', 'school_class', 'roll', 'session', 'created_at')
    list_filter = ('session', 'school_class')
    search_fields = ('name', 'student_id', 'father_name', 'contact')
    readonly_fields = ('id', 'student_id', 'created_at')


@admin.register(StudentService)
class StudentServiceAdmin(admin.ModelAdmin):
    list_display = ('student', 'service_type', 'active', 'created_at')
    list_filter = ('active', 'service_type')
    search_fields = ('student__name', 'student__student_id')
