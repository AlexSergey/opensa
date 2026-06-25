import { TouchInputSource } from '@opensa/game/input';
/**
 * Standalone harness for the on-screen touch controls (plan 055) — renders `<TouchControls>` over a blank
 * page with no game/assets, so the overlay can be tuned by hand and driven by the e2e lane
 * (`e2e/touch-controls.spec.ts`). The live `TouchInputSource` is exposed on `window.__touchSource` for the
 * test to read the resulting signals. Open `/controls-harness.html` (dev only; excluded from the prod build).
 */
import { type ReactElement, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { TouchControls } from '../ui/controls/touch-controls';

const source = new TouchInputSource();
// Drive the Enter button's contextual visibility from the test (in-game this comes from the enter-vehicle system).
let canEnter = false;
const canEnterQuery = (): boolean => canEnter;
(window as unknown as { __setCanEnter: (value: boolean) => void; __touchSource: TouchInputSource }).__touchSource =
  source;
(window as unknown as { __setCanEnter: (value: boolean) => void }).__setCanEnter = (value): void => {
  canEnter = value;
};

/** Live, non-consuming readout (move + held actions) so a human can see the controls working. */
function Harness(): ReactElement {
  const [text, setText] = useState('');

  useEffect(() => {
    let raf = 0;
    const tick = (): void => {
      const move = source.move();
      const actions = (['run', 'jump', 'enterExit'] as const).filter((action) => source.isActive(action));
      setText(`move: ${move.x.toFixed(2)}, ${move.y.toFixed(2)}\nactions: ${actions.join(', ') || '—'}`);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return (): void => cancelAnimationFrame(raf);
  }, []);

  return (
    <>
      <div id="readout">{text}</div>
      <TouchControls canEnterExit={canEnterQuery} source={source} />
    </>
  );
}

createRoot(document.getElementById('root')!).render(<Harness />);
