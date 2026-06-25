import type { CellCoord, Game, WorldObjectInfo } from '@opensa/game';

import { type ReactElement, useEffect, useMemo, useState } from 'react';

import { CELL_PX, styles } from './debug-styles';

/** Rough GTA SA region of a cell (by its world-centre coords), used to group the sections. */
const REGIONS = ['Los Santos', 'San Fierro', 'Las Venturas', 'Countryside'] as const;
type Region = (typeof REGIONS)[number];

const REGION_COLOR: Record<Region, string> = {
  Countryside: '#8899aa',
  'Las Venturas': '#ff66cc',
  'Los Santos': '#ffcc00',
  'San Fierro': '#00ff88',
};

/**
 * The map-viewer inspector. Mounting it turns the engine's **map-viewer** mode on
 * (free-fly camera + manual cell render + click-to-pick) and seeds the selection
 * with the current section; unmounting turns it back off and resumes streaming —
 * so leaving the Map screen / closing the panel exits cleanly. Pick the sections
 * to render (HD, or LOD with "Show LODs"); clicking a model reports its info.
 */
export function MapInspector({ game }: { game: Game }): ReactElement {
  const [showCollision, setShowCollision] = useState(false);
  const [selection, setSelection] = useState<null | WorldObjectInfo>(null);
  const [center, setCenter] = useState<CellCoord | null>(null);
  const [allCells, setAllCells] = useState<CellCoord[]>([]);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [showLods, setShowLods] = useState(false);

  const cellSize = game.getConfig().streaming.cellSize;

  // Enter map-viewer on mount (seed the current section + all cells, suspend streaming);
  // leave on unmount (resume streaming, clear the manual selection).
  useEffect(() => {
    game.setMapViewer(true);
    const view = game.getViewCell();
    /* eslint-disable @eslint-react/set-state-in-effect */
    setCenter(view);
    setAllCells(game.listCells());
    setSelected(new Set(view ? [cellKey(view)] : []));
    /* eslint-enable @eslint-react/set-state-in-effect */

    return (): void => {
      game.setMapViewer(false);
      game.setManualCells(null);
    };
  }, [game]);

  useEffect(() => game.events.on('select', setSelection), [game]);

  useEffect(() => {
    const cells = [...selected].map((key): CellCoord => {
      const [cx, cy] = key.split(',');

      return [Number(cx), Number(cy)];
    });
    game.setManualCells(cells, showLods);
  }, [game, selected, showLods]);

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

    return {
      cols: range(Math.min(...xs), Math.max(...xs)),
      has: new Set(allCells.map(cellKey)),
      region: new Map(allCells.map((c) => [cellKey(c), regionOf(c, cellSize)])),
      rows: range(Math.max(...ys), Math.min(...ys)), // top = north
    };
  }, [allCells, cellSize]);

  return (
    <>
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
        <Checkbox
          checked={showCollision}
          label="Show collision"
          onToggle={() => {
            const next = !showCollision;
            setShowCollision(next);
            game.setShowCollision(next);
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
    </>
  );
}

function cellKey([cx, cy]: CellCoord): string {
  return `${cx},${cy}`;
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
