/**
 * UI in the DOM, not in WebGL. Text rendered by the browser is crisper than
 * anything you will hand-roll in a canvas texture, it costs no draw calls, and
 * it is inspectable in devtools.
 *
 * Two rules that come from capture reproducibility:
 *  1. NO `will-change: transform` / `transform: translateZ(0)` on anything that
 *     animates. It promotes the element to a composited layer whose raster is
 *     taken at a wall-clock-dependent moment, and the reference project spent
 *     real time chasing that as a "renderer" nondeterminism.
 *  2. Animate off the engine clock like everything else. A CSS animation or
 *     transition is on the browser's clock, so its phase at the shutter depends
 *     on how long boot took.
 */
import { TouchControls } from '../../lib/index.js';

export class UiSystem {
  static id = 'ui';
  static deps = [];

  async init(ctx) {
    this.ctx = ctx;
    /**
     * A DIAGNOSTIC OVERLAY WILL DEFEAT YOUR OWN PIXEL GATE. This example printed
     * the live WebGL program count in the corner; the pixel gate then reported
     * every shot as changed when shader pre-warm was toggled — not because the
     * render moved, but because the number on screen did. The diff's bounding box
     * was a 7x9 px digit at the bottom-left, which is how it was identified in
     * one look.
     *
     * So: volatile diagnostics (fps, program counts, timings, entity counts) are
     * for the live window only. The HUD a reviewer captures shows game state,
     * which is deterministic.
     */
    this.showDiagnostics = !ctx.config.deterministic;
    this.host = document.getElementById('ui') ?? document.body;
    this.host.innerHTML = `
      <div data-hud style="position:absolute;left:16px;bottom:14px;opacity:.9">
        <div data-state style="font-size:14px;letter-spacing:.06em"></div>
        <div data-stats style="opacity:.6;margin-top:4px"></div>
      </div>
      <div data-crosshair style="position:absolute;left:50%;top:50%;width:14px;height:14px;
        margin:-7px 0 0 -7px;border:1px solid rgba(255,255,255,.75);border-radius:50%"></div>
      <div data-hit style="position:absolute;left:50%;top:50%;width:26px;height:26px;
        margin:-13px 0 0 -13px;opacity:0;border:2px solid #fff;transform:rotate(45deg)"></div>
    `;
    this.stats = this.host.querySelector('[data-stats]');
    this.state = this.host.querySelector('[data-state]');
    this.hit = this.host.querySelector('[data-hit]');
    this.shots = 0;
    ctx.events.on('weapon:fire', () => this.shots++);
    this.hitUntil = -1;
    this.mode = 'clean';
    ctx.events.on('bullet:impact', () => {
      this.hitUntil = ctx.time.elapsed + 0.12;
    });

    /**
     * On-screen controls, hidden until a real finger touches the screen — so a
     * headless capture never sees them and the pixel gate is unaffected. The
     * left of the screen is already a movement stick and the right already
     * looks; these are for the actions a thumb cannot express as a drag.
     */
    this.touch = new TouchControls(ctx.input, {
      host: this.host,
      buttons: [{ action: 'jump', label: 'JUMP' }, { action: 'primary', label: 'FIRE' }],
    }).attach();
  }

  /** Debug hook so the `hud` shot can capture the busiest state. */
  debugState(mode) {
    this.mode = mode;
    if (mode === 'busy') this.hitUntil = Infinity;
    if (mode === 'clean') this.hitUntil = -1;
    return { mode };
  }

  lateUpdate(dt, ctx) {
    // Throttle DOM writes: a text update every frame is a layout every frame.
    if (ctx.time.frame % 6 === 0) {
      // Game state: deterministic, safe to capture.
      this.state.textContent = `HEALTH 100    AMMO ${Math.max(0, 30 - (this.shots % 31))}/120` + (this.mode === 'busy' ? '    [BUSY]' : '');
      if (this.showDiagnostics) {
        const info = window.__RENDER_INFO__;
        const fx = ctx.peek('fx');
        this.stats.textContent =
          `frame ${ctx.time.frame}  ${(1 / Math.max(1e-4, ctx.time.dt)).toFixed(0)} fps  ` +
          `calls ${info?.calls ?? 0}  tris ${((info?.tris ?? 0) / 1000).toFixed(0)}k  ` +
          `progs ${info?.programs ?? 0}  particles ${fx?.stats.live ?? 0}`;
      }
    }
    this.hit.style.opacity = ctx.time.elapsed < this.hitUntil ? '0.9' : '0';
    this.touch.sync();
  }

  dispose() {
    this.touch.dispose();
    this.host.innerHTML = '';
  }
}
