import { describe, expect, it } from 'vitest';
import { isGameKey, keyAction } from '../src/ui/keymap';
import type { KeyLike } from '../src/ui/keymap';

const k = (key: string, code: string, extra: Partial<KeyLike> = {}): KeyLike => ({
  key, code, repeat: false, ctrlKey: false, metaKey: false, altKey: false, ...extra,
});

describe('keyAction', () => {
  it('maps top-row digits', () => {
    for (let d = 0; d <= 9; d++) expect(keyAction(k(String(d), `Digit${d}`))).toEqual({ type: 'digit', d });
  });

  it('maps top-row digits by code even when the layout needs Shift (AZERTY)', () => {
    expect(keyAction(k('&', 'Digit1'))).toEqual({ type: 'digit', d: 1 });
  });

  it('maps numpad digits, also without NumLock', () => {
    for (let d = 0; d <= 9; d++) expect(keyAction(k(String(d), `Numpad${d}`))).toEqual({ type: 'digit', d });
    expect(keyAction(k('End', 'Numpad1'))).toEqual({ type: 'digit', d: 1 });
  });

  it('maps minus and numpad minus to sign', () => {
    expect(keyAction(k('-', 'Slash'))).toEqual({ type: 'sign' });   // Croatian layout
    expect(keyAction(k('-', 'Minus'))).toEqual({ type: 'sign' });
    expect(keyAction(k('-', 'NumpadSubtract'))).toEqual({ type: 'sign' });
  });

  it('maps Enter, NumpadEnter and Space to submit', () => {
    expect(keyAction(k('Enter', 'Enter'))).toEqual({ type: 'submit' });
    expect(keyAction(k('Enter', 'NumpadEnter'))).toEqual({ type: 'submit' });
    expect(keyAction(k(' ', 'Space'))).toEqual({ type: 'submit' });
  });

  it('maps Backspace', () => {
    expect(keyAction(k('Backspace', 'Backspace'))).toEqual({ type: 'backspace' });
  });

  it('maps Escape and P to pause', () => {
    expect(keyAction(k('Escape', 'Escape'))).toEqual({ type: 'pause' });
    expect(keyAction(k('p', 'KeyP'))).toEqual({ type: 'pause' });
    expect(keyAction(k('P', 'KeyP'))).toEqual({ type: 'pause' });
  });

  it('ignores repeats except for Backspace', () => {
    const r = { repeat: true };
    expect(keyAction(k('7', 'Digit7', r))).toBeNull();
    expect(keyAction(k('7', 'Numpad7', r))).toBeNull();
    expect(keyAction(k('-', 'Minus', r))).toBeNull();
    expect(keyAction(k('Enter', 'Enter', r))).toBeNull();
    expect(keyAction(k(' ', 'Space', r))).toBeNull();
    expect(keyAction(k('Escape', 'Escape', r))).toBeNull();
    expect(keyAction(k('p', 'KeyP', r))).toBeNull();
    expect(keyAction(k('Backspace', 'Backspace', r))).toEqual({ type: 'backspace' });
  });

  it('ignores keys with Ctrl, Meta or Alt held', () => {
    for (const mod of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }]) {
      expect(keyAction(k('5', 'Digit5', mod))).toBeNull();
      expect(keyAction(k('-', 'Minus', mod))).toBeNull();
      expect(keyAction(k('Backspace', 'Backspace', mod))).toBeNull();
      expect(keyAction(k('Enter', 'Enter', mod))).toBeNull();
      expect(keyAction(k('p', 'KeyP', mod))).toBeNull();
    }
  });

  it('ignores unrelated keys', () => {
    expect(keyAction(k('a', 'KeyA'))).toBeNull();
    expect(keyAction(k('Tab', 'Tab'))).toBeNull();
    expect(keyAction(k('F5', 'F5'))).toBeNull();
  });
});

describe('isGameKey', () => {
  it('is true for consumed keys, repeats included', () => {
    expect(isGameKey(k('5', 'Digit5'))).toBe(true);
    expect(isGameKey(k(' ', 'Space', { repeat: true }))).toBe(true);
    expect(isGameKey(k('Escape', 'Escape'))).toBe(true);
  });

  it('is false with modifiers and for unrelated keys', () => {
    expect(isGameKey(k('r', 'KeyR', { ctrlKey: true }))).toBe(false);
    expect(isGameKey(k('5', 'Digit5', { metaKey: true }))).toBe(false);
    expect(isGameKey(k('a', 'KeyA'))).toBe(false);
  });
});
