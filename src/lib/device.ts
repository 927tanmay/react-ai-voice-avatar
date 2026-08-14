export const isIOS = () => {
  if (typeof navigator === 'undefined') return false;
  return /iPhone|iPod/.test(navigator.userAgent) ||
    // iPadOS 13+ reports as "MacIntel" but has touch
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
};
