// Steering, as in the original game: side to side only. On a keyboard the arrow keys or A and D; on a touch screen,
// hold the left or right half; on a gamepad the stick or d-pad. Whatever was pressed last wins. Any other fresh key
// press goes to the menus, so a new run is one key away.
const SIDE = { ArrowLeft: -1, KeyA: -1, ArrowRight: 1, KeyD: 1 };

export class Input {
  constructor(surface, { onPause, onMute, onAnyKey, isPlaying }) {
    this.keys = [];                    // held steering keys, oldest first
    this.touches = new Map();          // pointer id -> side, oldest first
    this.pad = { x: 0, buttons: [] };
    this.surface = surface;

    addEventListener('keydown', e => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.code === 'Tab') return;
      if (SIDE[e.code]) {
        if (!this.keys.includes(e.code)) this.keys.push(e.code);
        if (isPlaying()) { e.preventDefault(); return; }
      }
      if (e.repeat) return;
      if (e.code === 'KeyP' || e.code === 'Escape') { onPause(); return; }
      if (e.code === 'KeyM') { onMute(); return; }
      // A focused button or link keeps Enter and Space for itself.
      if ((e.code === 'Enter' || e.code === 'Space') && e.target.closest?.('button, a')) return;
      if (onAnyKey()) e.preventDefault();
    });
    addEventListener('keyup', e => { this.keys = this.keys.filter(code => code !== e.code); });
    addEventListener('blur', () => { this.keys = []; this.touches.clear(); });

    const side = e => {
      const rect = surface.getBoundingClientRect();
      return e.clientX < rect.left + rect.width / 2 ? -1 : 1;
    };
    surface.addEventListener('pointerdown', e => {
      if (e.pointerType === 'mouse' || e.target.closest?.('button, a, .overlay, .hud-buttons')) return;
      this.touches.delete(e.pointerId);
      this.touches.set(e.pointerId, side(e));
      try { surface.setPointerCapture(e.pointerId); } catch { /* the pointer is already gone */ }
    });
    surface.addEventListener('pointermove', e => {
      // Sliding a held finger across the middle switches direction, without lifting it.
      if (this.touches.has(e.pointerId)) this.touches.set(e.pointerId, side(e));
    });
    const end = e => this.touches.delete(e.pointerId);
    surface.addEventListener('pointerup', end);
    surface.addEventListener('pointercancel', end);
    surface.addEventListener('contextmenu', e => e.preventDefault());
  }

  /** -1 left, 1 right, 0 none: the most recent held touch, else the most recent held key, else the gamepad. */
  direction() {
    if (this.touches.size) return [...this.touches.values()].at(-1);
    if (this.keys.length) return SIDE[this.keys.at(-1)];
    return this.pad.x;
  }

  /** Which screen halves are held, for the touch hints. */
  held() {
    const sides = new Set(this.touches.values());
    return { left: sides.has(-1), right: sides.has(1) };
  }

  /** Reads the first connected gamepad; returns the buttons newly pressed since the last poll. */
  pollGamepad() {
    const pads = navigator.getGamepads?.() ?? [];
    const pad = [...pads].find(p => p && p.connected);
    if (!pad) { this.pad = { x: 0, buttons: [] }; return []; }
    let x = Math.abs(pad.axes[0] ?? 0) < 0.25 ? 0 : Math.sign(pad.axes[0]);
    if (pad.buttons[14]?.pressed) x = -1;
    if (pad.buttons[15]?.pressed) x = 1;
    const buttons = pad.buttons.map(b => b.pressed);
    const pressed = buttons.map((on, i) => on && !this.pad.buttons[i]).flatMap((on, i) => (on ? [i] : []));
    this.pad = { x, buttons };
    return pressed;
  }
}
