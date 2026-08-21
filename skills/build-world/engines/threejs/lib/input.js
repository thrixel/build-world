/**
 * Input aggregation: keyboard, mouse, TOUCH, wheel — exposed as a stable
 * PER-FRAME SNAPSHOT so gameplay never touches a DOM event.
 *
 * Why a snapshot and not listeners in gameplay code:
 *  - a DOM event can fire twice between two frames, or zero times; gameplay that
 *    reads events directly behaves differently at different frame rates
 *  - a capture harness / demo bot can then DRIVE the game by writing into this
 *    object (see tools/smoke.mjs) and everything downstream — state machines,
 *    animation, AI reacting to the player — runs untouched. That is how you get
 *    a scripted playthrough that is really the game being played, rather than a
 *    canned camera path that proves nothing.
 *  - `frozen` gives the shot API one switch to take control away
 *
 * TOUCH FEEDS THE SAME SNAPSHOT, which is the whole design. A thumb on the left
 * of the screen resolves to the same `axis2()` a WASD key does, a drag on the
 * right resolves to the same `look`, and a bound on-screen button resolves to
 * the same `held('jump')`. So gameplay code has no touch branch anywhere: write
 * the game once against actions and it is playable on a phone. Games published
 * to thrixel.world get opened on phones far more often than on desktops, so this
 * is not an accessibility extra — it is most of the audience.
 *
 * Edge queries (`pressed`, `released`) are only valid during the frame the
 * transition happened. Read them in update(), never in fixedUpdate() — a fixed
 * step may run 0 or N times in a frame, so an edge is missed or double-counted.
 */

/** Coarse pointer + no hover = phone or tablet. Not UA sniffing: this asks the
 *  question that actually matters (can this person hover a mouse?) and it stays
 *  right on devices that did not exist when this was written. */
export const isTouchDevice = () =>
  typeof matchMedia === 'function' &&
  matchMedia('(hover: none) and (pointer: coarse)').matches;

/** Beyond this the thumb has slid too far for the press to have been a tap. */
const TAP_SLOP_PX = 12;
/** Longer than this and it was a look-drag or a hold, not a tap. */
const TAP_MS = 260;

export const DEFAULT_ACTIONS = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  jump: ['Space'],
  crouch: ['ControlLeft', 'KeyC'],
  sprint: ['ShiftLeft'],
  use: ['KeyF', 'KeyE'],
  primary: ['Mouse0'],
  secondary: ['Mouse2'],
  reload: ['KeyR'],
  pause: ['Escape'],
};

export class Input {
  /**
   * @param {object} [opts]
   * @param {boolean} [opts.touch] enable the touch layer (default true; it costs
   *   nothing on a desktop because nothing dispatches touch pointers there)
   * @param {number} [opts.touchSensitivity] radians per pixel of thumb drag.
   *   Higher than the mouse figure on purpose: a thumb has perhaps a third of
   *   the travel of a mouse arm and has to cover the same 360 degrees.
   * @param {number} [opts.moveZoneWidth] fraction of the canvas width, measured
   *   from the left edge, that acts as the movement stick. The rest looks.
   * @param {string|null} [opts.tapAction] action fired by a tap in the look
   *   zone. Pass null for a game where a stray tap should not shoot.
   */
  constructor(canvas, {
    actions = DEFAULT_ACTIONS,
    sensitivity = 0.0022,
    pointerLock = true,
    touch = true,
    touchSensitivity = 0.0045,
    moveZoneWidth = 0.45,
    tapAction = 'primary',
  } = {}) {
    this.canvas = canvas;
    this.actions = actions;
    this.sensitivity = sensitivity;
    this.pointerLock = pointerLock;
    this.touchEnabled = touch;
    this.touchSensitivity = touchSensitivity;
    this.moveZoneWidth = moveZoneWidth;
    this.tapAction = tapAction;

    /**
     * True once this session has seen a real touch. Games read it to swap the
     * control hints ("WASD to move" -> nothing), to skip the click-to-lock
     * overlay, and to show on-screen controls. Deliberately NOT the same as
     * `isTouchDevice()`: a laptop with a touchscreen should keep its keyboard
     * hints until someone actually reaches out and touches the screen.
     */
    this.touchActive = false;
    /** Analog movement from the on-screen stick, each axis in [-1, 1]. Merged
     *  into axis2() alongside the keyboard, so gameplay reads one value. */
    this.move = { x: 0, y: 0 };
    this._stick = null;      // { id, ox, oy, x, y, radius }
    this._lookTouch = null;  // { id, x, y, t0, moved }
    this._touchLook = { x: 0, y: 0 };
    this._unbinds = new Map();

    this.down = new Set(); // codes held right now
    this._pressed = new Set(); // went down during this frame
    this._released = new Set(); // went up during this frame
    /**
     * An ORDERED queue of `{ code, down }`, not two sets. Two sets cannot
     * represent both of the things that legitimately happen inside one frame:
     *   - a fast TAP (down then up) must yield a press AND a release, not held
     *   - a RE-PRESS (up then down) must leave the key held
     * With sets you have to pick an order and one of those breaks. Processing all
     * downs before all ups silently swallowed the re-press, which is exactly what
     * a bot driving the game does when it releases the previous case's keys and
     * presses the next case's in the same frame — the key came out NOT held and
     * the run measured zero movement.
     */
    this._queue = [];

    /** Accumulated pointer delta for this frame, in radians after sensitivity. */
    this.look = { x: 0, y: 0 };
    this._rawLook = { x: 0, y: 0 };
    this.wheel = 0;
    this._rawWheel = 0;

    this.enabled = true;
    /** When true, every query reads as neutral. The shot API sets this. */
    this.frozen = false;
    this.locked = false;

    this._handlers = [];
  }

  attach() {
    const on = (target, type, fn, opts) => {
      target.addEventListener(type, fn, opts);
      this._handlers.push(() => target.removeEventListener(type, fn, opts));
    };

    on(window, 'keydown', (e) => {
      if (e.repeat) return;
      this._queue.push({ code: e.code, down: true });
      // Space scrolls, F5/Tab/etc. are the user's; only swallow what we bind.
      if (this._isBound(e.code)) e.preventDefault();
    });
    on(window, 'keyup', (e) => this._queue.push({ code: e.code, down: false }));
    on(window, 'blur', () => {
      // Without this, alt-tabbing while holding W leaves the player sprinting.
      for (const c of this.down) this._queue.push({ code: c, down: false });
      this._releaseAllTouches();
    });

    on(this.canvas, 'mousedown', (e) => {
      this._queue.push({ code: `Mouse${e.button}`, down: true });
      if (this.pointerLock && !this.locked) this.canvas.requestPointerLock?.();
    });
    on(window, 'mouseup', (e) => this._queue.push({ code: `Mouse${e.button}`, down: false }));
    on(this.canvas, 'contextmenu', (e) => e.preventDefault());
    on(window, 'mousemove', (e) => {
      if (this.pointerLock && !this.locked) return;
      this._rawLook.x += e.movementX ?? 0;
      this._rawLook.y += e.movementY ?? 0;
    });
    on(window, 'wheel', (e) => {
      this._rawWheel += Math.sign(e.deltaY);
    }, { passive: true });
    on(document, 'pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
    });

    if (this.touchEnabled) {
      // Pointer events, not touch events: one code path, and `pointerType`
      // separates a thumb from the mouse cleanly. The mouse listeners above are
      // left alone, so this adds a path rather than replacing one.
      //
      // `touch-action: none` is set here as well as in CSS on purpose. Without
      // it the browser claims the gesture as a scroll or a pinch after ~100ms
      // and pointermove simply stops arriving mid-drag — which presents as
      // "looking around works for a moment and then sticks", a bug that is very
      // hard to read from the game code.
      this.canvas.style.touchAction = 'none';
      on(this.canvas, 'pointerdown', (e) => {
        if (e.pointerType !== 'touch') return;
        e.preventDefault();
        this.touchActive = true;
        this.canvas.setPointerCapture?.(e.pointerId);
        const r = this.canvas.getBoundingClientRect();
        const inMoveZone = e.clientX - r.left < r.width * this.moveZoneWidth;
        if (inMoveZone && !this._stick) {
          // A FLOATING stick, centred wherever the thumb landed, not a fixed
          // circle the thumb has to find. On a phone the thumb cannot see what
          // it is covering, so a fixed stick means constant small corrections.
          this._stick = {
            id: e.pointerId,
            ox: e.clientX,
            oy: e.clientY,
            x: 0,
            y: 0,
            radius: Math.min(96, Math.max(46, Math.min(r.width, r.height) * 0.17)),
          };
        } else if (!this._lookTouch) {
          this._lookTouch = { id: e.pointerId, x: e.clientX, y: e.clientY, t0: performance.now(), moved: 0 };
        }
      });
      on(this.canvas, 'pointermove', (e) => {
        if (e.pointerType !== 'touch') return;
        e.preventDefault();
        const s = this._stick;
        if (s && s.id === e.pointerId) {
          const dx = e.clientX - s.ox;
          const dy = e.clientY - s.oy;
          const len = Math.hypot(dx, dy) || 1;
          const k = Math.min(1, len / s.radius) / len;
          s.x = dx * k;
          s.y = dy * k;
          return;
        }
        const l = this._lookTouch;
        if (l && l.id === e.pointerId) {
          const dx = e.clientX - l.x;
          const dy = e.clientY - l.y;
          l.moved += Math.hypot(dx, dy);
          l.x = e.clientX;
          l.y = e.clientY;
          this._touchLook.x += dx;
          this._touchLook.y += dy;
        }
      });
      const endTouch = (e) => {
        if (e.pointerType !== 'touch') return;
        if (this._stick?.id === e.pointerId) {
          this._stick = null;
          this.move.x = this.move.y = 0;
          return;
        }
        const l = this._lookTouch;
        if (l?.id !== e.pointerId) return;
        this._lookTouch = null;
        const tapped = e.type === 'pointerup'
          && l.moved < TAP_SLOP_PX
          && performance.now() - l.t0 < TAP_MS;
        // Down AND up in one frame is handled correctly by the ordered queue:
        // it yields a press edge and a release edge, and leaves nothing held.
        if (tapped && this.tapAction) {
          const code = this.actions[this.tapAction]?.[0];
          if (code) {
            this._queue.push({ code, down: true });
            this._queue.push({ code, down: false });
          }
        }
      };
      on(this.canvas, 'pointerup', endTouch);
      on(this.canvas, 'pointercancel', endTouch);
    }

    return this;
  }

  /**
   * Route an on-screen element to an action, for jump / fire / interact buttons.
   * Works for a mouse click too, so the same HUD is usable on a desktop.
   *
   *   input.bindButton(document.querySelector('[data-jump]'), 'jump')
   *
   * Returns an unbind function; `detach()` also releases every binding.
   */
  bindButton(el, action) {
    if (!el) return () => {};
    const code = this.actions[action]?.[0] ?? action;
    const down = (e) => {
      e.preventDefault();
      e.stopPropagation();          // never let the canvas also read this as a look-drag
      if (e.pointerType === 'touch') this.touchActive = true;
      el.setPointerCapture?.(e.pointerId);
      this._queue.push({ code, down: true });
    };
    // Release on up AND cancel AND lostpointercapture: a finger that slides off
    // a button and lifts elsewhere otherwise leaves the action held forever,
    // which reads as "the fire button got stuck".
    const up = (e) => {
      e.preventDefault();
      e.stopPropagation();
      this._queue.push({ code, down: false });
    };
    el.style.touchAction = 'none';
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('lostpointercapture', up);
    const off = () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      el.removeEventListener('lostpointercapture', up);
      this._unbinds.delete(el);
    };
    this._unbinds.set(el, off);
    return off;
  }

  /** Where the floating stick is and how far it is pushed, for anything drawing
   *  an indicator. Null when no thumb is down. Read-only view of private state. */
  get stickState() {
    const s = this._stick;
    return s && s.id !== -1 ? { originX: s.ox, originY: s.oy, x: s.x, y: s.y, radius: s.radius } : null;
  }

  _releaseAllTouches() {
    this._stick = null;
    this._lookTouch = null;
    this.move.x = this.move.y = 0;
    this._touchLook.x = this._touchLook.y = 0;
  }

  detach() {
    for (const off of this._handlers) off();
    this._handlers.length = 0;
    for (const off of [...this._unbinds.values()]) off();
    this._releaseAllTouches();
  }

  _isBound(code) {
    for (const codes of Object.values(this.actions)) if (codes.includes(code)) return true;
    return false;
  }

  /** Promote queued events into this frame's snapshot, in the order they arrived. */
  beginFrame() {
    this._pressed.clear();
    this._released.clear();
    if (this.enabled && !this.frozen) {
      for (const ev of this._queue) {
        if (ev.down) {
          if (!this.down.has(ev.code)) {
            this.down.add(ev.code);
            this._pressed.add(ev.code);
          }
        } else if (this.down.delete(ev.code)) {
          this._released.add(ev.code);
        }
      }
      // Mouse and thumb are summed, each at its own sensitivity: the two are
      // never in use at the same moment, and summing avoids a mode flag that
      // would have to be got right.
      this.look.x = this._rawLook.x * this.sensitivity + this._touchLook.x * this.touchSensitivity;
      this.look.y = this._rawLook.y * this.sensitivity + this._touchLook.y * this.touchSensitivity;
      this.wheel = this._rawWheel;
      const s = this._stick;
      // Deadzone: a thumb resting on the glass drifts a few pixels, and without
      // this the player slides very slowly forever while standing still.
      this.move.x = s && Math.hypot(s.x, s.y) > 0.12 ? s.x : 0;
      this.move.y = s && Math.hypot(s.x, s.y) > 0.12 ? s.y : 0;
    } else {
      this.down.clear();
      this.look.x = this.look.y = 0;
      this.wheel = 0;
      this.move.x = this.move.y = 0;
    }
    this._queue.length = 0;
    this._rawLook.x = this._rawLook.y = 0;
    this._touchLook.x = this._touchLook.y = 0;
    this._rawWheel = 0;
  }

  endFrame() {
    this._pressed.clear();
    this._released.clear();
  }

  /**
   * BOT / TEST DRIVING — feed a synthetic event exactly where a DOM event would
   * land, so `pressed()` and `released()` edges fire normally.
   *
   * Use this from tools (smoke test, profiler, demo recorder) instead of writing
   * into `down` directly: `down.add('Mouse0')` makes the key look HELD but never
   * generates a press edge, so anything gated on `pressed()` silently never
   * happens and the tool reports zero events for a game that works. That exact
   * mistake cost a debugging round here.
   */
  inject(code, isDown = true) {
    this._queue.push({ code, down: !!isDown });
    return this;
  }

  /** Feed raw pointer delta in pixels, pre-sensitivity — like a real mouse. */
  injectLook(dx, dy) {
    this._rawLook.x += dx;
    this._rawLook.y += dy;
    return this;
  }

  /**
   * Drive the movement stick directly, in stick space: x right, y DOWN-screen,
   * each in [-1, 1], so `injectStick(0, -1)` is full forward. For bots driving
   * a touch-only control scheme.
   *
   * It STAYS deflected until you call `injectStick(0, 0)` — there is no finger
   * to lift. A bot that forgets leaves the player walking into a wall for the
   * rest of the run, which measures as movement and reads as a pass.
   */
  injectStick(x, y) {
    this._stick = { id: -1, ox: 0, oy: 0, x, y, radius: 1 };
    this.touchActive = true;
    return this;
  }

  /** Take control for a bot: enabled, unfrozen, and pointer-lock not required. */
  takeControl() {
    this.enabled = true;
    this.frozen = false;
    this.pointerLock = false;
    return this;
  }

  /** Held. */
  held(action) {
    const codes = this.actions[action];
    if (!codes) return false;
    for (const c of codes) if (this.down.has(c)) return true;
    return false;
  }

  /** Went down this frame. */
  pressed(action) {
    const codes = this.actions[action];
    if (!codes) return false;
    for (const c of codes) if (this._pressed.has(c)) return true;
    return false;
  }

  /** Went up this frame. */
  released(action) {
    const codes = this.actions[action];
    if (!codes) return false;
    for (const c of codes) if (this._released.has(c)) return true;
    return false;
  }

  /**
   * Movement axis, in [-1, 1] per axis. Not normalised — the mover decides
   * whether diagonal movement is faster, which is a design choice.
   *
   * Keyboard contributes -1/0/1 and the touch stick contributes its analog
   * deflection; they are summed and clamped. That sum is why gameplay code
   * needs no touch branch: the same call is the whole control scheme on both a
   * keyboard and a thumb, and a half-deflected thumb walks instead of running.
   * Note the stick's screen-down Y is negated here, since forward is up-screen.
   */
  axis2(negX = 'left', posX = 'right', negY = 'back', posY = 'forward', out = { x: 0, y: 0 }) {
    const clamp = (v) => (v < -1 ? -1 : v > 1 ? 1 : v);
    out.x = clamp((this.held(posX) ? 1 : 0) - (this.held(negX) ? 1 : 0) + this.move.x);
    out.y = clamp((this.held(posY) ? 1 : 0) - (this.held(negY) ? 1 : 0) - this.move.y);
    return out;
  }
}
