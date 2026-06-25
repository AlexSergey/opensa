/**
 * Tab shell for the standalone viewers. One html (`viewer.html`) hosts three full-page viewers
 * (object/vehicle/character); the `?tab=` query selects which one. Each viewer module owns
 * `document.body` and auto-runs on import, so a tab switch is a plain navigation (full reload) —
 * the side effects run exactly once per load, no mount/unmount juggling. Object is the default.
 */
const VIEWERS = {
  character: () => import('./character-viewer'),
  object: () => import('./object-viewer'),
  vehicle: () => import('./vehicle-viewer'),
} as const;

type Tab = keyof typeof VIEWERS;

function resolveTab(): Tab {
  const requested = new URLSearchParams(window.location.search).get('tab');

  return requested && requested in VIEWERS ? (requested as Tab) : 'object';
}

const active = resolveTab();

for (const link of document.querySelectorAll<HTMLAnchorElement>('.viewer-tabs a')) {
  link.classList.toggle('active', link.dataset.tab === active);
}

void VIEWERS[active]();
