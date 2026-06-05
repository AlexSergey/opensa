import { type ReactElement, useEffect, useState } from 'react';

import type { CellCoord, Game, WorldObjectInfo } from '../../game';

/** Half-width of the section inspector grid (2 → a 5×5 grid around the current cell). */
const GRID_RADIUS = 2;
const OFFSETS = Array.from({ length: GRID_RADIUS * 2 + 1 }, (_, i) => i - GRID_RADIUS);

/**
 * TEMPORARY debug overlay (toggle with Ctrl+D) for early development. While open,
 * streaming is suspended and the **section inspector** renders the checked grid
 * cells (around the current one) — as HD, or as LOD with "Show LODs". Clicking a
 * model reports its name/txd/coords. Closing resumes the normal streaming render.
 * Remove this whole `ui/debug` folder (and its mount) before shipping.
 */
export function DebugOverlay({ game }: { game: Game }): null | ReactElement {
  const [visible, setVisible] = useState(false);
  const [playing, setPlaying] = useState(() => game.getConfig().gameState === 'play');
  const [showCollision, setShowCollision] = useState(false);
  const [selection, setSelection] = useState<null | WorldObjectInfo>(null);
  const [center, setCenter] = useState<CellCoord | null>(null);
  const [selected, setSelected] = useState(() => new Set(['0,0']));
  const [showLods, setShowLods] = useState(false);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.ctrlKey && e.key === 'd') {
        e.preventDefault();
        setVisible((previous) => !previous);
      }
    }
    window.addEventListener('keydown', handleKeyDown);

    return (): void => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  // Debug mode follows the popup: entering captures the current section + seeds the
  // selection (suspending streaming); leaving resumes streaming.
  useEffect(() => {
    game.setDebugMode(visible);
    /* eslint-disable @eslint-react/set-state-in-effect */
    if (visible) {
      setCenter(game.getViewCell());
      setSelected(new Set(['0,0']));
    } else {
      setSelection(null);
      setCenter(null);
      game.setManualCells(null);
    }
    /* eslint-enable @eslint-react/set-state-in-effect */
  }, [game, visible]);

  useEffect(() => game.events.on('select', setSelection), [game]);

  // Render the checked sections (relative to the captured centre) while open.
  useEffect(() => {
    if (!visible || !center) {
      return;
    }
    const cells = [...selected].map((offset): CellCoord => {
      const [dx, dy] = offset.split(',');

      return [center[0] + Number(dx), center[1] + Number(dy)];
    });
    game.setManualCells(cells, showLods);
  }, [game, visible, center, selected, showLods]);

  function toggleCell(dx: number, dy: number): void {
    const key = `${dx},${dy}`;
    setSelected((previous) => {
      const next = new Set(previous);
      if (!next.delete(key)) {
        next.add(key);
      }

      return next;
    });
  }

  if (!visible) {
    return null;
  }

  return (
    <div style={styles.panel}>
      <button onClick={() => setVisible(false)} style={styles.close} type="button">
        ×
      </button>
      <div style={styles.title}>DEBUG</div>

      <div style={styles.group}>
        <div style={styles.groupLabel}>GAME</div>
        <Radio
          checked={playing}
          label="Play"
          name="game"
          onSelect={() => {
            setPlaying(true);
            game.setGameState('play');
          }}
        />
        <Radio
          checked={!playing}
          label="Pause"
          name="game"
          onSelect={() => {
            setPlaying(false);
            game.setGameState('pause');
          }}
        />
      </div>

      <div style={styles.divider} />

      <div style={styles.group}>
        <div style={styles.groupLabel}>SECTIONS {center ? `(${center[0]}, ${center[1]})` : ''}</div>
        <div style={styles.grid}>
          {OFFSETS.flatMap((dy) =>
            OFFSETS.map((dx) => (
              <input
                checked={selected.has(`${dx},${dy}`)}
                key={`${dx},${dy}`}
                onChange={() => toggleCell(dx, dy)}
                style={dx === 0 && dy === 0 ? { ...styles.cell, ...styles.cellCenter } : styles.cell}
                title={center ? `${center[0] + dx}, ${center[1] + dy}` : `${dx}, ${dy}`}
                type="checkbox"
              />
            )),
          )}
        </div>
        <Checkbox checked={showLods} label="Show LODs" onToggle={() => setShowLods((previous) => !previous)} />
      </div>

      <div style={styles.divider} />

      <div style={styles.group}>
        <div style={styles.groupLabel}>COLLISION</div>
        <Radio
          checked={showCollision}
          label="Show"
          name="collision"
          onSelect={() => {
            setShowCollision(true);
            game.setShowCollision(true);
          }}
        />
        <Radio
          checked={!showCollision}
          label="Hide"
          name="collision"
          onSelect={() => {
            setShowCollision(false);
            game.setShowCollision(false);
          }}
        />
      </div>

      <div style={styles.divider} />

      <div style={styles.group}>
        <div style={styles.groupLabel}>SELECTED</div>
        {selection ? (
          <>
            <div style={styles.info}>name: {selection.modelName}</div>
            <div style={styles.info}>txd: {selection.txdName}</div>
            <div style={styles.info}>pos: {selection.position.map((n) => n.toFixed(1)).join(', ')}</div>
          </>
        ) : (
          <div style={styles.hint}>click a model…</div>
        )}
      </div>
    </div>
  );
}

function Checkbox({
  checked,
  label,
  onToggle,
}: {
  checked: boolean;
  label: string;
  onToggle: () => void;
}): ReactElement {
  return (
    <label style={styles.label}>
      <input checked={checked} onChange={onToggle} style={styles.radio} type="checkbox" />
      <span style={checked ? styles.optionActive : styles.option}>{label}</span>
    </label>
  );
}

function Radio({
  checked,
  label,
  name,
  onSelect,
}: {
  checked: boolean;
  label: string;
  name: string;
  onSelect: () => void;
}): ReactElement {
  return (
    <label style={styles.label}>
      <input checked={checked} name={name} onChange={onSelect} style={styles.radio} type="radio" />
      <span style={checked ? styles.optionActive : styles.option}>{label}</span>
    </label>
  );
}

const NEON = '#00ffcc';
const NEON_DIM = '#00ffcc33';
const BG = 'rgba(0, 8, 20, 0.92)';
const BORDER = '#00ffcc55';

const styles: Record<string, React.CSSProperties> = {
  cell: {
    accentColor: NEON,
    cursor: 'pointer',
    height: 16,
    margin: 0,
    width: 16,
  },
  cellCenter: {
    outline: `1px solid ${NEON}`,
    outlineOffset: 1,
  },
  close: {
    background: 'transparent',
    border: 'none',
    color: NEON,
    cursor: 'pointer',
    fontSize: 16,
    lineHeight: 1,
    padding: 0,
    position: 'absolute',
    right: 8,
    textShadow: `0 0 8px ${NEON}`,
    top: 6,
  },
  divider: {
    borderTop: `1px solid ${BORDER}`,
    margin: '8px 0',
  },
  grid: {
    display: 'grid',
    gap: 3,
    gridTemplateColumns: `repeat(${OFFSETS.length}, 1fr)`,
  },
  group: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  groupLabel: {
    color: NEON,
    fontSize: 9,
    letterSpacing: 3,
    marginBottom: 2,
    opacity: 0.6,
  },
  hint: {
    color: '#667',
    fontSize: 11,
  },
  info: {
    color: NEON,
    fontSize: 11,
    wordBreak: 'break-all',
  },
  label: {
    alignItems: 'center',
    cursor: 'pointer',
    display: 'flex',
    gap: 8,
  },
  option: {
    color: '#aaa',
    fontSize: 12,
    letterSpacing: 1,
    transition: 'color 0.15s',
  },
  optionActive: {
    color: NEON,
    fontSize: 12,
    letterSpacing: 1,
    textShadow: `0 0 8px ${NEON}`,
  },
  panel: {
    backgroundColor: BG,
    border: `1px solid ${NEON}`,
    borderRadius: 4,
    boxShadow: `0 0 16px ${NEON_DIM}, inset 0 0 12px rgba(0,255,204,0.04)`,
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
    fontFamily: '"Courier New", monospace',
    gap: 8,
    left: 16,
    minHeight: 200,
    padding: '12px 14px',
    position: 'fixed',
    top: 16,
    width: 160,
    zIndex: 1000,
  },
  radio: {
    accentColor: NEON,
    cursor: 'pointer',
    margin: 0,
  },
  title: {
    borderBottom: `1px solid ${NEON}`,
    color: NEON,
    fontSize: 10,
    letterSpacing: 4,
    paddingBottom: 6,
    textAlign: 'center',
    textShadow: `0 0 10px ${NEON}`,
  },
};
