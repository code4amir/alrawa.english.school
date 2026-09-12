"""Shared helpers for monitor agents (Phase 1).

Agents communicate through AgentFinding rows — never direct calls. report()
is idempotent per (agent, entity): re-reporting an open problem updates it
in place instead of spamming the board.
"""
import logging

from .models import AgentFinding

logger = logging.getLogger(__name__)


def report(agent, severity, entity_type, entity_id, summary, details=None):
    """File or refresh one open finding. Returns the row."""
    details = details or {}
    try:
        finding, created = AgentFinding.objects.update_or_create(
            agent=agent, entity_type=entity_type or '',
            entity_id=str(entity_id) if entity_id else None,
            status='open',
            defaults={'severity': severity, 'summary': summary, 'details': details},
        )
        return finding
    except Exception:
        logger.exception('Agent %s failed to file finding for %s', agent, entity_id)
        return None


def resolve_stale(agent, current_keys):
    """Auto-resolve open findings whose problem is gone.

    current_keys: iterable of (entity_type, entity_id-or-None) still broken.
    Returns the number resolved. This is how the board heals itself when a
    teacher finishes entry or an admin fixes data — no human triage needed
    for the good-news path.
    """
    keep = {(str(t or ''), str(i) if i else None) for t, i in current_keys}
    resolved = 0
    for finding in AgentFinding.objects.filter(agent=agent, status='open'):
        if (finding.entity_type, finding.entity_id) not in keep:
            finding.status = 'resolved'
            finding.resolution = 'Problem no longer detected on latest run.'
            finding.save(update_fields=['status', 'resolution', 'updated_at'])
            resolved += 1
    return resolved
