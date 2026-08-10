# Luminhive Skygarden

A playable Three.js prototype for a floating Skygarden simulator. The project explores procedural world building, autonomous creature behaviour, resource loops and a compact game HUD in the browser.

![Luminhive playtest](docs/playtest-screenshot.png)

## Implemented

- Third-person movement and a rotatable camera.
- A procedural floating island with a glowing hive tree, platforms, waterfalls, flowers and clouds.
- Autonomous Lumens that route to flowers and collect pollen.
- Nectar, honey and wax production loops.
- Four flower-efficiency states from Full Bloom to Exhausted.
- A timed Bloom Chain ability with partial and perfect multipliers.
- Atmosphere controls, particles, bloom lighting and a responsive HUD.

## Controls

- Move with `WASD` or the arrow keys.
- Drag to rotate the camera.
- Press `N` to change the atmosphere.
- Move close to the pulsing Lumen to start Bloom Chain, then reach additional Lumens before the timer expires.

## Run locally

```bash
npm ci
npm run dev
```

Open `http://127.0.0.1:5173`.

## Build

```bash
npm run build
```

## Technology

- TypeScript
- Three.js
- Vite
- Procedural geometry and WebGL effects

The current prototype deliberately uses procedural assets so the simulation is immediately playable. A future art pass can replace the tree, player, huts and Lumens with authored GLB assets while keeping the game logic and scene layout.

