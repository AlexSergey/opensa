/**
 * Pure menu-list selection, split from `game-config.tsx` so it can be unit-tested without evaluating the
 * JSX disclaimers in the config. Drops `devOnly` games outside dev — production builds expose only the
 * always-on titles. See {@link import('./game-config').GAME_IDS}.
 */
export function selectGameIds<Id extends string>(config: Record<Id, { devOnly?: boolean }>, isDev: boolean): Id[] {
  return (Object.keys(config) as Id[]).filter((id) => isDev || !config[id].devOnly);
}
