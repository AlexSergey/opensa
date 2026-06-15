import type { CSSProperties, ReactElement } from 'react';

interface PreloaderProps {
  /** 0–100. */
  percent: number;
  /** Rotating status line. */
  status: string;
}

export function Preloader({ percent, status }: PreloaderProps): ReactElement {
  const barStyle: CSSProperties = { width: `${percent}%` };

  return (
    <div className="sa-preloader">
      <div aria-hidden className="sa-progress">
        <div className="sa-progress__bar" style={barStyle} />
      </div>
      <span className="sa-status">{status}</span>
    </div>
  );
}
