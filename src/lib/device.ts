export const isIOS = () => {
  if (typeof navigator === 'undefined') return false;
  return /iPhone|iPod/.test(navigator.userAgent) ||
    // iPadOS 13+ reports as "MacIntel" but has touch
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
};

/**
 * An Android phone, or a browser that says it has 4 GB of memory or less.
 *
 * A phone's browser gives a tab far less memory than the phone has, and loading
 * Kokoro beside Whisper can get the tab killed before the crash guard has seen
 * two failed starts. `deviceMemory` is Chromium's rounded figure, capped at 8;
 * Safari and Firefox do not report it.
 */
export const isLowMemoryDevice = () => {
  if (typeof navigator === 'undefined') return false;
  if (/Android.+Mobile/.test(navigator.userAgent)) return true;
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return typeof memory === 'number' && memory <= 4;
};
