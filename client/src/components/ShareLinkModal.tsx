import { useEffect, useState } from 'react';
import { Check, Copy, Link2, RefreshCcw, ShieldCheck, ShieldX } from 'lucide-react';
import Modal from './Modal';
import { api } from '../stores/api';

interface Props {
  open: boolean;
  onClose: () => void;
  student: { id: string; name: string } | null;
}

type LinkState =
  | { status: 'loading' }
  | { status: 'active'; token: string; expiresAt: string }
  | { status: 'claimed'; claimedBy: string; claimedAt?: string | null }
  | { status: 'revoked' }
  | { status: 'none' }
  | { status: 'error'; message: string };

const ShareLinkModal = ({ open, onClose, student }: Props) => {
  const [state, setState] = useState<LinkState>({ status: 'loading' });
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const sid = student?.id;

  const fetchLink = async () => {
    setState({ status: 'loading' });
    try {
      const res = await api.get(`/students/${sid}/connect-link/`);
      const d = res.data;
      if (d.status === 'active') {
        setState({ status: 'active', token: d.token, expiresAt: d.expiresAt });
      } else if (d.status === 'claimed') {
        setState({ status: 'claimed', claimedBy: d.claimedBy, claimedAt: d.claimedAt });
      } else if (d.status === 'revoked') {
        setState({ status: 'revoked' });
      } else {
        setState({ status: 'none' });
      }
    } catch (e: any) {
      setState({ status: 'error', message: e.response?.data?.error || 'Failed to load the connection link.' });
    }
  };

  useEffect(() => {
    if (open && student?.id) {
      setCopied(false);
      fetchLink();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, student?.id]);

  const postAction = async (action: string) => {
    setBusy(true);
    try {
      await api.post(`/students/${sid}/connect-link/`, { action });
      await fetchLink();
    } catch (e: any) {
      setState({ status: 'error', message: e.response?.data?.error || 'Action failed.' });
    } finally {
      setBusy(false);
    }
  };

  const linkUrl =
    state.status === 'active'
      ? `${window.location.origin}${window.location.pathname}#/connect/${state.token}`
      : '';

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(linkUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable — user can select the text */
    }
  };

  const fmtDate = (iso?: string | null) =>
    iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '';

  // All hooks are above; with `open` false or no student selected render nothing.
  if (!open || !student) return null;

  const genButton = (
    <button
      type="button"
      disabled={busy}
      onClick={() => postAction('regenerate')}
      className="w-full py-2.5 rounded-xl border border-school-border text-sm font-bold text-school-primary dark:text-[#e0e0e8] hover:bg-school-paper transition-all disabled:opacity-50 flex items-center justify-center gap-2"
    >
      <RefreshCcw size={15} /> Generate new link
    </button>
  );

  return (
    <Modal open={open} onClose={onClose} title={`Share parent link — ${student.name}`}>
      {state.status === 'loading' && (
        <div className="flex items-center justify-center py-10">
          <div className="w-7 h-7 border-2 border-school-primary/30 border-t-school-primary rounded-full animate-spin" />
        </div>
      )}

      {state.status === 'error' && (
        <div className="text-center space-y-4 py-4">
          <div className="bg-rose-50 border border-rose-200 text-rose-600 p-3 rounded-xl text-sm">{state.message}</div>
          <button
            type="button"
            onClick={fetchLink}
            className="w-full py-2.5 rounded-xl bg-school-accent text-white text-sm font-bold hover:bg-school-accent/90 transition-all"
          >
            Try again
          </button>
        </div>
      )}

      {state.status === 'active' && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-xs font-bold text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2">
            <ShieldCheck size={15} className="flex-shrink-0" />
            Link active — expires {fmtDate(state.expiresAt)}
          </div>
          <div className="flex gap-2">
            <div className="flex-1 min-w-0 bg-school-paper border border-school-border rounded-xl px-3 py-2.5 text-xs text-school-muted break-all select-all">
              {linkUrl}
            </div>
            <button
              type="button"
              onClick={copyLink}
              className="px-4 rounded-xl bg-school-primary text-white text-xs font-bold hover:bg-school-primary/90 transition-all flex items-center gap-1.5 shrink-0"
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <p className="text-[11px] text-school-muted flex items-start gap-1.5">
            <Link2 size={13} className="mt-0.5 flex-shrink-0" />
            WhatsApp this link to the parent. It is valid for 90 days and works once — the first guardian who
            verifies the student ID card connects {student.name}. Second/third children connect to the same
            account automatically.
          </p>
          <div className="flex gap-2 pt-1">
            {genButton}
            <button
              type="button"
              disabled={busy}
              onClick={() => postAction('revoke')}
              className="px-4 py-2.5 rounded-xl border border-rose-200 text-rose-600 text-sm font-bold hover:bg-rose-50 transition-all disabled:opacity-50 flex items-center justify-center gap-1.5"
            >
              <ShieldX size={15} /> Revoke
            </button>
          </div>
        </div>
      )}

      {state.status === 'claimed' && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-xs font-bold text-blue-600 bg-blue-50 border border-blue-200 rounded-xl px-3 py-2">
            <ShieldCheck size={15} className="flex-shrink-0" />
            Connected to {state.claimedBy || 'a guardian account'}
            {state.claimedAt ? ` on ${fmtDate(state.claimedAt)}` : ''}
          </div>
          <p className="text-xs text-school-muted">
            This student is already linked to a guardian. Generate a new link if you need to send it again —
            the previous link stops working immediately.
          </p>
          {genButton}
        </div>
      )}

      {(state.status === 'revoked' || state.status === 'none') && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-xs font-bold text-amber-600 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
            <ShieldX size={15} className="flex-shrink-0" />
            {state.status === 'revoked' ? 'Link revoked' : 'No link yet'}
          </div>
          <p className="text-xs text-school-muted">
            The current link is {state.status === 'revoked' ? 'no longer valid. Generate a fresh one' : 'not issued yet. Generate one'} to
            WhatsApp to the parent.
          </p>
          {genButton}
        </div>
      )}
    </Modal>
  );
};

export default ShareLinkModal;