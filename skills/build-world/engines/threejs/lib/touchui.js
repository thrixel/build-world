/**
 * On-screen controls for phones: a floating stick indicator and a cluster of
 * action buttons, both wired into the same `Input` snapshot the keyboard feeds.
 *
 * Why this is in the kit rather than left to each game: touch INPUT without
 * touch UI is a game that is technically playable and looks broken. A player
 * who opens a shared link on a phone sees a 3D scene and no controls, tries a
 * tap, and leaves. The single most common mobile failure is not a dead input
 * layer, it is an invisible one.
 *
 * Two rules inherited from the capture harness:
 *  - This layer stays hidden until `input.touchActive`, so a headless capture
 *    (no touch events, ever) is pixel-identical to one taken before this file
 *    existed. `alwaysShow: true` is a debugging aid and WILL move pixels.
 *  - No CSS transitions or animations. Same reason as the HUD: they run on the
 *    browser's clock, not the engine's. Opacity is set, not eased.
 */

const BUTTON_PX = 68; // >= 44 is the accessibility floor; a thumb wants more

/** Standing back from the very edge: phone screens curve, and iOS reserves the
 *  bottom strip for the home indicator. `env(safe-area-inset-*)` needs
 *  `viewport-fit=cover` in the viewport meta tag to be non-zero. */
const EDGE = 'calc(22px + env(safe-area-inset-bottom, 0px))';

export class TouchControls {
  /**
   * @param {import('./input.js').Input} input
   * @param {object} [opts]
   * @param {HTMLElement} [opts.host] where to mount (default: #ui, else body)
   * @param {Array<{action: string, label: string}>} [opts.buttons] right-hand
   *   cluster, listed bottom-first. Keep it to three or fewer: every button is
   *   screen a thumb covers.
   * @param {boolean} [opts.stick] draw the floating stick indicator
   * @param {boolean} [opts.alwaysShow] show on desktop too (debugging only)
   */
  constructor(input, { host = null, buttons = [], stick = true, alwaysShow = false } = {}) {
    this.input = input;
    this.buttons = buttons;
    this.showStick = stick;
    this.alwaysShow = alwaysShow;
    this.host = host ?? document.getElementById('ui') ?? document.body;
    this.root = null;
    this._offs = [];
    this._visible = null;
  }

  attach() {
    const root = document.createElement('div');
    root.dataset.touchControls = '';
    // pointer-events: none on the layer, auto on the buttons — otherwise this
    // covers the canvas and swallows every look-drag.
    // `visibility:hidden`, not just `opacity:0`: an invisible button with
    // pointer-events still swallows clicks, so a desktop player would find a
    // dead zone in the bottom-right corner of the screen. Visibility removes
    // the subtree from hit-testing as well as from the picture.
    root.style.cssText =
      'position:fixed;inset:0;pointer-events:none;z-index:20;' +
      '-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent;' +
      'opacity:0;visibility:hidden';

    if (this.showStick) {
      this.stickRing = document.createElement('div');
      this.stickRing.style.cssText =
        'position:absolute;left:0;top:0;border-radius:50%;border:2px solid rgba(255,255,255,.35);' +
        'background:rgba(255,255,255,.06);display:none';
      this.stickNub = document.createElement('div');
      this.stickNub.style.cssText =
        'position:absolute;left:0;top:0;width:52px;height:52px;margin:-26px 0 0 -26px;border-radius:50%;' +
        'background:rgba(255,255,255,.5);display:none';
      root.append(this.stickRing, this.stickNub);
    }

    const cluster = document.createElement('div');
    cluster.style.cssText =
      `position:absolute;right:calc(22px + env(safe-area-inset-right, 0px));bottom:${EDGE};` +
      'display:flex;flex-direction:column-reverse;gap:14px;align-items:center';
    for (const { action, label } of this.buttons) {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.action = action;
      b.textContent = label;
      b.style.cssText =
        `width:${BUTTON_PX}px;height:${BUTTON_PX}px;border-radius:50%;pointer-events:auto;` +
        'border:2px solid rgba(255,255,255,.4);background:rgba(12,16,22,.45);color:#eef2f6;' +
        'font:600 13px/1 ui-sans-serif,system-ui,sans-serif;letter-spacing:.06em;' +
        '-webkit-tap-highlight-color:transparent;touch-action:none';
      this._offs.push(this.input.bindButton(b, action));
      cluster.appendChild(b);
    }
    root.appendChild(cluster);

    this.host.appendChild(root);
    this.root = root;
    return this;
  }

  /**
   * Call once per frame from your UI system's lateUpdate. Cheap: it writes to
   * the DOM only when something actually changed.
   */
  sync() {
    if (!this.root) return;
    const visible = this.alwaysShow || this.input.touchActive;
    if (visible !== this._visible) {
      this.root.style.opacity = visible ? '1' : '0';
      this.root.style.visibility = visible ? 'visible' : 'hidden';
      this._visible = visible;
    }
    if (!this.showStick) return;
    const s = visible ? this.input.stickState : null;
    if (!s) {
      if (this.stickRing.style.display !== 'none') {
        this.stickRing.style.display = 'none';
        this.stickNub.style.display = 'none';
      }
      return;
    }
    const d = s.radius * 2;
    this.stickRing.style.display = 'block';
    this.stickNub.style.display = 'block';
    this.stickRing.style.width = this.stickRing.style.height = `${d}px`;
    this.stickRing.style.transform =
      `translate(${s.originX - s.radius}px, ${s.originY - s.radius}px)`;
    this.stickNub.style.transform =
      `translate(${s.originX + s.x * s.radius}px, ${s.originY + s.y * s.radius}px)`;
  }

  dispose() {
    for (const off of this._offs) off();
    this._offs.length = 0;
    this.root?.remove();
    this.root = null;
  }
}
