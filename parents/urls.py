from django.urls import path
from . import views

urlpatterns = [
    path('parents/my-students/', views.MyStudentsView.as_view(), name='parent-my-students'),
    path('parents/attendance/<uuid:student_id>/', views.StudentAttendanceView.as_view(), name='parent-student-attendance'),
    path('parents/fees/<uuid:student_id>/', views.StudentFeesView.as_view(), name='parent-student-fees'),
    path('parents/results/<uuid:student_id>/', views.StudentResultsView.as_view(), name='parent-student-results'),
    path('parents/push/subscribe/', views.PushSubscribeView.as_view(), name='push-subscribe'),
    path('parents/push/vapid-key/', views.VapidKeyView.as_view(), name='vapid-key'),
    path('parents/announcements/', views.AnnouncementListView.as_view(), name='parent-announcements'),
    path('parents/notifications/', views.ParentNotificationsView.as_view(), name='parent-notifications'),
    path('parents/links/', views.ParentLinkView.as_view(), name='parent-links'),
    path('parents/connect/<str:token>/', views.StudentConnectView.as_view(), name='parent-connect'),
    path('students/<uuid:student_id>/connect-link/', views.StudentConnectLinkAdminView.as_view(), name='student-connect-link'),
]
