/**
 * Disposal. WebGL resources are not garbage collected — a geometry, material,
 * texture or render target you drop the last reference to stays on the GPU until
 * you call dispose(). Two symptoms in practice: VRAM climbing over a session,
 * and (with HMR) each reload leaking a whole scene's worth of textures until the
 * context is lost and the page goes black mid-iteration.
 *
 * Every subsystem's dispose() should be able to be written as:
 *   dispose() { disposeTree(this.root); this.root.parent?.remove(this.root); }
 */

/** Dispose one material and every texture it references. */
export function disposeMaterial(material) {
  if (!material) return 0;
  let n = 0;
  for (const key of Object.keys(material)) {
    const v = material[key];
    if (v && v.isTexture) {
      v.dispose();
      n++;
    }
  }
  // Uniforms of a ShaderMaterial / patched material hold textures too.
  const u = material.uniforms;
  if (u) {
    for (const k of Object.keys(u)) {
      const v = u[k]?.value;
      if (v && v.isTexture) {
        v.dispose();
        n++;
      }
    }
  }
  material.dispose();
  return n;
}

/**
 * Recursively dispose geometries, materials and textures under `root`.
 * Materials and geometries are deduped, because sharing them is the norm and
 * double-disposing a shared material in a partial teardown is a real crash.
 * Does NOT detach `root` from its parent — that is the caller's call.
 */
export function disposeTree(root, { removeChildren = true } = {}) {
  if (!root) return { geometries: 0, materials: 0, textures: 0 };
  const geos = new Set();
  const mats = new Set();
  root.traverse((o) => {
    if (o.geometry) geos.add(o.geometry);
    const m = o.material;
    if (Array.isArray(m)) for (const x of m) mats.add(x);
    else if (m) mats.add(m);
  });
  let textures = 0;
  for (const g of geos) g.dispose();
  for (const m of mats) textures += disposeMaterial(m);
  if (removeChildren) root.clear?.();
  return { geometries: geos.size, materials: mats.size, textures };
}

/** Dispose a list of render targets / textures / anything with .dispose(). */
export function disposeAll(...items) {
  for (const list of items) {
    for (const it of Array.isArray(list) ? list : [list]) it?.dispose?.();
  }
}

/**
 * Track what you create so dispose() cannot forget one. Cheap enough to use
 * everywhere, and it turns "did I dispose the 14 render targets" into one call.
 *
 *   this.own = new Owned();
 *   const rt = this.own.add(new THREE.WebGLRenderTarget(...));
 *   ...
 *   dispose() { this.own.disposeAll(); }
 */
export class Owned {
  #items = new Set();

  add(item) {
    if (item?.dispose) this.#items.add(item);
    return item;
  }

  addAll(...items) {
    for (const i of items.flat()) this.add(i);
    return items;
  }

  disposeAll() {
    let n = 0;
    for (const i of this.#items) {
      try {
        i.dispose();
        n++;
      } catch (err) {
        console.warn('[dispose] threw', err);
      }
    }
    this.#items.clear();
    return n;
  }

  get size() {
    return this.#items.size;
  }
}
