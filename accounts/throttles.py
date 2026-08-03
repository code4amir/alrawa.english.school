from rest_framework.throttling import AnonRateThrottle


class LoginRateThrottle(AnonRateThrottle):
    scope = 'login'


class RegisterRateThrottle(AnonRateThrottle):
    scope = 'register'


class RefreshRateThrottle(AnonRateThrottle):
    scope = 'refresh'


class VerifyEmailRateThrottle(AnonRateThrottle):
    scope = 'verify_email'


class PasswordResetRateThrottle(AnonRateThrottle):
    scope = 'password_reset'


class PinLoginRateThrottle(AnonRateThrottle):
    scope = 'pin_login'


class ConnectReadRateThrottle(AnonRateThrottle):
    scope = 'connect_read'


class ConnectWriteRateThrottle(AnonRateThrottle):
    scope = 'connect_write'
