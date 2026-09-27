# Solido DRRM Games

An offline-ready exhibit web app for learning disaster preparedness through movement. The roster currently includes an earthquake **Drop, Cover, Hold On** challenge and the original **Solido Punch** AR game.

Camera frames are processed locally. The earthquake challenge holds three successful-pose snapshots in memory for its results screen and can generate a collage only when the facilitator presses Download. Photos are cleared on replay, Home, refresh, or tab closure.

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

### Windows diagnostic desktop build

The Tauri diagnostic wrapper keeps the existing web game intact while packaging
the production assets into a local Windows application. It opens in a resizable
1280×720 window and uses the installed Microsoft WebView2 runtime.

Install the Rust toolchain once, then run:

```bash
npm run tauri:dev
npm run tauri:build
```

The release executable is written under
`src-tauri/target/release/solido-drrm-games.exe`. It does not require Vite,
Node.js, or an internet connection at runtime. This first diagnostic build does
not create an installer; the exhibit release will add a bundled offline WebView2
installer after camera and tracking validation.

On Windows, the build script loads the installed Visual Studio C++ compiler and
restores Microsoft's official Windows SDK C++ NuGet packages when they are not
already cached. Subsequent builds can use the cached Rust and SDK dependencies
without an internet connection.

For a loopback-only HTTP server without certificate handling, run this alongside
the HTTPS server:

```bash
npm run dev:local
```

Open `http://localhost:5174`. Browsers treat localhost as a secure context for
camera access, and this server cannot be reached from other devices.

The MediaPipe WASM and hand/pose models are bundled under `public/mediapipe`, so an installed production build does not need internet access.

## Exhibit setup

- Connect the laptop to a 16:9 TV and mirror or extend the display at 1920×1080 when possible.
- Place the camera centered above or below the TV, facing a clear, evenly lit play zone.
- Allow roughly 2–3 metres between the camera and player so their head, hands, knees, and feet fit in frame.
- Mark the safe standing area on the floor and keep it free of furniture and trip hazards.
- Open the app, allow camera permission once, then use the home-screen **Full screen** control.
- Use **Alt+N** to advance the earthquake game during facilitator testing when camera recognition is unavailable.

The open-space exhibit version teaches Hold On by maintaining the complete protective posture. During a real earthquake, anyone under sturdy furniture should hold onto it until shaking stops.

## Character artwork

The supplied transparent Solido pose references are stored in `public/characters` and mapped by action in `src/earthquake/EarthquakeGame.tsx`. The live player view occupies the left two-thirds of the challenge screen and the current pose reference occupies the right third.

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

## Solido Punch controls

- Choose **Solo** for the original 60-second score challenge or **Versus** for a
  two-player, last-survivor match using one shared camera.
- Camera: make a fist and punch rapidly through a falling target. Hits connect automatically from tracked motion and overlap.
- In Versus, stand side-by-side and keep each player's hands in their own half
  of the screen. The center divider is a dead zone.
- `SH` blocks one life loss, `>>` speeds up the opponent's lane for three
  seconds, and `!!` sends the next two hazards to the opponent.
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

MediaPipe uses GPU delegation first with a CPU fallback. All runtime assets load from this application.

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
- `?demo=hub`
- `?demo=earthquake-framing`
- `?demo=earthquake-drop`
- `?demo=earthquake-cover`
- `?demo=earthquake-hold`
- `?demo=earthquake-results`
- `?demo=earthquake-error`
