import type { CSSProperties } from 'react';

/** Neon theme shared by the F2 debugger and its map inspector. */
export const NEON = '#00ffcc';
const NEON_DIM = '#00ffcc33';
const BG = 'rgba(0, 8, 20, 0.92)';
const BORDER = '#00ffcc55';

/** Pixel size of one section checkbox in the map inspector grid. */
export const CELL_PX = 11;

export const styles: Record<string, CSSProperties> = {
  actionButton: {
    background: 'transparent',
    border: `1px solid ${BORDER}`,
    borderRadius: 3,
    color: NEON,
    cursor: 'pointer',
    fontFamily: '"Courier New", monospace',
    fontSize: 12,
    letterSpacing: 1,
    padding: '7px 10px',
    textAlign: 'left',
  },
  backButton: {
    alignSelf: 'flex-start',
    background: 'transparent',
    border: 'none',
    color: NEON,
    cursor: 'pointer',
    fontFamily: '"Courier New", monospace',
    fontSize: 12,
    letterSpacing: 1,
    marginBottom: 4,
    padding: 0,
  },
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
    gap: 6,
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
  menuButton: {
    background: 'transparent',
    border: `1px solid ${BORDER}`,
    borderRadius: 3,
    color: NEON,
    cursor: 'pointer',
    display: 'flex',
    fontFamily: '"Courier New", monospace',
    fontSize: 13,
    justifyContent: 'space-between',
    letterSpacing: 2,
    padding: '9px 11px',
  },
  option: {
    color: '#aaa',
    fontSize: 12,
    letterSpacing: 1,
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
  presetRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 4,
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
