import type { CSSProperties, ReactElement, ReactNode } from 'react';

/** Full-screen, non-interactive layer above the canvas — immune to WebGL post-processing. */
const style: CSSProperties = {
  inset: 0,
  pointerEvents: 'none', // clicks pass through to the canvas; widgets opt back in if needed
  position: 'fixed',
  zIndex: 10, // above the canvas, below the (future) UI/menu layer (z 20) and debug overlay (z 1000)
};

/**
 * The HUD overlay root. The HUD and the later UI/menu layer are **sibling** layers
 * stacked here by z-index — the HUD stays passive (`pointer-events: none`) while
 * menus render above it.
 */
export function Overlay({ children }: { children: ReactNode }): ReactElement {
  return <div style={style}>{children}</div>;
}
