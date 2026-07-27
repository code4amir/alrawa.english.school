from django.urls import path
from . import views

urlpatterns = [
    path('auth/register/', views.RegisterView.as_view(), name='register'),
    path('auth/login/', views.CustomTokenObtainPairView.as_view(), name='login'),
    path('auth/refresh/', views.CustomTokenRefreshView.as_view(), name='refresh'),
    path('auth/logout/', views.LogoutView.as_view(), name='logout'),
    path('auth/me/', views.MeView.as_view(), name='me'),
    path('auth/change-password/', views.ChangePasswordView.as_view(), name='change-password'),
    path('auth/get-session/', views.AuthGetSessionView.as_view(), name='auth-get-session'),
    path('auth/send-verification/', views.SendVerificationView.as_view(), name='send-verification'),
    path('auth/verify-email/', views.VerifyEmailView.as_view(), name='verify-email'),
    path('auth/request-password-reset/', views.RequestPasswordResetView.as_view(), name='request-password-reset'),
    path('auth/reset-password/', views.ResetPasswordView.as_view(), name='reset-password'),
    path('auth/link-child/', views.LinkChildView.as_view(), name='link-child'),
    path('auth/unlink-child/', views.UnlinkChildView.as_view(), name='unlink-child'),
    path('users/', views.GetAllUsersView.as_view(), name='users-list'),
    path('users/create-staff/', views.CreateStaffView.as_view(), name='create-staff'),
    path('users/roles/', views.RoleChoicesView.as_view(), name='users-roles'),
    path('users/<uuid:pk>/role/', views.UpdateUserRoleView.as_view(), name='user-role'),
    path('users/<uuid:pk>/', views.DeleteUserView.as_view(), name='user-delete'),
]
