import type { CSSProperties } from 'react';

/** Debugger theme — shared with the UI shell: black panel, white text, orange accent (from logo.svg). */
const ACCENT = '#fd8709';
const FG = '#fff';
const MUTED = '#989998';
const BG = 'rgba(8, 8, 8, 0.94)';
const BORDER = 'rgba(255, 255, 255, 0.16)';

/** Pixel size of one section checkbox in the map inspector grid. */
export const CELL_PX = 11;

export const styles: Record<string, CSSProperties> = {
  actionButton: {
    background: 'transparent',
    border: `1px solid ${BORDER}`,
    borderRadius: 3,
    color: FG,
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
    color: ACCENT,
    cursor: 'pointer',
    fontFamily: '"Courier New", monospace',
    fontSize: 12,
    letterSpacing: 1,
    marginBottom: 4,
    padding: 0,
  },
  cell: {
    accentColor: ACCENT,
    cursor: 'pointer',
    height: CELL_PX,
    margin: 0,
    width: CELL_PX,
  },
  cellCenter: {
    outline: `1px solid ${ACCENT}`,
    outlineOffset: 1,
  },
  cellEmpty: {
    height: CELL_PX,
    width: CELL_PX,
  },
  close: {
    background: 'transparent',
    border: 'none',
    color: FG,
    cursor: 'pointer',
    fontSize: 16,
    lineHeight: 1,
    padding: 0,
    position: 'absolute',
    right: 8,
    top: 6,
  },
  divider: {
    borderTop: `1px solid ${BORDER}`,
    margin: '8px 0',
  },
  filterInput: {
    background: 'transparent',
    border: `1px solid ${BORDER}`,
    borderRadius: 3,
    color: FG,
    fontFamily: '"Courier New", monospace',
    fontSize: 12,
    letterSpacing: 1,
    marginBottom: 4,
    padding: '6px 8px',
    width: '100%',
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
    color: MUTED,
    fontSize: 9,
    letterSpacing: 3,
    marginBottom: 2,
    opacity: 0.8,
  },
  hint: {
    color: MUTED,
    fontSize: 11,
  },
  info: {
    color: FG,
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
    color: MUTED,
    display: 'flex',
    fontSize: 10,
    gap: 3,
  },
  menuButton: {
    background: 'transparent',
    border: `1px solid ${BORDER}`,
    borderRadius: 3,
    color: FG,
    cursor: 'pointer',
    display: 'flex',
    fontFamily: '"Courier New", monospace',
    fontSize: 13,
    justifyContent: 'space-between',
    letterSpacing: 2,
    padding: '9px 11px',
  },
  option: {
    color: MUTED,
    fontSize: 12,
    letterSpacing: 1,
  },
  optionActive: {
    color: ACCENT,
    fontSize: 12,
    letterSpacing: 1,
  },
  panel: {
    backgroundColor: BG,
    border: `1px solid ${BORDER}`,
    borderRadius: 4,
    boxShadow: '0 8px 28px rgba(0, 0, 0, 0.6)',
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
    fontFamily: '"Courier New", monospace',
    gap: 8,
    left: 16,
    maxHeight: 'calc(100vh - 32px)', // never taller than the viewport (16px margin top + bottom)
    minHeight: 200,
    overflowY: 'auto', // scroll when there are more controls than fit
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
    accentColor: ACCENT,
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
    borderBottom: `1px solid ${BORDER}`,
    color: ACCENT,
    fontSize: 10,
    letterSpacing: 4,
    paddingBottom: 6,
    textAlign: 'center',
  },
};
