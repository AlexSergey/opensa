import type { FontsConfig } from '@opensa/game/interfaces/config.interface';

import sixCapsUrl from '../../assets/fonts/SixCaps-Regular.ttf';

/** HUD font family name → bundled `.ttf` URL (Vite asset import). */
const FONT_SOURCES: Record<string, string> = {
  'SixCaps-Regular': sixCapsUrl,
};

/**
 * Register the HUD fonts (via the FontFace API) so the DOM HUD can use them by
 * family name. Call this **before** the scene loads so glyphs are ready when the
 * HUD first renders. Unknown families are skipped (assumed system fonts).
 */
export async function loadFonts(fonts: FontsConfig): Promise<void> {
  const families = new Set<string>([fonts.hud.clock, fonts.hud.zone]);
  await Promise.all([...families].map((family) => loadFont(family)));
}

async function loadFont(family: string): Promise<void> {
  const url = FONT_SOURCES[family];
  if (!url) {
    return;
  }
  const face = new FontFace(family, `url(${url})`);
  await face.load();
  document.fonts.add(face);
}
