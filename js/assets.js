// Sprite atlases exported by Pixelbolt, drawn with Pixelbolt's own runtime (vendor/pixelbolt/runtime.js).
import { loadSpriteSheet, frameAt, drawFrame } from '../vendor/pixelbolt/runtime.js';

const NAMES = ['rocket', 'rocks', 'items', 'boom', 'bursts', 'shield', 'nova', 'exhaust', 'stars', 'space', 'font'];
export const sheets = {};

export async function loadAssets(onProgress) {
  let done = 0;
  await Promise.all(NAMES.map(async name => {
    sheets[name] = await loadSpriteSheet(`assets/${name}.atlas.json`);
    onProgress?.(++done / NAMES.length);
  }));
}

/** Draws a frame by its anchor, snapped to whole pixels. */
export function draw(ctx, sheet, name, x, y, options) {
  drawFrame(ctx, sheets[sheet], name, x, y, options);
}

/** The frame an animation shows `ms` into it (loops wrap, one-shots hold their last frame). */
export function frameOf(sheet, animation, ms) {
  return frameAt(sheets[sheet].atlas, animation, ms);
}

export function lengthOf(sheet, animation) {
  return sheets[sheet].atlas.animations[animation].duration;
}

// ---------------------------------------------------------------- text
// Every letter on the canvas is a frame of the font atlas: Pixelbolt's built-in pixel font with a dark edge.
const SPACE = 3;
function glyph(ink, ch) {
  const name = `${ink}-${ch.charCodeAt(0)}`;
  return Object.hasOwn(sheets.font.atlas.frames, name) ? name : null;
}
const fold = ch => (ch === 'x' ? ch : ch.toUpperCase());

export function textWidth(text) {
  let width = 0;
  for (const raw of text) {
    const name = glyph('white', fold(raw));
    width += (name ? sheets.font.atlas.frames[name].points.advance.x : SPACE) + 1;
  }
  return Math.max(0, width - 1);
}

export function drawText(ctx, text, x, y, { ink = 'white', align = 'left' } = {}) {
  const width = textWidth(text);
  let cx = Math.round(align === 'center' ? x - width / 2 : align === 'right' ? x - width : x);
  for (const raw of text) {
    const name = glyph(ink, fold(raw));
    if (name) drawFrame(ctx, sheets.font, name, cx, y);
    cx += (name ? sheets.font.atlas.frames[name].points.advance.x : SPACE) + 1;
  }
  return width;
}

export const formatScore = n => Math.floor(n).toLocaleString('en-US');
