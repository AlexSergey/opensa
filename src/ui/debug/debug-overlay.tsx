import { type ReactElement, useEffect, useRef, useState } from 'react';

import type { Game, WorldObjectInfo } from '../../game';

import { FULL_MAP_CENTER, GANTON_CJ_HOME, GANTON_RADIUS } from '../locations';

/** How much to load + where to look: the whole map, or just the Ganton district. */
type CameraTarget = 'full-map' | 'ganton';

/** What geometry to draw: the real map (LODs excluded) or only the LOD stand-ins. */
type GeometryMode = 'lods' | 'map';

/**
 * TEMPORARY debug overlay (toggle with Ctrl+D) for early development. While open,
 * the game runs in debug mode and clicking a model reports its name/txd/coords
 * here. Drives the engine purely through {@link Game} methods + events. Remove
 * this whole `ui/debug` folder (and its mount) before shipping.
 */
export function DebugOverlay({ game }: { game: Game }): null | ReactElement {
  const [visible, setVisible] = useState(false);
  const [geometryMode, setGeometryMode] = useState<GeometryMode>('map');
  const [cameraTarget, setCameraTarget] = useState<CameraTarget>('ganton');
  const [selection, setSelection] = useState<null | WorldObjectInfo>(null);
  const firstReloadRef = useRef(true);

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

  // Debug mode follows the popup: on while open, off when closed (clears selection).
  useEffect(() => {
    game.setDebugMode(visible);
    if (!visible) {
      // eslint-disable-next-line no-warning-comments
      // TODO: Fix that later
      // eslint-disable-next-line @eslint-react/set-state-in-effect
      setSelection(null);
    }
  }, [game, visible]);

  useEffect(() => game.events.on('select', setSelection), [game]);

  // Reload the region when the geometry/camera choice changes (skip the first
  // run — the initial region is loaded by the canvas host on bootstrap).
  useEffect(() => {
    if (firstReloadRef.current) {
      firstReloadRef.current = false;

      return;
    }
    const ganton = cameraTarget === 'ganton';
    void game.loadGame(ganton ? GANTON_CJ_HOME : FULL_MAP_CENTER, {
      geometry: geometryMode,
      radius: ganton ? GANTON_RADIUS : Infinity,
    });
  }, [game, geometryMode, cameraTarget]);

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
        <div style={styles.groupLabel}>GEOMETRY</div>
        <Radio
          checked={geometryMode === 'lods'}
          label="Only LODs"
          name="geometry"
          onSelect={() => setGeometryMode('lods')}
        />
        <Radio
          checked={geometryMode === 'map'}
          label="Only Map"
          name="geometry"
          onSelect={() => setGeometryMode('map')}
        />
      </div>

      <div style={styles.divider} />

      <div style={styles.group}>
        <div style={styles.groupLabel}>CAMERA</div>
        <Radio
          checked={cameraTarget === 'full-map'}
          label="Full Map"
          name="camera"
          onSelect={() => setCameraTarget('full-map')}
        />
        <Radio
          checked={cameraTarget === 'ganton'}
          label="Ganton"
          name="camera"
          onSelect={() => setCameraTarget('ganton')}
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
    width: 150,
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
