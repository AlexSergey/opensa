import type { ReactElement, ReactNode } from 'react';

interface DisclaimerProps {
  /** The selected game's disclaimer body. */
  children: ReactNode;
  onAccept: () => void;
}

/** Pre-launch disclaimer popup (fetch games): shows the game's notice + an OK button that starts loading. */
export function Disclaimer({ children, onAccept }: DisclaimerProps): ReactElement {
  return (
    <div className="sa-overlay">
      <div aria-modal className="sa-panel" role="dialog">
        <h2 className="sa-panel__title">Before you play</h2>
        <div className="sa-panel__body">{children}</div>
        <div className="sa-panel__actions">
          <button className="sa-button" onClick={onAccept} type="button">
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
