import { useCallback, useRef } from 'react';
import type { ReactElement } from 'react';
import { fileToSquareDataUrl, isMobileDevice } from '../lib/imageCrop';

interface UseNativeCameraResult {
  /** Call from your camera button. On mobile opens the native camera app;
   *  returns false so the caller can fall back to the in-app webcam modal. */
  openNativeCamera: () => boolean;
  /** Hidden <input> to render once in the JSX. */
  nativeInput: ReactElement;
}

/**
 * On mobile devices, captures via the OS camera app (rear lens, full quality)
 * using an <input type="file" capture="environment">. The returned image is
 * center-square-cropped (max 400px) exactly like the in-app CameraModal path.
 */
export function useNativeCamera(onCapture: (dataUrl: string) => void): UseNativeCameraResult {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const cbRef = useRef(onCapture);
  cbRef.current = onCapture;

  const handleChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-taking the same shot
    if (!file) return;
    try {
      const dataUrl = await fileToSquareDataUrl(file);
      cbRef.current(dataUrl);
    } catch {
      cbRef.current(''); // signal failure without crashing the form
    }
  }, []);

  const openNativeCamera = useCallback((): boolean => {
    if (!isMobileDevice()) return false; // desktop -> use CameraModal
    inputRef.current?.click();
    return true;
  }, []);

  const nativeInput = (
    <input
      ref={inputRef}
      type="file"
      accept="image/*"
      capture="environment"
      className="hidden"
      onChange={handleChange}
      aria-hidden="true"
    />
  );

  return { openNativeCamera, nativeInput };
}
