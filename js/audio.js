// Sound effects and a quiet synthwave loop, synthesised with Web Audio: no sound files to download.
// Browsers start audio only after a tap or key press, so nothing is created until unlock() runs from one.
let ctx = null, master = null, sfxBus = null, musicBus = null, noise = null;
let soundOn = true, musicOn = true;
let music = null, wind = null, paceLevel = 0, paceSent = -1;

export function unlock() {
  if (!ctx) {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = soundOn ? 0.8 : 0;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -10; limiter.ratio.value = 8;
    master.connect(limiter).connect(ctx.destination);
    sfxBus = ctx.createGain(); sfxBus.gain.value = 0.55; sfxBus.connect(master);
    musicBus = ctx.createGain(); musicBus.gain.value = musicOn ? 0.22 : 0; musicBus.connect(master);
    noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noise.getChannelData(0);
    let seed = 1;
    for (let i = 0; i < data.length; i++) { seed = (seed * 16807) % 2147483647; data[i] = seed / 1073741823.5 - 1; }
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
}

export function suspend() { if (ctx && ctx.state === 'running') ctx.suspend().catch(() => {}); }
export function resume() { if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {}); }

export function setSound(on) {
  soundOn = on;
  if (master) master.gain.setTargetAtTime(on ? 0.8 : 0, ctx.currentTime, 0.02);
}
export function setMusic(on) {
  musicOn = on;
  if (musicBus) musicBus.gain.setTargetAtTime(on ? 0.22 : 0, ctx.currentTime, 0.05);
}

const ready = () => ctx && ctx.state === 'running' && soundOn;

function tone({ type = 'square', from, to = from, time = 0.12, gain = 0.3, at = 0, bus = sfxBus, attack = 0.005 }) {
  const t = ctx.currentTime + at, osc = ctx.createOscillator(), env = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(from, t);
  if (to !== from) osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t + time);
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(gain, t + attack);
  env.gain.exponentialRampToValueAtTime(0.0001, t + time);
  osc.connect(env).connect(bus);
  osc.start(t); osc.stop(t + time + 0.02);
}

function hiss({ time = 0.3, gain = 0.4, from = 2000, to = 300, q = 0.8, type = 'lowpass', at = 0 }) {
  const t = ctx.currentTime + at, src = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), env = ctx.createGain();
  src.buffer = noise;
  filter.type = type; filter.Q.value = q;
  filter.frequency.setValueAtTime(from, t);
  filter.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + time);
  env.gain.setValueAtTime(gain, t);
  env.gain.exponentialRampToValueAtTime(0.0001, t + time);
  src.connect(filter).connect(env).connect(sfxBus);
  src.start(t, Math.random() * 0.5); src.stop(t + time + 0.02);
}

let shardStep = 0, shardTime = 0;
export const sfx = {
  shard() {
    if (!ready()) return;
    // Quick pickups climb a little scale, so a line of shards plays a run.
    shardStep = ctx.currentTime - shardTime < 0.5 ? Math.min(shardStep + 1, 7) : 0;
    shardTime = ctx.currentTime;
    const f = 880 * 2 ** ([0, 2, 4, 7, 9, 12, 14, 16][shardStep] / 12);
    tone({ type: 'square', from: f, to: f * 1.5, time: 0.08, gain: 0.12 });
  },
  // Each near miss whooshes past and pings a little higher as the speed gauge fills.
  graze(surge = 0) {
    if (!ready()) return;
    const f = 1320 * 2 ** surge;
    tone({ type: 'triangle', from: f, to: f * 1.5, time: 0.07, gain: 0.14 });
    hiss({ time: 0.16, gain: 0.16, from: 6000, to: 900, type: 'bandpass', q: 1.4 });
  },
  maxSpeed() {
    if (!ready()) return;
    [659, 880, 1175, 1568].forEach((f, i) => tone({ type: 'sawtooth', from: f, to: f * 1.02, time: 0.14, gain: 0.1, at: i * 0.045 }));
  },
  power() {
    if (!ready()) return;
    [523, 659, 784, 1047].forEach((f, i) => tone({ type: 'square', from: f, time: 0.1, gain: 0.12, at: i * 0.05 }));
  },
  shieldPop() { if (ready()) { hiss({ time: 0.35, gain: 0.35, from: 4000, to: 400 }); tone({ type: 'sawtooth', from: 900, to: 120, time: 0.3, gain: 0.15 }); } },
  shatter() { if (ready()) { hiss({ time: 0.22, gain: 0.3, from: 3000, to: 500, type: 'bandpass', q: 1.2 }); tone({ type: 'square', from: 220, to: 70, time: 0.12, gain: 0.12 }); } },
  boost() { if (ready()) { tone({ type: 'sawtooth', from: 110, to: 880, time: 0.5, gain: 0.16 }); hiss({ time: 0.6, gain: 0.2, from: 300, to: 5000, type: 'bandpass', q: 2 }); } },
  nova() { if (ready()) { hiss({ time: 0.9, gain: 0.45, from: 200, to: 6000, type: 'bandpass', q: 1.5 }); tone({ type: 'sine', from: 60, to: 30, time: 0.8, gain: 0.5 }); } },
  boom() {
    if (!ready()) return;
    hiss({ time: 1.4, gain: 0.7, from: 1800, to: 60 });
    tone({ type: 'sine', from: 140, to: 28, time: 1.1, gain: 0.7 });
    tone({ type: 'square', from: 300, to: 40, time: 0.4, gain: 0.15 });
  },
  click() { if (ready()) tone({ type: 'square', from: 660, time: 0.04, gain: 0.08 }); },
  knock(strength = 0.5) { if (ready()) { hiss({ time: 0.08, gain: 0.12 * strength, from: 1400, to: 300, type: 'bandpass', q: 2 }); tone({ type: 'triangle', from: 150, to: 70, time: 0.09, gain: 0.18 * strength }); } },
};

// ---------------------------------------------------------------- pace
// The rush of speed: a wind of filtered noise that rises and brightens with the speed, and a music tempo that climbs
// from 108 to 156 BPM. level: 0 cruising (or not flying) to 1 flat out.
export function pace(level) {
  paceLevel = level;
  if (!ctx || ctx.state !== 'running' || Math.abs(level - paceSent) < 0.01) return;
  paceSent = level;
  if (!wind) {
    const length = ctx.sampleRate * 4, buffer = ctx.createBuffer(1, length, ctx.sampleRate), data = buffer.getChannelData(0);
    let seed = 7, last = 0;
    for (let i = 0; i < length; i++) { seed = (seed * 16807) % 2147483647; last = last * 0.6 + (seed / 1073741823.5 - 1) * 0.4; data[i] = last * 1.8; }
    const src = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), gain = ctx.createGain();
    src.buffer = buffer; src.loop = true;
    filter.type = 'bandpass'; filter.Q.value = 0.8; filter.frequency.value = 400;
    gain.gain.value = 0;
    src.connect(filter).connect(gain).connect(sfxBus);
    src.start();
    wind = { filter, gain };
  }
  const t = ctx.currentTime;
  wind.filter.frequency.setTargetAtTime(350 + 2600 * level, t, 0.2);
  wind.gain.gain.setTargetAtTime(level > 0.02 ? 0.04 + 0.3 * level * level : 0, t, level > 0.02 ? 0.2 : 0.08);
}

// ---------------------------------------------------------------- music
// A 16-step loop in A minor: a pulsing bass, a slow pad and a sparse arpeggio, scheduled a little ahead. Its tempo
// follows the speed.
const tempo = () => 108 + 48 * paceLevel;
const CHORDS = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]]; // Am F C G
const hz = midi => 440 * 2 ** ((midi - 69) / 12);

export function startMusic() {
  if (!ctx || music) return;
  music = { step: 0, next: ctx.currentTime + 0.1, timer: 0 };
  const schedule = () => {
    if (!music) return;
    while (music.next < ctx.currentTime + 0.25) {
      playStep(music.step, music.next);
      music.step = (music.step + 1) % 64;
      music.next += 60 / tempo() / 4;
    }
    music.timer = setTimeout(schedule, 60);
  };
  schedule();
}
export function stopMusic() {
  if (!music) return;
  clearTimeout(music.timer);
  music = null;
}

function voice(type, freq, start, length, gain, cutoff) {
  const osc = ctx.createOscillator(), env = ctx.createGain(), filter = ctx.createBiquadFilter();
  osc.type = type; osc.frequency.value = freq;
  filter.type = 'lowpass'; filter.frequency.value = cutoff;
  env.gain.setValueAtTime(0.0001, start);
  env.gain.exponentialRampToValueAtTime(gain, start + 0.01);
  env.gain.exponentialRampToValueAtTime(0.0001, start + length);
  osc.connect(filter).connect(env).connect(musicBus);
  osc.start(start); osc.stop(start + length + 0.05);
}

function playStep(step, t) {
  const STEP = 60 / tempo() / 4;
  const chord = CHORDS[Math.floor(step / 16)], beat = step % 16;
  if (beat % 2 === 0) voice('sawtooth', hz(chord[0] - 24), t, STEP * 1.6, 0.5, 420 + (beat % 4 === 0 ? 300 : 0));
  if (beat === 0) for (const note of chord) voice('triangle', hz(note), t, STEP * 15, 0.12, 1800);
  if ([2, 5, 7, 10, 13].includes(beat)) voice('square', hz(chord[(beat * 7) % 3] + 12), t, STEP * 0.9, 0.06, 2600);
  if (beat % 4 === 2) {
    const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), env = ctx.createGain();
    src.buffer = noise; f.type = 'highpass'; f.frequency.value = 7000;
    env.gain.setValueAtTime(0.12, t); env.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    src.connect(f).connect(env).connect(musicBus); src.start(t, (step * 0.013) % 0.5); src.stop(t + 0.06);
  }
}
