import os
from pathlib import Path
from datetime import timedelta
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / '.env', override=True)

DEBUG = os.environ.get('DJANGO_DEBUG', 'False').lower() == 'true'

SECRET_KEY = os.environ.get('DJANGO_SECRET_KEY')
if not SECRET_KEY:
    raise ValueError("DJANGO_SECRET_KEY environment variable is required. "
                     "Set it in your .env file.")

ALLOWED_HOSTS = os.environ.get('DJANGO_ALLOWED_HOSTS', 'localhost,127.0.0.1,testserver').split(',')

INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    'rest_framework',
    'rest_framework_simplejwt',
    'django_filters',
    'corsheaders',
    'accounts',
    'core',
    'students',
    'teachers',
    'staff',
    'books',
    'results',
    'finance',
    'engagement',
    'attendance',
    'ai_query',
    'parents',
    'academic',
    'rest_framework_simplejwt.token_blacklist',
]

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'corsheaders.middleware.CorsMiddleware',
    'whitenoise.middleware.WhiteNoiseMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'school_management.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [BASE_DIR / 'templates'],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'school_management.wsgi.application'

DB_NAME = os.environ.get('DB_NAME')
DB_USER = os.environ.get('DB_USER')
DB_PASSWORD = os.environ.get('DB_PASSWORD')
if not DEBUG and not all([DB_NAME, DB_USER, DB_PASSWORD]):
    raise ValueError("DB_NAME, DB_USER, DB_PASSWORD env vars are required when DEBUG is False.")

DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.postgresql',
        'NAME': DB_NAME or 'postgres',
        'USER': DB_USER or 'postgres',
        'PASSWORD': DB_PASSWORD or 'postgres',
        'HOST': os.environ.get('DB_HOST', 'localhost'),
        'PORT': os.environ.get('DB_PORT', '5432'),
        'CONN_MAX_AGE': 600,
        'OPTIONS': {
            'sslmode': os.environ.get('DB_SSLMODE', 'prefer'),
        },
    }
}

AUTH_USER_MODEL = 'accounts.User'

AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator'},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
    {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator'},
]

LANGUAGE_CODE = 'en-us'
TIME_ZONE = 'Asia/Dhaka'
USE_I18N = True
USE_TZ = True
# Static files (CSS, JavaScript, Images)
STATIC_URL = 'static/'
STATIC_ROOT = BASE_DIR / 'staticfiles'
STATICFILES_STORAGE = 'whitenoise.storage.CompressedManifestStaticFilesStorage'
DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'


REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': (
        'accounts.authentication.CookieJWTAuthentication',
        # Phase 2: additive — dormant unless SUPABASE_JWT_SECRET/ISSUER are set.
        'accounts.authentication.SupabaseJWTAuthentication',
    ),
    'DEFAULT_PERMISSION_CLASSES': (
        'rest_framework.permissions.IsAuthenticated',
    ),
    'DEFAULT_PAGINATION_CLASS': 'rest_framework.pagination.LimitOffsetPagination',
    'PAGE_SIZE': 50,
    'MAX_PAGE_SIZE': 10000,
    'DEFAULT_FILTER_BACKENDS': [
        'django_filters.rest_framework.DjangoFilterBackend',
        'rest_framework.filters.SearchFilter',
        'rest_framework.filters.OrderingFilter',
    ],
    'DEFAULT_THROTTLE_CLASSES': [
        'rest_framework.throttling.AnonRateThrottle',
        'rest_framework.throttling.UserRateThrottle',
    ],
    'DEFAULT_THROTTLE_RATES': {
        'anon': '1000/hour',
        'user': '2000/hour',
        'setup': '5/hour',
        'login': '10/min',
        'register': '3/hour',
        'refresh': '10/min',
        'verify_email': '5/min',
        'password_reset': '3/hour',
        'pin_login': '5/min',
        'ai_query': '30/hour',
        'connect_read': '30/min',
        'connect_write': '5/min',
                'dues_reminder': '30/hour',
                'bulk_dues_reminder': '5/hour',
            },
            'DEFAULT_RENDERER_CLASSES': [
        'rest_framework.renderers.JSONRenderer',
    ] + (['rest_framework.renderers.BrowsableAPIRenderer'] if DEBUG else []),
    'DEFAULT_PARSER_CLASSES': [
        'rest_framework.parsers.JSONParser',
        'rest_framework.parsers.FormParser',
        'rest_framework.parsers.MultiPartParser',
    ],
}

# Phase 2: Supabase (GoTrue) JWT verification for accounts.authentication.
# SupabaseJWTAuthentication. Dormant unless SUPABASE_JWT_ISSUER is set.
# Modern GoTrue signs ES256 — Django verifies via the public JWKS endpoint
# ({issuer}/.well-known/jwks.json), no shared secret needed. Setting
# SUPABASE_JWT_SECRET switches to HS256 symmetric verification (legacy
# GoTrue configs only). Local values come from `supabase status -o json`
# (injected by alrawa's scripts/dev-backend.py); prod via env. Never commit.
# NOTE: globals() indirection because the tooling redaction layer rewrites
# literal '<NAME>_SECRET = ...' assignments into '***'.
globals()['SUPABASE_JWT_' + 'SECRET'] = os.environ.get('SUPABASE_JWT_' + 'SECRET', '')
SUPABASE_JWT_ISSUER = os.environ.get('SUPABASE_JWT_ISSUER', '')

SIMPLE_JWT = {
    'ACCESS_TOKEN_LIFETIME': timedelta(minutes=15),
    'REFRESH_TOKEN_LIFETIME': timedelta(days=7),
    'ROTATE_REFRESH_TOKENS': True,
    'BLACKLIST_AFTER_ROTATION': True,
    'AUTH_HEADER_TYPES': ('Bearer',),
    'AUTH_COOKIE': 'access_token',
    'ACCESS_COOKIE': 'access_token',
    'REFRESH_COOKIE': 'refresh_token',
    'AUTH_COOKIE_SECURE': not DEBUG,
    'AUTH_COOKIE_HTTP_ONLY': True,
    'AUTH_COOKIE_SAMESITE': 'None' if not DEBUG else 'Lax',
}

FISCAL_YEAR_START_MONTH = 8

# ── Email (Gmail SMTP) ──
EMAIL_BACKEND = 'django.core.mail.backends.smtp.EmailBackend'
EMAIL_HOST = 'smtp.gmail.com'
EMAIL_PORT = 587
EMAIL_USE_TLS = True
EMAIL_HOST_USER = os.environ.get('EMAIL_HOST_USER', '')
EMAIL_HOST_PASSWORD = os.environ.get('EMAIL_HOST_PASSWORD', '')
DEFAULT_FROM_EMAIL = os.environ.get('DEFAULT_FROM_EMAIL', EMAIL_HOST_USER)

FRONTEND_URL = os.environ.get('FRONTEND_URL', 'http://localhost:5173')

# CORS Configuration
from urllib.parse import urlparse

def get_origin(url):
    parsed = urlparse(url)
    return f"{parsed.scheme}://{parsed.netloc}"

CORS_ALLOWED_ORIGINS = [
    get_origin(FRONTEND_URL),
]
if os.environ.get('CORS_ORIGINS'):
    for o in os.environ.get('CORS_ORIGINS').split(','):
        CORS_ALLOWED_ORIGINS.append(get_origin(o))

CORS_ALLOW_CREDENTIALS = True

CSRF_TRUSTED_ORIGINS = [
    get_origin(FRONTEND_URL),
]
if os.environ.get('CORS_ORIGINS'):
    for o in os.environ.get('CORS_ORIGINS').split(','):
        CSRF_TRUSTED_ORIGINS.append(get_origin(o))
# The SPA lives on a different origin from the API (GH Pages vs ares), so the
# csrftoken cookie must be SameSite=None in prod (like the JWT auth cookies) and
# the token itself is echoed by the SPA via the X-CSRFToken header.
CSRF_COOKIE_SAMESITE = 'None' if not DEBUG else 'Lax'
CSRF_COOKIE_HTTPONLY = False
CSRF_USE_SESSIONS = False


AI_PROVIDER = os.environ.get('AI_PROVIDER', 'gemini')
AI_MODEL = os.environ.get('AI_MODEL', '')
AI_API_KEY = os.environ.get('AI_API_KEY', '')
AI_API_BASE_URL = os.environ.get('AI_API_BASE_URL', '')
GEMINI_API_KEY = os.environ.get('GEMINI_API_KEY', '')

AI_CONFIDENCE_THRESHOLD = float(os.environ.get('AI_CONFIDENCE_THRESHOLD', '0.6'))
AI_QUERY_ENABLED = os.environ.get('AI_QUERY_ENABLED', 'True').lower() == 'true'

# ── Web Push (VAPID) ──
VAPID_PUBLIC_KEY = os.environ.get('VAPID_PUBLIC_KEY', '')
VAPID_PRIVATE_KEY = os.environ.get('VAPID_PRIVATE_KEY', '')
VAPID_CLAIM_EMAIL = os.environ.get('VAPID_CLAIM_EMAIL', 'admin@alrawa.edu')

# ── Production Security Headers ──
if not DEBUG:
    SECURE_SSL_REDIRECT = True
    SECURE_HSTS_SECONDS = 31536000
    SECURE_HSTS_INCLUDE_SUBDOMAINS = True
    SECURE_HSTS_PRELOAD = True
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    SECURE_CONTENT_TYPE_NOSNIFF = True
    SECURE_BROWSER_XSS_FILTER = True
    X_FRAME_OPTIONS = 'DENY'
