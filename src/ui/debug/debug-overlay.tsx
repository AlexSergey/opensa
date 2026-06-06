import { type ReactElement, useEffect, useMemo, useState } from 'react';

import type { CellCoord, Game, WorldObjectInfo } from '../../game';

/** Rough GTA SA region of a cell (by its world-centre coords), used to group the sections. */
const REGIONS = ['Los Santos', 'San Fierro', 'Las Venturas', 'Countryside'] as const;
type Region = (typeof REGIONS)[number];

const REGION_COLOR: Record<Region, string> = {
  Countryside: '#8899aa',
  'Las Venturas': '#ff66cc',
  'Los Santos': '#ffcc00',
  'San Fierro': '#00ff88',
};

function cellKey([cx, cy]: CellCoord): string {
  return `${cx},${cy}`;
}

/** Inclusive integer range, ascending or descending depending on the bounds. */
function range(from: number, to: number): number[] {
  const step = from <= to ? 1 : -1;
  const out: number[] = [];
  for (let v = from; step > 0 ? v <= to : v >= to; v += step) {
    out.push(v);
  }

  return out;
}

function regionOf([cx, cy]: CellCoord, cellSize: number): Region {
  const x = cx * cellSize + cellSize / 2;
  const y = cy * cellSize + cellSize / 2;
  if (x > 200 && y < -300) {
    return 'Los Santos';
  }
  if (x > 600 && y > 600) {
    return 'Las Venturas';
  }
  if (x < -700) {
    return 'San Fierro';
  }

  return 'Countryside';
}

/** Pixel size of one section checkbox in the inspector grid. */
const CELL_PX = 11;

/**
 * TEMPORARY debug overlay (toggle with Ctrl+X) for early development. While open,
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
  const [allCells, setAllCells] = useState<CellCoord[]>([]);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [showLods, setShowLods] = useState(false);

  const cellSize = game.getConfig().streaming.cellSize;

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.ctrlKey && e.key === 'x') {
        e.preventDefault();
        setVisible((previous) => !previous);
      }
    }
    window.addEventListener('keydown', handleKeyDown);

    return (): void => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  // Debug mode follows the popup: entering captures the current section + every map
  // cell, seeding the selection (suspending streaming); leaving resumes streaming.
  useEffect(() => {
    game.setDebugMode(visible);
    /* eslint-disable @eslint-react/set-state-in-effect */
    if (visible) {
      const view = game.getViewCell();
      setCenter(view);
      setAllCells(game.listCells());
      setSelected(new Set(view ? [cellKey(view)] : []));
    } else {
      setSelection(null);
      setCenter(null);
      game.setManualCells(null);
    }
    /* eslint-enable @eslint-react/set-state-in-effect */
  }, [game, visible]);

  useEffect(() => game.events.on('select', setSelection), [game]);

  // Render the checked (absolute) sections while open.
  useEffect(() => {
    if (!visible) {
      return;
    }
    const cells = [...selected].map((key): CellCoord => {
      const [cx, cy] = key.split(',');

      return [Number(cx), Number(cy)];
    });
    game.setManualCells(cells, showLods);
  }, [game, visible, selected, showLods]);

  function toggleCell(coord: CellCoord): void {
    const key = cellKey(coord);
    setSelected((previous) => {
      const next = new Set(previous);
      if (!next.delete(key)) {
        next.add(key);
      }

      return next;
    });
  }

  const allSelected = allCells.length > 0 && selected.size === allCells.length;
  function toggleAll(): void {
    setSelected(allSelected ? new Set() : new Set(allCells.map(cellKey)));
  }

  const layout = useMemo(() => {
    if (allCells.length === 0) {
      return null;
    }
    const xs = allCells.map((c) => c[0]);
    const ys = allCells.map((c) => c[1]);
    const region = new Map(allCells.map((c) => [cellKey(c), regionOf(c, cellSize)]));

    return {
      cols: range(Math.min(...xs), Math.max(...xs)),
      has: new Set(allCells.map(cellKey)),
      region,
      rows: range(Math.max(...ys), Math.min(...ys)), // top = north
    };
  }, [allCells, cellSize]);

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
        <Checkbox checked={allSelected} label="Whole map" onToggle={toggleAll} />
        {layout ? (
          <div style={styles.sectionsBox}>
            <div style={{ ...styles.grid, gridTemplateColumns: `repeat(${layout.cols.length}, ${CELL_PX}px)` }}>
              {layout.rows.flatMap((cy) =>
                layout.cols.map((cx) => {
                  const key = cellKey([cx, cy]);
                  if (!layout.has.has(key)) {
                    return <div key={key} style={styles.cellEmpty} />;
                  }
                  const region = layout.region.get(key) ?? 'Countryside';
                  const isCenter = center?.[0] === cx && center[1] === cy;

                  return (
                    <input
                      checked={selected.has(key)}
                      key={key}
                      onChange={() => toggleCell([cx, cy])}
                      style={{
                        ...styles.cell,
                        accentColor: REGION_COLOR[region],
                        ...(isCenter ? styles.cellCenter : {}),
                      }}
                      title={`${cx}, ${cy} · ${region}`}
                      type="checkbox"
                    />
                  );
                }),
              )}
            </div>
          </div>
        ) : null}
        <div style={styles.legend}>
          {REGIONS.map((r) => (
            <span key={r} style={styles.legendItem} title={r}>
              <span style={{ ...styles.swatch, background: REGION_COLOR[r] }} />
              {r
                .split(' ')
                .map((w) => w[0])
                .join('')}
            </span>
          ))}
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
    height: CELL_PX,
    margin: 0,
    width: CELL_PX,
  },
  cellCenter: {
    outline: `1px solid ${NEON}`,
    outlineOffset: 1,
  },
  cellEmpty: {
    height: CELL_PX,
    width: CELL_PX,
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
    gap: 2,
    width: 'max-content',
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
  legend: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 8,
  },
  legendItem: {
    alignItems: 'center',
    color: '#aaa',
    display: 'flex',
    fontSize: 10,
    gap: 3,
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
    width: 300,
    zIndex: 1000,
  },
  radio: {
    accentColor: NEON,
    cursor: 'pointer',
    margin: 0,
  },
  sectionsBox: {
    border: `1px solid ${BORDER}`,
    maxHeight: 220,
    overflow: 'auto',
    padding: 4,
  },
  swatch: {
    borderRadius: 2,
    display: 'inline-block',
    height: 9,
    width: 9,
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
