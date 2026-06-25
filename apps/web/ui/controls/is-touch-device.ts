/** Whether this is a touch device (coarse pointer / touch points) — gates the on-screen controls (plan 055). */
export function isTouchDevice(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  return window.matchMedia?.('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
}
