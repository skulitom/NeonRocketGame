# Neon Voyage art brief

Every sprite, effect, letter and icon in the game is a Pixelbolt recipe or source in this folder, built by `build.mjs`.

- **View.** Top-down vertical scroller. The rocket points up; the world scrolls down past it.
- **Native size.** The game draws at 1 art pixel per game pixel on a canvas 180 to 240 game pixels wide, enlarged by a whole number to the screen. Sprites are exported at 1x and never scaled in the game.
- **Light.** From the upper left, fixed: rotating rocks get their rim light and shadow edge after rotation, so the light never turns with them.
- **Palette roles** (`palette.json`): space violets for the void, a silver-lavender hull ramp, and one neon per meaning. Cyan is the player and plasma, magenta, orange and violet are hazards, green is the shield, yellow is boost and score, pink is the nova.
- **Outline.** A dark `k` line on the rocket and items; rocks get a neon edge and a translucent glow ring instead, so they read as hazards on black.
- **Silhouettes.** Rocket: needle nose, cockpit window, swept fins, nozzle. Rocks: lumpy, never round. Items: shield ring, boost chevrons, nova star, shard diamond, each readable at 1x as a different shape, not only a different colour.
- **Motion.** The exhaust is a live fluid simulation that bends when the rocket steers; everything else is baked frames played by the Pixelbolt runtime.
