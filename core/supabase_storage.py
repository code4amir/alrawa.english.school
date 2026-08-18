import os
import json
import logging
import urllib.request
from django.core.cache import cache

logger = logging.getLogger(__name__)

SUPABASE_URL = os.environ.get('SUPABASE_URL', '')
SERVICE_KEY = os.environ.get('SUPABASE_SERVICE_KEY', '')
BUCKET = os.environ.get('SUPABASE_BUCKET', 'student-photos')
CACHE_TTL = 1800

if not SUPABASE_URL or not SERVICE_KEY:
    import logging
    logging.getLogger(__name__).warning('SUPABASE_URL or SUPABASE_SERVICE_KEY not set — photo uploads will fail')


def _get_headers():
    return {
        "apikey": SERVICE_KEY,
        "Authorization": f"Bearer {SERVICE_KEY}",
        "Content-Type": "application/json",
    }


def _req(method, url, data=None, content_type=None, raw=False, extra_headers=None):
    h = {k: v for k, v in _get_headers().items() if k != 'Content-Type'}
    if content_type:
        h["Content-Type"] = content_type
    if extra_headers:
        h.update(extra_headers)
    if data is not None and isinstance(data, bytes) and raw:
        pass
    elif data is not None:
        data = json.dumps(data).encode()
    r = urllib.request.Request(url, data=data, headers=h, method=method)
    try:
        resp = urllib.request.urlopen(r, timeout=15)
        body = resp.read()
        try:
            return json.loads(body)
        except (json.JSONDecodeError, ValueError):
            return body
    except urllib.error.HTTPError as e:
        logger.error("Supabase HTTP %s %s → %s %s", method, url, e.code, e.read().decode(errors='replace')[:200])
        return None


def get_signed_url(path, expires_in=3600):
    cache_key = f"supabase_signed_url_{path}"
    cached = cache.get(cache_key)
    if cached:
        return cached
    payload = {"expiresIn": expires_in}
    result = _req("POST", f"{SUPABASE_URL}/storage/v1/object/sign/{BUCKET}/{path}", payload, content_type="application/json")
    if result and "signedURL" in result:
        full = f"{SUPABASE_URL}/storage/v1{result['signedURL']}"
        cache.set(cache_key, full, CACHE_TTL)
        return full
    return None


def _bust_signed_url(path):
    """Invalidate any cached signed URL so a freshly re-uploaded photo is served."""
    cache.delete(f"supabase_signed_url_{path}")


def delete_photo(path):
    if not path:
        return
    url = f"{SUPABASE_URL}/storage/v1/object/{BUCKET}/{path}"
    _req("DELETE", url, data=b'', raw=True, content_type=None)


def upload_photo(path, photo_bytes):
    # Use PUT (not POST) so re-uploading to the same path OVERWRITES the existing
    # object instead of failing with a "already exists" error. x-upsert guards
    # against create-vs-update ambiguity; cache-control: no-cache prevents the
    # CDN from serving a stale image after an update.
    url = f"{SUPABASE_URL}/storage/v1/object/{BUCKET}/{path}"
    ok = _req(
        "PUT",
        url,
        data=photo_bytes,
        content_type="image/jpeg",
        raw=True,
        extra_headers={"cache-control": "no-cache", "x-upsert": "true"},
    ) is not None
    if ok:
        _bust_signed_url(path)
    return ok
