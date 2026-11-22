import Phaser from 'phaser';
import { Button } from './Button';

export interface HitZoneOptions {
  /** Play the shared button click sound on tap. Default true. */
  sound?: boolean;
}

/**
 * Invisible tappable rectangle centred on (x, y). Fires on release after a press that started on
 * it, like Button. Returns the zone so the caller can add it to a container.
 */
export function addHitZone(
  scene: Phaser.Scene, x: number, y: number, w: number, h: number, onTap: () => void, opts: HitZoneOptions = {},
): Phaser.GameObjects.Zone {
  const zone = scene.add.zone(x, y, w, h).setInteractive({ useHandCursor: true });
  let pressed = false;
  zone.on(Phaser.Input.Events.POINTER_DOWN, () => { pressed = true; });
  zone.on(Phaser.Input.Events.POINTER_OUT, () => { pressed = false; });
  zone.on(Phaser.Input.Events.POINTER_UP, () => {
    if (!pressed) return;
    pressed = false;
    if (opts.sound ?? true) Button.clickSound?.();
    onTap();
  });
  return zone;
}
