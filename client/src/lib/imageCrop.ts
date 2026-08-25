// Shared image helpers: photos display in circles app-wide, so every capture
// path normalizes to a centered square (max 400px) before saving.

export async function fileToSquareDataUrl(file: File, max = 400): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (ev) => resolve(ev.target?.result as string);
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new window.Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error('Could not decode image'));
    i.src = dataUrl;
  });
  const side = Math.min(img.width, img.height);
  const scale = Math.min(1, max / side);
  const out = Math.max(1, Math.round(side * scale));
  const sx = Math.round((img.width - side) / 2);
  const sy = Math.round((img.height - side) / 2);
  const canvas = document.createElement('canvas');
  canvas.width = out;
  canvas.height = out;
  canvas.getContext('2d')?.drawImage(img, sx, sy, side, side, 0, 0, out, out);
  return canvas.toDataURL('image/jpeg', 0.6);
}

/** True on phones/tablets where opening the native camera app beats getUserMedia
 *  (full sensor quality, flash, HDR) and avoids permission prompts. */
export function isMobileDevice(): boolean {
  const ua = navigator.userAgent || '';
  const uaMobile = /Android|iPhone|iPad|iPod|Mobile|Silk/i.test(ua);
  // iPadOS 13+ masquerades as desktop Safari: touch-capable Mac == iPad
  const ipadOs = /Macintosh/i.test(ua) && navigator.maxTouchPoints > 1;
  return uaMobile || ipadOs;
}
