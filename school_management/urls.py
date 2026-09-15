from django.contrib import admin
from django.urls import path, include, re_path
from django.http import JsonResponse, HttpResponseRedirect
from django.db import connections
from django.views.generic import TemplateView
from rest_framework import generics, permissions
import logging

logger = logging.getLogger(__name__)


def healthz(request):
    return JsonResponse({'status': 'ok'})


def health(request):
    try:
        connections['default'].cursor()
        return JsonResponse({'status': 'healthy', 'database': 'connected'})
    except Exception:
        logger.exception('Health check failed: database connection error')
        return JsonResponse({'status': 'unhealthy', 'error': 'Database connection failed'}, status=503)


def root_redirect(request):
    return HttpResponseRedirect('/admin/')


def mobile_redirect(request):
    return HttpResponseRedirect('/?pwa=true')


class WakeDBView(generics.GenericAPIView):
    # Auth-free by design: runs one trivial query and returns static JSON.
    # Lets the login screen warm a cold database before credentials exist.
    permission_classes = [permissions.AllowAny]
    def get(self, request):
        from django.db import connection
        connection.cursor()
        return JsonResponse({'status': 'awake'})


urlpatterns = [
    path('admin/', admin.site.urls),
    path('', root_redirect, name='root'),
    path('healthz/', healthz, name='healthz'),
    path('health/', health, name='health'),
    path('api/wake-db/', WakeDBView.as_view(), name='wake-db'),
    path('api/', include('accounts.urls')),
    path('api/', include('core.urls')),
    path('api/', include('students.urls')),
    path('api/', include('teachers.urls')),
    path('api/', include('staff.urls')),
    path('api/', include('books.urls')),
    path('api/', include('results.urls')),
    path('api/finance/', include('finance.urls')),
    path('api/engagement/', include('engagement.urls')),
    path('api/', include('attendance.urls')),
    path('api/ai/', include('ai_query.urls')),
    path('api/', include('parents.urls')),
    path('api/', include('academic.urls')),
    path('api/m/', include('teachers.urls_mobile')),
    path('m/', mobile_redirect, name='mobile-home'),
]
