from django.contrib import admin
from .models import RoutineTemplate, LessonPlan, Homework, Diary, ExamRoutine


@admin.register(RoutineTemplate)
class RoutineTemplateAdmin(admin.ModelAdmin):
    list_display = ['school_class', 'day', 'period_number', 'subject', 'teacher']
    list_filter = ['school_class', 'day', 'teacher']
    search_fields = ['school_class__name', 'subject__name', 'teacher__name']
    actions = ['publish_routine']

    def publish_routine(self, request, queryset):
        class_ids = queryset.values_list('school_class_id', flat=True).distinct()
        from parents.services import notify_parents_of_class, notify_all_parents
        if len(class_ids) == 1:
            class_id = list(class_ids)[0]
            from core.models import SchoolClass
            cls = SchoolClass.objects.get(id=class_id)
            notify_parents_of_class(
                class_id, 'routine_published',
                'Weekly Class Plan Updated',
                f'Tap to view the updated schedule and lesson topics for {cls.name}.',
                url='/#/parent/routine',
            )
            self.message_user(request, f'Notification sent to parents of {cls.name}')
        else:
            notify_all_parents(
                'Weekly Class Plan Updated',
                'Tap to view the updated class schedule and lesson topics.',
                url='/#/parent/routine',
                event_type='routine_published',
            )
            self.message_user(request, 'Notification sent to all parents')
    publish_routine.short_description = 'Notify parents about routine update'


@admin.register(LessonPlan)
class LessonPlanAdmin(admin.ModelAdmin):
    list_display = ['routine_template', 'week_start', 'topic', 'completed']
    list_filter = ['completed', 'week_start']


@admin.register(Homework)
class HomeworkAdmin(admin.ModelAdmin):
    list_display = ['subject', 'school_class', 'date', 'due_date', 'published']
    list_filter = ['published', 'school_class', 'subject']


@admin.register(Diary)
class DiaryAdmin(admin.ModelAdmin):
    list_display = ['subject', 'school_class', 'date', 'topic']
    list_filter = ['school_class', 'subject', 'date']


@admin.register(ExamRoutine)
class ExamRoutineAdmin(admin.ModelAdmin):
    list_display = ['exam_name', 'school_class', 'subject', 'date', 'start_time']
    list_filter = ['exam_name', 'school_class', 'date']
