"""Request-scoped memoization for hot per-request lookups.

Weekend set and active academic year are read multiple times while serving
a single request (attendance grids, fee windows). Cache them ON the request
object so each request pays at most one query — never a global/TTL cache,
which would go stale when settings or the active year change.
"""

WEEKEND_DAYS_DEFAULT = '4,5'


def get_weekend_set(request=None):
    """Set of weekday ints (Mon=0..Sun=6) treated as weekend.

    When ``request`` is given the result is memoized on the request object
    (request-scoped, no cross-request state).
    """
    if request is not None:
        cached = getattr(request, '_cached_weekend_set', None)
        if cached is not None:
            return cached
    from core.models import SchoolSetting
    try:
        raw = SchoolSetting.objects.get(key='weekend_days').value
        result = {int(x.strip()) for x in raw.split(',') if x.strip().isdigit()}
    except SchoolSetting.DoesNotExist:
        result = {int(x) for x in WEEKEND_DAYS_DEFAULT.split(',')}
    if request is not None:
        request._cached_weekend_set = result
    return result


def get_active_year(request=None):
    """Active AcademicYear (or None). Memoized on ``request`` when given."""
    if request is not None:
        if hasattr(request, '_cached_active_year'):
            return request._cached_active_year
    from core.models import AcademicYear
    result = AcademicYear.objects.filter(is_active=True).first()
    if request is not None:
        request._cached_active_year = result
    return result
