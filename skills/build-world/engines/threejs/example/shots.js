/**
 * THE SHOT LIST. Write this on day one, before any art or feature work.
 *
 * A shot is a named, fixed framing that every review round re-captures. Its job
 * is to make iteration N comparable to iteration N+1 — if the framing drifts,
 * every critique is noise and you cannot tell improvement from camera luck.
 *
 * Cover the axes your game will be judged on, one shot per axis, and say in
 * `doc` what each shot is FOR. That sentence is what a reviewer reads, and it is
 * what stops them from critiquing the wrong thing.
 *
 * Aim for 8-12. Fewer and a whole class of defect has no witness; many more and
 * a review round costs too much to run often.
 */
export const SHOTS = {
  // --- establishing / art direction -------------------------------------
  hero: {
    pos: [0, 1.9, 18],
    look: [0, 1.4, -6],
    fov: 70,
    time: 16.5,
    doc: 'Wide establishing view — overall art direction, silhouette, composition.',
  },
  // --- close-range material quality (the most common failure) -----------
  detail: {
    pos: [3.1, 1.15, 4.5],
    look: [1.6, 0.95, 3.0],
    fov: 45,
    time: 16.5,
    doc: 'Close-up on a surface — texel density, normal detail, grime, edge wear.',
  },
  // --- lighting extremes ------------------------------------------------
  sunset: {
    pos: [3.0, 2.6, 16],
    look: [-2.0, 1.7, -8],
    fov: 65,
    time: 19.2,
    doc: 'Low sun — long shadows, scattering, bloom, exposure at the extremes.',
  },
  night: {
    pos: [0, 1.9, 18],
    look: [0, 1.4, -6],
    fov: 70,
    time: 1.5,
    doc: 'Night — artificial lights, exposure adaptation, shadow quality in the dark.',
  },
  // --- interior: bounce, AO, contact shadows ----------------------------
  interior: {
    pos: [-2.6, 1.7, 0.2],
    look: [-6.5, 1.4, 0.0],
    fov: 70,
    time: 16.5,
    doc: 'Enclosed space — ambient occlusion, bounce light, contact shadows.',
  },
  // --- transient FX. `apply` schedules the event to peak ON the captured
  //     frame, using opts.grabFrame — guessing does not work for a 50 ms flash.
  impacts: {
    pos: [3.0, 1.45, 1.4],
    look: [-1.4, 1.2, 0.65],
    fov: 60,
    time: 16.5,
    apply: (e, o) => e.ctx.peek('fx')?.debugBurst?.('wall', o),
    doc: 'Impact FX — decals, sparks, dust, light spill, debris.',
  },
  // --- UI over gameplay -------------------------------------------------
  hud: {
    pos: [0, 1.9, 18],
    look: [0, 1.4, -6],
    fov: 70,
    time: 16.5,
    apply: (e) => e.ctx.peek('ui')?.debugState?.('busy'),
    doc: 'Full HUD in its busiest state — layout, contrast, readability.',
  },
};

/**
 * Put transient gameplay state back to neutral. Called before every shot's own
 * apply(). Without this, the previous shot's looping debug state is still running
 * during the next one, and the next review round reports phantom regressions.
 */
export function clearState(engine) {
  engine.ctx.peek('fx')?.debugBurst?.('none');
  engine.ctx.peek('ui')?.debugState?.('clean');
}
