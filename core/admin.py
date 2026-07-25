from django.contrib import admin
from .models import SchoolClass, Subject, AcademicYear, SchoolSetting, AuditLog, Category, Program, ServiceType


@admin.register(SchoolClass)
class SchoolClassAdmin(admin.ModelAdmin):
    list_display = ('name', 'order')
    search_fields = ('name',)


@admin.register(Subject)
class SubjectAdmin(admin.ModelAdmin):
    list_display = ('name', 'school_class', 'order')
    list_filter = ('school_class',)


@admin.register(AcademicYear)
class AcademicYearAdmin(admin.ModelAdmin):
    list_display = ('name', 'start_date', 'end_date', 'is_active')


@admin.register(SchoolSetting)
class SchoolSettingAdmin(admin.ModelAdmin):
    list_display = ('key', 'value')


@admin.register(AuditLog)
class AuditLogAdmin(admin.ModelAdmin):
    list_display = ('user_id', 'action', 'entity_type', 'entity_id', 'created_at')
    list_filter = ('action', 'entity_type')
    readonly_fields = ('user_id', 'action', 'entity_type', 'entity_id', 'details', 'created_at')


@admin.register(Category)
class CategoryAdmin(admin.ModelAdmin):
    list_display = ('name', 'type')
    list_filter = ('type',)


@admin.register(ServiceType)
class ServiceTypeAdmin(admin.ModelAdmin):
    list_display = ('name', 'default_amount', 'frequency', 'active')
    list_filter = ('active', 'frequency')
    search_fields = ('name',)
