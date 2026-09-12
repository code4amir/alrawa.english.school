from django.urls import path, include
from rest_framework.routers import DefaultRouter
from . import views

router = DefaultRouter()
router.register(r'results', views.ResultViewSet, basename='result')
router.register(r'result-locks', views.ResultLockViewSet, basename='result-lock')

urlpatterns = [
    path('', include(router.urls)),
    path('students/<uuid:student_id>/results/',
         views.ResultViewSet.as_view({'get': 'list', 'post': 'create'}),
         name='student-results'),
    path('classes/<uuid:class_id>/results/',
         views.ResultViewSet.as_view({'get': 'class_results', 'delete': 'delete_class_results'}),
         name='class-results'),
]


