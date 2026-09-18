// School logo served as a static asset (public/logo.jpg) so the ~38KB JPEG
// stays out of every JS chunk. <img> tags use SCHOOL_LOGO directly.
// jsPDF's addImage() requires image *data*, so PDF builders must resolve the
// data URI at click-time via getLogoDataUri() (fetched + cached in memory).
export const SCHOOL_LOGO = `${import.meta.env.BASE_URL}logo.jpg`;

let _logoPromise: Promise<string> | null = null;

/** Fetch logo.jpg once and return it as a data URI (for jsPDF addImage). */
export function getLogoDataUri(): Promise<string> {
  if (!_logoPromise) {
    _logoPromise = (async () => {
      const res = await fetch(SCHOOL_LOGO, { credentials: 'omit' });
      if (!res.ok) throw new Error(`logo fetch failed: ${res.status}`);
      const blob = await res.blob();
      const uri = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error('logo read failed'));
        reader.readAsDataURL(blob);
      });
      return uri;
    })();
    // Don't cache failures — a later click (back online) can retry.
    _logoPromise.catch(() => { _logoPromise = null; });
  }
  return _logoPromise;
}

/** jsPDF image format string for a data URI (defaults to JPEG for logo.jpg). */
export function logoImageFormat(dataUri: string): string {
  return dataUri.match(/data:image\/([a-zA-Z0-9]+);/)?.[1]?.toUpperCase() || 'JPEG';
}
