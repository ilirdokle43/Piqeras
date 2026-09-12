import { useEffect, useState } from 'react';

/**
 * The full-bleed backdrop.
 *
 * When the organizer has uploaded a photo it is preloaded off-screen and only
 * swapped in once decoded, so the screen never flashes a half-painted image
 * over the text. Until then — and if the image fails, or the device is offline
 * on a cold start — the painted sunset below stands in. It is built from
 * gradients rather than a bundled JPEG so it costs nothing and never fails to
 * load, and it carries the same palette as the photograph.
 */

export const PAINTED_SUNSET = [
  // Sun glow just above the horizon
  'radial-gradient(70% 42% at 50% 58%, rgba(255,190,120,0.55) 0%, rgba(255,140,66,0.30) 28%, rgba(255,107,53,0.10) 52%, rgba(0,0,0,0) 72%)',
  // Warm band along the horizon
  'linear-gradient(180deg, rgba(0,0,0,0) 44%, rgba(232,80,47,0.42) 56%, rgba(0,0,0,0) 66%)',
  // Sea, darkening towards the shore
  'linear-gradient(180deg, rgba(0,0,0,0) 58%, rgba(35,65,79,0.55) 66%, rgba(20,26,32,0.9) 82%, rgba(11,13,16,1) 100%)',
  // Sky, dusk blue at the top through to ember at the horizon
  'linear-gradient(180deg, #1b2430 0%, #35323c 26%, #7a4436 44%, #c9542c 53%, #ff8c42 58%, #2e5266 66%, #0b0d10 100%)',
].join(', ');

export function Background({ imageUrl }: { imageUrl: string | null }) {
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!imageUrl) {
      setLoadedUrl(null);
      return;
    }
    let cancelled = false;
    let img: HTMLImageElement | null = null;

    /*
     * Preloaded with CORS first, because the browser caches a response
     * separately per CORS mode: a plain preload would leave the screenshot
     * feature re-fetching, or worse, drawing from a cache entry it is not
     * allowed to read and tainting the canvas.
     *
     * If that fails — the bucket's CORS rules changed, a proxy stripped the
     * header — it falls back to a plain load. A backdrop that shows up is worth
     * more than one that can be photographed, so the screenshot degrades rather
     * than the app.
     */
    const load = (withCors: boolean) => {
      const next = new Image();
      next.decoding = 'async';
      if (withCors) next.crossOrigin = 'anonymous';
      next.onload = () => {
        if (!cancelled) setLoadedUrl(imageUrl);
      };
      next.onerror = () => {
        if (cancelled) return;
        if (withCors) {
          load(false);
          return;
        }
        // Keep the painted sunset rather than showing a broken backdrop.
        setLoadedUrl(null);
      };
      next.src = imageUrl;
      img = next;
    };

    load(true);

    return () => {
      cancelled = true;
      if (img) {
        img.onload = null;
        img.onerror = null;
      }
    };
  }, [imageUrl]);

  return (
    <>
      <div
        className="backdrop"
        style={{
          backgroundImage: loadedUrl ? `url(${JSON.stringify(loadedUrl)})` : PAINTED_SUNSET,
        }}
        role="presentation"
      />
      <div className="scrim" role="presentation" />
    </>
  );
}
