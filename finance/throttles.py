from rest_framework.throttling import UserRateThrottle


class DuesReminderRateThrottle(UserRateThrottle):
    """Limit accountant/admin dues-reminder sends to 30/hr per user.

    Prevents accidental mass-spam (a careless bulk "send to all").
    """
    scope = 'dues_reminder'
