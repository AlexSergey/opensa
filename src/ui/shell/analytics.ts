/**
 * Minimal Google Analytics (plan 051): inject gtag and record the visit, only to count visitors. A no-op
 * when `VITE_GA_ID` is unset (e.g. dev) — the component/flow simply skips it.
 */
const GA_ID = import.meta.env.VITE_GA_ID;

let started = false;

/** Load gtag and send the initial page view. Safe to call repeatedly (runs once). */
export function initAnalytics(): void {
  if (!GA_ID || started) {
    return;
  }
  started = true;

  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`;
  document.head.append(script);

  window.dataLayer ??= [];
  window.dataLayer.push(['js', new Date()]);
  window.dataLayer.push(['config', GA_ID]);
}
