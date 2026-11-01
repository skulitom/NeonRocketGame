#!/usr/bin/env node
// Builds every game asset from the Pixelbolt recipes and sources in this folder.
//
//   node art/build.mjs --pixelbolt <Pixelbolt checkout>        writes assets/*.png and assets/*.atlas.json
//   node art/build.mjs --pixelbolt <checkout> --keep <dir>     also writes each compiled recipe there, to inspect
//
// The output is deterministic: the same sources and Pixelbolt commit give the same bytes.
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ART = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(ART, '..');
const ASSETS = join(ROOT, 'assets');
const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const PIXELBOLT = resolve(option('--pixelbolt') ?? process.env.PIXELBOLT ?? join(ROOT, '..', 'PixelForge'));
const KEEP = option('--keep');
const only = option('--only')?.split(',');

const pb = await import(pathToFileURL(join(PIXELBOLT, 'src', 'index.js')).href);

const readJSON = async file => JSON.parse(await readFile(join(ART, file), 'utf8'));
// Shared palette references resolve against this folder, as the CLI resolves them.
async function load(file) {
  const { document } = await pb.resolveReferences(await readJSON(file), { baseDir: ART });
  return document;
}

const written = [];
async function emit(recipe, name = recipe.name) {
  recipe = { ...recipe, name, sheet: { trim: true, padding: 0, ...recipe.sheet } };
  const project = pb.renderProject(recipe);
  for (const warning of project.warnings) console.warn(`${name}: ${warning}`);
  const atlas = pb.buildAtlas(project);
  await mkdir(ASSETS, { recursive: true });
  await writeFile(join(ASSETS, `${name}.png`), pb.encodePNG(atlas.data, atlas.width, atlas.height));
  await writeFile(join(ASSETS, `${name}.atlas.json`), JSON.stringify(atlas.metadata));
  if (KEEP) { await mkdir(KEEP, { recursive: true }); await writeFile(join(KEEP, `${name}.json`), pb.formatJSON(recipe)); }
  written.push(`${name}: ${project.frames.length} frames, sheet ${atlas.width}x${atlas.height}`);
  return { project, atlas };
}

// ---------------------------------------------------------------- rocket
// rocket.poses.json holds the ship's three roll frames and turns them through the tilt angles with RotSprite; each
// tilted frame carries the turned nozzle point, so the exhaust leaves from the right pixel. When the ship is hit it
// breaks into the pieces cut below from its centre frame, each spun through 16 angles, also by RotSprite.
const PIECES = {          // [first row, last row, first column, last column] of the centre frame
  nose: [0, 5, 8, 14],
  cockpit: [6, 13, 7, 15],
  tail: [14, 24, 8, 14],
  'fin-l': [14, 22, 2, 7],
  'fin-r': [14, 22, 15, 20],
};
async function rocketRecipe() {
  const source = await load('rocket.poses.json');
  const center = source.parts.center.rows;
  const parts = { ...source.parts }, poses = [...source.poses], animations = {};
  for (const [piece, [r0, r1, c0, c1]] of Object.entries(PIECES)) {
    const rows = center.slice(r0, r1 + 1).map(row => row.slice(c0, c1 + 1));
    parts[piece] = { rows, anchor: [Math.floor(rows[0].length / 2), Math.floor(rows.length / 2)] };
    const names = [];
    for (let i = 0; i < 16; i++) {
      const name = `${piece}-${i}`, angle = Math.round(i * 22.5);
      names.push(name);
      poses.push({ name, duration: 50, origin: [18, 18], parts: [{ name: 'piece', part: piece, ...(angle && { rotate: angle }) }] });
    }
    animations[`spin-${piece}`] = { frames: names };
  }
  const { recipe, warnings = [] } = pb.compilePoses({ ...source, parts, poses });
  for (const warning of warnings) console.warn(`rocket: ${warning}`);
  const flash = { name: 'flash', duration: 60, points: recipe.frames.find(f => f.name === 'tilt-0').points,
    ops: [{ op: 'copy', from: 'tilt-0', remap: { s: 'W', H: 'w', h: 'c', n: 'W', m: 'w', M: 'c', q: 'c', C: 'w', c: 'W' } }] };
  return { ...recipe, frames: [...recipe.frames, flash], animations: { ...animations, hit: { frames: ['flash', 'tilt-0', 'flash', 'tilt-0'], loop: false } } };
}
const rocket = async () => emit(await rocketRecipe());

// ---------------------------------------------------------------- rocks
// RotSprite turns each rock body through 16 angles (the poses source). The light stays put: after rotation every frame
// gets a rim light on its upper-left edge, a shadow on its lower-right edge, a neon edge and a translucent glow ring.
// Each hazard colour is then a copy of those frames with the neon swapped.
const NEONS = [
  { tag: 'pink', edge: 'm', glow: '#ff3fa466' },
  { tag: 'orange', edge: 'o', glow: '#ff8a2b66' },
  { tag: 'violet', edge: 'v', glow: '#8f5cff70' },
];
async function rockRecipe() {
  const source = await load('rocks.poses.json');
  const { recipe, warnings = [] } = pb.compilePoses(source);
  for (const warning of warnings) console.warn(`rocks: ${warning}`);
  // Each pose is one layer with one stamp of the rotated rock; as frame ops, the lighting below draws after it.
  for (const frame of recipe.frames) { frame.ops = frame.layers.flatMap(layer => layer.ops); delete frame.layers; }
  const lit = [
    // RotSprite can leave a one-pixel spike on an edge; a pixel open on three sides is cut before lighting.
    { op: 'rewrite', empty: '_', rotate: true, rules: [{ match: ['._.', '_._'], replace: ['...', '._.'] }] },
    { op: 'outline', color: 'b', position: 'inside', width: 2, directions: ['...', '..x', '.xx'] },
    { op: 'outline', color: 'f', position: 'inside', directions: ['xx.', 'x..', '...'] },
    { op: 'outline', color: 'm', position: 'outside' },
    { op: 'outline', color: NEONS[0].glow, position: 'outside' },
  ];
  const base = recipe.frames.map(frame => ({ ...frame, name: `${NEONS[0].tag}-${frame.name}`, ops: [...frame.ops, ...lit] }));
  const frames = [...base];
  for (const neon of NEONS.slice(1)) for (const frame of base) frames.push({
    name: frame.name.replace(NEONS[0].tag, neon.tag), duration: frame.duration, ...(frame.anchor && { anchor: frame.anchor }),
    ops: [{ op: 'copy', from: frame.name, remap: { m: neon.edge, [NEONS[0].glow]: neon.glow } }],
  });
  const animations = {};
  for (const neon of NEONS) for (const [key, animation] of Object.entries(recipe.animations)) {
    animations[`${neon.tag}-${key}`] = { ...animation, frames: animation.frames.map(name => `${neon.tag}-${name}`) };
  }
  return { ...recipe, frames, animations };
}
const rocks = async () => emit(await rockRecipe());

// ---------------------------------------------------------------- pickups
async function items() {
  await emit(await load('items.json'));
}

// ---------------------------------------------------------------- effects
// Particle and shape sources compile to ordinary recipes; the game draws each effect around its centre.
async function effect(file) {
  const source = await load(file);
  const { recipe, warnings = [] } = pb.compileEffects(source);
  for (const warning of warnings) console.warn(`${file}: ${warning}`);
  await emit({ ...recipe, anchor: [Math.floor(recipe.width / 2), Math.floor(recipe.height / 2)] });
}
const boom = () => effect('boom.fx.json');
const bursts = () => effect('bursts.fx.json');
const shield = () => effect('shield.fx.json');
const nova = () => effect('nova.fx.json');

// ---------------------------------------------------------------- exhaust
// The game runs this source live (createLiveFluid). A baked loop of it, turned to point down, is the stand-in until
// the live runner starts and the plume on the link card. Gas rises in the simulation; the game flips it under the nozzle.
async function bakeExhaust() {
  const source = await load('exhaust.fluid.json');
  const { recipe, warnings = [] } = pb.compileFluid(source);
  for (const warning of warnings) console.warn(`exhaust: ${warning}`);
  const down = recipe.frames.map((frame, i) => ({ name: `down-${i}`, duration: frame.duration, from: frame.name, flipY: true }));
  // Only the turned frames go to the game; the upright ones are the simulation's own view.
  const turned = { ...recipe, anchor: [10, 0], frames: [...recipe.frames, ...down], animations: { down: { frames: down.map(f => f.name) } } };
  return turned;
}
async function exhaust() {
  const turned = await bakeExhaust();
  const project = pb.renderProject(turned);
  const keep = project.frames.filter(frame => frame.name.startsWith('down-')).map(frame => frame.name);
  // A recipe with only the turned frames: each copies its rendered upright frame flipped, so no simulation runs twice.
  const frames = keep.map(name => ({ name, duration: project.frames.find(f => f.name === name).duration, pixels: pixelsOf(project, name) }));
  await emit({ version: 1, name: 'exhaust', width: turned.width, height: turned.height, anchor: [10, 0], palette: turned.palette, frames, animations: turned.animations });
  // The live runner reads the source itself, palette inlined, as a page can't follow a palette reference.
  await writeFile(join(ASSETS, 'exhaust.fluid.json'), JSON.stringify(await load('exhaust.fluid.json')));
}
// Exact pixels of a rendered frame as `pixels` corrections, so a derived recipe keeps them without re-simulating.
function pixelsOf(project, name) {
  const frame = project.frames.find(f => f.name === name), out = [];
  for (let y = 0; y < project.height; y++) for (let x = 0; x < project.width; x++) {
    const k = (y * project.width + x) * 4, a = frame.data[k + 3];
    if (!a) continue;
    const hex = [0, 1, 2].map(c => frame.data[k + c].toString(16).padStart(2, '0')).join('') + (a === 255 ? '' : a.toString(16).padStart(2, '0'));
    out.push({ x, y, color: `#${hex}` });
  }
  return out;
}

// ---------------------------------------------------------------- backdrop
async function stars() {
  const recipe = await load('stars.json');
  await emit({ ...recipe, sheet: { trim: false } }); // tiles keep their full 128 x 128 so they repeat seamlessly
}
const space = async () => emit(await load('space.json'));
const logo = async () => emit(await load('logo.json'));

// ---------------------------------------------------------------- font
// Every letter the canvas draws is Pixelbolt's built-in font: one frame per glyph with a dark edge, its advance as a
// point, and colour variants copied with a remap.
const GLYPHS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZx.,:!?+-%/'<>";
const INKS = { white: 'W', yellow: 'y', cyan: 'c', pink: 'n', green: 'l' };
async function font() {
  const { document: base } = await pb.resolveReferences({ palette: { $ref: 'palette.json' } }, { baseDir: ART });
  const frames = [];
  for (const ch of GLYPHS) {
    const { width } = pb.measureText(ch);
    frames.push({ name: `white-${ch.charCodeAt(0)}`, duration: 100, points: { advance: [width, 0] },
      ops: [{ op: 'text', x: 1, y: 1, text: ch, color: 'W' }, { op: 'outline', color: 'k' }] });
  }
  const white = [...frames];
  for (const [ink, key] of Object.entries(INKS)) if (ink !== 'white') for (const frame of white) frames.push({
    name: frame.name.replace('white', ink), duration: 100, points: frame.points, ops: [{ op: 'copy', from: frame.name, remap: { W: key } }],
  });
  await emit({ version: 1, name: 'font', width: 7, height: 10, anchor: [1, 1], palette: base.palette, frames });
}

// ---------------------------------------------------------------- icons
// The rocket's own grid on a round badge (favicon) and on a full square (home-screen icons, which the system rounds).
async function icons() {
  const rocketSource = await load('rocket.poses.json');
  const flame = ['cWc', '.c.', '.C.'];
  const draw = (size, round) => {
    const ox = Math.floor((size - 23) / 2), oy = Math.floor((size - 28) / 2);
    return [
      round ? { op: 'ellipse', x: 0, y: 0, w: size, h: size, color: '2' } : { op: 'rect', x: 0, y: 0, w: size, h: size, color: '2' },
      ...(round ? [{ op: 'ellipse', x: 0, y: 0, w: size, h: size, color: 'C', filled: false }] : []),
      { op: 'stamp', symbol: 'rocket', x: ox, y: oy },
      { op: 'grid', x: ox + 10, y: oy + 25, rows: flame },
    ];
  };
  const icon = (name, size, round) => ({ version: 1, name, width: size, height: size, palette: rocketSource.palette,
    symbols: { rocket: rocketSource.parts.center.rows }, frames: [{ name, ops: draw(size, round) }] });
  const out = [['favicon', 32, true, 1], ['icon-192', 32, false, 6], ['icon-512', 32, false, 16], ['apple-touch-icon', 36, false, 5]];
  for (const [name, size, round, scale] of out) {
    const project = pb.renderProject(icon(name, size, round));
    const frame = project.frames[0];
    await writeFile(join(ASSETS, `${name}.png`), pb.encodePNG(pb.scalePixels(frame.data, size, size, scale), size * scale, size * scale));
    written.push(`${name}: ${size * scale}x${size * scale}`);
  }
}

// ---------------------------------------------------------------- link card
// A Pixelbolt scene: the same recipes as the game, placed and rendered at 240 x 126, then enlarged 5x to 1200 x 630.
async function card() {
  const { document } = await pb.resolveReferences(await readJSON('og.scene.json'), { baseDir: ART });
  // The rocks as the game has them (lit after rotation, three neons) come from the rocks build; inline them here.
  document.assets.rocks = await rockRecipe();
  document.assets.exhaust = await bakeExhaust();
  document.assets.rocket = await rocketRecipe();
  // The plume hangs from the tilted frame's own nozzle point.
  const ship = document.instances.find(i => i.name === 'rocket'), plume = document.instances.find(i => i.name === 'exhaust');
  const nozzle = document.assets.rocket.frames.find(f => f.name === ship.frame).points.nozzle, [ax, ay] = document.assets.rocket.anchor;
  plume.at = [ship.at[0] + nozzle[0] - ax, ship.at[1] + nozzle[1] - ay];
  document.assets.tagline = { version: 1, name: 'tagline', width: 100, height: 12, palette: { W: '#ffffff', k: '#140f2b', c: '#62f4f8' },
    frames: [{ name: 'tagline', ops: [{ op: 'text', x: 50, y: 2, text: 'FREE BROWSER GAME', color: 'c', align: 'center' }, { op: 'outline', color: 'k' }] }] };
  const scene = pb.prepareScene(document);
  const view = pb.renderScene(scene, { time: 0 });
  const image = pb.sceneImage(view, { scale: 5 });
  await writeFile(join(ASSETS, 'og-image.png'), pb.encodePNG(image.data, image.width, image.height));
  written.push(`og-image: ${image.width}x${image.height}`);
}

// ---------------------------------------------------------------- runtime
// The page imports Pixelbolt's own modules: the fluid solver for the live exhaust and the atlas player. Copy them, with
// everything they import, from the same commit the art was built with.
async function vendor() {
  const out = join(ROOT, 'vendor', 'pixelbolt');
  await mkdir(out, { recursive: true });
  const queue = ['fluid.js', 'runtime.js'], seen = new Set();
  while (queue.length) {
    const file = queue.shift();
    if (seen.has(file)) continue;
    seen.add(file);
    const text = await readFile(join(PIXELBOLT, 'src', file), 'utf8');
    for (const [, dep] of text.matchAll(/^import [^;]*? from '\.\/([\w-]+\.js)';/gm)) queue.push(dep);
    await copyFile(join(PIXELBOLT, 'src', file), join(out, file));
  }
  await copyFile(join(PIXELBOLT, 'LICENSE'), join(out, 'LICENSE'));
  written.push(`vendor: ${[...seen].sort().join(', ')}`);
}

// ---------------------------------------------------------------- page media
// GIFs and strips for the page and the README, from the same recipes, on the page's panel colour.
const PANEL = [15, 10, 36, 255];
function canvas(width, height) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) data.set(PANEL, i);
  return { width, height, data };
}
function blit(target, project, name, dx, dy) {
  const frame = project.frames.find(f => f.name === name);
  if (!frame) throw new Error(`${project.name} has no frame ${name}`);
  for (let y = 0; y < project.height; y++) for (let x = 0; x < project.width; x++) {
    const tx = dx + x, ty = dy + y;
    if (tx < 0 || ty < 0 || tx >= target.width || ty >= target.height) continue;
    const s = (y * project.width + x) * 4, a = frame.data[s + 3] / 255, t = (ty * target.width + tx) * 4;
    if (!a) continue;
    for (let c = 0; c < 3; c++) target.data[t + c] = Math.round(frame.data[s + c] * a + target.data[t + c] * (1 - a));
  }
}
async function media() {
  const out = join(ROOT, 'media');
  await mkdir(out, { recursive: true });
  const save = async (file, bytes, size) => { await writeFile(join(out, file), bytes); written.push(`media/${file}: ${size}`); };
  const gif = async (file, frames, width, height, scale) => {
    const { data } = pb.encodeGIF(frames, width, height, { scale });
    await save(file, data, `${width * scale}x${height * scale}`);
  };

  const itemsProject = pb.renderProject(await load('items.json'));
  for (const type of ['shield', 'boost', 'nova']) {
    const { data, width, height } = pb.animationGIF(itemsProject, type, { scale: 3, background: '#0f0a24' });
    await save(`${type}.gif`, data, `${width}x${height}`);
  }

  const rocket = pb.renderProject(await rocketRecipe());
  const tilts = ['tilt-l30', 'tilt-l20', 'tilt-l10', 'tilt-0', 'tilt-r10', 'tilt-r20', 'tilt-r30'];
  const strip = canvas(tilts.length * 32, 34);
  tilts.forEach((name, i) => blit(strip, rocket, name, i * 32 - 2, -1));
  await save('rocket.png', pb.encodePNG(pb.scalePixels(strip.data, strip.width, strip.height, 3), strip.width * 3, strip.height * 3), `${strip.width * 3}x${strip.height * 3}`);

  const rocksProject = pb.renderProject(await rockRecipe());
  const spin = Array.from({ length: 16 }, (_, i) => {
    const frame = canvas(96, 34);
    blit(frame, rocksProject, `pink-l-${i}`, -2, 0);
    blit(frame, rocksProject, `orange-m-${(i * 2 + 5) % 16}`, 30, 0);
    blit(frame, rocksProject, `violet-s-${(16 - i) % 16}`, 62, 0);
    return { data: frame.data, duration: 80 };
  });
  await gif('rocks.gif', spin, 96, 34, 3);

  const plume = pb.renderProject(await bakeExhaust());
  const flight = plume.animations.down.frames.map(index => {
    const frame = canvas(30, 76);
    blit(frame, plume, plume.frames[index].name, 15 - 10, 26);
    blit(frame, rocket, 'tilt-0', 15 - 18, 2 - 6);
    return { data: frame.data, duration: plume.frames[index].duration };
  });
  await gif('exhaust.gif', flight, 30, 76, 3);

  const boomProject = pb.renderProject({ ...(pb.compileEffects(await load('boom.fx.json')).recipe) });
  const blast = boomProject.animations.boom.frames.map(index => {
    const frame = canvas(88, 88);
    blit(frame, boomProject, boomProject.frames[index].name, 0, 0);
    return { data: frame.data, duration: boomProject.frames[index].duration };
  });
  blast.push({ data: canvas(88, 88).data, duration: 600 });
  await gif('boom.gif', blast, 88, 88, 2);
}

const BUILDS = { rocket, rocks, items, boom, bursts, shield, nova, exhaust, stars, space, logo, font, icons, card, vendor, media };
for (const [name, build] of Object.entries(BUILDS)) if (!only || only.includes(name)) await build();
console.log(written.join('\n'));
