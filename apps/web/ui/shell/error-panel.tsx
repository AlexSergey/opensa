import type { ReactElement } from 'react';

interface ErrorPanelProps {
  /** Optional technical detail (e.g. the caught error message). */
  detail?: string;
  onRetry: () => void;
}

export function ErrorPanel({ detail, onRetry }: ErrorPanelProps): ReactElement {
  return (
    <div className="sa-overlay">
      <div aria-modal className="sa-panel" role="alertdialog">
        <h2 className="sa-panel__title">Something went wrong</h2>
        <div className="sa-panel__body">
          <p>We could not finish loading the game. Please check your connection and try again.</p>
          {detail ? <p>{detail}</p> : null}
        </div>
        <div className="sa-panel__actions">
          <button className="sa-button" onClick={onRetry} type="button">
            Retry
          </button>
        </div>
      </div>
    </div>
  );
}
