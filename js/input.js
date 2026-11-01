// Keyboard, mouse, touch and gamepad. Touch steers by dragging anywhere (the finger never covers the rocket); a mouse
// moved over the game is followed; keys and sticks set a direction. Whichever moved last steers.
const STEER = {
  ArrowLeft: [-1, 0], KeyA: [-1, 0], ArrowRight: [1, 0], KeyD: [1, 0],
  ArrowUp: [0, -1], KeyW: [0, -1], ArrowDown: [0, 1], KeyS: [0, 1],
};

export class Input {
  constructor(surface, { onPause, onMute, onConfirm, isPlaying }) {
    this.keys = new Set();
    this.drag = { id: null, x: 0, y: 0, dx: 0, dy: 0 };
    this.mouse = { x: 0, y: 0, inside: false };
    this.device = 'keys';
    this.pad = { x: 0, y: 0, buttons: [] };

    addEventListener('keydown', e => {
      if (e.repeat && !STEER[e.code]) return;
      if (STEER[e.code]) {
        this.keys.add(e.code); this.device = 'keys';
        if (isPlaying()) e.preventDefault();
      } else if (e.code === 'KeyP' || e.code === 'Escape') onPause();
      else if (e.code === 'KeyM') onMute();
      else if ((e.code === 'Enter' || e.code === 'Space') && !e.target.closest?.('button, a, input')) {
        if (onConfirm()) e.preventDefault();
      }
    });
    addEventListener('keyup', e => this.keys.delete(e.code));
    addEventListener('blur', () => { this.keys.clear(); this.endDrag(); });

    surface.addEventListener('pointerdown', e => {
      // Buttons and menus keep their taps: capturing the pointer for a drag would take their click away.
      if (e.target.closest?.('button, a, .overlay, .hud-buttons')) return;
      if (e.pointerType === 'mouse') { this.trackMouse(e); return; }
      if (this.drag.id !== null) return;
      this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, dx: 0, dy: 0 };
      this.device = 'touch';
      try { surface.setPointerCapture(e.pointerId); } catch { /* the pointer is already gone */ }
    });
    surface.addEventListener('pointermove', e => {
      if (e.pointerType === 'mouse') { this.trackMouse(e); return; }
      if (e.pointerId !== this.drag.id) return;
      this.drag.dx += e.clientX - this.drag.x; this.drag.dy += e.clientY - this.drag.y;
      this.drag.x = e.clientX; this.drag.y = e.clientY;
    });
    const end = e => { if (e.pointerId === this.drag.id) this.endDrag(); };
    surface.addEventListener('pointerup', end);
    surface.addEventListener('pointercancel', end);
    surface.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') this.mouse.inside = false; });
    surface.addEventListener('contextmenu', e => e.preventDefault());
  }

  trackMouse(e) {
    const moved = !this.mouse.inside || Math.abs(e.clientX - this.mouse.x) + Math.abs(e.clientY - this.mouse.y) > 0;
    this.mouse = { x: e.clientX, y: e.clientY, inside: true };
    if (moved) this.device = 'mouse';
  }
  endDrag() { this.drag.id = null; this.drag.dx = 0; this.drag.dy = 0; }

  /** Drag since the last call, in CSS pixels. */
  takeDrag() {
    const { dx, dy } = this.drag;
    this.drag.dx = 0; this.drag.dy = 0;
    return [dx, dy];
  }

  /** The steering direction from keys and gamepad, each axis from -1 to 1. */
  axis() {
    let x = 0, y = 0;
    for (const code of this.keys) { x += STEER[code][0]; y += STEER[code][1]; }
    x = Math.max(-1, Math.min(1, x)); y = Math.max(-1, Math.min(1, y));
    if (Math.abs(this.pad.x) > Math.abs(x)) x = this.pad.x;
    if (Math.abs(this.pad.y) > Math.abs(y)) y = this.pad.y;
    return [x, y];
  }

  /** Reads the first connected gamepad; returns the buttons newly pressed since the last poll. */
  pollGamepad() {
    const pads = navigator.getGamepads?.() ?? [];
    const pad = [...pads].find(p => p && p.connected);
    if (!pad) { this.pad = { x: 0, y: 0, buttons: [] }; return []; }
    const dead = v => (Math.abs(v) < 0.2 ? 0 : v);
    let x = dead(pad.axes[0] ?? 0), y = dead(pad.axes[1] ?? 0);
    const held = i => Boolean(pad.buttons[i]?.pressed);
    if (held(14)) x = -1; if (held(15)) x = 1; if (held(12)) y = -1; if (held(13)) y = 1;
    const buttons = pad.buttons.map(b => b.pressed);
    const pressed = buttons.map((on, i) => on && !this.pad.buttons[i]).flatMap((on, i) => (on ? [i] : []));
    if (x || y) this.device = 'keys';
    this.pad = { x, y, buttons };
    return pressed;
  }
}
