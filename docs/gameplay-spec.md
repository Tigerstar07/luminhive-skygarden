# Luminhive 2 Gameplay Spec Notes

## Flowers

Flowers never die and are always harvestable. Each harvest lowers efficiency by one phase and passive regeneration restores one phase every `2.5s`.

| Phase | Yield | Harvest time |
| --- | ---: | ---: |
| Full Bloom | 1.00x | 1.00x |
| Fading | 0.66x | 1.15x |
| Drained | 0.33x | 1.30x |
| Exhausted | 0.10x | 1.60x |

Visual readability is handled through glow intensity, petal openness, color saturation, and recovery pulsing.

## Lumens

Lumens currently auto-select high-efficiency flowers, fly to them, complete a timed harvest, then pick a new target. Yield is multiplied by the active Bloom Chain multiplier when that Lumen is connected.

## Bloom Chain

The first ability is implemented as a player movement routing event:

- A random Lumen enters the ready state and pulses.
- Touching it starts the chain with a 5 second timer.
- Every newly touched Lumen resets the timer to 5 seconds.
- Multiplier is `1.0 + 0.5 * touchedLumens`.
- Timer expiry gives a partial 10 second boost.
- Touching all Lumens gives a perfect 20 second boost.
