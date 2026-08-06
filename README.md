# Solido Punch

A mobile-first browser AR training game. Colorful Three.js targets fall through a live camera view while MediaPipe tracks up to two hands. A target only scores when a closed fist overlaps it at punch velocity.

## Custom fist model

Place the GLB at:

```text
public/models/fist.glb
```

Reload the game after copying the file. The renderer normalizes the model's size automatically, reuses it for both tracked hands, and mirrors the left-hand instance. Model scale and base rotation can be adjusted in `src/config.ts` under `fistModel` if its authored orientation needs correction.

## Run locally

```bash
npm install
npm run dev
```

Open the local address shown by Vite (normally `https://localhost:5173`). Camera
access works on localhost after accepting the local certificate.

For a loopback-only HTTP server without certificate handling, run this alongside
the HTTPS server:

```bash
npm run dev:local
```

Open `http://localhost:5174`. Browsers treat localhost as a secure context for
camera access, and this server cannot be reached from other devices.

## Phone testing over HTTPS

The development server uses HTTPS and listens on every network interface. With the
computer and phone on the same Wi-Fi network, open the **Network** URL printed by
Vite, for example:

```text
https://192.168.1.49:5173/
```

The local certificate is self-signed, so each new device must accept the browser's
certificate warning once. Then accept camera permission after tapping **Start
game**. If the page cannot connect, allow Node.js on Windows **Private networks**
and confirm both devices are on the same Wi-Fi network.

`localhost` only works on the development computer. Another device must use the
computer's LAN IP address shown by Vite.

## Controls

- Camera: make a fist and punch rapidly through a falling target. Hits connect automatically from tracked motion and overlap.
- Desktop simulation: `F` or `Space` remains an optional development fallback.
- `P` or `Escape`: pause/resume.
- On-screen controls: switch camera, mute, pause, restart, and open diagnostics.
- Do not punch the red wireframe hazard.

## Architecture

- `src/camera` — camera constraints, permission fallback, and switching.
- `src/tracking` — MediaPipe setup, fist classification, identity matching, velocity smoothing, and punch state machine.
- `src/math` — mirrored cover-crop coordinate conversion and overlap math.
- `src/rendering` — hand landmarks and Three.js/Rapier target scene.
- `src/physics` — fixed 60 Hz accumulator.
- `src/game` — deterministic scoring, lives, hazard behavior, and difficulty curves.
- `src/engine` — imperative real-time loop and lifecycle; React receives throttled HUD snapshots.
- `src/config.ts` — all timings, scores, thresholds, collision sizes, spawn rates, and physics tuning.

MediaPipe uses GPU delegation first with a CPU fallback. The model and WebAssembly assets load from their official hosted package/model locations on first use.

## Verification

```bash
npm run check
npm audit --audit-level=high
```

GitHub Actions runs the same checks for every pull request and every push to
`main`. Dependabot checks npm and GitHub Actions dependencies for updates.

## Security

Camera frames are processed locally and are not uploaded by this application.
The production document includes a restrictive Content Security Policy, and the
application disables the browser context menu. Please report suspected security
issues privately using the instructions in [`SECURITY.md`](SECURITY.md).

Deterministic layout states are available for browser checks:

- `?demo=countdown`
- `?demo=playing`
- `?demo=paused`
- `?demo=gameover`
- `?demo=error`
