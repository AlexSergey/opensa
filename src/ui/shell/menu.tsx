import type { ReactElement } from 'react';

/** External menu links (placeholder URLs — wire to the real Code/Blog/Videos destinations). */
const LINKS: readonly { href: string; label: string }[] = [
  { href: 'https://github.com/AlexSergey/opensa', label: 'Code' },
  { href: 'https://opensa.cc/blog', label: 'Blog' },
  { href: 'https://opensa.cc/videos', label: 'Videos' },
];

interface MenuProps {
  /** Shown under the items (e.g. the degraded-mode explanation). */
  note?: string;
  onPlay: () => void;
  /** Disable Play (degraded mode) — the links stay usable. */
  playDisabled?: boolean;
  /** "Play Game" in the menu, "Continue" when paused. */
  playLabel?: string;
}

export function Menu({ note, onPlay, playDisabled = false, playLabel = 'Play Game' }: MenuProps): ReactElement {
  return (
    <nav className="sa-menu">
      <button className="sa-menu__item" disabled={playDisabled} onClick={onPlay} type="button">
        {playLabel}
      </button>
      {LINKS.map((link) => (
        <a className="sa-menu__item" href={link.href} key={link.label} rel="noopener noreferrer" target="_blank">
          {link.label}
        </a>
      ))}
      {note ? <p className="sa-menu__note">{note}</p> : null}
    </nav>
  );
}
