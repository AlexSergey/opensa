/** Game input (plan 055): a device-agnostic {@link InputState} the systems read, fed by pluggable sources. */
export { CombinedInput } from './combine-input';
export type { Action, InputState, LookDelta, MoveVector } from './input-state';
export { Keyboard, type KeyboardInput } from './keyboard/keyboard';
export { KeyboardSource } from './keyboard/keyboard-source';
export { PointerLookSource } from './pointer/pointer-look-source';
export { TouchInputSource } from './touch/touch-input-source';
