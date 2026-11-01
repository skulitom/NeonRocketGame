// The rocket's plasma exhaust is a live Pixelbolt fluid simulation (createLiveFluid), stepped 30 times a second and
// stirred by the rocket's motion, so the plume bends when you steer and flares when you boost. Gas rises in the
// simulation, so it is drawn upside down under the nozzle. Until the solver has loaded (or if it can't run), a baked
// loop of the same source plays instead.
import { draw, frameOf } from './assets.js';

const PUSH = 0.28;           // share of the rocket's speed (px per simulation frame) given to the gas, opposite way
const STIR = { x: 10, y: 30, radius: 9 };

export class Exhaust {
  constructor() {
    this.live = null;
    this.status = 'baked';
    this.dirty = true;
  }

  async start() {
    if (this.live || this.status === 'loading') return;
    this.status = 'loading';
    try {
      const [{ createLiveFluid }, source] = await Promise.all([
        import('../vendor/pixelbolt/fluid.js'),
        fetch('assets/exhaust.fluid.json').then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }),
      ]);
      const live = createLiveFluid(source, { warmup: 30 });
      this.canvas = document.createElement('canvas');
      this.canvas.width = live.width; this.canvas.height = live.height;
      this.ctx = this.canvas.getContext('2d');
      this.image = this.ctx.createImageData(live.width, live.height);
      this.live = live;
      this.status = 'live';
    } catch (error) {
      console.warn('Live exhaust unavailable; using the baked loop.', error);
      this.status = 'baked';
    }
  }

  /** One simulation frame. vx, vy: the rocket's velocity in game pixels per second. */
  step(vx, vy, boosting) {
    const live = this.live;
    if (!live) return;
    const clamp = v => Math.max(-2.2, Math.min(2.2, v));
    const px = clamp(-vx / 30 * PUSH), py = clamp(vy / 30 * PUSH); // screen y is the simulation's -y
    if (Math.abs(px) + Math.abs(py) > 0.04) live.push({ x: STIR.x, y: STIR.y, vx: px, vy: py, radius: STIR.radius });
    if (boosting) live.boost('jet', 2.6, 2);
    live.step();
    this.dirty = true;
  }

  /** Draws the plume with its top at (x, y): the nozzle. */
  draw(ctx, x, y, ms) {
    if (!this.live) { draw(ctx, 'exhaust', frameOf('exhaust', 'down', ms), x, y); return; }
    if (this.dirty) {
      this.image.data.set(this.live.render().rgba);
      this.ctx.putImageData(this.image, 0, 0);
      this.dirty = false;
    }
    ctx.save();
    ctx.translate(Math.round(x) - 10, Math.round(y) + this.canvas.height);
    ctx.scale(1, -1);
    ctx.drawImage(this.canvas, 0, 0);
    ctx.restore();
  }
}
