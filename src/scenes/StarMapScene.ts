import Phaser from 'phaser';
import { app } from '../app';
import { SYSTEMS, planetById, sectorById, sectorOfPlanet, systemById } from '../core/content';
import { WORLD_H, WORLD_W, planetHold } from '../core/galaxy';
import { masteryBand, planetMastery } from '../core/mastery';
import { callFor, markSeen, sectorCalls } from '../core/story';
import type { Call } from '../core/story';
import type { SystemDef } from '../core/types';
import { IMG, planetImageFor, portraitFor, voiceUrlFor } from '../fx/assets';
import { addBackdrop, addShade } from '../fx/backdrop';
import { GalaxyView } from '../fx/GalaxyView';
import {
  CARD_ANCHORS, MAX_PENDING_CALLS, VIEW_H, VIEW_W, anchorCard, callDelayMs, circleHitsRect, clamp, edgeX, edgeY,
  isDrag, isIntroCall, pickCall, smooth, zoomAt,
} from '../fx/mapLayout';
import { SystemView } from '../fx/SystemView';
import { WarpStreaks } from '../fx/WarpStreaks';
import { CallCard } from '../ui/CallCard';
import { GlyphButton } from '../ui/GlyphButton';
import type { GlyphDraw } from '../ui/GlyphButton';
import { capsStyle, numeralStyle } from '../ui/TextStyles';
import { percentText } from '../ui/format';
import { drawCreditGlyph } from '../ui/hudGlyphs';
import {
  drawChevron, drawGalaxyGlyph, drawHangarGlyph, drawKindGlyph, drawMenuGlyph, drawReportGlyph, drawSystemGlyph,
  kindColor,
} from '../ui/mapGlyphs';
import { cssColor, sectorColors } from '../ui/mapPalette';
import { BAND_COLORS, CSS, DEPTH, LETTER_SPACING, SIZES, SPACING } from '../ui/theme';

type Mode = 'system' | 'galaxy' | 'busy' | 'leaving';

/** Jump across the map, ms. */
const TRAVEL_MS = 1500;
/** Galaxy camera eases from the system out to the whole galaxy, ms. */
const ZOOM_OUT_MS = 950;
const FADE_MS = 420;
const SETTLE_MS = 1000;
/** Zoom of the galaxy camera when it is close to one system (entering / leaving a system). */
const CLOSE_ZOOM = 1.15;
/** Wheel distance (deltaY) of zooming out in the system view that returns to the galaxy. */
const SYSTEM_ZOOM_OUT = 260;
const WHEEL_RATE = 0.0013;
const KEY_ZOOM = 1.25;
const INERTIA_DECAY = 0.9;
const BG_OVERSCAN = 1.14;
const BG_SHIFT_X = 70;
const BG_SHIFT_Y = 40;
const EDGE_INSET = 46;
const EDGE_HIT = 44;
const ANCHOR_CHECK_MS = 300;
const GLYPH_BTN = 30;
const HUD_Y = 30;
/** Minimum time between two bursts of alien chatter on the radio, ms. */
const CHATTER_COOLDOWN_MS = 6000;

interface Press {
  active: boolean;
  dragging: boolean;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  lastT: number;
}

/**
 * The star map: one scene, two views over bg_starmap. The galaxy view (sector clouds, star
 * systems, the ship; drag, wheel, pinch, +/-) and the system view (sun, planets on orbits)
 * where calls arrive one by one and open the call card; GO jumps to the mission.
 * Opens straight in the system view of `save.location`.
 */
export class StarMapScene extends Phaser.Scene {
  private mode: Mode = 'system';
  private galaxy!: GalaxyView;
  private systemView!: SystemView;
  private card!: CallCard;
  private bg: Phaser.GameObjects.Image | null = null;
  private bgScale = 1;
  private bgX = 0;
  private bgY = 0;
  private toggle!: GlyphButton;
  private systemName!: Phaser.GameObjects.Text;
  private sectorName!: Phaser.GameObjects.Text;
  private edge!: Phaser.GameObjects.Graphics;
  private edgeZones: Phaser.GameObjects.Zone[] = [];
  private edgeCalls: Array<Call | null> = [];

  private pending: Call[] = [];
  private delivered = 0;
  private callClock = 0;
  private cardCall: Call | null = null;
  private anchorClock = 0;
  private readonly probe = { x: 0, y: 0, r: 0 };

  private readonly press: Press = { active: false, dragging: false, startX: 0, startY: 0, lastX: 0, lastY: 0, lastT: 0 };
  private velX = 0;
  private velY = 0;
  private pinchDist = 0;
  private systemZoomOut = 0;
  private camTween: Phaser.Tweens.Tween | null = null;
  private warp: WarpStreaks | null = null;
  private hoverCursor = false;
  private lastChatter = -Infinity;

  private readonly onKeyDown = (ev: KeyboardEvent): void => this.handleKey(ev);

  constructor() {
    super('StarMap');
  }

  create(): void {
    this.mode = 'system';
    this.pending = [];
    this.delivered = 0;
    this.callClock = 0;
    this.cardCall = null;
    this.anchorClock = 0;
    this.press.active = false;
    this.press.dragging = false;
    this.velX = 0;
    this.velY = 0;
    this.pinchDist = 0;
    this.systemZoomOut = 0;
    this.camTween = null;
    this.warp = null;
    this.hoverCursor = false;
    this.lastChatter = -Infinity;
    this.edgeZones = [];
    this.edgeCalls = [];

    this.createBackground();
    this.galaxy = new GalaxyView(this);
    this.galaxy.setSectorNames((key) => app.i18n.t(key));
    this.galaxy.root.setVisible(false);
    this.systemView = new SystemView(this);
    this.edge = this.add.graphics().setDepth(DEPTH.hud - 1);
    for (let i = 0; i < MAX_PENDING_CALLS; i++) {
      const zone = this.add.zone(0, 0, EDGE_HIT, EDGE_HIT).setDepth(DEPTH.hud - 1).setInteractive({ useHandCursor: true });
      zone.on(Phaser.Input.Events.POINTER_UP, () => {
        const call = this.edgeCalls[i];
        if (call && this.mode === 'system') this.openCard(call);
      });
      zone.setVisible(false).disableInteractive();
      this.edgeZones.push(zone);
      this.edgeCalls.push(null);
    }
    this.createHud();
    this.card = new CallCard(this, () => {
      if (this.cardCall) this.go(this.cardCall);
    });

    this.input.on(Phaser.Input.Events.POINTER_DOWN, this.onPointerDown, this);
    this.input.on(Phaser.Input.Events.POINTER_MOVE, this.onPointerMove, this);
    this.input.on(Phaser.Input.Events.POINTER_UP, this.onPointerUp, this);
    this.input.on(Phaser.Input.Events.POINTER_WHEEL, this.onWheel, this);
    window.addEventListener('keydown', this.onKeyDown);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      window.removeEventListener('keydown', this.onKeyDown);
      this.input.off(Phaser.Input.Events.POINTER_DOWN, this.onPointerDown, this);
      this.input.off(Phaser.Input.Events.POINTER_MOVE, this.onPointerMove, this);
      this.input.off(Phaser.Input.Events.POINTER_UP, this.onPointerUp, this);
      this.input.off(Phaser.Input.Events.POINTER_WHEEL, this.onWheel, this);
      this.setHoverCursor(false);
      this.card.silence();
      this.warp?.destroy();
      this.warp = null;
      this.camTween = null;
    });

    app.sfx.startAmbience('map');
    this.cameras.main.fadeIn(350);
    this.enterSystem(this.currentSystem(), true);
  }

  update(time: number, delta: number): void {
    const dt = Math.min(delta, 100);
    this.updateInertia(dt);
    this.updateBackground(time, dt);
    this.galaxy.update(time, dt);
    this.systemView.update(time, dt);
    this.warp?.update(dt);

    if (this.systemZoomOut > 0) {
      this.systemZoomOut *= Math.exp(-dt / 500);
      if (this.mode === 'system') this.systemView.root.setScale(1 - 0.12 * (this.systemZoomOut / SYSTEM_ZOOM_OUT));
    }

    if (this.mode === 'system' && !this.card.isOpen && this.pending.length < MAX_PENDING_CALLS) {
      this.callClock -= dt;
      if (this.callClock <= 0) this.deliverCall();
    }
    if (this.card.isOpen) {
      this.anchorClock -= dt;
      if (this.anchorClock <= 0) {
        this.anchorClock = ANCHOR_CHECK_MS;
        this.keepCardClear();
      }
    }
    this.drawEdgeMarkers(time);
  }

  // ------------------------------------------------------------------ views

  private currentSystem(): SystemDef {
    return systemById(app.save.location.systemId) ?? SYSTEMS[0];
  }

  /** Shows the system view of `system`; `settle` plays the gentle arrival (scene entry, after a jump). */
  private enterSystem(system: SystemDef, settle: boolean): void {
    const now = app.now();
    this.mode = 'system';
    this.galaxy.setLocation(system.id);
    if (this.systemView.systemId !== system.id) this.systemView.show(system, app.save.stats, now);
    else this.systemView.refresh(app.save.stats, now);
    this.systemView.setCalls(this.pending);
    this.toggle.setGlyph(drawGalaxyGlyph);
    this.setHoverCursor(false);
    this.galaxy.setHover(-1);

    const sector = sectorById(system.sectorId);
    this.systemName.setText(system.name.toUpperCase()).setVisible(true);
    this.sectorName.setText(sector ? app.i18n.t(sector.nameKey).toUpperCase() : '').setVisible(true)
      .setColor(sector ? cssColor(sectorColors(sector.hue).label) : CSS.textDim);

    const root = this.systemView.root.setVisible(true);
    this.systemZoomOut = 0;
    if (settle) {
      root.setAlpha(0).setScale(1.07);
      this.tweens.add({ targets: root, alpha: 1, scale: 1, duration: SETTLE_MS, ease: 'Cubic.easeOut' });
    } else {
      root.setAlpha(1).setScale(1);
    }
    if (this.galaxy.root.visible) {
      this.tweens.add({
        targets: this.galaxy.root, alpha: 0, duration: FADE_MS, ease: 'Quad.easeOut',
        onComplete: () => { if (this.mode === 'system') this.galaxy.root.setVisible(false); },
      });
    }
    // The first call of a visit arrives shortly after entering.
    this.delivered = 0;
    this.callClock = callDelayMs(0, 0);
  }

  /** Switches to the galaxy view around the player's system and eases out to the whole galaxy. */
  private enterGalaxy(zoomOut = true): void {
    if (this.mode !== 'system') return;
    this.closeCard();
    this.mode = 'galaxy';
    const now = app.now();
    const g = this.galaxy;
    g.refreshTerritory(app.save.stats, now);
    const i = g.systemIndex(app.save.location.systemId);
    g.setView(g.systemX(i), g.systemY(i), CLOSE_ZOOM);
    g.root.setVisible(true).setAlpha(0);
    this.tweens.killTweensOf(g.root);
    this.tweens.add({ targets: g.root, alpha: 1, duration: FADE_MS, ease: 'Quad.easeOut' });
    const root = this.systemView.root;
    this.tweens.killTweensOf(root);
    this.tweens.add({
      targets: root, alpha: 0, scale: 0.86, duration: FADE_MS, ease: 'Quad.easeIn',
      onComplete: () => { if (this.mode !== 'system') root.setVisible(false); },
    });
    this.toggle.setGlyph(drawSystemGlyph);
    this.systemName.setVisible(false);
    this.sectorName.setVisible(false);
    if (zoomOut) this.animateCamera(g.fit.cx, g.fit.cy, g.fit.zoom, ZOOM_OUT_MS);
  }

  /** From the galaxy view back into the player's current system (no jump). */
  private returnToSystem(): void {
    if (this.mode !== 'galaxy') return;
    const g = this.galaxy;
    const i = g.systemIndex(app.save.location.systemId);
    this.mode = 'busy';
    this.animateCamera(g.systemX(i), g.systemY(i), CLOSE_ZOOM, 520, () => this.enterSystem(this.currentSystem(), true));
  }

  /** Eases the galaxy camera to a centre and zoom; user input on the map cancels it. */
  private animateCamera(cx: number, cy: number, zoom: number, duration: number, onComplete?: () => void): void {
    this.stopCamera();
    const v = this.galaxy.view;
    const from = { cx: v.cx, cy: v.cy, zoom: v.zoom };
    const anim = { p: 0 };
    this.camTween = this.tweens.add({
      targets: anim, p: 1, duration, ease: 'Linear',
      onUpdate: () => {
        const k = smooth(anim.p);
        // Interpolate zoom geometrically so the motion feels even at every scale.
        this.galaxy.setView(from.cx + (cx - from.cx) * k, from.cy + (cy - from.cy) * k,
          from.zoom * Math.pow(zoom / from.zoom, k));
      },
      onComplete: () => {
        this.camTween = null;
        onComplete?.();
      },
    });
  }

  private stopCamera(): void {
    if (this.camTween) {
      this.camTween.stop();
      this.camTween = null;
    }
  }

  /**
   * The jump across the map: the ship turns toward the target, warp streaks swell over the
   * map while the camera flies there, then the location is saved and `onArrive` runs.
   */
  private travelTo(systemIndex: number, onArrive: () => void): void {
    const g = this.galaxy;
    const target = SYSTEMS[systemIndex];
    this.mode = 'busy';
    this.stopCamera();
    this.velX = 0;
    this.velY = 0;
    g.setHover(-1);
    this.setHoverCursor(false);
    const fromX = g.shipX;
    const fromY = g.shipY;
    const toX = target.x;
    const toY = target.y;
    const v = g.view;
    const start = { cx: v.cx, cy: v.cy, zoom: v.zoom };
    const endZoom = CLOSE_ZOOM;
    const heading = Math.atan2(toY - fromY, toX - fromX) + Math.PI / 2;
    const startHeading = g.shipHeading;
    const turn = Phaser.Math.Angle.Wrap(heading - startHeading);
    this.warp = new WarpStreaks(this, { count: 240, depth: DEPTH.fx, seed: 'map-jump' });
    this.warp.setAlpha(0);
    app.sfx.ftlCharge(TRAVEL_MS / 1000);
    const anim = { p: 0 };
    this.tweens.add({
      targets: anim, p: 1, duration: TRAVEL_MS, ease: 'Linear',
      onUpdate: () => {
        const p = anim.p;
        const k = smooth(p);
        const dip = 1 - 0.3 * Math.sin(Math.PI * p);
        g.shipFlight = Math.min(1, p * 5);
        g.shipHeading = startHeading + turn * smooth(p / 0.18);
        g.shipX = fromX + (toX - fromX) * smooth((p - 0.1) / 0.85);
        g.shipY = fromY + (toY - fromY) * smooth((p - 0.1) / 0.85);
        g.setView(start.cx + (toX - start.cx) * k, start.cy + (toY - start.cy) * k,
          start.zoom * Math.pow(endZoom / start.zoom, k) * dip);
        const w = Math.sin(Math.PI * p);
        this.warp?.setIntensity(0.62 * w * w).setAlpha(Math.min(1, w * 1.6) * 0.75);
      },
      onComplete: () => {
        this.warp?.destroy();
        this.warp = null;
        app.sfx.ftlDrop();
        if (target.id !== app.save.location.systemId) {
          app.save = { ...app.save, location: { sectorId: target.sectorId, systemId: target.id } };
          app.persist();
          this.pending = [];
          this.closeCard();
        }
        g.setLocation(target.id);
        onArrive();
      },
    });
  }

  // ------------------------------------------------------------------ calls

  private deliverCall(): void {
    this.delivered++;
    this.callClock = callDelayMs(this.delivered, Math.random());
    const system = this.currentSystem();
    const now = app.now();
    const calls = sectorCalls(app.save.location.sectorId, app.save, now, MAX_PENDING_CALLS);
    let call = pickCall(calls, this.pending, system.planets.map((p) => p.id));
    if (!call) return;
    // The first call heard in a skill carries its intro, even when it is not the sector's first call.
    const skill = sectorOfPlanet(call.planetId)?.skill;
    if (skill && !app.save.story.seen.includes(skill) && !isIntroCall(call) && !this.pending.some(isIntroCall)) {
      call = callFor(call.planetId, app.save, now);
    }
    this.pending.push(call);
    this.systemView.setCalls(this.pending);
    if (call.kind === 'defend') app.sfx.alarm();
    this.openCard(call);
  }

  private openCard(call: Call): void {
    const planet = planetById(call.planetId);
    if (!planet) return;
    const { t } = app.i18n;
    const m = planetMastery(planet.id, app.save.stats);
    let x: number;
    let y: number;
    let r: number;
    if (this.systemView.planetScreen(planet.id, this.probe) || this.edgePoint(planet.id, this.probe)) {
      ({ x, y, r } = this.probe);
    } else {
      x = VIEW_W / 2;
      y = VIEW_H / 2;
      r = 0;
    }
    this.cardCall = call;
    this.systemView.setFocus(planet.id);
    app.sfx.radioChirp();
    // Now and then the Static can be heard on the channel of a planet it holds.
    const nowMs = this.time.now;
    if (planetHold(planet.id, app.save.stats) === 'hostile' && nowMs - this.lastChatter > CHATTER_COOLDOWN_MS
        && Math.random() < 0.5) {
      this.lastChatter = nowMs;
      app.sfx.alienChatter(undefined, 0.4);
    }
    this.anchorClock = ANCHOR_CHECK_MS;
    this.card.open({
      kind: call.kind,
      portrait: portraitFor(call.sender),
      sender: t(`story.sender.${call.sender}`),
      message: t(call.storyKey, call.params),
      planetTexture: planetImageFor(planet.id),
      planetName: planet.name,
      mastery: m,
      masteryText: percentText(app.i18n, m),
      masteryColor: BAND_COLORS[masteryBand(m)],
      goLabel: t('meta.starmap.go'),
      voiceUrls: voiceUrlFor(call.storyKey, app.i18n.locale),
      volume: app.save.settings.sfxVolume,
    }, CARD_ANCHORS[anchorCard(x, y, r)]);
  }

  private closeCard(): void {
    this.card.close();
    this.cardCall = null;
    this.systemView.setFocus(null);
  }

  /** Moves the open card to another corner when its planet drifts underneath it. */
  private keepCardClear(): void {
    const rect = this.card.rect;
    if (!rect || !this.cardCall || !this.systemView.planetScreen(this.cardCall.planetId, this.probe)) return;
    const { x, y, r } = this.probe;
    if (circleHitsRect(rect, x, y, r)) this.card.slideTo(CARD_ANCHORS[anchorCard(x, y, r)]);
  }

  /** GO: marks a skill intro as seen, jumps to another system of the sector if needed, then the FTL jump. */
  private go(call: Call): void {
    if (this.mode !== 'system') return;
    const planet = planetById(call.planetId);
    if (!planet) return;
    if (isIntroCall(call)) {
      const skill = sectorOfPlanet(planet.id)?.skill;
      if (skill) {
        app.save = markSeen(app.save, skill);
        app.persist();
      }
    }
    this.closeCard();
    if (planet.systemId === app.save.location.systemId) {
      this.launch(planet.id);
      return;
    }
    const target = this.galaxy.systemIndex(planet.systemId);
    this.enterGalaxy(false);
    this.mode = 'busy';
    this.time.delayedCall(FADE_MS * 0.6, () => this.travelTo(target, () => this.launch(planet.id)));
  }

  private launch(planetId: string): void {
    this.mode = 'leaving';
    this.closeCard();
    this.cameras.main.fadeOut(260, 0, 0, 0);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      this.scene.start('Ftl', { planetId });
    });
  }

  // ------------------------------------------------------------------ input

  private onPointerDown(pointer: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]): void {
    if (over.length > 0 || (this.mode !== 'galaxy' && this.mode !== 'system')) return;
    // Grabbing the map stops the automatic zoom-out (it has no follow-up action in this mode).
    if (this.mode === 'galaxy') this.stopCamera();
    this.velX = 0;
    this.velY = 0;
    const p = this.press;
    p.active = true;
    p.dragging = false;
    p.startX = p.lastX = pointer.x;
    p.startY = p.lastY = pointer.y;
    p.lastT = this.time.now;
  }

  private onPointerMove(pointer: Phaser.Input.Pointer): void {
    const p = this.press;
    if (this.pinch()) return;
    if (!p.active || !pointer.isDown) {
      if (this.mode === 'galaxy') {
        const hit = this.galaxy.hitSystem(pointer.x, pointer.y);
        this.galaxy.setHover(hit);
        this.setHoverCursor(hit >= 0);
      } else if (this.mode === 'system') {
        this.setHoverCursor(this.systemView.planetAt(pointer.x, pointer.y) !== null);
      }
      return;
    }
    if (!p.dragging && isDrag(pointer.x - p.startX, pointer.y - p.startY)) p.dragging = true;
    if (!p.dragging || this.mode !== 'galaxy') return;
    const dx = pointer.x - p.lastX;
    const dy = pointer.y - p.lastY;
    const now = this.time.now;
    const dt = Math.max(1, now - p.lastT);
    const v = this.galaxy.view;
    v.cx -= dx / v.zoom;
    v.cy -= dy / v.zoom;
    this.clampGalaxy();
    // Smoothed release velocity in world units per ms.
    this.velX = this.velX * 0.6 + (-dx / v.zoom / dt) * 0.4;
    this.velY = this.velY * 0.6 + (-dy / v.zoom / dt) * 0.4;
    p.lastX = pointer.x;
    p.lastY = pointer.y;
    p.lastT = now;
  }

  private onPointerUp(pointer: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]): void {
    const p = this.press;
    const wasPress = p.active;
    p.active = false;
    if (this.pinchDist > 0) {
      this.pinchDist = 0;
      this.velX = 0;
      this.velY = 0;
      return;
    }
    if (!wasPress) return;
    if (p.dragging) {
      if (this.time.now - p.lastT > 90) {
        this.velX = 0;
        this.velY = 0;
      }
      return;
    }
    this.velX = 0;
    this.velY = 0;
    if (over.length > 0) return;
    if (this.mode === 'galaxy') {
      const hit = this.galaxy.hitSystem(pointer.x, pointer.y);
      if (hit >= 0) this.onSystemClicked(hit);
    } else if (this.mode === 'system') {
      const planetId = this.systemView.planetAt(pointer.x, pointer.y);
      if (planetId) {
        this.openCard(this.pending.find((c) => c.planetId === planetId) ?? callFor(planetId, app.save, app.now()));
      }
    }
  }

  private onWheel(pointer: Phaser.Input.Pointer, _over: Phaser.GameObjects.GameObject[], _dx: number, dy: number): void {
    if (dy === 0) return;
    if (this.mode === 'galaxy') {
      this.stopCamera();
      this.zoomGalaxy(Math.exp(-dy * WHEEL_RATE), pointer.x, pointer.y);
    } else if (this.mode === 'system') {
      this.zoomOutSystem(dy);
    }
  }

  /** Two-finger pinch: zooms the galaxy around the fingers' midpoint, or leaves the system view. */
  private pinch(): boolean {
    const a = this.input.pointer1;
    const b = this.input.pointer2;
    if (!a || !b || !a.isDown || !b.isDown) return false;
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    this.press.dragging = true;
    if (this.pinchDist > 0 && d > 0) {
      const ratio = d / this.pinchDist;
      if (this.mode === 'galaxy') this.zoomGalaxy(ratio, (a.x + b.x) / 2, (a.y + b.y) / 2);
      else if (this.mode === 'system' && ratio < 1) this.zoomOutSystem((1 - ratio) * 600);
    }
    this.pinchDist = d;
    return true;
  }

  private zoomGalaxy(factor: number, px: number, py: number): void {
    const g = this.galaxy;
    const zoom = clamp(g.view.zoom * factor, g.minZoom, g.maxZoom);
    const next = zoomAt(g.view, zoom, px, py);
    g.setView(next.cx, next.cy, next.zoom);
    this.clampGalaxy();
  }

  private zoomOutSystem(amount: number): void {
    this.systemZoomOut = Math.max(0, this.systemZoomOut + amount);
    if (this.systemZoomOut >= SYSTEM_ZOOM_OUT) this.enterGalaxy();
  }

  private clampGalaxy(): void {
    const g = this.galaxy;
    const b = g.bounds;
    g.view.cx = clamp(g.view.cx, b.x, b.x + b.w);
    g.view.cy = clamp(g.view.cy, b.y, b.y + b.h);
    g.markDirty();
  }

  private updateInertia(dt: number): void {
    if (this.mode !== 'galaxy' || this.press.active) return;
    if (Math.abs(this.velX) + Math.abs(this.velY) < 0.002) return;
    const v = this.galaxy.view;
    v.cx += this.velX * dt;
    v.cy += this.velY * dt;
    const decay = Math.pow(INERTIA_DECAY, dt / 16.7);
    this.velX *= decay;
    this.velY *= decay;
    this.clampGalaxy();
  }

  private onSystemClicked(index: number): void {
    if (this.mode !== 'galaxy') return;
    app.sfx.click();
    const target = SYSTEMS[index];
    if (target.id === app.save.location.systemId) {
      this.returnToSystem();
      return;
    }
    this.travelTo(index, () => this.enterSystem(target, true));
  }

  private handleKey(ev: KeyboardEvent): void {
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    const key = ev.key;
    if (key === 'Enter' || key === ' ' || ev.code === 'Space' || ev.code === 'NumpadEnter') {
      if (this.card.isOpen && this.mode === 'system') {
        ev.preventDefault();
        if (!ev.repeat) this.card.go();
      }
      return;
    }
    if (ev.repeat && key === 'Escape') return;
    if (key === 'Escape') {
      if (this.card.isOpen) this.closeCard();
      else if (this.mode === 'system') this.enterGalaxy();
      else if (this.mode === 'galaxy') this.returnToSystem();
      return;
    }
    const zoomIn = key === '+' || key === '=' || ev.code === 'NumpadAdd';
    const zoomOut = key === '-' || key === '_' || ev.code === 'NumpadSubtract';
    if (!zoomIn && !zoomOut) return;
    ev.preventDefault();
    if (this.mode === 'galaxy') {
      this.stopCamera();
      this.zoomGalaxy(zoomIn ? KEY_ZOOM : 1 / KEY_ZOOM, VIEW_W / 2, VIEW_H / 2);
    } else if (this.mode === 'system' && zoomOut && !ev.repeat) {
      this.enterGalaxy();
    }
  }

  private setHoverCursor(on: boolean): void {
    if (on === this.hoverCursor) return;
    this.hoverCursor = on;
    this.input.setDefaultCursor(on ? 'pointer' : 'default');
  }

  // ------------------------------------------------------------------ backdrop and HUD

  private createBackground(): void {
    this.bg = addBackdrop(this, IMG.bg.starmap, { overscan: BG_OVERSCAN });
    if (this.bg) {
      this.bgScale = this.bg.scale;
      this.bgX = this.bg.x;
      this.bgY = this.bg.y;
    }
    addShade(this, 0.3);
  }

  /** Slow parallax: the backdrop follows the galaxy camera a little, and drifts in the system view. */
  private updateBackground(time: number, dt: number): void {
    const bg = this.bg;
    if (!bg) return;
    let tx = VIEW_W / 2 + Math.sin(time / 47000) * 8;
    let ty = VIEW_H / 2 + Math.cos(time / 61000) * 5;
    let ts = this.bgScale;
    if (this.mode !== 'system') {
      const v = this.galaxy.view;
      tx = VIEW_W / 2 - ((v.cx - WORLD_W / 2) / WORLD_W) * BG_SHIFT_X;
      ty = VIEW_H / 2 - ((v.cy - WORLD_H / 2) / WORLD_H) * BG_SHIFT_Y;
      ts = this.bgScale * (1 + 0.03 * clamp((v.zoom - this.galaxy.fit.zoom) / (this.galaxy.maxZoom - this.galaxy.fit.zoom), -0.5, 1));
    }
    const k = Math.min(1, dt * 0.004);
    this.bgX += (tx - this.bgX) * k;
    this.bgY += (ty - this.bgY) * k;
    bg.setPosition(this.bgX, this.bgY).setScale(bg.scale + (ts - bg.scale) * k);
  }

  private createHud(): void {
    const g = this.add.graphics().setDepth(DEPTH.hud);
    drawCreditGlyph(g, SPACING.l + 7, HUD_Y, 14);
    this.add.text(SPACING.l + 22, HUD_Y, String(app.save.credits), numeralStyle({ fontSize: `${SIZES.heading}px`, color: CSS.primary }))
      .setOrigin(0, 0.5).setDepth(DEPTH.hud);
    this.systemName = this.add.text(SPACING.l, HUD_Y + 30, '', capsStyle({
      fontSize: `${SIZES.label}px`, color: CSS.text, letterSpacing: LETTER_SPACING.caps + 1,
    })).setOrigin(0, 0.5).setDepth(DEPTH.hud).setAlpha(0.85);
    this.sectorName = this.add.text(SPACING.l, HUD_Y + 47, '', capsStyle({
      fontSize: `${SIZES.small}px`, color: CSS.textDim, letterSpacing: LETTER_SPACING.caps,
    })).setOrigin(0, 0.5).setDepth(DEPTH.hud).setAlpha(0.8);

    const step = GLYPH_BTN + 8;
    const right = VIEW_W - SPACING.l - GLYPH_BTN / 2;
    const button = (slot: number, draw: GlyphDraw, onClick: () => void): GlyphButton =>
      new GlyphButton(this, right - slot * step, HUD_Y, GLYPH_BTN, draw, onClick).setDepth(DEPTH.hud);
    button(0, drawMenuGlyph, () => this.leaveTo('Menu'));
    button(1, drawReportGlyph, () => this.leaveTo('Mastery', { from: 'StarMap' }));
    button(2, drawHangarGlyph, () => this.leaveTo('Station'));
    this.toggle = button(3, drawGalaxyGlyph, () => {
      if (this.mode === 'system') this.enterGalaxy();
      else if (this.mode === 'galaxy') this.returnToSystem();
    });
  }

  private leaveTo(key: 'Menu' | 'Mastery' | 'Station', data?: object): void {
    if (this.mode === 'busy' || this.mode === 'leaving') return;
    this.mode = 'leaving';
    this.scene.start(key, data);
  }

  /** Where the edge marker of a planet in another system of the sector sits; false for this system's planets. */
  private edgePoint(planetId: string, out: { x: number; y: number; r: number }): boolean {
    const planet = planetById(planetId);
    const sys = planet ? systemById(planet.systemId) : undefined;
    const here = this.currentSystem();
    if (!sys || sys.id === here.id) return false;
    const dx = sys.x - here.x;
    const dy = sys.y - here.y;
    const len = Math.hypot(dx, dy) || 1;
    out.x = edgeX(dx / len, dy / len, EDGE_INSET);
    out.y = edgeY(dx / len, dy / len, EDGE_INSET);
    out.r = 48;
    return true;
  }

  /** Blinking arrows at the screen edge for pending calls in other systems of the sector. */
  private drawEdgeMarkers(time: number): void {
    const g = this.edge;
    g.clear();
    const show = this.mode === 'system';
    const blink = Math.sin(time / 170) > -0.2 ? 1 : 0.3;
    let slot = 0;
    for (const call of this.pending) {
      if (!show || slot >= this.edgeZones.length) break;
      if (!this.edgePoint(call.planetId, this.probe)) continue;
      const x = this.probe.x;
      const y = this.probe.y;
      const angle = Math.atan2(y - VIEW_H / 2, x - VIEW_W / 2);
      const color = kindColor(call.kind);
      drawChevron(g, x + Math.cos(angle) * 14, y + Math.sin(angle) * 14, 14, angle, color, blink);
      drawKindGlyph(g, call.kind, x - Math.cos(angle) * 6, y - Math.sin(angle) * 6, 14, color, 0.9);
      const zone = this.edgeZones[slot];
      if (this.edgeCalls[slot] !== call || !zone.visible) {
        zone.setPosition(x, y).setVisible(true).setInteractive({ useHandCursor: true });
        this.edgeCalls[slot] = call;
      }
      slot++;
    }
    for (let i = slot; i < this.edgeZones.length; i++) {
      if (this.edgeZones[i].visible) this.edgeZones[i].setVisible(false).disableInteractive();
      this.edgeCalls[i] = null;
    }
  }
}
