# Arena Survivor 3D

A single-player 3D shooting arena game built with HTML, CSS, JavaScript, and
[Three.js](https://threejs.org/) (loaded from a CDN — no install/build step).
Made for a college assignment.

Real accounts gate access to the game — sign up or sign in with a call sign
and password before you can play. Accounts and best scores (per mode) live
in a small Python/Flask + SQLite backend (`server.py`); see
[Accounts & scores](#accounts--scores) below for how it works. **This means
the game now requires the backend server to be running — it can no longer
be played by just double-clicking `public/index.html`.**

The **Enter the Pit** theme uses acid-yellow armor, coral enemy accents, a
live 3D arena preview, illuminated perimeter rails, and an industrial HUD.
Select a difficulty, then click **Enter the Arena**. After a run, select a
new difficulty and click **Run It Back**. The pause and results screens use
the same visual theme. Reduced-motion preferences disable preview rotation
and interface animations. All visuals still use CSS and simple 3D shapes;
there are no image or audio downloads.

There are two game modes, picked on the start screen before **Survival**
(the default: soldiers hunt you for 60 seconds) or **Target Range** (a
5-stage aim-trainer run against stationary targets and a shrinking clock —
see [Target Range mode](#target-range-mode) below).

## 1. How to run it locally

### Option A — Docker (gives you a localhost link)

Requires [Docker Desktop](https://www.docker.com/products/docker-desktop/)
installed and running.

```
docker compose up --build
```

Then open **http://localhost:8080** in your browser. Stop it with `Ctrl+C`,
or `docker compose down` if it's running in the background.

> This machine didn't have Docker installed when this was built, so the
> Docker setup itself hasn't been run/verified end-to-end yet — if
> `docker compose up --build` doesn't work first try, check that Docker
> Desktop is actually running and re-run the command.

### Option B — Run the Flask server directly (no Docker)

Requires Python 3. The static-file-only fallback (`python3 -m http.server`
or opening `public/index.html` directly) **no longer works** now that login
is required — every page load calls the backend to check your session, and
the game itself won't unlock without it.

```
python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
SECRET_KEY=dev-only-secret FLASK_ENV=development python3 server.py
```

Then visit **http://localhost:8000**. `SECRET_KEY` can be any string for
local dev — it just signs the session cookie. Accounts/scores are stored in
`data/arena.db` (SQLite), created automatically on first run.

**Controls**
- Move: `WASD` or Arrow Keys
- Aim: Mouse
- Shoot: Left Click or `Space`
- Pause/Resume: the Pause button, or the `Esc` key
- 🔊/🔇 top-right: mute/unmute music & sound effects
- ⛶ top-right: toggle true fullscreen (the game already fills the browser
  window without this — this button additionally hides the browser chrome)

## 2. Beginner-friendly explanation

This explains how each mechanic works in `script.js`, in the order they'd
come up explaining the game out loud. The core rules are identical to a 2D
top-down shooter — the only real difference is that positions now use X/Z
(a flat ground plane) instead of X/Y, and Three.js draws everything in 3D
instead of us drawing 2D shapes by hand.

### The 3D scene
A `THREE.Scene` holds every object (the floor, walls, player, enemies,
bullets). A `THREE.PerspectiveCamera` is fixed above and behind the arena,
tilted down, so the whole arena is always visible — like a 3D version of the
original top-down camera. Every frame, `renderer.render(scene, camera)`
draws the current state of all those objects — this replaces the manual
`ctx.fillRect`/`ctx.arc` drawing calls a 2D Canvas version would need.

### The game loop
`gameLoop()` runs continuously via `requestAnimationFrame`, roughly 60 times
a second, for the entire life of the page — it's only ever started once, at
the bottom of the file. Each call:
1. Works out `dt` — the time in seconds since the last frame.
2. If the game is actively being played, calls `update(dt)` to move
   everything and check collisions.
3. Renders the scene.

Starting/pausing/ending the game only ever change a `state` variable
("start"/"playing"/"paused"/"gameover") — they never start or stop the loop
itself. That's deliberately simple: there is exactly one loop, always
running, so there's no risk of accidentally creating a second one (which is
an easy mistake if pause/resume each try to manage their own loop).

### Movement
`updatePlayerMovement()` checks which WASD/arrow keys are held down (tracked
in a `keys` lookup object), builds a normalized direction vector so diagonal
movement isn't faster than straight movement, and moves the player by
`speed * dt` on the X/Z ground plane. `clamp()` keeps the player inside the
arena bounds.

### Aiming (3D raycasting)
This is the one genuinely new idea versus the 2D version. A `THREE.Raycaster`
converts the 2D mouse position into a 3D ray shot from the camera through
that pixel. We intersect that ray with an invisible flat plane at the
arena's floor height (`groundPlane`) to get the exact 3D point on the floor
the mouse is pointing at. From there, `Math.atan2(targetZ - playerZ, targetX
- playerX)` gives the aim angle used for the bullet's velocity — the same
trigonometry as the 2D version, just on X/Z instead of X/Y. The tank model's barrel points along local -Z. Setting its Y rotation to
`-player.aimAngle - Math.PI / 2` aligns that barrel with the exact direction
used by the bullet velocity. Enemy rifles use the same alignment rule.

### The tank and soldiers (simple shapes, grouped)
There are no external 3D model files — the tank and each soldier are built
in `createPlayerTank()`/`createSoldierModel()` out of a handful of basic
primitives (`BoxGeometry`, `CylinderGeometry`, `SphereGeometry`) positioned
relative to each other and grouped into a single `THREE.Group`, the same way
you'd build a simple model out of LEGO bricks. A `THREE.Group` can be moved,
rotated, and disposed of as one unit, even though it's really several
separate meshes (hull/turret/barrel/treads, or legs/torso/head/helmet/rifle)
underneath. Every soldier is built with its own fresh set of shapes (not
shared with other soldiers), so that removing one defeated soldier can never
accidentally break a different, still-alive one.

### Shooting
Two inputs both call the same `shoot()` function: a `mousedown` listener on
the canvas (specifically the canvas, not the whole page — so clicking a
button like Pause never accidentally also fires a bullet), and a `keydown`
listener for the Space bar (gated to only fire while `state === "playing"`,
with `preventDefault()` so Space doesn't scroll the page or re-click a
focused button). `shoot()` spawns a small sphere at the player's position
with a velocity in the aim direction, plus a short cooldown
(`SHOOT_COOLDOWN`) so neither input can fire unlimited bullets.

### Enemy spawning & difficulty
`spawnEnemy()` places a new enemy just outside a random edge of the arena.
`currentSpawnInterval()` gradually shrinks the delay between spawns as time
passes, but never below a minimum, so the game stays winnable. The exact
speeds/spawn rates/fire rate/starting health come from `DIFFICULTY_PRESETS`
(Easy / Medium / Hard), chosen on the start screen and stored in
`currentDifficulty`.

### Enemies shooting back
Each soldier has its own `fireTimer` (started at a random point in the
cycle, so a whole wave doesn't fire in unison) that counts up every frame.
Once it passes `currentDifficulty.enemyFireInterval` **and** the soldier is
within `ENEMY_FIRE_RANGE` of the player, `fireEnemyBullet()` spawns a bullet
aimed at the player's position at that moment and resets the timer. Enemy
bullets reuse the exact same bullet system as the player's shots
(`createBulletMesh()`, `updateBullets()`) but are tagged `owner: "enemy"`
and colored orange-red instead of yellow, so the two are easy to tell apart
on sight - and have their own lower-pitched sound effect to tell apart by
ear too.

### Collision detection
`circlesOverlap()` does simple circle-vs-circle collision (viewed from
above, ignoring height): two circles overlap when the distance between
their centers is less than the sum of their radii. It's reused for:
- **The player's bullets vs enemies** (removes both, +10 score, spawns a
  defeat effect + sound) - filtered to `owner === "player"` so an enemy's
  own bullet can never accidentally kill it or another enemy.
- **Enemy contact, and enemy bullets, vs the player** (-1 health, starts a
  brief invulnerability window so one collision can't chain into multiple
  hits, plays a hit sound). Only one of these can damage the player per
  frame - contact is checked first, and a bullet is only checked if contact
  didn't already land - keeping the rule simple: at most 1 damage/frame.

### Audio
All music and sound effects are generated in code with the **Web Audio
API** — there are no external sound files. `playTone()` builds a single note
from an oscillator with a fade-in/out envelope; a short loop of these notes
(`MUSIC_PATTERN`) forms the looping background music. `playNoiseBurst()`
generates a short clip of random noise through a filter for the "enemy
defeated" pop. The 🔊/🔇 button just mutes/unmutes a master volume node —
it doesn't stop anything from playing.

### Cleanup
Every 3D object (enemy, bullet, particle) that gets removed goes through
`disposeMesh()`, which removes it from the scene **and** frees its
GPU-side geometry/material. Three.js doesn't do this automatically just
because JavaScript stops referencing an object, so without this a long play
session would slowly leak GPU memory.

### Win/lose conditions
A 60-second countdown ticks down inside `update()`. Reaching 0 with health
remaining triggers `endGame(true)` ("You Survived!"); health reaching 0
first triggers `endGame(false)` ("You Died"). Both show the final score and
let you pick a difficulty to play again.

### Target Range mode
A second, separate mode picked on the start screen, entirely disconnected
from Survival's soldiers/health/difficulty — no enemies ever spawn, and the
player can't take damage. `RANGE_STAGES` is a fixed list of 5 stages, each
with its own target count, time limit, and target size (both get tighter
each stage). `spawnRangeStage()` places that stage's targets — stationary
`createTargetModel()` groups (a post plus a layered red/white box "board")
scattered around the arena, using rejection sampling
(`pickTargetSpawnPosition()`) to keep them away from the player's start
point and reasonably spread out, retrying a bounded number of times rather
than risking an infinite loop.

Every frame, `updateRangeMode()` counts down the current stage's clock (time
hitting zero ends the run) and checks the player's bullets against the
remaining targets using the exact same `circlesOverlap()` test Survival uses
for bullets vs enemies. Clearing every target in a stage advances to the
next one automatically; clearing the last stage's targets wins the run.
`update()` picks between this and Survival's normal update logic with one
`if (gameMode === "range")` branch — everything upstream of that branch
(movement, aiming, shooting, bullet travel, particles) is shared by both
modes unchanged, since a tank moving and firing works exactly the same
regardless of what its bullets are allowed to hit.

### Accounts & scores

The game itself is still a static frontend (`public/`) — this adds a small
Flask backend (`server.py`) in front of it, because real accounts need
somewhere server-side to check a password and remember who's who, which no
purely static site can do.

- **Passwords** are never stored directly — `generate_password_hash()`
  (from Werkzeug, Flask's toolkit) turns each password into a one-way hash
  (`pbkdf2:sha256` specifically; explicit, rather than Werkzeug's default,
  because that default depends on the local Python's OpenSSL build
  supporting `scrypt`, which isn't guaranteed everywhere — it wasn't on the
  machine this was built on). Logging in re-hashes the entered password and
  compares hashes; the real password is never stored or compared directly.
- **Sessions** use Flask's built-in signed cookie: after login, `session["user_id"]`
  is set, and every request Flask verifies the cookie's signature (using
  `SECRET_KEY`) to trust it without hitting the database again. That's why
  `SECRET_KEY` must be a real secret in production, set via `fly secrets set`
  (see below) — anyone who has it could forge a valid login cookie.
- **The frontend** (`script.js`, section 16) calls `/api/signup`, `/api/login`,
  `/api/logout`, `/api/me`, and `/api/score` with `fetch()`. On page load,
  `checkSession()` calls `/api/me`; if it comes back with a username (the
  browser already had a valid session cookie), the login screen is skipped
  entirely and the player goes straight to the start screen.
- **Scores**: `endGame()`/`endRangeGame()` both call `submitScore(mode, score)`
  when a run ends. The server only keeps each account's *best* score per
  mode (`/api/score` compares against what's stored and only updates it if
  the new run beats it), and the start screen's "PERSONAL BEST" line reflects
  whichever mode is currently selected.
- **Persistence**: SQLite (`data/arena.db` locally, `/data/arena.db` in
  production) is a single file, not a separate database server — simple,
  but it does mean the file must live somewhere that survives a redeploy.
  In production that's a Fly Volume (`fly.toml`'s `[[mounts]]`); without
  one, every deploy would start with zero accounts again, since a fresh
  container has a blank filesystem.

## 3. Manual testing checklist

Run through these before presenting:

**Accounts**
- [ ] On first visit (no session yet), the login screen shows — not the
      start screen.
- [ ] Signing up with a username under 3 characters, or a password under 8
      characters, shows an inline error and does not create an account.
- [ ] Signing up with a username that's already taken shows "That username
      is already taken." and does not log you in.
- [ ] A successful signup logs you in immediately (no separate login step)
      and shows the start screen with your call sign in the header.
- [ ] Signing out returns you to the login screen, and reloading the page
      after that still shows the login screen (session actually cleared).
- [ ] Logging back in with the same credentials succeeds and shows your
      previously saved personal best score(s).
- [ ] Logging in with a wrong password shows "Incorrect username or
      password." without revealing whether the username itself exists.
- [ ] Reloading the page while logged in skips the login screen entirely
      (goes straight to the start screen) — the session persists.
- [ ] Playing a Survival or Target Range run and beating your previous best
      updates the "PERSONAL BEST" line on the start screen after the run
      ends; a worse run does not lower it.

- [ ] Start screen shows on page load, with controls listed, and the arena
      is visible (idle) in 3D behind it.
- [ ] Selecting Easy/Medium/Hard highlights the choice without starting.
      Clicking **Enter the Arena** begins at that difficulty (HUD matches).

**Target Range mode**
- [ ] Selecting **Target Range** on the start screen hides the threat-level
      picker and swaps the intro text and deploy button label; selecting
      **Survival** again brings the threat-level picker back.
- [ ] Clicking **Enter the Range** starts Stage 1/5 with 5 visible targets
      and no soldiers anywhere in the arena.
- [ ] Shooting a target removes it, adds to the score, and shows the same
      defeat effect/sound as defeating a soldier.
- [ ] Clearing every target in a stage automatically advances to the next
      stage (new targets appear, the clock resets to that stage's limit,
      the HUD's stage/target counters update).
- [ ] Letting a stage's clock hit zero before clearing it ends the run with
      "Out Of Time" and the correct stages-cleared count.
- [ ] Clearing all 5 stages ends the run with "Range Cleared".
- [ ] Touching or being shot at by a soldier never happens in this mode —
      there is no health bar and no damage.
- [ ] The results screen shows a "Stages Cleared" stat instead of "Survived"
      and skips the difficulty picker in favor of a plain retry prompt;
      **Run It Back** relaunches Target Range, not Survival.
- [ ] Pause/Resume, mute, and fullscreen all work the same as in Survival.
- [ ] WASD moves the player in all 4 directions; Arrow Keys do the same.
- [ ] Player cannot move outside the arena boundary in any direction.
- [ ] The tank's turret/barrel smoothly turns to face the mouse cursor as it
      moves across the floor.
- [ ] Left-clicking fires a bullet toward the cursor, with a sound.
- [ ] Pressing `Space` also fires a bullet (without scrolling the page or
      re-clicking a focused button).
- [ ] Enemy soldiers are actually visible on screen (not just felt through
      collisions) as soon as they spawn.
- [ ] Bullets travel in a straight line and disappear past the arena edge
      (no crash, no slowdown over time).
- [ ] Enemy soldiers spawn from random edges, visibly turn to face the
      player, and walk straight toward them.
- [ ] A bullet hitting a soldier removes both, adds 10 to the score, and
      shows a brief expanding/fading defeat effect with a sound.
- [ ] Once a soldier gets close enough, it periodically fires an orange-red
      bullet at the player, with a distinct (lower-pitched) sound from the
      player's own shots.
- [ ] An enemy bullet hitting the player reduces health by 1, same as
      touching a soldier does - and the bullet disappears on impact.
- [ ] A player bullet only ever damages soldiers, and an enemy bullet only
      ever damages the player (no enemy bullet accidentally kills a soldier).
- [ ] Touching an enemy reduces health by 1, the player flashes briefly, a
      hit sound plays, and no further health is lost until flashing stops.
- [ ] Health reaching 0 (from either contact or an enemy bullet) shows "System
      Down" with the correct final score and difficulty.
- [ ] Surviving the full 60 seconds shows "Still Standing" with the correct
      final score and difficulty.
- [ ] Enemy spawn rate, speed, and fire rate clearly differ between Easy,
      Medium, and Hard.
- [ ] Restarting ("Play Again") while soldiers are still alive on screen
      works cleanly with no error (previously a leftover bug here would
      break the restart).
- [ ] The in-game timer counts down and the HUD stays readable at all times.
- [ ] Clicking **Pause** (or pressing `Esc`) freezes the game and shows the
      pause screen — **without also firing a bullet**; **Resume** continues
      exactly where it left off.
- [ ] Picking a difficulty on the results screen, then clicking **Run It Back**,
      fully resets health, score, timer, and enemies, and returns to active play.
- [ ] Background music loops continuously; clicking 🔊/🔇 mutes/unmutes both
      music and sound effects.
- [ ] Clicking ⛶ enters true fullscreen (browser chrome hidden); clicking it
      again (or pressing `Esc`) exits fullscreen, and the game resizes
      correctly both times with no stretching/distortion.
- [ ] Resizing the browser window resizes the 3D view correctly (no
      stretched or squashed geometry).

## 4. One-minute presentation script

> "This is Arena Survivor 3D — I control a tank, and enemy soldiers rush in
> from the edges of the arena to attack me. It's rendered in real 3D with
> Three.js and WebGL instead of a flat 2D canvas — and there are no
> downloaded 3D models here, the tank and every soldier are built entirely
> out of simple shapes like boxes and spheres, grouped together in code.
>
> I move with WASD, aim with my mouse, and shoot with left-click or the
> Space bar. Under the hood, aiming works by casting a ray from the camera
> through my cursor and finding where it hits the arena floor in 3D space —
> my tank's turret and barrel then physically turn to face that point.
>
> This isn't a one-way fight, either — soldiers shoot back. Once one gets
> close enough it opens fire with its own bullets, on its own timer, so I
> have to watch for orange-red fire coming back at me, not just avoid
> running into them.
>
> Before starting, I pick a difficulty — Easy, Medium, or Hard — which
> changes how fast the soldiers move, how often they shoot, and how quickly
> new ones start spawning. Each soldier turns to face me as it closes in,
> and dies in a single hit for 10 points, but touching me - or getting hit
> by one of their shots - costs one of my health points, with a brief
> invulnerability window so one hit can't wipe me out instantly.
>
> There's also a second mode — Target Range. No soldiers, no health, just
> five staged rounds of stationary targets and a shrinking clock. Clear
> every target in a stage before time runs out to advance; run out of time
> and the run ends there. It reuses the exact same movement, aiming, and
> shooting code as Survival — the only thing that changes is what the
> bullets are allowed to hit.
>
> All the music and sound effects are generated live in code with the Web
> Audio API — there are no audio files anywhere in the project, it's all
> oscillators and filtered noise.
>
> The goal is to survive 60 seconds. I can play fullscreen, and the whole
> thing runs from a Docker container with a single command, so it's easy to
> demo on any machine with a localhost link.
>
> Even though it's now a full 3D scene, the underlying game logic — the
> game loop, movement, collision detection — is the same simple approach
> you'd use in 2D: everything is just circles being compared by distance,
> which keeps it straightforward to read and explain."

## 5. Project structure

```
index.html          Page structure: canvas container, HUD, start/pause/end screens
style.css            Acid-industrial theme, responsive HUD, launch/pause/results screens
script.js            All game logic (Three.js scene, input, audio, game loop)
Dockerfile           Serves the static files with nginx
docker-compose.yml    `docker compose up` -> http://localhost:8080
.dockerignore         Keeps non-game files out of the built image
```
