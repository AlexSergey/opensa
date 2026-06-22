import { type ReactElement, type PointerEvent as ReactPointerEvent, useRef, useState } from 'react';

interface JoystickProps {
  /** Extra class for positioning (e.g. `sa-touch__move`). */
  className?: string;
  /** Accessible label for the control. */
  label: string;
  /** Normalised deflection on every change: `x` right+, `y` **down+** (screen-space); `0,0` on release. */
  onChange: (x: number, y: number) => void;
}

/**
 * An on-screen analog joystick (plan 055): drag the knob within a circular base; reports the normalised
 * deflection (clamped to the unit circle) and recentres on release. Pointer events (touch + mouse + pen),
 * so it works in an emulator too. Screen-space output — the consumer inverts the Y axis where needed.
 */
export function Joystick({ className, label, onChange }: JoystickProps): ReactElement {
  const baseRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef(false);
  const [knob, setKnob] = useState({ x: 0, y: 0 });

  const update = (clientX: number, clientY: number): void => {
    const base = baseRef.current;
    if (!base) {
      return;
    }
    const rect = base.getBoundingClientRect();
    const radius = rect.width / 2;
    let dx = clientX - (rect.left + radius);
    let dy = clientY - (rect.top + radius);
    const distance = Math.hypot(dx, dy);
    if (distance > radius) {
      dx = (dx / distance) * radius;
      dy = (dy / distance) * radius;
    }
    setKnob({ x: dx, y: dy });
    onChange(dx / radius, dy / radius);
  };

  const onDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    activeRef.current = true;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    update(event.clientX, event.clientY);
  };

  const onMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (activeRef.current) {
      update(event.clientX, event.clientY);
    }
  };

  const release = (): void => {
    activeRef.current = false;
    setKnob({ x: 0, y: 0 });
    onChange(0, 0);
  };

  return (
    <div
      aria-label={label}
      className={`sa-joystick ${className ?? ''}`}
      onPointerCancel={release}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={release}
      ref={baseRef}
      role="slider"
    >
      <span className="sa-joystick__knob" style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }} />
    </div>
  );
}
