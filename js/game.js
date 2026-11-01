// Neon Voyage: the world, its rules and how it is drawn. Positions are game pixels on a canvas that the page enlarges
// by a whole number, so every sprite stays crisp. All art comes from the Pixelbolt atlases in assets/.
import { sheets, draw, frameOf, lengthOf, drawText, textWidth, formatScore } from './assets.js';
import { sfx } from './audio.js';

const BG = '#07040f';
const FIELD = [240, 360];              // playfield width range; wider screens get margins with the HUD in them
const NEONS = ['pink', 'orange', 'violet'];
const ROCKS = {                        // hit radius against the rocket (a little inside the drawn rock), radius against
  s: { r: 3.6, body: 5, mass: 1, points: 10 },   // other rocks (the drawn rock with its edge), mass, points when smashed
  m: { r: 5.8, body: 7.5, mass: 2.2, points: 15 },
  l: { r: 8.2, body: 10.5, mass: 4.5, points: 25 },
};
const HIT = [[0, -6, 3], [0, 1, 4.5], [0, 8, 5.5]]; // the rocket's hit circles, upright: [dx, dy, r] from its anchor
const GRAZE = 7;                       // a rock passing this close without touching counts as a graze
const SPEED = 1.2;                     // top steering speed, playfield widths per second
const RESPONSE = 26;                   // how fast the rocket reaches it (and stops): a time constant of about 40 ms
const TILT = 30, TILT_RATE = 16;       // degrees of lean at top speed, and how fast the lean follows
const TILTS = ['tilt-l30', 'tilt-l20', 'tilt-l10', 'tilt-0', 'tilt-r10', 'tilt-r20', 'tilt-r30'];
const PIECES = {                       // where each crash piece sits on the upright ship, from its anchor
  nose: [0, -9.5], cockpit: [0, -2.5], tail: [0, 7], 'fin-l': [-6.5, 6], 'fin-r': [6.5, 6],
};
const SHIELD_TIME = 12, BOOST_TIME = 4.5, MULT_MAX = 5;

function rng(seed) {                   // mulberry32: a seed makes a run repeatable for tests
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const lerp = (a, b, t) => a + (b - a) * t;
const turn = ([x, y], deg) => {
  const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  return [x * c - y * s, x * s + y * c];
};

export class Game {
  constructor({ exhaust, onGameOver, reducedMotion, seed = Date.now() }) {
    this.exhaust = exhaust;
    this.onGameOver = onGameOver;
    this.reducedMotion = reducedMotion;
    this.touch = false;
    this.random = rng(seed);
    this.vw = 240; this.vh = 400; this.insets = { top: 0, bottom: 0 };
    this.fw = 240; this.fx = 0;
    this.mode = 'title';
    this.clock = 0;                    // ms of game time, for animations
    this.best = 0;
    this.reset();
    this.seedDecor();
  }

  resize(vw, vh, insets = this.insets) {
    this.vw = vw; this.vh = vh; this.insets = insets;
    this.fw = clamp(vw, FIELD[0], FIELD[1]);
    this.fx = Math.floor((vw - this.fw) / 2);
    this.rocket.x = clamp(this.rocket.x, this.fx + 12, this.fx + this.fw - 12);
    this.rocket.y = this.homeY();
  }
  // On touch screens the thumbs rest near the bottom corners, so the rocket flies higher, clear of them.
  homeY() { return (this.touch ? Math.round(this.vh * 0.8) : this.vh - 30) - this.insets.bottom; }
  // Speeds scale with the screen's height, so a rock takes as long to cross a phone as a monitor.
  get scale() { return this.vh / 300; }

  reset() {
    this.rocket = { x: this.fx + this.fw / 2, y: this.homeY(), vx: 0, tilt: 0, flash: 0, thrust: 0 };
    this.rocks = []; this.shards = []; this.items = []; this.effects = []; this.popups = []; this.pieces = [];
    this.time = 0; this.score = 0; this.mult = 1; this.lastGraze = -9;
    this.speed = 60; this.boost = 0; this.shield = 0; this.invuln = 0;
    this.shake = 0; this.flash = 0;
    this.stats = { shards: 0, grazes: 0, smashed: 0, powerups: 0 };
    this.timers = { rock: 0.6, shards: 2.5, item: 11, storm: 38, storming: 0 };
    this.lineCounts = new Map();
    this.far = 0; this.near = 0; this.exhaustClock = 0; this.knocked = 0;
    this.dyingFor = 0; this.newBest = false;
  }

  start() {
    this.reset();
    this.mode = 'playing';
  }

  // ------------------------------------------------------------ update
  update(dt, input) {
    this.clock += dt * 1000;
    if (this.mode === 'paused') { this.shake = 0; return; }
    const playing = this.mode === 'playing', wrecked = this.mode === 'dying' || this.mode === 'over';
    if (playing) this.time += dt;

    // World speed: rises over three minutes, faster while boosting, slowing to a drift after a crash.
    const target = this.mode === 'title' ? 45 : wrecked ? 22 : lerp(62, 175, clamp(this.time / 180, 0, 1)) * (this.boost > 0 ? 1.9 : 1);
    this.speed = lerp(this.speed, target, 1 - Math.exp(-dt * (this.boost > 0 ? 6 : 2)));
    const v = this.speed * this.scale;
    this.far = (this.far + v * 0.22 * dt) % 128;
    this.near = (this.near + v * 0.5 * dt) % 128;
    for (const d of this.decor) d.y += v * d.parallax * dt;
    this.decor = this.decor.filter(d => d.y < this.vh + 100);
    if (this.decor.length < 2 && this.random() < dt * 0.04) this.addDecor(-110);

    if (playing) {
      this.steer(dt, input.direction());
      this.score += v * dt / 10 * this.mult * (this.boost > 0 ? 2 : 1);
      if (this.time - this.lastGraze > 2.5) this.mult = Math.max(1, this.mult - 0.05 * dt);
      this.boost = Math.max(0, this.boost - dt);
      this.shield = Math.max(0, this.shield - dt);
      this.invuln = Math.max(0, this.invuln - dt);
    } else if (this.mode === 'title') {
      // The title screen flies itself: weaving across the lane, leaning into each turn.
      const t = this.clock / 1000, tx = this.fx + this.fw / 2 + Math.sin(t * 0.8) * this.fw * 0.3 + Math.sin(t * 2.3) * 14;
      this.steer(dt, Math.abs(tx - this.rocket.x) < 6 ? 0 : Math.sign(tx - this.rocket.x));
    }
    this.rocket.flash = Math.max(0, this.rocket.flash - dt);
    this.rocket.y = this.homeY() + Math.sin(this.clock / 1000 * 2.5) * 1.5;

    this.spawn(dt);
    this.move(dt, v);
    if (playing) this.collide();
    this.tick(dt, v);

    // The exhaust simulates at 30 frames a second, whatever the display rate.
    this.exhaustClock += dt;
    while (this.exhaustClock >= 1 / 30) {
      this.exhaustClock -= 1 / 30;
      if (!wrecked) this.exhaust.step(this.rocket.vx, this.boost > 0 ? 2.6 : this.rocket.thrust ? 1.7 : 0);
    }

    if (wrecked) this.dyingFor += dt;
    if (this.mode === 'dying' && this.dyingFor > 1.2) { this.mode = 'over'; this.onGameOver?.(this.summary()); }
  }

  // Side to side only, quick as a fly: the rocket reaches top speed or stops within a few frames, and leans into it.
  steer(dt, dir) {
    const r = this.rocket, top = SPEED * this.fw;
    r.thrust = dir;
    r.vx = lerp(r.vx, dir * top, 1 - Math.exp(-dt * RESPONSE));
    r.x += r.vx * dt;
    const left = this.fx + 12, right = this.fx + this.fw - 12;
    if (r.x < left || r.x > right) { r.x = clamp(r.x, left, right); r.vx = 0; }
    r.tilt = lerp(r.tilt, clamp(r.vx / top, -1, 1) * TILT, 1 - Math.exp(-dt * TILT_RATE));
  }
  tiltFrame() { return TILTS[clamp(Math.round(this.rocket.tilt / 10), -3, 3) + 3]; }

  // ------------------------------------------------------------ spawning
  spawn(dt) {
    const t = this.timers, density = (this.fw / 200) * this.scale;
    const title = this.mode === 'title', playing = this.mode === 'playing';
    if (playing) {
      t.storm -= dt;
      if (t.storm <= 0 && !t.storming) { t.storming = 6; this.popup('METEOR STORM!', this.fx + this.fw / 2, this.vh * 0.3, 'pink', 1.6); }
      if (t.storming) { t.storming = Math.max(0, t.storming - dt); if (!t.storming) t.storm = 35 + this.random() * 15; }
    }
    if (this.mode === 'over') return;
    t.rock -= dt;
    if (t.rock <= 0) {
      const ramp = clamp(this.time / 150, 0, 1);
      const base = title ? 1.4 : lerp(0.95, 0.34, ramp) / (t.storming ? 2.4 : 1);
      t.rock = base * (0.7 + this.random() * 0.6) / density;
      this.addRock(ramp, Boolean(t.storming));
    }
    if (!playing) return;
    t.shards -= dt;
    if (t.shards <= 0) { t.shards = 3.2 + this.random() * 2; this.addShardLine(); }
    t.item -= dt;
    if (t.item <= 0) { t.item = 14 + this.random() * 8; this.addItem(); }
  }

  addRock(ramp, storm) {
    const roll = this.random();
    const size = storm ? (roll < 0.7 ? 's' : 'm') : roll < lerp(0.5, 0.3, ramp) ? 's' : roll < lerp(0.9, 0.68, ramp) ? 'm' : 'l';
    const pad = ROCKS[size].body;
    const k = (size === 's' ? 1.15 : size === 'm' ? 1 : 0.85) * (0.85 + this.random() * 0.35) * (storm ? 1.25 : 1);
    this.rocks.push({
      size, neon: NEONS[Math.floor(this.random() * 3)],
      x: this.fx + pad + this.random() * (this.fw - pad * 2), y: -16,
      vx: (this.random() - 0.5) * 2 * (8 + 30 * ramp) * this.scale, vy: this.speed * this.scale * k, k,
      rot: this.random() * 16, spin: (this.random() < 0.5 ? -1 : 1) * (4 + this.random() * 10),
      grazed: false, doom: null,
    });
  }

  addShardLine() {
    const n = 5, line = Symbol('line'), shape = Math.floor(this.random() * 3);
    const x0 = this.fx + 16 + this.random() * (this.fw - 32);
    const slant = (this.random() < 0.5 ? -1 : 1) * 8;
    for (let i = 0; i < n; i++) {
      let x = x0;
      if (shape === 1) x = x0 + slant * (i - 2);
      if (shape === 2) x = x0 + Math.sin(i * 1.3) * 14;
      this.shards.push({ x: clamp(x, this.fx + 8, this.fx + this.fw - 8), y: -12 - i * 15, line, phase: i * 90 });
    }
    this.lineCounts.set(line, n);
  }

  addItem() {
    const roll = this.random();
    let type = roll < 0.45 ? 'shield' : roll < 0.75 ? 'boost' : 'nova';
    if (type === 'shield' && this.shield > 0) type = 'nova';
    this.items.push({ type, x: this.fx + 20 + this.random() * (this.fw - 40), y: -14, phase: this.random() * 500 });
  }

  seedDecor() {
    this.decor = [];
    this.addDecor(this.vh * 0.42, 'nebula-a');
    this.addDecor(-this.vh * 0.02, 'planet'); // up top, clear of the rocket's lane
  }
  addDecor(y, kind) {
    const kinds = ['nebula-a', 'nebula-b', 'planet', 'moon', 'nebula-b'];
    const frame = kind ?? kinds[Math.floor(this.random() * kinds.length)];
    const nebula = frame.startsWith('nebula');
    this.decor.push({ frame, x: Math.round(this.random() * (this.vw - 80) - 20), y, parallax: nebula ? 0.05 : 0.09 });
  }

  // ------------------------------------------------------------ motion
  move(dt, v) {
    const settle = 1 - Math.exp(-dt * 1.5);
    for (const rock of this.rocks) {
      rock.vy += (v * rock.k - rock.vy) * settle; // a knocked rock drifts back to the flow
      rock.x += rock.vx * dt; rock.y += rock.vy * dt;
      rock.rot = (rock.rot + rock.spin * dt + 16) % 16;
      // Rocks bounce off the playfield's sides, so none hides in a margin.
      const r = ROCKS[rock.size].body;
      if (rock.x < this.fx + r || rock.x > this.fx + this.fw - r) { rock.vx = -rock.vx; rock.x = clamp(rock.x, this.fx + r, this.fx + this.fw - r); }
    }
    this.collideRocks();
    const magnet = this.boost > 0;
    for (const s of this.shards) {
      s.y += v * dt;
      if (magnet) {
        const dx = this.rocket.x - s.x, dy = this.rocket.y - s.y, d = Math.hypot(dx, dy);
        if (d < 80 && d > 0.1) { s.x += dx / d * 200 * dt; s.y += dy / d * 200 * dt; }
      }
    }
    for (const item of this.items) item.y += v * 0.9 * dt;
    for (const e of this.effects) e.y += v * e.drift * dt;
    const below = this.vh + 24;
    this.rocks = this.rocks.filter(r => r.y < below);
    this.shards = this.shards.filter(s => s.y < below);
    this.items = this.items.filter(i => i.y < below);
  }

  // Asteroids knock each other about, as they did in the original: pushed apart where they overlap, and a bounce
  // that trades momentum along the line between them, so a big rock shoves a small one aside.
  collideRocks() {
    const rocks = this.rocks;
    for (let i = 0; i < rocks.length; i++) for (let j = i + 1; j < rocks.length; j++) {
      const a = rocks[i], b = rocks[j];
      if (a.dead || b.dead) continue;
      const A = ROCKS[a.size], B = ROCKS[b.size], reach = A.body + B.body;
      const dx = b.x - a.x, dy = b.y - a.y, d2 = dx * dx + dy * dy;
      if (d2 >= reach * reach || d2 === 0) continue;
      const d = Math.sqrt(d2), nx = dx / d, ny = dy / d, overlap = reach - d, total = A.mass + B.mass;
      a.x -= nx * overlap * B.mass / total; a.y -= ny * overlap * B.mass / total;
      b.x += nx * overlap * A.mass / total; b.y += ny * overlap * A.mass / total;
      const closing = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
      if (closing >= 0) continue;
      const impulse = -1.85 * closing / (1 / A.mass + 1 / B.mass);
      a.vx -= impulse * nx / A.mass; a.vy -= impulse * ny / A.mass;
      b.vx += impulse * nx / B.mass; b.vy += impulse * ny / B.mass;
      a.spin = clamp(a.spin + (this.random() - 0.5) * 8, -16, 16); b.spin = clamp(b.spin - (this.random() - 0.5) * 8, -16, 16);
      if (a.y > 0 && b.y > 0 && -closing > 25 && this.clock - this.knocked > 90) { this.knocked = this.clock; sfx.knock(Math.min(1, -closing / 120)); }
    }
  }

  tick(dt, v) {
    for (const e of this.effects) e.t += dt * 1000;
    this.effects = this.effects.filter(e => e.loop || e.t < e.length);
    for (const p of this.popups) p.t += dt;
    this.popups = this.popups.filter(p => p.t < p.life);
    for (const p of this.pieces) {
      p.vy += 300 * this.scale * dt;
      p.x += p.vx * dt; p.y += (p.vy + v * 0.3) * dt; p.rot += p.spin * dt;
    }
    this.pieces = this.pieces.filter(p => p.y < this.vh + 30);
    this.shake = Math.max(0, this.shake - dt * 30);
    this.flash = Math.max(0, this.flash - dt * 3);
    // Rocks marked by a nova shatter as its wave reaches them.
    for (const rock of this.rocks) if (rock.doom !== null && this.time >= rock.doom) this.smash(rock, false);
    this.rocks = this.rocks.filter(r => !r.dead);
  }

  // ------------------------------------------------------------ collisions
  collide() {
    const r = this.rocket, hits = HIT.map(([x, y, radius]) => { const [tx, ty] = turn([x, y], r.tilt); return [r.x + tx, r.y + ty, radius]; });
    for (const rock of this.rocks) {
      if (rock.dead) continue;
      const rr = ROCKS[rock.size].r;
      let nearest = Infinity;
      for (const [hx, hy, hr] of hits) nearest = Math.min(nearest, Math.hypot(rock.x - hx, rock.y - hy) - hr - rr);
      if (nearest < 0) {
        if (this.boost > 0) { this.smash(rock, true); continue; }
        if (this.shield > 0) {
          this.smash(rock, true);
          this.shield = 0; this.invuln = 1.2; r.flash = 0.15;
          this.addEffect('bursts', 'pickup-shield', r.x, r.y, 0);
          this.popup('SHIELD DOWN', r.x, r.y - 26, 'green');
          sfx.shieldPop(); this.kick(4);
          continue;
        }
        if (this.invuln > 0) continue;
        rock.dead = true;
        this.addEffect('bursts', `break-${rock.neon}`, rock.x, rock.y, 0.4);
        this.crash();
        return;
      }
      if (!rock.grazed && nearest < GRAZE && this.invuln <= 0) {
        rock.grazed = true;
        this.mult = Math.min(MULT_MAX, this.mult + 0.1);
        this.lastGraze = this.time;
        const gain = Math.round(10 * this.mult);
        this.score += gain; this.stats.grazes++;
        const mx = (rock.x + r.x) / 2, my = (rock.y + r.y) / 2;
        this.addEffect('bursts', 'graze', mx, my, 0.6);
        this.popup(`+${gain}`, mx, my - 8, 'cyan', 0.6);
        sfx.graze();
      }
    }
    for (const s of this.shards) {
      if (s.taken || Math.hypot(s.x - r.x, s.y - r.y) > 11) continue;
      s.taken = true;
      const gain = Math.round(25 * this.mult * (this.boost > 0 ? 2 : 1));
      this.score += gain; this.mult = Math.min(MULT_MAX, this.mult + 0.02); this.stats.shards++;
      this.addEffect('bursts', 'pickup-shard', s.x, s.y, 0.8);
      sfx.shard();
      const left = this.lineCounts.get(s.line) - 1;
      this.lineCounts.set(s.line, left);
      if (left === 0) { const bonus = Math.round(100 * this.mult); this.score += bonus; this.popup(`LINE +${bonus}`, s.x, s.y - 12, 'yellow', 0.9); }
    }
    this.shards = this.shards.filter(s => !s.taken);
    for (const item of this.items) {
      if (item.taken || Math.hypot(item.x - r.x, item.y - r.y) > 14) continue;
      item.taken = true; this.stats.powerups++;
      this.addEffect('bursts', `pickup-${item.type}`, item.x, item.y, 0.5);
      sfx.power();
      if (item.type === 'shield') { this.shield = SHIELD_TIME; this.popup('SHIELD', r.x, r.y - 28, 'green'); }
      if (item.type === 'boost') { this.boost = BOOST_TIME; this.popup('BOOST', r.x, r.y - 28, 'yellow'); sfx.boost(); }
      if (item.type === 'nova') this.nova();
    }
    this.items = this.items.filter(i => !i.taken);
  }

  smash(rock, byRocket) {
    if (rock.dead) return;
    rock.dead = true; this.stats.smashed++;
    const gain = Math.round(ROCKS[rock.size].points * this.mult);
    this.score += gain;
    this.addEffect('bursts', `break-${rock.neon}`, rock.x, rock.y, 0.7);
    if (byRocket) { this.popup(`+${gain}`, rock.x, rock.y - 10, 'white', 0.6); this.kick(2); }
    sfx.shatter();
  }

  nova() {
    const r = this.rocket;
    this.addEffect('nova', 'nova', r.x, r.y, 0);
    this.popup('NOVA', r.x, r.y - 28, 'pink');
    sfx.nova(); this.kick(5); this.flash = Math.max(this.flash, 0.5);
    // The wave travels outward; each rock on screen shatters as it arrives.
    for (const rock of this.rocks) {
      if (rock.y < -8) continue;
      rock.doom = this.time + Math.hypot(rock.x - r.x, rock.y - r.y) / 300;
    }
  }

  // The rocket breaks apart, as in the original: nose, cockpit, tail and both fins fly off spinning, arc up and fall.
  crash() {
    const r = this.rocket, s = this.scale;
    this.mode = 'dying'; this.dyingFor = 0;
    this.addEffect('boom', 'boom', r.x, r.y, 0.25);
    const launch = { nose: [0, -240], cockpit: [0, -205], tail: [0, -165], 'fin-l': [-140, -180], 'fin-r': [140, -180] };
    this.pieces = Object.entries(PIECES).map(([piece, offset]) => {
      const [ox, oy] = turn(offset, r.tilt), [lx, ly] = launch[piece];
      return { piece, x: r.x + ox, y: r.y + oy, rot: r.tilt,
        vx: (lx + (this.random() - 0.5) * 70 + r.vx * 0.35) * s, vy: (ly - this.random() * 40) * s,
        spin: (this.random() < 0.5 ? -1 : 1) * (200 + this.random() * 360) };
    });
    sfx.boom(); this.kick(10); this.flash = 1;
    this.shield = 0; this.boost = 0;
    if (this.score > this.best) { this.best = Math.floor(this.score); this.newBest = true; }
  }

  summary() {
    return { score: Math.floor(this.score), best: this.best, newBest: this.newBest, time: this.time, ...this.stats };
  }

  addEffect(sheet, animation, x, y, drift, loop = false) {
    this.effects.push({ sheet, animation, x, y, t: 0, drift, loop, length: lengthOf(sheet, animation) });
  }
  popup(text, x, y, ink = 'white', life = 1) {
    for (const p of this.popups) if (p.t < 0.3 && Math.abs(p.x - x) < 40 && Math.abs(p.y - p.t * 16 - y) < 10) y = p.y - p.t * 16 - 10;
    this.popups.push({ text, x: clamp(x, this.fx + textWidth(text) / 2 + 2, this.fx + this.fw - textWidth(text) / 2 - 2), y, ink, t: 0, life });
  }
  kick(amount) { if (!this.reducedMotion) this.shake = Math.max(this.shake, amount); }

  // ------------------------------------------------------------ drawing
  render(ctx, input) {
    const { vw, vh } = this, ms = this.clock;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = BG; ctx.fillRect(0, 0, vw, vh);
    ctx.save();
    if (this.shake > 0) ctx.translate(Math.round((this.random() - 0.5) * this.shake), Math.round((this.random() - 0.5) * this.shake));

    for (const d of this.decor) {
      ctx.globalAlpha = d.frame.startsWith('nebula') ? 0.75 : 0.42;
      draw(ctx, 'space', d.frame, d.x, Math.round(d.y));
    }
    ctx.globalAlpha = 1;
    this.tile(ctx, 'far', this.far);
    this.tile(ctx, frameOf('stars', 'near', ms), this.near);
    this.margins(ctx);

    for (const s of this.shards) draw(ctx, 'items', frameOf('items', 'shard', ms + s.phase), s.x, s.y);
    for (const item of this.items) draw(ctx, 'items', frameOf('items', item.type, ms + item.phase), item.x, item.y);
    for (const rock of this.rocks) draw(ctx, 'rocks', `${rock.neon}-${rock.size}-${Math.floor(rock.rot) % 16}`, rock.x, rock.y);

    const r = this.rocket;
    if (this.mode === 'title' || this.mode === 'playing' || this.mode === 'paused') {
      const blink = this.invuln > 0 && Math.floor(ms / 70) % 2;
      if (!blink) {
        if (this.boost > 0) this.speedLines(ctx, ms);
        const frame = this.tiltFrame(), entry = sheets.rocket.atlas.frames[frame];
        // The exhaust leaves from the tilted frame's own nozzle point, along the rocket's axis.
        const nx = r.x + entry.points.nozzle.x - entry.anchor.x, ny = r.y + entry.points.nozzle.y - entry.anchor.y;
        this.exhaust.draw(ctx, nx, ny, ms, r.tilt * Math.PI / 180);
        draw(ctx, 'rocket', r.flash > 0 ? 'flash' : frame, r.x, r.y);
      }
      if (this.shield > 0 && !(this.shield < 2 && Math.floor(ms / 110) % 2)) draw(ctx, 'shield', frameOf('shield', 'shield', ms), r.x, r.y);
    }
    for (const e of this.effects) draw(ctx, e.sheet, frameOf(e.sheet, e.animation, e.t), e.x, e.y);
    for (const p of this.pieces) draw(ctx, 'rocket', `${p.piece}-${(((Math.round(p.rot / 22.5)) % 16) + 16) % 16}`, p.x, p.y);
    for (const p of this.popups) {
      if (p.t > p.life * 0.75 && Math.floor(p.t * 20) % 2) continue;
      drawText(ctx, p.text, p.x, Math.round(p.y - p.t * 16), { ink: p.ink, align: 'center' });
    }
    ctx.restore();

    if (this.mode !== 'title') this.hud(ctx, input);
    if (this.flash > 0 && !this.reducedMotion) {
      ctx.fillStyle = `rgba(255,255,255,${(this.flash * 0.35).toFixed(3)})`;
      ctx.fillRect(0, 0, vw, vh);
    }
  }

  tile(ctx, frame, offset) {
    const y0 = Math.round(offset) - 128;
    for (let y = y0; y < this.vh; y += 128) for (let x = 0; x < this.vw; x += 128) draw(ctx, 'stars', frame, x, y);
  }

  // On wide screens the playfield is a lane: the space beside it dims, with a thin rail along each edge.
  margins(ctx) {
    const { fx, fw, vw, vh } = this;
    if (fw >= vw) return;
    ctx.fillStyle = 'rgba(7,4,15,0.55)';
    ctx.fillRect(0, 0, fx, vh); ctx.fillRect(fx + fw, 0, vw - fx - fw, vh);
    ctx.fillStyle = '#2a1f5c';
    ctx.fillRect(fx - 1, 0, 1, vh); ctx.fillRect(fx + fw, 0, 1, vh);
    const dash = Math.floor(this.near * 2) % 24;
    ctx.fillStyle = '#62f4f8';
    for (let y = dash - 24; y < vh; y += 24) { ctx.fillRect(fx - 1, y, 1, 6); ctx.fillRect(fx + fw, y + 12, 1, 6); }
  }

  speedLines(ctx, ms) {
    ctx.fillStyle = 'rgba(201,254,255,0.55)';
    for (let i = 0; i < 18; i++) {
      const x = this.fx + ((i * 73 + 17) % this.fw), len = 6 + (i * 5) % 10;
      const y = ((ms * (0.6 + (i % 4) * 0.15) + i * 97) % (this.vh + 40)) - 20;
      ctx.fillRect(x, Math.round(y), 1, len);
    }
  }

  hud(ctx, input) {
    const { fx, fw, vh } = this, top = 4 + this.insets.top;
    const side = fx >= 64;                         // room beside the lane on wide screens
    const x = side ? fx - 10 : fx + 5, align = side ? 'right' : 'left';
    drawText(ctx, formatScore(this.score), x, top, { align });
    let y = top + 11;
    if (side) { drawText(ctx, `BEST ${formatScore(Math.max(this.best, this.score))}`, x, y, { ink: 'cyan', align }); y += 11; }
    if (this.mult > 1.01) { drawText(ctx, `x${this.mult.toFixed(1)}`, x, y, { ink: 'yellow', align }); y += 11; }
    const bars = [];
    if (this.shield > 0) bars.push(['SHIELD', 'green', '#3dff8b', this.shield / SHIELD_TIME]);
    if (this.boost > 0) bars.push(['BOOST', 'yellow', '#ffd23f', this.boost / BOOST_TIME]);
    for (const [label, ink, color, share] of bars) {
      const w = drawText(ctx, label, x, y, { ink, align });
      const left = align === 'right' ? x - w : x;
      ctx.fillStyle = '#2a1f5c'; ctx.fillRect(left, y + 9, w, 2);
      ctx.fillStyle = color; ctx.fillRect(left, y + 9, Math.ceil(w * share), 2);
      y += 14;
    }
    if (this.mode !== 'playing') return;
    if (this.touch) {
      // Touch: the two halves of the screen are the controls; their arrows light while held.
      const held = input?.held() ?? { left: false, right: false }, by = vh - 16 - this.insets.bottom;
      drawText(ctx, '<', fx + 8, by, { ink: held.left ? 'cyan' : 'white' });
      drawText(ctx, '>', fx + fw - 8, by, { ink: held.right ? 'cyan' : 'white', align: 'right' });
      if (this.time < 4 && Math.floor(this.clock / 400) % 3) drawText(ctx, 'HOLD LEFT OR RIGHT', fx + fw / 2, Math.round(vh * 0.55), { ink: 'cyan', align: 'center' });
    } else if (side && this.time < 8) {
      const hx = fx + fw + 10;
      drawText(ctx, 'ARROWS OR A D', hx, top, { ink: 'white' });
      drawText(ctx, 'P PAUSE', hx, top + 15, { ink: 'cyan' });
      drawText(ctx, 'M SOUND', hx, top + 26, { ink: 'cyan' });
    } else if (!side && this.time < 4 && Math.floor(this.clock / 400) % 3) {
      drawText(ctx, 'ARROWS OR A D', fx + fw / 2, Math.round(vh * 0.55), { ink: 'cyan', align: 'center' });
    }
  }
}
