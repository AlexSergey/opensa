import type { ReactElement } from 'react';

interface DisclaimerProps {
  onAccept: () => void;
}

export function Disclaimer({ onAccept }: DisclaimerProps): ReactElement {
  return (
    <div className="sa-overlay">
      <div aria-modal className="sa-panel" role="dialog">
        <h2 className="sa-panel__title">Before you play</h2>
        <div className="sa-panel__body">
          <p>
            OpenSA is a <strong>technical, non-commercial demo</strong> for learning and preservation. It is not an
            official product and is <strong>not affiliated with Rockstar Games or Take-Two</strong>. No money is made
            from it.
          </p>
          <p>
            Game data is cached in your browser (Cache Storage) so reloads are fast. We use Google Analytics only to
            count visitors — no personal data is collected.
          </p>
          <p>
            Thanks to <strong>mad_driver</strong> for several of the vehicle models.
          </p>
        </div>
        <div className="sa-panel__actions">
          <button className="sa-button" onClick={onAccept} type="button">
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
