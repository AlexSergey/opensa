import type { ReactElement } from 'react';

// Inlined so CSS can target the wordmark/subtitle path classes (logo-opensa-title/description).
import logoMarkup from '../../assets/logo.svg?raw';

interface LogoProps {
  /** Modifier classes driving the intro animation (e.g. `sa-logo--pulse sa-logo--small`). */
  className?: string;
}

export function Logo({ className }: LogoProps): ReactElement {
  return (
    <div
      className={className ? `sa-logo ${className}` : 'sa-logo'}
      // eslint-disable-next-line @eslint-react/dom-no-dangerously-set-innerhtml -- static local asset, inlined to animate its inner SVG classes
      dangerouslySetInnerHTML={{ __html: logoMarkup }}
    />
  );
}
