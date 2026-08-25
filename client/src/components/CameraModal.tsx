import React, { useRef, useEffect, useState, useCallback } from 'react';
import { X, RotateCw, Camera } from 'lucide-react';
import { toast } from './Toast';

interface Props {
  open: boolean;
  onClose: () => void;
  onCapture: (dataUrl: string) => void;
}

const CameraModal: React.FC<Props> = ({ open, onClose, onCapture }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');

  const startCamera = useCallback(async (mode: 'user' | 'environment') => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: mode, width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
    } catch (err: any) {
      toast('Camera access denied: ' + (err?.message || 'Unknown error'), 'error');
      onClose();
    }
  }, [onClose]);

  useEffect(() => {
    if (open) startCamera(facingMode);
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
  }, [open, facingMode, startCamera]);

  const flipCamera = () => {
    setFacingMode((prev) => (prev === 'user' ? 'environment' : 'user'));
  };

  // Photos are displayed in a CIRCLE everywhere in the app, so capture a SQUARE:
  // center-crop the 16:9 video frame to square (what you frame inside the guide
  // overlay is exactly what gets saved — no surprise side-chopping by CSS).
  const capture = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) { toast('Camera not ready — try again', 'error'); return; }

    const MAX = 400;
    const side = Math.min(vw, vh);                    // square crop of the source
    const scale = Math.min(1, MAX / side);
    const out = Math.max(1, Math.round(side * scale)); // output size (<=400)
    const sx = Math.round((vw - side) / 2);            // center-crop offsets
    const sy = Math.round((vh - side) / 2);

    canvas.width = out;
    canvas.height = out;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, sx, sy, side, side, 0, 0, out, out);
    onCapture(canvas.toDataURL('image/jpeg', 0.6));
    onClose();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
      <div className="bg-school-primary rounded-2xl overflow-hidden max-w-md w-full">
        <div className="flex items-center justify-between p-3 text-white">
          <h3 className="font-medium text-sm flex items-center gap-1.5"><Camera size={16} /> Take Photo</h3>
          <button onClick={onClose} className="p-1 hover:bg-white/10 rounded-full" aria-label="Close camera"><X size={20} /></button>
        </div>
        <div className="relative aspect-square overflow-hidden bg-black">
          {/* object-cover + square container mirrors the exact crop the capture takes */}
          <video ref={videoRef} autoPlay playsInline muted className="absolute inset-0 w-full h-full object-cover" />
          {/* circular framing guide matching the app's round avatars */}
          <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
            <div className="w-[72%] aspect-square rounded-full border-2 border-dashed border-white/70 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
          </div>
        </div>
        <canvas ref={canvasRef} className="hidden" />
        <div className="flex gap-2 p-3">
          <button onClick={capture} className="flex-1 py-2 bg-school-accent text-white rounded-xl font-bold text-sm hover:opacity-90 flex items-center justify-center gap-1.5">
            <Camera size={14} /> Capture
          </button>
          <button onClick={onClose} className="px-4 py-2 border border-white/30 text-white rounded-xl text-sm hover:bg-white/10">
            Cancel
          </button>
        </div>
        <div className="px-3 pb-3 -mt-1 flex justify-center">
          <button onClick={flipCamera} className="p-2 rounded-full text-white/80 hover:text-white hover:bg-white/10 transition-colors" title="Flip camera" aria-label="Flip camera">
            <RotateCw size={18} />
          </button>
        </div>
      </div>
    </div>
  );
};

export default CameraModal;
