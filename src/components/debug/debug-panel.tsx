import { type ReactElement, useEffect, useState, useSyncExternalStore } from 'react';

import type { CameraTarget, GeometryMode } from './debug-types';

import { debugState } from './debug-state';

interface DebugPanelProps {
  cameraTarget: CameraTarget;
  geometryMode: GeometryMode;
  onCameraTargetChange: (target: CameraTarget) => void;
  onGeometryModeChange: (mode: GeometryMode) => void;
}

/**
 * TEMPORARY debug overlay (toggle with Ctrl+D) for early development. While open,
 * `DEBUG_MODE` is true and clicking a model reports its name/txd/coords here.
 * Remove this whole `components/debug` folder (and its wiring) before shipping.
 */
export function DebugPanel({
  cameraTarget,
  geometryMode,
  onCameraTargetChange,
  onGeometryModeChange,
}: DebugPanelProps): null | ReactElement {
  const [visible, setVisible] = useState(false);
  const selection = useSyncExternalStore(
    (onChange) => debugState.subscribe(onChange),
    () => debugState.selection(),
  );

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

  // DEBUG_MODE follows the popup: on while open, off (and cleared) when closed.
  useEffect(() => {
    debugState.setMode(visible);
  }, [visible]);

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
          onSelect={() => onGeometryModeChange('lods')}
        />
        <Radio
          checked={geometryMode === 'map'}
          label="Only Map"
          name="geometry"
          onSelect={() => onGeometryModeChange('map')}
        />
      </div>

      <div style={styles.divider} />

      <div style={styles.group}>
        <div style={styles.groupLabel}>CAMERA</div>
        <Radio
          checked={cameraTarget === 'full-map'}
          label="Full Map"
          name="camera"
          onSelect={() => onCameraTargetChange('full-map')}
        />
        <Radio
          checked={cameraTarget === 'ganton'}
          label="Ganton"
          name="camera"
          onSelect={() => onCameraTargetChange('ganton')}
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
