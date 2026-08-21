/**
 * Subsystem registry + event bus. Genre-generic; nothing here knows about a game.
 *
 * CONTRACT — every subsystem is a class with:
 *   static id       : string, unique. Others reach it via ctx.get(id).
 *   static deps     : string[] of ids that must init() first.
 *   async init(ctx) : build resources. May await.
 *   fixedUpdate(h,ctx): fixed-rate, 0..N times per frame. Optional.
 *   update(dt,ctx)  : once per frame, before render. Optional.
 *   lateUpdate(dt,ctx): after every update(), before render. Optional.
 *   resize(w,h,ctx) : viewport changed. Optional.
 *   prewarmMaterials(ctx): compile every shader this system can produce. Optional.
 *   dispose()       : free GPU/CPU resources. Optional.
 *
 * Subsystems MUST NOT import each other. They go through ctx.get(id). That is
 * what keeps the dependency graph explicit and lets one owner work on one
 * directory without reading (or breaking) another's internals.
 */

export class Registry {
  #systems = new Map();
  #order = [];
  #cache = new Map();

  add(system) {
    const id = system.constructor.id;
    if (!id) throw new Error(`${system.constructor.name} is missing a static id`);
    if (this.#systems.has(id)) throw new Error(`duplicate subsystem id "${id}"`);
    this.#systems.set(id, system);
    this.#cache.clear();
    this.#order = [];
    return this;
  }

  /** Throwing lookup — use for a hard dependency. */
  get(id) {
    const s = this.#systems.get(id);
    if (!s) throw new Error(`subsystem "${id}" not registered`);
    return s;
  }

  /** Non-throwing lookup — use for an optional dependency, and in tools. */
  peek(id) {
    return this.#systems.get(id) ?? null;
  }

  has(id) {
    return this.#systems.has(id);
  }

  /** Topological sort over static deps. Throws on cycles and missing deps. */
  resolve() {
    const seen = new Map(); // id -> 0 visiting, 1 done
    const out = [];
    const visit = (id, from) => {
      const state = seen.get(id);
      if (state === 1) return;
      if (state === 0) throw new Error(`dependency cycle at "${id}" (via ${from})`);
      const sys = this.#systems.get(id);
      if (!sys) throw new Error(`"${from}" depends on unregistered subsystem "${id}"`);
      seen.set(id, 0);
      for (const d of sys.constructor.deps ?? []) visit(d, id);
      seen.set(id, 1);
      out.push(sys);
    };
    for (const id of this.#systems.keys()) visit(id, '<root>');
    this.#order = out;
    return out;
  }

  get ordered() {
    return this.#order.length ? this.#order : this.resolve();
  }

  /** Systems implementing `method`, in dependency order. Cached per method so the
   *  frame loop does no filtering. */
  with(method) {
    let list = this.#cache.get(method);
    if (!list) {
      list = this.ordered.filter((s) => typeof s[method] === 'function');
      this.#cache.set(method, list);
    }
    return list;
  }

  invalidate() {
    this.#cache.clear();
  }
}

/**
 * Minimal synchronous event bus. Handlers are copied before dispatch so a
 * handler may unsubscribe (or subscribe) during its own dispatch, and a throwing
 * handler cannot take down the frame — a single bad listener in one subsystem
 * would otherwise stop every later listener from running that frame.
 */
export class EventBus {
  #map = new Map();

  on(type, fn) {
    let set = this.#map.get(type);
    if (!set) this.#map.set(type, (set = new Set()));
    set.add(fn);
    return () => this.off(type, fn);
  }

  once(type, fn) {
    const off = this.on(type, (e) => {
      off();
      fn(e);
    });
    return off;
  }

  off(type, fn) {
    this.#map.get(type)?.delete(fn);
  }

  emit(type, payload) {
    const set = this.#map.get(type);
    if (!set || set.size === 0) return;
    for (const fn of [...set]) {
      try {
        fn(payload);
      } catch (err) {
        console.error(`[events] handler for "${type}" threw:`, err);
      }
    }
  }

  clear() {
    this.#map.clear();
  }
}
