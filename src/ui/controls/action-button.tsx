import { type ReactElement, type PointerEvent as ReactPointerEvent, useState } from 'react';

interface ActionButtonProps {
  /** Extra class for positioning. */
  className?: string;
  /** Button face text (also the accessible name). */
  label: string;
  /** Fired with the held state on press / release. */
  onChange: (held: boolean) => void;
}

/** A press-and-hold on-screen button (plan 055): reports `true` while held, `false` on release/cancel. */
export function ActionButton({ className, label, onChange }: ActionButtonProps): ReactElement {
  const [pressed, setPressed] = useState(false);

  const set = (event: ReactPointerEvent<HTMLButtonElement>, held: boolean): void => {
    if (held) {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    }
    setPressed(held);
    onChange(held);
  };

  return (
    <button
      className={`sa-touch-btn ${pressed ? 'is-pressed' : ''} ${className ?? ''}`}
      onPointerCancel={(event) => set(event, false)}
      onPointerDown={(event) => set(event, true)}
      onPointerUp={(event) => set(event, false)}
      type="button"
    >
      {label}
    </button>
  );
}
