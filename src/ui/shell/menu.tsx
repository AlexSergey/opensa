import type { ReactElement } from 'react';

import { GAME_CONFIG, GAME_IDS, type GameId } from '../../game-config';

/** External menu links. (Videos is a placeholder until the YouTube channel exists.) */
const LINKS: readonly { href: string; label: string }[] = [
  { href: 'https://github.com/AlexSergey/opensa', label: 'GitHub' },
  { href: 'https://github.com/AlexSergey/opensa/tree/main/blog', label: 'Blog' },
  { href: 'https://opensa.cc/videos', label: 'Videos' },
];

interface MenuProps {
  /** Launch a game by id (one button per `GAME_CONFIG` entry). */
  onPlay: (game: GameId) => void;
}

export function Menu({ onPlay }: MenuProps): ReactElement {
  return (
    <nav className="sa-menu">
      {GAME_IDS.map((id) => {
        const { disable, disabledNote, label } = GAME_CONFIG[id];

        return (
          <div className="sa-menu__game" key={id}>
            <button className="sa-menu__item" disabled={disable} onClick={() => onPlay(id)} type="button">
              {label}
            </button>
            {disable && disabledNote ? <p className="sa-menu__note">{disabledNote}</p> : null}
          </div>
        );
      })}
      <hr className="sa-menu__divider" />
      {LINKS.map((link) => (
        <a className="sa-menu__item" href={link.href} key={link.label} rel="noopener noreferrer" target="_blank">
          {link.label}
        </a>
      ))}
      <p className="sa-menu__legal">
        Unofficial, non-commercial fan project — not affiliated with Rockstar Games / Take-Two. No game files included;
        you bring your own copy. Rights holders: <a href="mailto:gooddev.sergey@gmail.com">contact us</a>.
      </p>
    </nav>
  );
}
