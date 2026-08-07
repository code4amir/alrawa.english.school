from django.urls import path, include
from rest_framework.routers import DefaultRouter
from . import views

router = DefaultRouter()
router.register(r'classes', views.ClassViewSet, basename='class')
router.register(r'subjects', views.SubjectViewSet, basename='subject')
router.register(r'academic-years', views.AcademicYearViewSet, basename='academic-year')
router.register(r'audit', views.AuditLogViewSet, basename='audit')
router.register(r'categories', views.CategoryViewSet, basename='category')
router.register(r'service-types', views.ServiceTypeViewSet, basename='service-type')
router.register(r'scheduler', views.SchedulerViewSet, basename='scheduler')

urlpatterns = [
    path('classes/promote-all/', views.ClassViewSet.as_view({'post': 'promote_all'}), name='promote-all'),
    path('', include(router.urls)),
    path('settings/', views.SettingView.as_view(), name='settings'),
    path('setup/status/', views.SetupStatusView.as_view(), name='setup-status'),
    path('setup/init/', views.SetupInitView.as_view(), name='setup-init'),
    path('dashboard-summary/', views.DashboardSummaryView.as_view(), name='dashboard-summary'),
    path('classes/<uuid:class_id>/subjects/',
         views.SubjectViewSet.as_view({'get': 'list', 'post': 'create'}),
         name='class-subjects'),
]


