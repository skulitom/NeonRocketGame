// Neon Voyage: page wiring. Scales the canvas by whole numbers, runs a fixed-step loop and drives the menus.
import { loadAssets, formatScore } from './assets.js';
import { Input } from './input.js';
import { Exhaust } from './exhaust.js';
import { Game } from './game.js';
import * as audio from './audio.js';
import * as store from './store.js';

const $ = id => document.getElementById(id);
const stage = $('play'), canvas = $('game'), ctx = canvas.getContext('2d', { alpha: false });
const overlays = { loading: $('loading'), title: $('title'), paused: $('paused'), over: $('over') };
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const coarse = matchMedia('(pointer: coarse)');
const URL_CANONICAL = 'https://skulitom.github.io/NeonRocketGame/';
const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);

let game = null, input = null, view = { cssPerGame: 1 }, confirmAfter = 0, visible = true, lastSummary = null;
const settings = { sound: store.read('sound', true), music: store.read('music', true) };
const exhaust = new Exhaust();

// ---------------------------------------------------------------- scaling
// The game draws at a small size and the canvas is enlarged by a whole number of device pixels, so every art pixel
// is the same size on screen. About 240 game pixels fill the height; narrow phones are limited by width instead.
const probe = document.createElement('div');
probe.style.cssText = 'position:fixed;inset:0;pointer-events:none;visibility:hidden;padding:env(safe-area-inset-top) 0 env(safe-area-inset-bottom)';
document.body.append(probe);

function resize() {
  const rect = stage.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  // A minimised window or a rotation in progress can report no size at all; keep the last good one.
  if (rect.width < 60 || rect.height < 60) return;
  const W = Math.round(rect.width * dpr), H = Math.round(rect.height * dpr);
  const s = Math.max(1, Math.min(Math.floor(H / 240), Math.floor(W / 180)));
  const vw = Math.max(1, Math.floor(W / s)), vh = Math.max(1, Math.floor(H / s));
  if (canvas.width !== vw || canvas.height !== vh) { canvas.width = vw; canvas.height = vh; }
  const cssPerGame = s / dpr;
  Object.assign(canvas.style, {
    width: `${vw * cssPerGame}px`, height: `${vh * cssPerGame}px`,
    left: `${Math.floor((W - vw * s) / 2) / dpr}px`, top: `${Math.floor((H - vh * s) / 2) / dpr}px`,
  });
  view = { cssPerGame, s, dpr };
  const style = getComputedStyle(probe);
  const inset = v => Math.ceil((parseFloat(v) || 0) / cssPerGame);
  game?.resize(vw, vh, { top: inset(style.paddingTop), bottom: inset(style.paddingBottom) });
}

function toGame(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  return [(clientX - rect.left) / view.cssPerGame, (clientY - rect.top) / view.cssPerGame];
}
Object.defineProperty(toGame, 'scale', { get: () => 1 / view.cssPerGame });

// ---------------------------------------------------------------- menus
function show(name) {
  for (const [key, el] of Object.entries(overlays)) el.hidden = key !== name;
  document.body.classList.toggle('playing', name === null);
  stage.classList.toggle('active', name === null);
}

function startGame() {
  if (!game) return;
  audio.unlock();
  if (settings.music) audio.startMusic();
  exhaust.start();
  game.best = store.readBest();
  input.takeDrag(); // a finger left down since the crash must not jolt the new rocket
  game.start();
  show(null);
  if (stage.getBoundingClientRect().top !== 0) stage.scrollIntoView({ block: 'start' });
  canvas.focus({ preventScroll: true });
}

function pause() {
  if (game?.mode !== 'playing') return;
  game.mode = 'paused';
  audio.suspend();
  show('paused');
  $('resumeBtn').focus({ preventScroll: true });
}
function resume() {
  if (game?.mode !== 'paused') return;
  game.mode = 'playing';
  input.takeDrag();
  audio.resume();
  show(null);
  canvas.focus({ preventScroll: true });
}
function togglePause() { if (game?.mode === 'playing') pause(); else if (game?.mode === 'paused') resume(); }

function toTitle() {
  audio.resume();
  game.mode = 'title';
  game.reset();
  game.resize(game.vw, game.vh);
  showTitle();
}
function showTitle() {
  $('bestTitle').textContent = formatScore(store.readBest());
  show('title');
  $('playBtn').focus({ preventScroll: true });
}

function gameOver(summary) {
  lastSummary = summary;
  if (summary.newBest) store.write('best', summary.best);
  $('finalScore').textContent = formatScore(summary.score);
  $('finalBest').textContent = formatScore(Math.max(summary.best, store.readBest()));
  $('newBest').hidden = !summary.newBest;
  $('statTime').textContent = `${Math.floor(summary.time / 60)}:${String(Math.floor(summary.time % 60)).padStart(2, '0')}`;
  $('statShards').textContent = summary.shards;
  $('statGrazes').textContent = summary.grazes;
  $('statSmashed').textContent = summary.smashed;
  show('over');
  confirmAfter = performance.now() + 700; // a key still held from the crash doesn't restart at once
  $('againBtn').focus({ preventScroll: true });
}

function confirm() {
  if (!game) return false;
  if (game.mode === 'title') { startGame(); return true; }
  if (game.mode === 'paused') { resume(); return true; }
  if (game.mode === 'over' && performance.now() > confirmAfter) { startGame(); return true; }
  return false;
}

function setSound(on) {
  settings.sound = on; store.write('sound', on);
  audio.setSound(on);
  const button = $('soundBtn');
  button.setAttribute('aria-pressed', String(on));
  button.setAttribute('aria-label', on ? 'Sound on (M)' : 'Sound off (M)');
  button.classList.toggle('off', !on);
}
function setMusic(on) {
  settings.music = on; store.write('music', on);
  audio.setMusic(on);
  if (on && game?.mode === 'playing') audio.startMusic();
  $('musicBtn').setAttribute('aria-pressed', String(on));
  $('musicBtn').textContent = on ? 'Music: on' : 'Music: off';
}

async function share() {
  const score = lastSummary ? formatScore(lastSummary.score) : null;
  const text = score ? `I scored ${score} in Neon Voyage, a free pixel-art rocket game.` : 'Neon Voyage, a free pixel-art rocket game.';
  if (navigator.share) {
    try { await navigator.share({ title: 'Neon Voyage', text, url: URL_CANONICAL }); } catch { /* closed */ }
    return;
  }
  try {
    await navigator.clipboard.writeText(`${text} ${URL_CANONICAL}`);
    toast('Copied to the clipboard');
  } catch {
    toast(URL_CANONICAL);
  }
}
let toastTimer = 0;
function toast(message) {
  const el = $('toast');
  el.textContent = message; el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2400);
}

// ---------------------------------------------------------------- loop
const STEP = 1 / 60;
let last = performance.now(), accumulator = 0;
function step() {
  for (const button of input.pollGamepad()) {
    if (button === 0) confirm();
    if (button === 9) togglePause();
  }
  game.update(STEP, input, toGame);
}
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (game && (visible || game.mode === 'playing')) {
    accumulator += dt;
    let n = 0;
    while (accumulator >= STEP && n < 8) { step(); accumulator -= STEP; n++; }
    if (n === 8) accumulator = 0;
    game.render(ctx);
  }
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- start
async function boot() {
  resize();
  try {
    await loadAssets(share => { $('loadingBar').style.width = `${Math.round(share * 100)}%`; });
  } catch (error) {
    console.error(error);
    $('loadingText').textContent = 'The game could not load. Check your connection and reload the page.';
    return;
  }
  game = new Game({ exhaust, onGameOver: gameOver, reducedMotion: reducedMotion.matches });
  input = new Input(stage, { onPause: togglePause, onMute: () => setSound(!settings.sound), onConfirm: confirm, isPlaying: () => game.mode === 'playing' });
  game.best = store.readBest();
  game.touch = coarse.matches;
  resize();
  showTitle();
  requestAnimationFrame(frame);
  // The fluid solver loads after the first frame; the baked plume shows until then.
  setTimeout(() => exhaust.start(), 300);
  if (local || new URLSearchParams(location.search).has('debug')) exposeForTests();
}

reducedMotion.addEventListener?.('change', e => { if (game) game.reducedMotion = e.matches; });
addEventListener('resize', resize);
new ResizeObserver(() => resize()).observe(stage);
screen.orientation?.addEventListener?.('change', resize);
document.addEventListener('visibilitychange', () => { if (document.hidden) { pause(); audio.suspend(); } else if (game?.mode !== 'paused') audio.resume(); });
addEventListener('blur', pause);
new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; if (!visible) pause(); }).observe(stage);

$('playBtn').addEventListener('click', startGame);
$('againBtn').addEventListener('click', () => { if (performance.now() > confirmAfter - 400) startGame(); });
$('resumeBtn').addEventListener('click', resume);
$('quitBtn').addEventListener('click', toTitle);
$('menuBtn').addEventListener('click', toTitle);
$('pauseBtn').addEventListener('click', togglePause);
$('soundBtn').addEventListener('click', () => { audio.unlock(); setSound(!settings.sound); });
$('musicBtn').addEventListener('click', () => { audio.unlock(); setMusic(!settings.music); });
$('shareBtn').addEventListener('click', share);
for (const link of document.querySelectorAll('a[href="#play"]')) link.addEventListener('click', e => {
  e.preventDefault();
  stage.scrollIntoView({ behavior: reducedMotion.matches ? 'auto' : 'smooth', block: 'start' });
  if (game?.mode === 'title') $('playBtn').focus({ preventScroll: true });
});
const fullscreen = $('fsBtn');
if (document.fullscreenEnabled && stage.requestFullscreen) {
  fullscreen.hidden = false;
  fullscreen.addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else stage.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
  });
  document.addEventListener('fullscreenchange', () => {
    fullscreen.setAttribute('aria-label', document.fullscreenElement ? 'Leave full screen' : 'Full screen');
    resize();
  });
}
document.body.classList.toggle('touch', coarse.matches);
setSound(settings.sound);
setMusic(settings.music);

// A deterministic driver for automated checks on a local server (or with ?debug): step time without animation
// frames, which a hidden browser tab barely runs.
function exposeForTests() {
  window.neonVoyage = {
    get game() { return game; }, input, exhaust, startGame, pause, resume, toTitle,
    advance(ms) { for (let t = 0; t < ms; t += STEP * 1000) step(); game.render(ctx); return game.mode; },
    frame: () => canvas.toDataURL('image/png'),
  };
}

boot();
