import type { ReactElement } from 'react';

interface FolderPromptProps {
  /** Last error (e.g. permission denied) to show under the button. */
  detail?: string;
  onChoose: () => void;
}

/**
 * Local loader (plan 053): asks the user to pick their GTA San Andreas install folder. The pick must run in
 * this button's click — `showDirectoryPicker` needs a user gesture — so loading only starts once it's granted.
 */
export function FolderPrompt({ detail, onChoose }: FolderPromptProps): ReactElement {
  return (
    <nav className="sa-menu">
      <p className="sa-menu__note">
        We can&rsquo;t ship the original game assets, so you need to play from your own legitimate copy of GTA San
        Andreas. Select your installed game folder to continue — nothing is uploaded; the files are read locally in your
        browser.
      </p>
      <button className="sa-menu__item" onClick={onChoose} type="button">
        Choose game folder
      </button>
      {detail ? <p className="sa-menu__note">{detail}</p> : null}
    </nav>
  );
}
