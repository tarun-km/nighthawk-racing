# Hawk Racing

A browser racing game for **Night Hawk Energy**, built with three.js, Rapier physics and GSAP.

- **Grand Prix:** you against three CPU rivals over three laps, with Hawk Box power-ups (Turbo can, Hawk strike, Can mines, Wing shield). Rookie, Pro and Legend difficulty.
- **Score Attack:** 75 seconds of cans, bolts, gates, drifts and combos.
- **Duel:** Blue (Classic Cruiser) vs Red (Ultra Buggy), split screen, one keyboard or two gamepads.
- **In-engine trailer:** press **T** in the garage.

## Run

```bash
npm install
npm run dev        # http://localhost:3000
npm run build      # production build in dist/
npm run preview    # serve the build
```

## Controls

| | Player 1 / solo | Player 2 |
|---|---|---|
| Drive | W A S D | Arrow keys |
| Nitro | Left Shift | Right Shift |
| Drift | Space | Right Ctrl |
| Power-up | E | Enter |
| Reset car | R | Backspace |

Gamepads: stick to steer, RT/LT throttle and brake, A nitro, B drift, Y/RB power-up. Esc pauses, F3 shows the performance overlay.

## Deploy (Vercel)

`vercel.json` configures the Vite build (`dist/`), long-term caching for hashed assets and basic security headers. Import the repo in Vercel or run `npx vercel --prod`.

## Project layout

- `src/main.js` game flow, modes, HUD, cameras
- `src/world.js` stadium, course, barriers and props
- `src/car.js`, `src/vehicles/` the two cars and their physics
- `src/ai.js` CPU drivers, `src/items.js` power-ups, `src/trailer.js` trailer director
- `livery-templates/` editable car livery templates (see its README)
- `trailer/README.md` how the trailer video is recorded

Scores and career progress are stored in the browser on the player's device.
