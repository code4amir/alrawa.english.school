"""Private HTTP caching for reference-data endpoints.

Ref-data (classes, academic years, settings summary, expense categories,
fee schedules) changes rarely and is identical for every user holding the
same read permission, so clients may cache it briefly. The headers are
always ``private`` — never ``public``/shared — so shared proxies must not
serve one user's rows to another. Per-user scoped endpoints (students,
transactions, …) must NOT use this mixin.
"""
import hashlib
import json

from django.utils.cache import patch_cache_control

REF_DATA_MAX_AGE = 60


def _etag_for(data):
    raw = json.dumps(data, sort_keys=True, default=str).encode('utf-8')
    return '"%s"' % hashlib.md5(raw).hexdigest()


def apply_private_ref_cache(response, max_age=REF_DATA_MAX_AGE):
    """Stamp Cache-Control: private, max-age=<n> + a content ETag."""
    patch_cache_control(response, private=True, max_age=max_age)
    try:
        response['ETag'] = _etag_for(response.data)
    except Exception:
        pass
    return response


class PrivateRefDataCacheMixin:
    """Add private max-age=60 (+ ETag) to a viewset's list() responses."""

    ref_data_max_age = REF_DATA_MAX_AGE

    def list(self, request, *args, **kwargs):
        response = super().list(request, *args, **kwargs)
        return apply_private_ref_cache(response, self.ref_data_max_age)
