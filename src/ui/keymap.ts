/** Pure mapping from a keyboard event to a battle input action. No Phaser, no DOM access. */

export interface KeyLike {
  key: string;
  code: string;
  repeat: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}

export type KeyAction =
  | { type: 'digit'; d: number }
  | { type: 'sign' }
  | { type: 'backspace' }
  | { type: 'submit' }
  | { type: 'pause' };

/** The action a key stands for, ignoring repeat and modifiers. */
function baseAction(ev: KeyLike): KeyAction | null {
  const m = /^(?:Digit|Numpad)([0-9])$/.exec(ev.code);
  if (m) return { type: 'digit', d: Number(m[1]) };
  if (/^[0-9]$/.test(ev.key)) return { type: 'digit', d: Number(ev.key) };
  if (ev.key === '-' || ev.code === 'NumpadSubtract') return { type: 'sign' };
  if (ev.key === 'Backspace') return { type: 'backspace' };
  if (ev.key === 'Enter' || ev.code === 'NumpadEnter' || ev.code === 'Space' || ev.key === ' ') return { type: 'submit' };
  if (ev.key === 'Escape' || ev.code === 'KeyP') return { type: 'pause' };
  return null;
}

const hasModifier = (ev: KeyLike): boolean => ev.ctrlKey || ev.metaKey || ev.altKey;

/** True when the game consumes this key (so the caller should preventDefault), repeats included. */
export function isGameKey(ev: KeyLike): boolean {
  return !hasModifier(ev) && baseAction(ev) !== null;
}

/**
 * The action to perform for one keydown, or null. Keys with Ctrl/Meta/Alt are ignored so
 * browser shortcuts keep working; auto-repeat only repeats Backspace.
 */
export function keyAction(ev: KeyLike): KeyAction | null {
  if (hasModifier(ev)) return null;
  const action = baseAction(ev);
  if (!action) return null;
  if (ev.repeat && action.type !== 'backspace') return null;
  return action;
}
