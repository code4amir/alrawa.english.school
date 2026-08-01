/* eslint-disable react-refresh/only-export-components */
import React, { useEffect, useState, useCallback } from 'react';
import { X } from 'lucide-react';

interface ToastState {
  message: string;
  type: 'success' | 'error' | 'info' | '';
  visible: boolean;
  action?: { label: string; onClick: () => void };
}

let toastFn: ((msg: string, type?: 'success' | 'error' | 'info' | '', action?: { label: string; onClick: () => void }) => void) | null = null;

export const toast = (msg: string, type: 'success' | 'error' | 'info' | '' = '', action?: { label: string; onClick: () => void }) => {
  toastFn?.(msg, type, action);
};

export function getErrorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  if (e && typeof e === 'object') {
    const obj = e as any;
    if (obj.response?.data) {
      const d = obj.response.data;
      if (typeof d === 'string') return d;
      if (d.detail) return d.detail;
      if (d.message) return d.message;
      if (d.error) return d.error;
      // DRF field errors: { field: ["message", ...] } or { field: "message" }
      if (typeof d === 'object' && !Array.isArray(d)) {
        const first = Object.values(d)[0];
        if (Array.isArray(first) && first.length > 0) return String(first[0]);
        if (typeof first === 'string') return first;
      }
    }
  }
  return 'An unexpected error occurred';
}

const Toast: React.FC = () => {
  const [state, setState] = useState<ToastState>({ message: '', type: '', visible: false });

  const hide = useCallback(() => setState((s) => ({ ...s, visible: false })), []);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    toastFn = (message, type = '', action) => {
      setState({ message, type, visible: true, action });
      clearTimeout(timer);
      const duration = type === 'error' ? 6000 : (action ? 7000 : 3000);
      timer = setTimeout(hide, duration);
    };
    return () => { clearTimeout(timer); toastFn = null; };
  }, [hide]);

  if (!state.visible) return null;

  return (
    <div
      className={`fixed bottom-20 sm:bottom-8 left-1/2 -translate-x-1/2 z-[100] px-4 py-3 rounded-xl shadow-lg text-sm font-medium transition-all duration-300 flex items-center gap-2 max-w-sm ${
        state.visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
      } ${
        state.type === 'success' ? 'bg-green-600 text-white' :
        state.type === 'error' ? 'bg-red-500 text-white' :
        state.type === 'info' ? 'bg-blue-600 text-white' :
        'bg-school-primary text-white'
      }`}
    >
      <span className="flex-1">{state.message}</span>
      {state.action && (
        <button
          onClick={() => { state.action?.onClick(); hide(); }}
          className="px-2 py-1 rounded-lg bg-white/20 hover:bg-white/30 text-xs font-bold uppercase tracking-wider transition-colors flex-shrink-0"
        >
          {state.action.label}
        </button>
      )}
      <button onClick={hide} className="p-0.5 rounded-full hover:bg-white/20 transition-colors flex-shrink-0" aria-label="Dismiss notification">
        <X size={14} />
      </button>
    </div>
  );
};

export default Toast;
