# Arena Survivor

## Project goal

Create a beginner-friendly single-player shooting arena game for a college assignment. The audience is my classmates, so make it fun to demonstrate, visually clear, and easy for me to explain.

## Technology

- HTML, CSS, and JavaScript, plus Three.js (loaded from a CDN via a classic
  `<script>` tag - no bundler/npm install) for real 3D rendering with WebGL.
- Core game files: `index.html`, `style.css`, and `script.js`.
- Docker (`Dockerfile` + `docker-compose.yml`) serves the game over a
  localhost link via nginx - `docker compose up` and no other install step.
- No external asset files (images/audio) - music and sound effects are
  generated in code with the Web Audio API.

*(Note: this project started as a strictly vanilla-2D-Canvas, no-framework,
three-file build. It was deliberately expanded to real 3D + difficulty
settings + procedural audio + Docker at the requester's explicit request,
which now takes priority over the original "avoid frameworks/complex setup"
constraint below. The "beginner-friendly, easy to explain" goal still
applies - keep new code as clearly commented/structured as the added
complexity allows.)*

## Core gameplay

- The player controls a tank around a fixed 3D top-down-style arena (camera
  tilted down over the whole arena) using WASD or arrow keys, on the X/Z ground plane.
- Aim with the mouse (via raycasting onto the arena floor); shoot with
  left-click or the Space bar. The tank's turret/barrel visibly turns to
  face the aim point.
- Enemy soldiers appear at the arena edges, turn to face the player, and
  walk toward them. Once close enough, each soldier also periodically fires
  its own bullet at the player (visually/audibly distinct from the
  player's own shots), on a per-soldier cooldown that varies by difficulty.
- Each soldier takes one hit (from a player bullet only) to defeat and awards 10 points.
- The player starts with 3-4 health points (depends on difficulty) and loses
  one when touching an enemy or getting hit by an enemy bullet (at most one
  of these per frame).
- A short damage cooldown means one hit cannot instantly end the game.
- Survive for 60 seconds to win. Losing all health ends the game.
- Keep the player inside the arena.
- Three difficulty presets (Easy/Medium/Hard) set enemy speed, spawn ramp,
  enemy fire rate, and starting health; chosen on the start screen and on "Play Again".

## Target Range mode

A second, separate game mode picked on the start screen alongside Survival
(added deliberately at the requester's explicit request - see the Scope
note below). No soldiers, no player health/damage - just 5 fixed stages of
stationary shooting-range targets (post + layered box "board", same
no-external-assets approach as the tank/soldiers) against a per-stage
countdown that shrinks along with the target size each stage. Clearing every
target in a stage advances to the next one; the clock running out on any
stage ends the run. Reuses Survival's movement/aiming/shooting/camera/audio
systems entirely unchanged - only what bullets are allowed to hit, and the
win/lose condition, differ.

## Small extras

- Display health, score, remaining time, and current difficulty.
- Gradually increase enemy spawn frequency per difficulty, with a reasonable limit so the game stays playable.
- Add a brief visual effect + sound when an enemy is defeated.
- Start screen with controls + difficulty picker, pause/resume, and a difficulty picker again on the result screen to restart.
- Looping background music and sound effects, all generated procedurally with the Web Audio API (no audio files). A mute toggle is always visible.
- The game fills the whole browser window by default, plus an explicit fullscreen toggle (Fullscreen API).

## Visual style

Use a dark arena, a brightly colored player tank, and distinct enemy soldier colors. The tank and soldiers are built from simple grouped primitive shapes (boxes/cylinders/spheres), not external 3D model files. Keep text readable and the layout suitable for a classroom laptop demonstration, at any window size/fullscreen.

## Scope

Keep the project otherwise small - no multiplayer, accounts, database, weapon upgrades, or real physics (movement/collision stays simple distance-based checks, not a physics engine). 3D rendering, difficulty settings, procedural audio, Docker packaging, enemies that shoot back, and the staged Target Range mode are all in scope (added deliberately at the requester's explicit request over several rounds, see the Technology note above) - don't expand further without being asked.

*(Note: the frontend's visual theme - "Enter the Pit" acid/coral industrial
styling, the live arena preview on the start screen, ARIA/accessibility
polish - was produced by a different tool (Codex) working on this same
codebase outside this file's original guidance. Treat it as the current,
intentional design rather than reverting it; keep matching its visual
language and existing CSS patterns (e.g. reusing `.difficultyButton`/
`.hudItem`/`.modalCard`) when adding anything new, rather than introducing a
second, inconsistent style.)*

## Deliverables

1. Complete code for all three game files.
2. Simple instructions for running the game locally.
3. Clear comments and a beginner-friendly explanation of movement, aiming, shooting, enemy spawning, collision detection, and the game loop.
4. A short checklist for manually testing the game.
5. A one-minute presentation script explaining the project and its main features.

## Coding guidance

Use straightforward code that a beginner can understand and explain during a classroom demonstration.
