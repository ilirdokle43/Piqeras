import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';

/**
 * The capture itself is a browser drawing operation and is verified in a real
 * browser, not here. What this file guards is everything around it: the share
 * sheet, the fallbacks when there is no share sheet, and the promise that the
 * page is always put back the way it was found.
 */

const canvas = {
  toBlob: vi.fn((cb: (b: Blob | null) => void) => cb(new Blob(['png'], { type: 'image/png' }))),
};
type CaptureOptions = {
  scale: number;
  useCORS: boolean;
  ignoreElements: (el: Element) => boolean;
};
const html2canvas = vi.fn(async (_el: HTMLElement, _options: CaptureOptions) => canvas);
vi.mock('html2canvas', () => ({ default: html2canvas }));

const {
  captureScale,
  captureScreen,
  screenshotFileName,
  shareScreen,
  HIDE_IN_CAPTURE,
} = await import('../lib/screenshot');

const originalNavigator = { share: navigator.share, canShare: navigator.canShare };

/**
 * Downloads happen by clicking a generated <a download>. jsdom cannot navigate,
 * so a real click prints a "Not implemented" stack over the test output — and
 * intercepting it lets the download itself be inspected.
 */
const clicked: HTMLAnchorElement[] = [];

function setShareSupport(options: {
  canShare?: (data: ShareData) => boolean;
  share?: (data: ShareData) => Promise<void>;
}) {
  Object.defineProperty(navigator, 'canShare', {
    value: options.canShare,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(navigator, 'share', {
    value: options.share,
    configurable: true,
    writable: true,
  });
}

beforeEach(() => {
  document.body.innerHTML = '<div id="root">hello</div>';
  document.documentElement.className = '';
  html2canvas.mockClear();
  canvas.toBlob.mockClear();
  URL.createObjectURL = vi.fn(() => 'blob:fake');
  URL.revokeObjectURL = vi.fn();
  clicked.length = 0;
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    clicked.push(this);
  });
});

afterEach(() => {
  setShareSupport(originalNavigator as never);
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('the screenshot filename', () => {
  test('is dated, so a gallery full of them still sorts', () => {
    expect(screenshotFileName(new Date(2026, 8, 7))).toBe('piqeras-2026-09-07.png');
  });

  test('pads single digits', () => {
    expect(screenshotFileName(new Date(2026, 0, 3))).toBe('piqeras-2026-01-03.png');
  });
});

describe('drawing the screen', () => {
  test('hides the glass while drawing and restores it afterwards', async () => {
    // backdrop-filter does not rasterise, so panels are made opaque for the
    // capture — and must not stay that way once the picture is taken.
    let classDuringCapture = '';
    html2canvas.mockImplementationOnce(async () => {
      classDuringCapture = document.documentElement.className;
      return canvas;
    });

    await captureScreen();

    expect(classDuringCapture).toContain('capturing');
    expect(document.documentElement.className).not.toContain('capturing');
  });

  test('restores the page even when drawing throws', async () => {
    html2canvas.mockImplementationOnce(async () => {
      throw new Error('canvas exploded');
    });

    await expect(captureScreen()).rejects.toThrow();
    // A page left permanently in capture styling would be a visible bug.
    expect(document.documentElement.className).not.toContain('capturing');
  });

  test('leaves the share button itself out of the picture', async () => {
    await captureScreen();
    const { ignoreElements } = html2canvas.mock.calls[0][1];
    const button = document.createElement('button');
    button.setAttribute(HIDE_IN_CAPTURE, '');
    expect(ignoreElements(button)).toBe(true);
    expect(ignoreElements(document.createElement('div'))).toBe(false);
  });

  test('caps the pixel ratio so a tall page cannot overflow the canvas limit', async () => {
    Object.defineProperty(window, 'devicePixelRatio', { value: 3, configurable: true });
    await captureScreen();
    expect(html2canvas.mock.calls[0][1].scale).toBe(2);
  });
});

describe('the canvas budget', () => {
  /*
   * Crossing a browser's canvas ceiling does not throw — it returns a blank or
   * truncated bitmap. A member would get a black rectangle and no explanation,
   * so the scale has to come down before that happens rather than after.
   */

  test('a phone screen is drawn at full retina scale', () => {
    expect(captureScale(390, 844, 3)).toBe(2);
    expect(captureScale(390, 844, 2)).toBe(2);
    expect(captureScale(390, 844, 1)).toBe(1);
  });

  test('a long page is scaled down instead of overflowing', () => {
    // The group screen with everybody listed, on a tall phone.
    const scale = captureScale(430, 9000, 3);
    expect(scale).toBeLessThan(2);
    expect(430 * scale * 9000 * scale).toBeLessThanOrEqual(12_000_000);
  });

  test('no single edge exceeds the 8192px limit', () => {
    const scale = captureScale(400, 7000, 3);
    expect(7000 * scale).toBeLessThanOrEqual(8192);
  });

  test('never drops below 1, which would blur an ordinary screen', () => {
    expect(captureScale(430, 40000, 3)).toBe(1);
  });

  test('survives a zero-sized or unmeasured page', () => {
    // getBoundingClientRect returns zeros for a hidden root; the capture should
    // still be attempted rather than dividing by zero.
    expect(captureScale(0, 0, 2)).toBe(2);
    expect(Number.isFinite(captureScale(0, 0, 0))).toBe(true);
  });
});

describe('sharing the picture', () => {
  test('goes to the share sheet when the phone has one', async () => {
    const share = vi.fn(async (_data: ShareData) => {});
    setShareSupport({ canShare: () => true, share });

    const outcome = await shareScreen({ fileName: 'p.png' });

    expect(outcome).toBe('shared');
    const data = share.mock.calls[0][0];
    expect(data.files?.[0].name).toBe('p.png');
    expect(data.files?.[0].type).toBe('image/png');
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  test('the picture goes on its own, with no caption or subject', () => {
    // WhatsApp turns `text` into a prefilled caption under the image and
    // `title` into a subject line — words the sender then has to delete.
    const share = vi.fn(async (_data: ShareData) => {});
    setShareSupport({ canShare: () => true, share });

    return shareScreen({ fileName: 'p.png' }).then(() => {
      const data = share.mock.calls[0][0];
      expect(Object.keys(data)).toEqual(['files']);
      expect(data.text).toBeUndefined();
      expect(data.title).toBeUndefined();
      expect(data.url).toBeUndefined();
    });
  });

  test('a dismissed share sheet is not an error and does not download', async () => {
    // Tapping "cancel" rejects with AbortError. Treating that as a failure
    // would pop an error message at somebody who simply changed their mind.
    const abort = Object.assign(new Error('cancelled'), { name: 'AbortError' });
    setShareSupport({ canShare: () => true, share: vi.fn(async () => { throw abort; }) });

    expect(await shareScreen({ fileName: 'p.png' })).toBe('cancelled');
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  test('falls back to a download where files cannot be shared', async () => {
    // Desktop Firefox has navigator.share but refuses files.
    setShareSupport({ canShare: () => false, share: vi.fn() });

    expect(await shareScreen({ fileName: 'p.png' })).toBe('downloaded');
    expect(URL.createObjectURL).toHaveBeenCalled();
    expect(clicked).toHaveLength(1);
    expect(clicked[0].download).toBe('p.png');
    expect(clicked[0].getAttribute('href')).toBe('blob:fake');
    // The temporary link must not be left behind in the document.
    expect(clicked[0].isConnected).toBe(false);
  });

  test('falls back to a download when a phone advertises sharing then refuses', async () => {
    // Some Android builds answer canShare true and then reject anyway; losing
    // the picture entirely would be worse than saving it.
    setShareSupport({
      canShare: () => true,
      share: vi.fn(async () => { throw new Error('not today'); }),
    });

    expect(await shareScreen({ fileName: 'p.png' })).toBe('downloaded');
    expect(URL.createObjectURL).toHaveBeenCalled();
  });

  test('works on a browser with no Web Share API at all', async () => {
    setShareSupport({ canShare: undefined, share: undefined });
    expect(await shareScreen({ fileName: 'p.png' })).toBe('downloaded');
  });

  test('reports failure rather than throwing when the drawing fails', async () => {
    html2canvas.mockImplementationOnce(async () => {
      throw new Error('tainted canvas');
    });
    setShareSupport({ canShare: () => true, share: vi.fn() });

    expect(await shareScreen({ fileName: 'p.png' })).toBe('failed');
  });

  test('reports failure when the canvas yields no image', async () => {
    canvas.toBlob.mockImplementationOnce((cb: (b: Blob | null) => void) => cb(null));
    expect(await shareScreen({ fileName: 'p.png' })).toBe('failed');
  });
});
