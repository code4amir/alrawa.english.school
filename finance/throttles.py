from rest_framework.throttling import UserRateThrottle


class DuesReminderRateThrottle(UserRateThrottle):
    """Limit accountant/admin dues-reminder sends to 30/hr per user.

    Prevents accidental mass-spam (a careless bulk "send to all").
    """
    scope = 'dues_reminder'


class BulkDuesReminderRateThrottle(UserRateThrottle):
    """Tight limit for the bulk "send to all defaulters" action (5/hr).

    Bulk sends touch many parents at once, so the allowance is deliberately
    small — an intentional bulk run is rare, but a runaway loop is costly.
    """
    scope = 'bulk_dues_reminder'
