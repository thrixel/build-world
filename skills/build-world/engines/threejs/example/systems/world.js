import * as THREE from 'three';
import { LightBallast, Owned, disposeTree, compileMeshes } from '../../lib/index.js';

/**
 * World: level geometry, props, static colliders, practical lights.
 *
 * Three things here are worth copying regardless of genre:
 *  1. EVERY texture is generated from ctx.rng, so the level is identical on every
 *     run and a pixel diff means something.
 *  2. Repeated props are ONE InstancedMesh, not 200 meshes. 200 draw calls of a
 *     crate is the most common reason a Three.js scene is slow for no reason.
 *  3. The practical lights are behind a LightBallast, because a light crossing
 *     its cull radius otherwise recompiles every lit material in the scene.
 *     See lib/lights.js — this was the worst single stall source in the
 *     reference project.
 */
export class WorldSystem {
  static id = 'world';
  static deps = ['render'];

  async init(ctx) {
    this.ctx = ctx;
    this.own = new Owned();
    const rng = ctx.rng.fork(); // own stream: our detail must not depend on FX
    this.root = new THREE.Group();
    this.root.name = 'world';
    ctx.scene.add(this.root);

    const render = ctx.get('render');
    const aniso = Math.min(ctx.config.q.anisotropy, render.renderer.capabilities.getMaxAnisotropy());

    // ---- procedural surfaces -------------------------------------------
    const ground = this.own.add(noiseTexture(rng, 256, { base: [0.44, 0.41, 0.37], grain: 0.5, repeat: 24, aniso }));
    const wall = this.own.add(noiseTexture(rng, 256, { base: [0.62, 0.56, 0.47], grain: 0.35, repeat: 4, aniso }));
    const crate = this.own.add(noiseTexture(rng, 128, { base: [0.52, 0.38, 0.22], grain: 0.3, repeat: 1, aniso }));

    this.matGround = this.own.add(new THREE.MeshStandardMaterial({ map: ground, roughness: 0.92, metalness: 0 }));
    this.matWall = this.own.add(new THREE.MeshStandardMaterial({ map: wall, roughness: 0.78, metalness: 0 }));
    this.matCrate = this.own.add(new THREE.MeshStandardMaterial({ map: crate, roughness: 0.7, metalness: 0 }));

    // ---- ground ---------------------------------------------------------
    // Tessellated, not a single quad: a 2-triangle floor cannot receive a
    // gradient from a point light, and vertex-lit engines aside, it also gives
    // nothing for AO or contact shadows to bite into.
    const g = this.own.add(new THREE.PlaneGeometry(120, 120, 48, 48));
    g.rotateX(-Math.PI / 2);
    const floor = new THREE.Mesh(g, this.matGround);
    floor.receiveShadow = true;
    floor.name = 'ground';
    this.root.add(floor);

    // ---- buildings: real wall thickness, real openings -------------------
    // Boxes, not planes. A plane wall has no reveal, so windows and doorways
    // read as stickers and light leaks through the edge.
    this.colliders = [];
    const wallGeo = this.own.add(new THREE.BoxGeometry(1, 1, 1));
    const addBlock = (x, z, w, h, d) => {
      const m = new THREE.Mesh(wallGeo, this.matWall);
      m.position.set(x, h / 2, z);
      m.scale.set(w, h, d);
      m.castShadow = m.receiveShadow = true;
      this.root.add(m);
      this.colliders.push(m);
      return m;
    };
    // A street with an enclosed room on the left (the `interior` shot).
    addBlock(-9, 0, 6, 4, 14);
    addBlock(-4.4, -5.5, 3.5, 4, 0.4);
    addBlock(-4.4, 5.5, 3.5, 4, 0.4);
    addBlock(-4.4, 0, 0.4, 4, 4); // back wall of the room
    addBlock(9, 2, 6, 6, 20);
    addBlock(0, -12, 24, 5, 1);

    // ---- instanced props: ONE draw call ---------------------------------
    const COUNT = 220;
    const box = this.own.add(new THREE.BoxGeometry(0.7, 0.7, 0.7));
    this.props = new THREE.InstancedMesh(box, this.matCrate, COUNT);
    this.props.castShadow = this.props.receiveShadow = true;
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const v = new THREE.Vector3();
    const s = new THREE.Vector3();
    // Instances 0-2 are a DELIBERATE stack at a known position, because the
    // `detail` shot frames it. Do not leave a review shot pointing at randomly
    // placed geometry: in the reference project the impact shot was aimed down an
    // open street for three rounds, so the decals it existed to show were staged
    // 20 m away and never legible, and every critique of it was about something
    // else.
    const FEATURE = { x: 1.6, z: 3.0 };
    for (let i = 0; i < COUNT; i++) {
      if (i < 3) {
        v.set(FEATURE.x + (i === 2 ? 0.18 : 0), 0.35 + i * 0.7, FEATURE.z + (i === 1 ? -0.12 : 0));
        e.set(0, 0.35 + i * 0.22, 0);
        q.setFromEuler(e);
        s.setScalar(1.0);
        this.props.setMatrixAt(i, m4.compose(v, q, s));
        continue;
      }
      const ring = 4.5 + rng.float() * 15;
      const a = rng.float() * Math.PI * 2;
      v.set(Math.cos(a) * ring, 0, Math.sin(a) * ring);
      const stack = rng.int(0, 2);
      v.y = 0.35 + stack * 0.7;
      // Nothing perfectly straight, clean or repeated: vary yaw and scale or
      // 220 crates read as 1 crate copy-pasted, which is exactly how a reviewer
      // will describe it.
      e.set(rng.range(-0.03, 0.03), rng.float() * Math.PI * 2, rng.range(-0.03, 0.03));
      q.setFromEuler(e);
      s.setScalar(rng.range(0.85, 1.25));
      this.props.setMatrixAt(i, m4.compose(v, q, s));
    }
    this.props.instanceMatrix.needsUpdate = true;
    this.root.add(this.props);

    // ---- practical lights + ballast -------------------------------------
    this.lampSlots = Math.min(4, ctx.config.q.maxDynamicLights);
    this.lamps = [];
    for (let i = 0; i < this.lampSlots; i++) {
      const l = new THREE.PointLight(0xffb765, 0, 14, 2);
      l.position.set(-6 + i * 5.5, 2.6, i % 2 ? 4 : -4);
      l.castShadow = false;
      this.root.add(l);
      this.lamps.push(l);
    }
    // Slots the shader will ALWAYS see, whatever the cull decides.
    this.ballast = new LightBallast(this.root, this.lampSlots, 2);
    this.ballast.update(0);

    console.info(`[world] ${this.colliders.length} colliders · ${COUNT} instanced props`);
  }

  update(dt, ctx) {
    // Lamps on at night. Driven by the render system's time of day — a pure
    // function of state, never of performance.now().
    const hour = ctx.get('render').timeOfDay;
    const night = hour < 6.5 || hour > 18.5 ? 1 : 0;
    for (const l of this.lamps) l.intensity = night * 12;
  }

  /** In lateUpdate, after everything has moved: hold the visible point-light
   *  count constant. Here every lamp is always visible, so `realVisible` is a
   *  constant; in a real game you predict it with the same test the cull uses. */
  lateUpdate() {
    this.ballast.update(this.lamps.length);
  }

  async prewarmMaterials(ctx) {
    const meshes = [];
    this.root.traverse((o) => {
      if (o.isMesh) meshes.push(o);
    });
    return { ok: true, compiled: compileMeshes(ctx.get('render').renderer, meshes, ctx.scene, ctx.camera) };
  }

  dispose() {
    this.ballast.dispose();
    disposeTree(this.root);
    this.root.parent?.remove(this.root);
    this.own.disposeAll();
  }
}

/**
 * A procedural surface in 30 lines: value noise into a DataTexture. Not
 * production art — the point is that it is DETERMINISTIC (seeded by ctx.rng) and
 * that it has variation at more than one frequency, which is the difference
 * between "a texture" and "a flat colour".
 */
function noiseTexture(rng, size, { base, grain, repeat, aniso }) {
  const data = new Uint8Array(size * size * 4);
  // Two octaves of a cheap seeded lattice, plus per-pixel grain.
  const lattice = new Float32Array(64 * 64);
  for (let i = 0; i < lattice.length; i++) lattice[i] = rng.float();
  const samp = (x, y, f) => {
    const xf = x * f, yf = y * f;
    const x0 = Math.floor(xf) & 63, y0 = Math.floor(yf) & 63;
    const x1 = (x0 + 1) & 63, y1 = (y0 + 1) & 63;
    const tx = xf - Math.floor(xf), ty = yf - Math.floor(yf);
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const a = lattice[y0 * 64 + x0], b = lattice[y0 * 64 + x1];
    const c = lattice[y1 * 64 + x0], d = lattice[y1 * 64 + x1];
    return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = 0.6 * samp(x / size, y / size, 8) + 0.3 * samp(x / size, y / size, 26) + 0.1 * rng.float();
      const k = 1 - grain * 0.5 + grain * n;
      const i = (y * size + x) * 4;
      data[i] = Math.min(255, base[0] * 255 * k);
      data[i + 1] = Math.min(255, base[1] * 255 * k);
      data[i + 2] = Math.min(255, base[2] * 255 * k);
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.anisotropy = aniso;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.needsUpdate = true;
  return tex;
}
