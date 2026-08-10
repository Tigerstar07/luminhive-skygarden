# Engine Path

## Current prototype

The current playable version is a Three.js/Vite prototype. This is useful because iteration is immediate: visuals, camera, flowers, Lumens, resources, and Bloom Chain can be tested in the browser in seconds.

## Installed local engine tooling

- Unity Hub is installed.
- Unity 6 editors found:
  - `6000.3.2f1`
  - `6000.3.3f1`
- Blender 5.0 is installed.

## Recommended production path

Unity is the better long-term engine target for the final Luminhive 2 game if the priority is high-end graphics, authored worlds, terrain tools, VFX Graph, Cinemachine, lighting workflows, and eventual PC packaging.

The practical route is:

1. Keep using this browser prototype to lock gameplay feel and visual composition.
2. Author the tree, islands, Lumens, flowers, huts, bridges, and comb cells as GLB/FBX assets in Blender.
3. Port the simulation systems into Unity once the core loop feels right.
4. Use Unity URP or HDRP depending on hardware target. URP is safer for stylized high-performance PC builds; HDRP is stronger for premium lighting if performance budget allows it.

The prototype should not be thrown away. Its flower phase logic, Bloom Chain rules, resource tuning, camera direction, and art composition can transfer directly into a Unity project.
