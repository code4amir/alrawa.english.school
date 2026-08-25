import React, { useRef } from 'react';
import { Camera, Image } from 'lucide-react';

interface Props {
  photo: string | null;
  onPhotoChange: (dataUrl: string | null) => void;
  onOpenCamera: () => void;
  size?: 'sm' | 'md' | 'lg';
}

const PhotoUpload: React.FC<Props> = ({ photo, onPhotoChange, onOpenCamera, size = 'md' }) => {
  const inputRef = useRef<HTMLInputElement>(null);

  const sizeClasses = {
    sm: 'w-14 h-14',
    md: 'w-20 h-20',
    lg: 'w-28 h-28',
  };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const img = new window.Image();
    const reader = new FileReader();
    reader.onload = (ev: ProgressEvent<FileReader>) => {
      img.onload = () => {
        // Photos display in a CIRCLE app-wide — center-crop to a SQUARE here so
        // gallery shots match camera captures and CSS never surprise-crops.
        const MAX = 400;
        const side = Math.min(img.width, img.height);
        const scale = Math.min(1, MAX / side);
        const out = Math.max(1, Math.round(side * scale));
        const sx = Math.round((img.width - side) / 2);
        const sy = Math.round((img.height - side) / 2);
        const canvas = document.createElement('canvas');
        canvas.width = out;
        canvas.height = out;
        canvas.getContext('2d')?.drawImage(img, sx, sy, side, side, 0, 0, out, out);
        onPhotoChange(canvas.toDataURL('image/jpeg', 0.6));
      };
      img.src = ev.target?.result as string;
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  return (
    <div className="flex flex-col items-center gap-2">
      {photo ? (
        <div className={`${sizeClasses[size]} rounded-full overflow-hidden border-2 border-school-border`}>
          <img src={photo} alt="" className="w-full h-full object-cover" />
        </div>
      ) : (
        <div className={`${sizeClasses[size]} rounded-full border-2 border-dashed border-school-border flex items-center justify-center bg-school-paper`}>
          <Camera size={24} className="text-school-muted" />
        </div>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onOpenCamera}
          className="flex items-center gap-1 px-3 py-1.5 bg-school-primary text-white rounded-lg text-xs font-medium hover:opacity-90"
        >
          <Camera size={14} /> Camera
        </button>
        <label className="flex items-center gap-1 px-3 py-1.5 bg-school-secondary text-white rounded-lg text-xs font-medium cursor-pointer hover:opacity-90">
          <Image size={14} /> Gallery
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            onChange={handleFile}
            className="hidden"
          />
        </label>
        {photo && (
          <button
            type="button"
            onClick={() => onPhotoChange(null)}
            className="px-3 py-1.5 border border-red-300 text-red-500 rounded-lg text-xs font-medium hover:bg-red-50"
          >
            Remove
          </button>
        )}
      </div>
    </div>
  );
};

export default PhotoUpload;
