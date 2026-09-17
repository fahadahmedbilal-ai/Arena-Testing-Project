// =====================================================================
// ARENA SURVIVOR 3D - script.js
//
// A real 3D version of the game, built with Three.js (loaded from a CDN
// in index.html - no bundler or install step needed) instead of the 2D
// Canvas API. The core rules are unchanged: move, aim, shoot, survive.
//
// Sections in this file:
//   1. Setup & constants
//   2. Difficulty presets
//   3. Three.js scene (camera, lights, arena floor/walls, renderer)
//   4. Audio (Web Audio API - procedural music & sound effects)
//   5. Game state
//   6. Player (a tank model built from simple shapes)
//   7. Input handling (keyboard + mouse-to-3D-floor raycasting)
//   8. Enemies (soldier models built from simple shapes)
//   9. Bullets
//  10. Particles (defeat effect)
//  11. Collision detection
//  12. HUD
//  13. The game loop
//  14. Fullscreen & window resizing
//  15. Starting, pausing, and restarting
// =====================================================================


// ---------------------------------------------------------------------
// 1. SETUP & CONSTANTS
// ---------------------------------------------------------------------

// The arena floor spans X from -ARENA_HALF_WIDTH..+ARENA_HALF_WIDTH and
// Z from -ARENA_HALF_DEPTH..+ARENA_HALF_DEPTH. In Three.js, X and Z form
// the ground plane and Y is "up" - so movement now happens on X/Z instead
// of the X/Y we used in the old 2D version.
const ARENA_HALF_WIDTH = 15;
const ARENA_HALF_DEPTH = 10;

const GAME_DURATION = 60;          // seconds the player must survive to win
const PLAYER_RADIUS = 1;
const PLAYER_SPEED = 9;            // units per second
const DAMAGE_COOLDOWN = 1000;      // ms of invulnerability after being hit

const BULLET_SPEED = 24;           // units per second
const BULLET_RADIUS = 0.25;
const BULLET_HEIGHT = 1;           // fixed height bullets travel at
const SHOOT_COOLDOWN = 200;        // ms between the player's shots (prevents spam-clicking)

const ENEMY_RADIUS = 0.9;
const ENEMY_POINTS = 10;
const MAX_ENEMIES_ON_SCREEN = 15;  // keeps the game playable late on
const ENEMY_BULLET_SPEED = 16;     // units per second - slower than the player's, for fairness
const ENEMY_FIRE_RANGE = 14;       // soldiers only start shooting once they're this close


// ---------------------------------------------------------------------
// 2. DIFFICULTY PRESETS
// ---------------------------------------------------------------------

// Each preset tunes how fast enemies move, how quickly they start
// spawning more often, how often each soldier fires, and how much health
// the player starts with.
const DIFFICULTY_PRESETS = {
  easy: {
    label: "Easy",
    enemyMinSpeed: 3, enemyMaxSpeed: 5,
    spawnStart: 1800, spawnMin: 750, spawnRamp: 50,
    enemyFireInterval: 2200,
    maxHealth: 4,
  },
  medium: {
    label: "Medium",
    enemyMinSpeed: 4.5, enemyMaxSpeed: 7,
    spawnStart: 1400, spawnMin: 500, spawnRamp: 45,
    enemyFireInterval: 1700,
    maxHealth: 3,
  },
  hard: {
    label: "Hard",
    enemyMinSpeed: 6, enemyMaxSpeed: 9.5,
    spawnStart: 1000, spawnMin: 350, spawnRamp: 35,
    enemyFireInterval: 1200,
    maxHealth: 3,
  },
};

let currentDifficulty = DIFFICULTY_PRESETS.medium; // overwritten when the player picks one

// Target Range mode: a separate mode from Survival. Fixed, ordered stages -
// no soldiers, no health, just stationary targets and a shrinking clock.
// Each stage clears once every one of its targets is destroyed; running out
// of time on any stage ends the run.
const RANGE_STAGES = [
  { targetCount: 5, timeLimit: 24, targetRadius: 0.55 },
  { targetCount: 6, timeLimit: 21, targetRadius: 0.5 },
  { targetCount: 7, timeLimit: 19, targetRadius: 0.45 },
  { targetCount: 8, timeLimit: 17, targetRadius: 0.4 },
  { targetCount: 10, timeLimit: 16, targetRadius: 0.35 },
];
const RANGE_TARGET_POINTS = 15;


// ---------------------------------------------------------------------
// 3. THREE.JS SCENE (camera, lights, arena floor/walls, renderer)
// ---------------------------------------------------------------------

const sceneContainer = document.getElementById("sceneContainer");

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x101212);
scene.fog = new THREE.Fog(0x101212, 48, 105); // distant objects fade into the dark - a cheap depth cue

// A camera fixed above and behind the arena, tilted down, so the whole
// arena is always visible - like a 3D version of the old top-down view.
const camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.1, 200);
camera.position.set(0, 32, 26);
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
sceneContainer.appendChild(renderer.domElement);

// Lighting - without at least one light, MeshStandardMaterial surfaces
// render pure black, so we add a soft ambient fill plus one directional
// light (like sunlight) for gentle shading.
scene.add(new THREE.AmbientLight(0xb8cbb0, 0.9));
const sunLight = new THREE.DirectionalLight(0xe9ffdb, 1.4);
sunLight.position.set(10, 25, 10);
scene.add(sunLight);

// Arena floor.
const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(ARENA_HALF_WIDTH * 2, ARENA_HALF_DEPTH * 2),
  new THREE.MeshStandardMaterial({ color: 0x202922, roughness: 0.75, metalness: 0.25 })
);
floor.rotation.x = -Math.PI / 2; // a plane is vertical by default - lay it flat
scene.add(floor);

// A faint grid on top of the floor, stretched to exactly match the arena
// bounds, so it's easy to judge distance and movement at a glance.
const grid = new THREE.GridHelper(ARENA_HALF_DEPTH * 2, 20, 0x647448, 0x343f2d);
grid.scale.x = (ARENA_HALF_WIDTH * 2) / (ARENA_HALF_DEPTH * 2);
grid.position.y = 0.02; // just above the floor, to avoid two surfaces flickering at the same depth
scene.add(grid);

// Low decorative walls marking the arena boundary (visual only - the
// player is kept inside by clamping position, not by wall collisions,
// same simple approach as the original 2D version).
function addWall(x, z, width, depth) {
  const wall = new THREE.Mesh(
    new THREE.BoxGeometry(width, 1, depth),
    new THREE.MeshStandardMaterial({ color: 0x323c2d, roughness: 0.7, metalness: 0.5 })
  );
  wall.position.set(x, 0.5, z);
  scene.add(wall);
}
addWall(0, -ARENA_HALF_DEPTH - 0.5, ARENA_HALF_WIDTH * 2 + 2, 1); // north
addWall(0, ARENA_HALF_DEPTH + 0.5, ARENA_HALF_WIDTH * 2 + 2, 1);  // south
addWall(-ARENA_HALF_WIDTH - 0.5, 0, 1, ARENA_HALF_DEPTH * 2 + 2); // west
addWall(ARENA_HALF_WIDTH + 0.5, 0, 1, ARENA_HALF_DEPTH * 2 + 2);  // east

// The Pit: a floating industrial platform, edge lighting and landing markings.
// These meshes are decorative; movement and collision bounds stay unchanged.
function arenaBox(width, height, depth, x, y, z, color, glowing = false) {
  const material = glowing
    ? new THREE.MeshBasicMaterial({ color })
    : new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.35 });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
  mesh.position.set(x, y, z);
  scene.add(mesh);
  return mesh;
}
arenaBox(34, 1.4, 24, 0, -0.8, 0, 0x242b23);
arenaBox(32.6, 0.25, 22.6, 0, -1.65, 0, 0x090e0b);
for (const z of [-10.5, 10.5]) {
  arenaBox(32, 0.08, 0.1, 0, 1.04, z, 0xd9fa47, true);
  for (let x = -14; x <= 14; x += 2) {
    arenaBox(0.75, 0.025, 0.22, x, 0.03, z > 0 ? 9.4 : -9.4, 0x84964a, true);
  }
}
for (const x of [-15.5, 15.5]) {
  arenaBox(0.1, 0.08, 22, x, 1.04, 0, 0xd9fa47, true);
  for (const z of [-10.5, 0, 10.5]) {
    arenaBox(1.1, 2.4, 1.1, x, 0.9, z, 0x151c16);
    arenaBox(1.13, 0.14, 1.13, x, 1.9, z, 0xff6852, true);
    arenaBox(0.25, 1.3, 0.25, x, 2.55, z, 0x8b9955);
    arenaBox(0.4, 0.12, 0.4, x, 3.2, z, 0xd9fa47, true);
  }
}
function floorRing(radius, width, color, opacity) {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(radius, radius + width, 80),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.04;
  scene.add(ring);
  return ring;
}
const landingRing = floorRing(3.8, 0.07, 0xd9fa47, 0.5);
floorRing(4.2, 0.025, 0xd9fa47, 0.22);
floorRing(7.7, 0.035, 0x7b8b5e, 0.2);
for (let i = 0; i < 12; i++) {
  const angle = i * Math.PI / 6;
  const tick = arenaBox(0.12, 0.025, 0.42, Math.cos(angle) * 4.6, 0.05, Math.sin(angle) * 4.6, 0x81934b, true);
  tick.rotation.y = -angle + Math.PI / 2;
}
const acidLight = new THREE.PointLight(0xd9fa47, 1.3, 30);
acidLight.position.set(-8, 7, 4);
scene.add(acidLight);
const coralLight = new THREE.PointLight(0xff6852, 1.4, 35);
coralLight.position.set(14, 5, -7);
scene.add(coralLight);

// Removes a 3D object - a single mesh (a bullet, a particle) or a whole
// group of meshes (the player tank, an enemy soldier) - from the scene AND
// frees its GPU resources. Three.js doesn't do this automatically just
// because we stop referencing an object, so every enemy/bullet/particle we
// delete goes through this helper. traverse() visits the object itself
// plus every child inside it, so this works for both cases.
function disposeMesh(object) {
  scene.remove(object);
  object.traverse((child) => {
    if (child.isMesh) {
      child.geometry.dispose();
      child.material.dispose();
    }
  });
}


// ---------------------------------------------------------------------
// 4. AUDIO (Web Audio API - procedural music & sound effects)
// ---------------------------------------------------------------------
// Everything here is generated in code with oscillators/noise - no
// external music or sound files to manage.

let audioCtx = null;
let masterGain = null;
let musicGain = null;
let sfxGain = null;
let musicTimerId = null;
let isMuted = false;

function initAudio() {
  if (audioCtx) return; // already set up
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();

  masterGain = audioCtx.createGain();
  masterGain.gain.value = isMuted ? 0 : 0.5;
  masterGain.connect(audioCtx.destination);

  musicGain = audioCtx.createGain();
  musicGain.gain.value = 0.35;
  musicGain.connect(masterGain);

  sfxGain = audioCtx.createGain();
  sfxGain.gain.value = 0.7;
  sfxGain.connect(masterGain);
}

// Plays one short musical note. Both the background music and several
// sound effects are built out of calls to this one function.
function playTone({ frequency, duration, type = "sine", destination, startTime, gain = 0.3, glideTo = null }) {
  const osc = audioCtx.createOscillator();
  const envelope = audioCtx.createGain();

  osc.type = type;
  osc.frequency.setValueAtTime(frequency, startTime);
  if (glideTo) {
    osc.frequency.exponentialRampToValueAtTime(glideTo, startTime + duration);
  }

  // A quick fade in/out avoids audible "clicks" at the start/end of a note.
  envelope.gain.setValueAtTime(0, startTime);
  envelope.gain.linearRampToValueAtTime(gain, startTime + 0.015);
  envelope.gain.linearRampToValueAtTime(0, startTime + duration);

  osc.connect(envelope);
  envelope.connect(destination);
  osc.start(startTime);
  osc.stop(startTime + duration + 0.05);
}

// A short burst of filtered random noise - used for the "enemy defeated" pop.
function playNoiseBurst({ duration, destination, startTime, gain = 0.3, filterFrequency = 1200 }) {
  const bufferSize = Math.floor(audioCtx.sampleRate * duration);
  const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = Math.random() * 2 - 1;
  }

  const noise = audioCtx.createBufferSource();
  noise.buffer = buffer;

  const filter = audioCtx.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = filterFrequency;

  const envelope = audioCtx.createGain();
  envelope.gain.setValueAtTime(gain, startTime);
  envelope.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

  noise.connect(filter);
  filter.connect(envelope);
  envelope.connect(destination);
  noise.start(startTime);
  noise.stop(startTime + duration);
}

function playShootSound() {
  if (!audioCtx) return;
  playTone({ frequency: 700, glideTo: 220, duration: 0.09, type: "square", destination: sfxGain, startTime: audioCtx.currentTime, gain: 0.15 });
}
function playEnemyShootSound() {
  if (!audioCtx) return;
  // Lower-pitched than the player's shot, so the two are easy to tell apart by ear.
  playTone({ frequency: 380, glideTo: 140, duration: 0.1, type: "sawtooth", destination: sfxGain, startTime: audioCtx.currentTime, gain: 0.12 });
}
function playEnemyDefeatedSound() {
  if (!audioCtx) return;
  playNoiseBurst({ duration: 0.18, destination: sfxGain, startTime: audioCtx.currentTime, gain: 0.35, filterFrequency: 1800 });
}
function playPlayerHitSound() {
  if (!audioCtx) return;
  playTone({ frequency: 160, glideTo: 60, duration: 0.35, type: "sawtooth", destination: sfxGain, startTime: audioCtx.currentTime, gain: 0.3 });
}
function playGameOverJingle(won) {
  if (!audioCtx) return;
  const notes = won ? [523.25, 659.25, 783.99, 1046.5] : [392, 329.63, 261.63, 196];
  notes.forEach((freq, i) => {
    playTone({ frequency: freq, duration: 0.28, type: "triangle", destination: sfxGain, startTime: audioCtx.currentTime + i * 0.18, gain: 0.25 });
  });
}

// A short 8-note bassline that loops for as long as the page is open.
const MUSIC_PATTERN = [110, 130.81, 146.83, 130.81, 110, 98, 110, 130.81]; // Hz
const MUSIC_NOTE_DURATION = 0.28; // seconds per note

function scheduleMusicLoop() {
  const loopDuration = MUSIC_NOTE_DURATION * MUSIC_PATTERN.length;
  const startTime = audioCtx.currentTime + 0.05;
  MUSIC_PATTERN.forEach((freq, i) => {
    playTone({
      frequency: freq,
      duration: MUSIC_NOTE_DURATION * 0.9,
      type: "triangle",
      destination: musicGain,
      startTime: startTime + i * MUSIC_NOTE_DURATION,
      gain: 0.18,
    });
  });
  // Schedule the next loop iteration. Muting doesn't stop this chain -
  // it just silences masterGain - so there's only ever one music loop
  // running for the whole page session, however many times we restart.
  musicTimerId = setTimeout(scheduleMusicLoop, loopDuration * 1000);
}

function startMusic() {
  initAudio();
  if (audioCtx.state === "suspended") audioCtx.resume();
  if (musicTimerId) return; // already looping - don't start a second chain
  scheduleMusicLoop();
}

function toggleMute() {
  isMuted = !isMuted;
  if (masterGain) masterGain.gain.value = isMuted ? 0 : 0.5;
  const button = document.getElementById("muteButton");
  button.setAttribute("aria-pressed", String(isMuted));
  button.setAttribute("aria-label", isMuted ? "Unmute audio" : "Mute audio");
  button.title = isMuted ? "Unmute audio" : "Mute audio";
  document.getElementById("soundLabel").textContent = isMuted ? "SOUND OFF" : "SOUND ON";
}


// ---------------------------------------------------------------------
// 5. GAME STATE
// ---------------------------------------------------------------------

// "state" tracks which screen/mode the game is in: "start", "playing",
// "paused", or "gameover".
let state = "start";
let selectedDifficulty = "medium";
// "gameMode" tracks which GAME (not screen) is active: "survival" (soldiers,
// health, one flat 60s timer) or "range" (stationary targets, no health,
// fixed staged rounds). selectedGameMode is what's picked on the start
// screen; gameMode is what the currently running/just-finished run used.
let selectedGameMode = "survival";
let gameMode = "survival";
let rangeStageIndex = 0;
let rangeStageTimeRemaining = 0;
let rangeTargets = [];
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

function setState(nextState) {
  state = nextState;
  document.body.dataset.state = state;
  // Hidden combat controls must not receive keyboard focus behind a menu.
  const interactive = state === "playing";
  document.getElementById("hud").inert = !interactive;
  document.getElementById("rangeHud").inert = !interactive;
  onWindowResize();
}

let score = 0;
let timeRemaining = GAME_DURATION;
let spawnTimer = 0;         // counts up in ms until the next enemy spawns
let elapsedPlayTime = 0;    // counts up in seconds while playing (controls spawn ramp)

let enemies = [];
let bullets = [];
let particles = [];


// ---------------------------------------------------------------------
// 6. PLAYER (3D mesh + aim line)
// ---------------------------------------------------------------------

const player = {
  x: 0, z: 0,               // position on the arena floor
  health: 3,
  invulnerableUntil: 0,     // timestamp (ms) until which the player can't take damage
  aimAngle: 0,               // direction (radians) the player is currently aiming
};

// Builds the player's tank out of simple box shapes (hull, turret, barrel,
// two treads) grouped together into one THREE.Group. The barrel is
// positioned sticking out along local -Z. We rotate the group around Y
// to align that forward direction with the player's aim angle.
function createPlayerTank() {
  const tank = new THREE.Group();

  const hull = new THREE.Mesh(
    new THREE.BoxGeometry(1.6, 0.5, 2.2),
    new THREE.MeshStandardMaterial({ color: 0xd9fa47, emissive: 0x546610, emissiveIntensity: 0.5 })
  );
  hull.position.y = 0.25;
  tank.add(hull);

  const turret = new THREE.Mesh(
    new THREE.BoxGeometry(0.9, 0.4, 1.0),
    new THREE.MeshStandardMaterial({ color: 0xabc235, emissive: 0x546610, emissiveIntensity: 0.5 })
  );
  turret.position.y = 0.7;
  tank.add(turret);

  const barrel = new THREE.Mesh(
    new THREE.BoxGeometry(0.16, 0.16, 1.3),
    new THREE.MeshStandardMaterial({ color: 0x404c2b })
  );
  barrel.position.set(0, 0.7, -1.15); // sticks out the front, along local -Z
  tank.add(barrel);

  const treadMaterial = new THREE.MeshStandardMaterial({ color: 0x121912 });
  const treadGeometry = new THREE.BoxGeometry(0.3, 0.35, 2.3);
  const treadLeft = new THREE.Mesh(treadGeometry, treadMaterial);
  treadLeft.position.set(-0.95, 0.2, 0);
  tank.add(treadLeft);
  const treadRight = new THREE.Mesh(treadGeometry, treadMaterial);
  treadRight.position.set(0.95, 0.2, 0);
  tank.add(treadRight);

  // Bright headlights and tread ribs make the silhouette readable from above.
  for (const side of [-1, 1]) {
    for (let z = -0.9; z <= 0.9; z += 0.3) {
      const rib = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.06, 0.08), new THREE.MeshStandardMaterial({ color: 0x586344 }));
      rib.position.set(side * 0.95, 0.4, z);
      tank.add(rib);
    }
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.12, 0.06), new THREE.MeshBasicMaterial({ color: 0xf1ffd1 }));
    lamp.position.set(side * 0.55, 0.45, -1.12);
    tank.add(lamp);
  }
  return tank;
}

const playerTank = createPlayerTank();
scene.add(playerTank);

function resetPlayer() {
  player.x = 0;
  player.z = 0;
  player.health = currentDifficulty.maxHealth;
  player.invulnerableUntil = 0;
  player.aimAngle = 0;
  playerTank.scale.setScalar(1);
  playerTank.position.set(0, 0, 0);
  playerTank.visible = true;
}


// ---------------------------------------------------------------------
// 7. INPUT HANDLING (keyboard + mouse-to-3D-floor raycasting)
// ---------------------------------------------------------------------

// "keys" is a lookup table: keys["w"] is true while the W key is held down.
const keys = {};

// Raw mouse position in page pixels.
const mouse = { x: window.innerWidth / 2, y: window.innerHeight / 2 };

// A raycaster turns a 2D mouse position into a 3D ray from the camera.
// We intersect that ray with an invisible flat plane at y=0 (the arena
// floor's height) to find the 3D point the player is pointing at.
const raycaster = new THREE.Raycaster();
const mouseNDC = new THREE.Vector2();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const aimTarget = new THREE.Vector3();

let lastShotTime = 0;

document.addEventListener("keydown", (e) => {
  keys[e.key.toLowerCase()] = true;
  if (state === "playing" && e.key.startsWith("Arrow")) e.preventDefault();

  if (!e.repeat && e.key === "Escape" && (state === "playing" || state === "paused")) {
    togglePause();
  }

  // Space bar fires too, alongside left-click - same shoot() call, same
  // cooldown, so both inputs behave identically.
  if (e.code === "Space" && state === "playing") {
    e.preventDefault(); // stop the page from scrolling or re-clicking a focused button
    shoot();
  }
});

// Losing window focus must not leave movement keys stuck down.
window.addEventListener("blur", () => {
  Object.keys(keys).forEach((key) => { keys[key] = false; });
  if (state === "playing") togglePause();
});
document.addEventListener("keyup", (e) => {
  keys[e.key.toLowerCase()] = false;
});

window.addEventListener("mousemove", (e) => {
  mouse.x = e.clientX;
  mouse.y = e.clientY;
});

// Listening on the canvas itself (not window/document) means clicks on the
// HUD/menu buttons - which live outside the canvas in the DOM - never reach
// this handler, so pressing Pause/Mute/Fullscreen can't also fire a bullet.
renderer.domElement.addEventListener("mousedown", (e) => {
  if (e.button !== 0) return;   // only respond to the left mouse button
  if (state !== "playing") return;
  shoot();
});

document.getElementById("gameContainer").addEventListener("contextmenu", (e) => e.preventDefault());


function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

// Reads keyboard + mouse input and updates the player's position, aim
// direction, and visuals. Called once per frame while playing.
function updatePlayerMovement(dt) {
  let moveX = 0;
  let moveZ = 0;
  if (keys["w"] || keys["arrowup"]) moveZ -= 1;
  if (keys["s"] || keys["arrowdown"]) moveZ += 1;
  if (keys["a"] || keys["arrowleft"]) moveX -= 1;
  if (keys["d"] || keys["arrowright"]) moveX += 1;

  // Normalise so diagonal movement isn't faster than straight movement.
  if (moveX !== 0 || moveZ !== 0) {
    const length = Math.hypot(moveX, moveZ);
    moveX /= length;
    moveZ /= length;
  }

  player.x += moveX * PLAYER_SPEED * dt;
  player.z += moveZ * PLAYER_SPEED * dt;

  // Keep the player inside the arena's edges.
  player.x = clamp(player.x, -ARENA_HALF_WIDTH + PLAYER_RADIUS, ARENA_HALF_WIDTH - PLAYER_RADIUS);
  player.z = clamp(player.z, -ARENA_HALF_DEPTH + PLAYER_RADIUS, ARENA_HALF_DEPTH - PLAYER_RADIUS);
  playerTank.position.set(player.x, 0, player.z);

  // Aiming: cast a ray from the camera through the mouse position and
  // see where it hits the arena floor - that's the point we're aiming at.
  const rect = renderer.domElement.getBoundingClientRect();
  mouseNDC.x = ((mouse.x - rect.left) / rect.width) * 2 - 1;
  mouseNDC.y = -((mouse.y - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(mouseNDC, camera);
  const hitFloor = raycaster.ray.intersectPlane(groundPlane, aimTarget);
  if (hitFloor) {
    player.aimAngle = Math.atan2(aimTarget.z - player.z, aimTarget.x - player.x);

    // Group.lookAt points local +Z forward, but our barrel uses -Z.
    // Align -Z with the same X/Z angle used by the bullet velocity.
    const aimDistance = Math.hypot(aimTarget.x - player.x, aimTarget.z - player.z);
    if (aimDistance > 0.01) {
      playerTank.rotation.y = -player.aimAngle - Math.PI / 2;
    }
  }

  // Flash the tank while invulnerable so a hit is obviously registered.
  const now = performance.now();
  const isInvulnerable = now < player.invulnerableUntil;
  playerTank.visible = !(isInvulnerable && Math.floor(now / 100) % 2 === 0);
}


// ---------------------------------------------------------------------
// 8. ENEMIES
// ---------------------------------------------------------------------

// Builds one enemy "soldier" out of simple shapes (legs, torso, head,
// helmet, rifle) grouped together, standing on the ground (group origin at
// y=0). Every soldier gets its OWN fresh geometries/materials here rather
// than sharing them with other soldiers - important, because disposeMesh()
// frees whatever geometry/material a defeated soldier's parts use, and if
// that were shared with a still-alive soldier, disposing it would break
// that other soldier's rendering too.
function createSoldierModel() {
  const soldier = new THREE.Group();

  const legs = new THREE.Mesh(
    new THREE.CylinderGeometry(0.16, 0.2, 0.7, 8),
    new THREE.MeshStandardMaterial({ color: 0x7a1f1f })
  );
  legs.position.y = 0.35;
  soldier.add(legs);

  const torso = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.55, 0.32),
    new THREE.MeshStandardMaterial({ color: 0xff6852, emissive: 0x662014, emissiveIntensity: 0.5 })
  );
  torso.position.y = 0.975;
  soldier.add(torso);

  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.17, 10, 8),
    new THREE.MeshStandardMaterial({ color: 0xdf9a6b })
  );
  head.position.y = 1.42;
  soldier.add(head);

  const helmet = new THREE.Mesh(
    new THREE.BoxGeometry(0.26, 0.12, 0.28),
    new THREE.MeshStandardMaterial({ color: 0x551111 })
  );
  helmet.position.y = 1.53;
  soldier.add(helmet);

  const rifle = new THREE.Mesh(
    new THREE.BoxGeometry(0.05, 0.05, 0.75),
    new THREE.MeshStandardMaterial({ color: 0x222222 })
  );
  rifle.position.set(0.22, 0.95, -0.5); // held out front, along local -Z
  soldier.add(rifle);

  return soldier;
}

// Creates one enemy just outside a random edge of the arena.
function spawnEnemy() {
  if (enemies.length >= MAX_ENEMIES_ON_SCREEN) return;

  const edge = Math.floor(Math.random() * 4); // 0=north, 1=east, 2=south, 3=west
  let x, z;

  if (edge === 0) {
    x = (Math.random() * 2 - 1) * ARENA_HALF_WIDTH;
    z = -ARENA_HALF_DEPTH - ENEMY_RADIUS;
  } else if (edge === 1) {
    x = ARENA_HALF_WIDTH + ENEMY_RADIUS;
    z = (Math.random() * 2 - 1) * ARENA_HALF_DEPTH;
  } else if (edge === 2) {
    x = (Math.random() * 2 - 1) * ARENA_HALF_WIDTH;
    z = ARENA_HALF_DEPTH + ENEMY_RADIUS;
  } else {
    x = -ARENA_HALF_WIDTH - ENEMY_RADIUS;
    z = (Math.random() * 2 - 1) * ARENA_HALF_DEPTH;
  }

  const model = createSoldierModel();
  model.position.set(x, 0, z);
  scene.add(model); // without this the soldier updates and collides, but never renders

  enemies.push({
    model, x, z,
    speed: currentDifficulty.enemyMinSpeed + Math.random() * (currentDifficulty.enemyMaxSpeed - currentDifficulty.enemyMinSpeed),
    // Randomised starting point in the fire cycle so a whole wave of
    // soldiers doesn't all shoot in perfect unison.
    fireTimer: Math.random() * currentDifficulty.enemyFireInterval,
  });
}

// How often enemies should spawn right now. The interval shrinks over
// time (enemies appear more often) but never goes below spawnMin, so
// the game stays winnable even on Hard.
function currentSpawnInterval() {
  const progress = Math.min(elapsedPlayTime / currentDifficulty.spawnRamp, 1);
  return currentDifficulty.spawnStart - progress * (currentDifficulty.spawnStart - currentDifficulty.spawnMin);
}

function updateEnemies(dt) {
  for (const enemy of enemies) {
    const dx = player.x - enemy.x;
    const dz = player.z - enemy.z;
    const distance = Math.hypot(dx, dz);
    if (distance > 0) {
      enemy.x += (dx / distance) * enemy.speed * dt;
      enemy.z += (dz / distance) * enemy.speed * dt;
    }
    enemy.model.position.set(enemy.x, 0, enemy.z);
    // Face the player - since a soldier always moves straight toward the
    // player, this is also its movement direction. The distance guard
    // avoids an undefined rotation in the rare case they're at the exact
    // same spot for a frame.
    if (distance > 0.01) {
      enemy.model.rotation.y = -Math.atan2(dz, dx) - Math.PI / 2;
    }

    // Shooting: once close enough, each soldier fires on its own cooldown.
    enemy.fireTimer += dt * 1000;
    if (distance > 0.01 && distance <= ENEMY_FIRE_RANGE && enemy.fireTimer >= currentDifficulty.enemyFireInterval) {
      enemy.fireTimer = 0;
      fireEnemyBullet(enemy, dx, dz, distance);
    }
  }

  spawnTimer += dt * 1000;
  if (spawnTimer >= currentSpawnInterval()) {
    spawnTimer = 0;
    spawnEnemy();
  }
}


// ---------------------------------------------------------------------
// 8b. TARGET RANGE MODE (stationary targets, staged rounds)
// ---------------------------------------------------------------------

// Builds one stationary shooting-range target: a post plus a layered
// red/white bullseye board. Every target gets its OWN fresh
// geometries/materials (same reasoning as soldiers in createSoldierModel) -
// so destroying one target can never break a still-standing one.
//
// The board is a stack of thin boxes, each slightly smaller than the last.
// A box that's thin in Z already has its flat face pointing along Z with no
// rotation needed - and because the camera always views the arena from the
// same fixed angle (see onWindowResize), a Z-facing board stays readable
// no matter where in the arena it's placed or where the player is standing.
function createTargetModel() {
  const target = new THREE.Group();

  const post = new THREE.Mesh(
    new THREE.CylinderGeometry(0.06, 0.08, 1.1, 6),
    new THREE.MeshStandardMaterial({ color: 0x2a2f28 })
  );
  post.position.y = 0.55;
  target.add(post);

  const rings = [
    { size: 0.8, z: 0, color: 0xf4f2e6 },
    { size: 0.58, z: 0.012, color: 0xff6852 },
    { size: 0.36, z: 0.024, color: 0xf4f2e6 },
    { size: 0.16, z: 0.036, color: 0xff6852 },
  ];
  for (const ring of rings) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(ring.size, ring.size, 0.05),
      new THREE.MeshStandardMaterial({ color: ring.color, emissive: ring.color, emissiveIntensity: 0.15 })
    );
    mesh.position.set(0, 1.15, ring.z);
    target.add(mesh);
  }

  return target;
}

// Finds a spot for a new target: away from the player's center start point,
// and (when possible within a bounded number of tries) not overlapping
// targets already placed this stage. Falls back to any in-bounds spot
// rather than looping forever if the arena is getting crowded.
function pickTargetSpawnPosition(existingTargets) {
  const MIN_FROM_CENTER = 4;
  const MIN_SEPARATION = 2.6;
  for (let attempt = 0; attempt < 30; attempt++) {
    const x = (Math.random() * 2 - 1) * (ARENA_HALF_WIDTH - 2);
    const z = (Math.random() * 2 - 1) * (ARENA_HALF_DEPTH - 2);
    if (Math.hypot(x, z) < MIN_FROM_CENTER) continue;
    const tooClose = existingTargets.some((t) => Math.hypot(t.x - x, t.z - z) < MIN_SEPARATION);
    if (!tooClose) return { x, z };
  }
  return {
    x: (Math.random() * 2 - 1) * (ARENA_HALF_WIDTH - 2),
    z: (Math.random() * 2 - 1) * (ARENA_HALF_DEPTH - 2),
  };
}

// Clears any targets left from the previous stage and places a fresh set
// for RANGE_STAGES[stageIndex], then resets that stage's clock.
function spawnRangeStage(stageIndex) {
  for (const t of rangeTargets) disposeMesh(t.model);
  rangeTargets = [];

  const stage = RANGE_STAGES[stageIndex];
  for (let i = 0; i < stage.targetCount; i++) {
    const { x, z } = pickTargetSpawnPosition(rangeTargets);
    const model = createTargetModel();
    model.position.set(x, 0, z);
    scene.add(model);
    rangeTargets.push({ model, x, z, radius: stage.targetRadius });
  }

  rangeStageIndex = stageIndex;
  rangeStageTimeRemaining = stage.timeLimit;
  updateRangeHUD();
}

// Range mode's own update loop, called from update() instead of
// updateEnemies()/handleCollisions() while gameMode === "range". There are
// no enemies and no player damage here - just the stage clock and player
// bullets vs targets.
function updateRangeMode(dt) {
  rangeStageTimeRemaining -= dt;
  if (rangeStageTimeRemaining <= 0) {
    rangeStageTimeRemaining = 0;
    updateRangeHUD();
    endRangeGame(false);
    return;
  }

  const remainingTargets = [];
  for (const target of rangeTargets) {
    let hitIndex = -1;
    for (let i = 0; i < bullets.length; i++) {
      if (bullets[i].owner === "player" && circlesOverlap(target.x, target.z, target.radius, bullets[i].x, bullets[i].z, BULLET_RADIUS)) {
        hitIndex = i;
        break;
      }
    }

    if (hitIndex !== -1) {
      disposeMesh(bullets[hitIndex].mesh);
      bullets.splice(hitIndex, 1);
      disposeMesh(target.model);
      score += RANGE_TARGET_POINTS;
      spawnDefeatEffect(target.x, target.z);
      playEnemyDefeatedSound();
    } else {
      remainingTargets.push(target);
    }
  }
  rangeTargets = remainingTargets;

  if (rangeTargets.length === 0) {
    if (rangeStageIndex >= RANGE_STAGES.length - 1) {
      endRangeGame(true);
      return;
    }
    spawnRangeStage(rangeStageIndex + 1);
    return;
  }

  updateRangeHUD();
}

function updateRangeHUD() {
  const stage = RANGE_STAGES[rangeStageIndex];
  document.getElementById("rangeStageDisplay").textContent = (rangeStageIndex + 1) + "/" + RANGE_STAGES.length;
  document.getElementById("rangeTargetsDisplay").textContent = rangeTargets.length + "/" + stage.targetCount;
  const seconds = Math.max(0, Math.ceil(rangeStageTimeRemaining));
  document.getElementById("rangeTimeDisplay").textContent =
    String(Math.floor(seconds / 60)).padStart(2, "0") + ":" + String(seconds % 60).padStart(2, "0");
  document.getElementById("rangeTimerFill").style.width = (rangeStageTimeRemaining / stage.timeLimit * 100) + "%";
  document.getElementById("rangeScoreDisplay").textContent = String(score).padStart(4, "0");
  document.querySelector("#rangeHud .timerItem").classList.toggle("urgent", seconds <= 5);
}


// ---------------------------------------------------------------------
// 9. BULLETS
// ---------------------------------------------------------------------

// color/emissive let us make the player's bullets (yellow) and the
// soldiers' bullets (orange-red) look visibly different at a glance.
function createBulletMesh(color = 0xffe066, emissive = 0xffcc00) {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(BULLET_RADIUS, 8, 6),
    new THREE.MeshStandardMaterial({ color, emissive, emissiveIntensity: 1 })
  );
  scene.add(mesh);
  return mesh;
}

function shoot() {
  const now = performance.now();
  if (now - lastShotTime < SHOOT_COOLDOWN) return; // still cooling down
  lastShotTime = now;

  const mesh = createBulletMesh();
  mesh.position.set(player.x, BULLET_HEIGHT, player.z);

  bullets.push({
    mesh,
    owner: "player",
    x: player.x, z: player.z,
    vx: Math.cos(player.aimAngle) * BULLET_SPEED,
    vz: Math.sin(player.aimAngle) * BULLET_SPEED,
  });

  playShootSound();
}

// Fires one bullet from a soldier straight at the player's current
// position. dx/dz/distance are passed in from updateEnemies(), which
// already computed them for movement that same frame.
function fireEnemyBullet(enemy, dx, dz, distance) {
  const mesh = createBulletMesh(0xff5533, 0xff2200);
  mesh.position.set(enemy.x, BULLET_HEIGHT, enemy.z);

  bullets.push({
    mesh,
    owner: "enemy",
    x: enemy.x, z: enemy.z,
    vx: (dx / distance) * ENEMY_BULLET_SPEED,
    vz: (dz / distance) * ENEMY_BULLET_SPEED,
  });

  playEnemyShootSound();
}

function updateBullets(dt) {
  const remaining = [];
  for (const bullet of bullets) {
    bullet.x += bullet.vx * dt;
    bullet.z += bullet.vz * dt;
    bullet.mesh.position.set(bullet.x, BULLET_HEIGHT, bullet.z);

    const outOfBounds =
      bullet.x < -ARENA_HALF_WIDTH - 5 || bullet.x > ARENA_HALF_WIDTH + 5 ||
      bullet.z < -ARENA_HALF_DEPTH - 5 || bullet.z > ARENA_HALF_DEPTH + 5;

    if (outOfBounds) {
      disposeMesh(bullet.mesh);
    } else {
      remaining.push(bullet);
    }
  }
  bullets = remaining;
}


// ---------------------------------------------------------------------
// 10. PARTICLES (the little "poof" effect when an enemy is defeated)
// ---------------------------------------------------------------------

function spawnDefeatEffect(x, z) {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(ENEMY_RADIUS, 8, 6),
    new THREE.MeshBasicMaterial({ color: 0xffd23f, wireframe: true, transparent: true, opacity: 1 })
  );
  mesh.position.set(x, ENEMY_RADIUS, z);
  scene.add(mesh);
  particles.push({ mesh, alpha: 1 });
}

function updateParticles(dt) {
  const remaining = [];
  for (const p of particles) {
    p.alpha -= 2.5 * dt; // fade out
    if (p.alpha > 0) {
      p.mesh.scale.setScalar(1 + (1 - p.alpha) * 2.5); // ring expands outward
      p.mesh.material.opacity = p.alpha;
      remaining.push(p);
    } else {
      disposeMesh(p.mesh);
    }
  }
  particles = remaining;
}


// ---------------------------------------------------------------------
// 11. COLLISION DETECTION
// ---------------------------------------------------------------------

// Two circles (viewed from above, ignoring height) overlap when the
// distance between their centers is less than the sum of their radii -
// the same simple test as the 2D version, just using X/Z instead of X/Y.
function circlesOverlap(ax, az, aRadius, bx, bz, bRadius) {
  return Math.hypot(ax - bx, az - bz) < aRadius + bRadius;
}

function handleCollisions() {
  // --- The player's bullets vs enemies ---
  // Only bullets owned by the player can defeat an enemy - without this
  // filter, an enemy's own bullet could "hit" and kill it (or another
  // enemy) the instant it's fired.
  const survivingEnemies = [];
  for (const enemy of enemies) {
    let hitIndex = -1;
    for (let i = 0; i < bullets.length; i++) {
      if (bullets[i].owner === "player" && circlesOverlap(enemy.x, enemy.z, ENEMY_RADIUS, bullets[i].x, bullets[i].z, BULLET_RADIUS)) {
        hitIndex = i;
        break;
      }
    }

    if (hitIndex !== -1) {
      disposeMesh(bullets[hitIndex].mesh);
      bullets.splice(hitIndex, 1);
      disposeMesh(enemy.model);
      score += ENEMY_POINTS;
      spawnDefeatEffect(enemy.x, enemy.z);
      playEnemyDefeatedSound();
    } else {
      survivingEnemies.push(enemy);
    }
  }
  enemies = survivingEnemies;

  // --- Enemies (contact) and enemy bullets vs the player ---
  const now = performance.now();
  const isInvulnerable = now < player.invulnerableUntil;

  if (!isInvulnerable) {
    let tookDamage = false;

    for (const enemy of enemies) {
      if (circlesOverlap(player.x, player.z, PLAYER_RADIUS, enemy.x, enemy.z, ENEMY_RADIUS)) {
        tookDamage = true;
        break;
      }
    }

    // Only check bullets if contact didn't already hit this frame - one
    // source of damage per frame is enough, and it keeps this simple.
    if (!tookDamage) {
      for (let i = 0; i < bullets.length; i++) {
        if (bullets[i].owner === "enemy" && circlesOverlap(player.x, player.z, PLAYER_RADIUS, bullets[i].x, bullets[i].z, BULLET_RADIUS)) {
          disposeMesh(bullets[i].mesh);
          bullets.splice(i, 1);
          tookDamage = true;
          break;
        }
      }
    }

    if (tookDamage) {
      player.health -= 1;
      player.invulnerableUntil = now + DAMAGE_COOLDOWN;
      playPlayerHitSound();
      const flash = document.getElementById("damageFlash");
      flash.classList.remove("hit");
      void flash.offsetWidth; // restart the short damage vignette
      flash.classList.add("hit");

      if (player.health <= 0) {
        endGame(false);
      }
    }
  }
}


// ---------------------------------------------------------------------
// 12. HUD (on-screen health / score / time text)
// ---------------------------------------------------------------------

function updateHUD() {
  const healthDisplay = document.getElementById("healthDisplay");
  const healthKey = player.health + "/" + currentDifficulty.maxHealth;
  // Only rebuild the armor segments when health changes, not every frame.
  if (healthDisplay.dataset.value !== healthKey) {
    healthDisplay.dataset.value = healthKey;
    healthDisplay.setAttribute("aria-label", "Armor: " + healthKey);
    healthDisplay.innerHTML = Array.from({ length: currentDifficulty.maxHealth }, (_, i) =>
      '<span class="armorPip' + (i >= player.health ? ' empty' : '') + '" aria-hidden="true"></span>'
    ).join("");
  }
  document.getElementById("scoreDisplay").textContent = String(score).padStart(4, "0");
  const seconds = Math.max(0, Math.ceil(timeRemaining));
  document.getElementById("timeDisplay").textContent =
    String(Math.floor(seconds / 60)).padStart(2, "0") + ":" + String(seconds % 60).padStart(2, "0");
  document.getElementById("timerFill").style.width = (timeRemaining / GAME_DURATION * 100) + "%";
  document.querySelector(".timerItem").classList.toggle("urgent", seconds <= 10);
}


// ---------------------------------------------------------------------
// 13. THE GAME LOOP
// ---------------------------------------------------------------------

// update() advances the game world forward by "dt" seconds. Only called
// while state === "playing". Movement/aiming/shooting/particles are shared
// by both modes; everything else branches on gameMode, since Survival
// (soldiers, health, one flat timer) and Range (targets, no health, staged
// timers) have almost nothing else in common.
function update(dt) {
  updatePlayerMovement(dt);
  updateBullets(dt);
  updateParticles(dt);

  if (gameMode === "range") {
    updateRangeMode(dt);
    return;
  }

  updateEnemies(dt);
  handleCollisions();
  if (state !== "playing") return; // a fatal hit must not become a win in this same frame

  elapsedPlayTime += dt;
  timeRemaining -= dt;
  if (timeRemaining <= 0) {
    timeRemaining = 0;
    endGame(true);
  }

  updateHUD();
}

// The main loop runs continuously for the entire page session - it never
// stops and is only ever started once (see the bottom of this file).
// Pausing/starting/ending the game only change the "state" variable;
// they never touch requestAnimationFrame themselves. This keeps things
// simple and guarantees there is only ever one loop running.
let lastTimestamp = performance.now();
function gameLoop(timestamp) {
  const dt = Math.min((timestamp - lastTimestamp) / 1000, 0.05); // seconds, capped to avoid big jumps
  lastTimestamp = timestamp;

  if (state === "playing") {
    update(dt);
  }

  if (state === "start") {
    // A slow equipment-preview turn; accessibility settings disable motion.
    playerTank.scale.setScalar(2);
    if (!reducedMotion.matches) playerTank.rotation.y = timestamp * 0.00014;
    landingRing.material.opacity = reducedMotion.matches ? 0.5 : 0.35 + Math.sin(timestamp * 0.0015) * 0.15;
  }
  renderer.render(scene, camera); // always render, so the arena is visible behind menus too

  requestAnimationFrame(gameLoop);
}


// ---------------------------------------------------------------------
// 14. FULLSCREEN & WINDOW RESIZING
// ---------------------------------------------------------------------

function onWindowResize() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  camera.aspect = width / height;
  camera.clearViewOffset();
  if (state === "start") {
    scene.fog.near = 48;
    scene.fog.far = 105;
    camera.far = 200;
    camera.position.set(27, 29, 34);
    camera.lookAt(0, 0, 0);
    // Shift the real arena to the right of the briefing, without moving the canvas.
    if (width > 600) camera.setViewOffset(width, height, -width * 0.22, -height * 0.01, width, height);
  } else {
    const fit = Math.max(1, 1.55 / camera.aspect);
    scene.fog.near = 48 * fit;
    scene.fog.far = 105 * fit;
    camera.far = 200 * fit;
    camera.position.set(0, 32 * fit, 26 * fit);
    camera.lookAt(0, 0, 0);
  }
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
  const fullscreen = Boolean(document.fullscreenElement || document.webkitFullscreenElement);
  const fullscreenButton = document.getElementById("fullscreenButton");
  fullscreenButton.title = fullscreen ? "Exit fullscreen" : "Enter fullscreen";
  fullscreenButton.setAttribute("aria-label", fullscreenButton.title);
}
window.addEventListener("resize", onWindowResize);
document.addEventListener("fullscreenchange", onWindowResize);
document.addEventListener("webkitfullscreenchange", onWindowResize);

function toggleFullscreen() {
  const el = document.getElementById("gameContainer");
  const isFullscreen = document.fullscreenElement || document.webkitFullscreenElement;

  if (!isFullscreen) {
    if (el.requestFullscreen) el.requestFullscreen();
    else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
  } else {
    if (document.exitFullscreen) document.exitFullscreen();
    else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
  }
}


// ---------------------------------------------------------------------
// 15. STARTING, PAUSING, AND RESTARTING
// ---------------------------------------------------------------------

const startScreen = document.getElementById("startScreen");
const pauseScreen = document.getElementById("pauseScreen");
const endScreen = document.getElementById("endScreen");
const endTitle = document.getElementById("endTitle");
const endMessage = document.getElementById("endMessage");
const hud = document.getElementById("hud");

function showScreen(screen) {
  screen.classList.remove("hidden");
}
function hideScreen(screen) {
  screen.classList.add("hidden");
}

// Both start/retry paths funnel through this so game-loop setup (music,
// input reset, focus) only lives in one place, regardless of mode.
function beginRun() {
  hideScreen(startScreen);
  hideScreen(pauseScreen);
  hideScreen(endScreen);
  startMusic(); // requires a user gesture - this click is one
  setState("playing");
  Object.keys(keys).forEach((key) => { keys[key] = false; });
  lastShotTime = 0;
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
}

function startGame(difficultyKey) {
  gameMode = "survival";
  currentDifficulty = DIFFICULTY_PRESETS[difficultyKey] || DIFFICULTY_PRESETS.medium;
  document.getElementById("difficultyDisplay").textContent = currentDifficulty.label;

  // Clear out any leftover enemies/bullets/particles/targets from a previous round.
  for (const e of enemies) disposeMesh(e.model);
  for (const b of bullets) disposeMesh(b.mesh);
  for (const p of particles) disposeMesh(p.mesh);
  for (const t of rangeTargets) disposeMesh(t.model);
  enemies = [];
  bullets = [];
  particles = [];
  rangeTargets = [];

  resetPlayer();
  score = 0;
  timeRemaining = GAME_DURATION;
  spawnTimer = 0;
  elapsedPlayTime = 0;

  document.getElementById("rangeHud").classList.add("hidden");
  hud.classList.remove("hidden");
  updateHUD();

  beginRun();
}

function startRangeGame() {
  gameMode = "range";

  // Clear out any leftover enemies/bullets/particles/targets from a previous round.
  for (const e of enemies) disposeMesh(e.model);
  for (const b of bullets) disposeMesh(b.mesh);
  for (const p of particles) disposeMesh(p.mesh);
  for (const t of rangeTargets) disposeMesh(t.model);
  enemies = [];
  bullets = [];
  particles = [];
  rangeTargets = [];

  resetPlayer(); // health goes unused/undisplayed in this mode - no damage source exists
  score = 0;

  hud.classList.add("hidden");
  document.getElementById("rangeHud").classList.remove("hidden");
  spawnRangeStage(0); // also sets rangeStageTimeRemaining and updates the range HUD

  beginRun();
}

// The deploy/retry buttons don't care which mode is selected - they just
// launch whichever one the player picked.
function launchSelectedMode() {
  if (selectedGameMode === "range") {
    startRangeGame();
  } else {
    startGame(selectedDifficulty);
  }
}

function togglePause() {
  if (state === "playing") {
    setState("paused");
    showScreen(pauseScreen);
    document.getElementById("resumeButton").focus();
  } else if (state === "paused") {
    setState("playing");
    hideScreen(pauseScreen);
    document.activeElement.blur();
  }
}

// Shows/hides the two different "what to pick before retrying" blocks on
// the end screen: a difficulty re-picker for Survival, a plain note for
// Range (its stages are fixed - there's nothing to pick).
function applyRetrySectionVisibility() {
  document.getElementById("threatLevelRetrySection").classList.toggle("hidden", gameMode === "range");
  document.getElementById("rangeRetryNote").classList.toggle("hidden", gameMode !== "range");
}

function endGame(won) {
  if (state === "gameover") return;
  setState("gameover");
  document.body.dataset.result = won ? "won" : "lost";
  hud.classList.add("hidden");
  endTitle.innerHTML = won ? 'STILL<br><span>STANDING.</span>' : 'SYSTEM<br><span>DOWN.</span>';
  document.getElementById("resultEyebrow").textContent = won ? "// EXTRACTION SUCCESSFUL" : "// SIGNAL LOST";
  endMessage.textContent = won ? "60 seconds. One survivor. You earned your way out." : "The arena got you this time. Make the next run count.";
  document.getElementById("finalScore").textContent = String(score).padStart(4, "0");
  document.getElementById("finalTimeLabel").textContent = "SURVIVED";
  document.getElementById("finalTime").innerHTML = Math.floor(GAME_DURATION - timeRemaining) + '<span>s / ' + currentDifficulty.label.toUpperCase() + '</span>';
  applyRetrySectionVisibility();
  showScreen(endScreen);
  document.getElementById("retryButton").focus();
  playGameOverJingle(won);
  submitScore("survival", score);
}

// Range mode's equivalent of endGame(): cleared === every stage finished,
// !cleared === the clock ran out on the current stage.
function endRangeGame(cleared) {
  if (state === "gameover") return;
  setState("gameover");
  document.body.dataset.result = cleared ? "won" : "lost";
  document.getElementById("rangeHud").classList.add("hidden");
  endTitle.innerHTML = cleared ? 'RANGE<br><span>CLEARED.</span>' : 'OUT OF<br><span>TIME.</span>';
  document.getElementById("resultEyebrow").textContent = cleared ? "// PERFECT RUN" : "// RUN INCOMPLETE";
  endMessage.textContent = cleared
    ? "All " + RANGE_STAGES.length + " stages down. That kind of precision doesn't happen by accident."
    : "Stage " + (rangeStageIndex + 1) + " of " + RANGE_STAGES.length + ". The clock got you - reload and go again.";
  document.getElementById("finalScore").textContent = String(score).padStart(4, "0");
  document.getElementById("finalTimeLabel").textContent = "STAGES CLEARED";
  const stagesCleared = cleared ? RANGE_STAGES.length : rangeStageIndex;
  document.getElementById("finalTime").innerHTML = stagesCleared + '<span>/' + RANGE_STAGES.length + '</span>';
  applyRetrySectionVisibility();
  showScreen(endScreen);
  document.getElementById("retryButton").focus();
  playGameOverJingle(cleared);
  submitScore("range", score);
}

// Updates the start screen's intro copy, deploy button label, and which
// briefing section (threat level vs range info) is shown, to match
// whichever mode is currently selected.
function applyModeCopy() {
  const intro = document.getElementById("modeIntro");
  const deployLabel = document.querySelector("#deployButton span:first-child");
  const isRange = selectedGameMode === "range";
  document.getElementById("threatLevelSection").classList.toggle("hidden", isRange);
  if (isRange) {
    intro.innerHTML = "Stationary targets. A shrinking clock.<br>Clear all <strong>" + RANGE_STAGES.length + " stages</strong> before time runs out.";
    deployLabel.textContent = "ENTER THE RANGE";
  } else {
    intro.innerHTML = "They keep coming. You keep firing.<br>Survive the longest <strong>60 seconds</strong> of your life.";
    deployLabel.textContent = "ENTER THE ARENA";
  }
  updateLoadoutNote();
  updatePersonalBestDisplay();
}

function updateLoadoutNote() {
  const note = document.getElementById("loadoutNote");
  if (selectedGameMode === "range") {
    note.textContent = RANGE_STAGES.length + " STAGES / PRECISION RUN";
  } else {
    const preset = DIFFICULTY_PRESETS[selectedDifficulty];
    note.textContent = preset.maxHealth + " ARMOR / " + preset.label.toUpperCase() + " THREAT";
  }
}

// Difficulty is a deliberate selection; the large action button launches a
// run. Selectors use the [data-difficulty]/[data-mode] attributes (not the
// shared .difficultyButton class both sets of buttons use for styling) so
// picking a difficulty can never be confused with picking a game mode.
document.querySelectorAll("[data-difficulty]").forEach((button) => {
  button.addEventListener("click", () => {
    selectedDifficulty = button.dataset.difficulty;
    document.querySelectorAll("[data-difficulty]").forEach((choice) => {
      const selected = choice.dataset.difficulty === selectedDifficulty;
      choice.classList.toggle("selected", selected);
      choice.setAttribute("aria-pressed", String(selected));
    });
    updateLoadoutNote();
  });
});
document.querySelectorAll("[data-mode]").forEach((button) => {
  button.addEventListener("click", () => {
    selectedGameMode = button.dataset.mode;
    document.querySelectorAll("[data-mode]").forEach((choice) => {
      const selected = choice.dataset.mode === selectedGameMode;
      choice.classList.toggle("selected", selected);
      choice.setAttribute("aria-pressed", String(selected));
    });
    applyModeCopy();
  });
});
document.getElementById("deployButton").addEventListener("click", launchSelectedMode);
document.getElementById("retryButton").addEventListener("click", launchSelectedMode);
document.getElementById("pauseButton").addEventListener("click", togglePause);
document.getElementById("rangePauseButton").addEventListener("click", togglePause);
document.getElementById("resumeButton").addEventListener("click", togglePause);
document.getElementById("muteButton").addEventListener("click", toggleMute);
document.getElementById("fullscreenButton").addEventListener("click", toggleFullscreen);

// Start the one-and-only render loop for the whole page session. The
// arena is visible (idle) behind the start screen right from page load.
requestAnimationFrame(gameLoop);


// ---------------------------------------------------------------------
// 16. ACCOUNTS (login/signup/session/personal-best scores)
// ---------------------------------------------------------------------
// A thin fetch() client for server.py's /api/* endpoints. Nothing above
// this section knows accounts exist - it just calls submitScore() when a
// run ends; everything else about gating startScreen behind a login lives
// entirely here.

const authScreen = document.getElementById("authScreen");
const authForm = document.getElementById("authForm");
const authUsernameInput = document.getElementById("authUsername");
const authPasswordInput = document.getElementById("authPassword");
const authError = document.getElementById("authError");
const authSubmitButton = document.getElementById("authSubmit");
const authHeading = document.getElementById("authHeading");
const authToggleText = document.getElementById("authToggleText");
const authToggleButton = document.getElementById("authToggle");
const accountBadge = document.getElementById("accountBadge");
const accountUsername = document.getElementById("accountUsername");

let authMode = "login"; // "login" | "signup"
let currentUser = null; // { username, scores: { survival, range } }

function setAuthMode(mode) {
  authMode = mode;
  hideAuthError();
  if (mode === "signup") {
    authHeading.innerHTML = "ENLIST<br><span>NOW.</span>";
    authSubmitButton.querySelector("span:first-child").textContent = "CREATE ACCOUNT";
    authToggleText.textContent = "ALREADY ENLISTED?";
    authToggleButton.textContent = "SIGN IN INSTEAD";
    authPasswordInput.autocomplete = "new-password";
  } else {
    authHeading.innerHTML = "SIGN<br><span>IN.</span>";
    authSubmitButton.querySelector("span:first-child").textContent = "SIGN IN";
    authToggleText.textContent = "NEW HERE?";
    authToggleButton.textContent = "ENLIST INSTEAD";
    authPasswordInput.autocomplete = "current-password";
  }
}

function showAuthError(message) {
  authError.textContent = message;
  authError.classList.remove("hidden");
}
function hideAuthError() {
  authError.classList.add("hidden");
}

authToggleButton.addEventListener("click", () => {
  setAuthMode(authMode === "login" ? "signup" : "login");
});

authForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  hideAuthError();

  const username = authUsernameInput.value.trim();
  const password = authPasswordInput.value;
  const endpoint = authMode === "signup" ? "/api/signup" : "/api/login";

  authSubmitButton.disabled = true;
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const data = await response.json();

    if (!response.ok) {
      showAuthError(data.error || "Something went wrong. Try again.");
      return;
    }

    onLoggedIn(data);
  } catch (err) {
    showAuthError("Couldn't reach the server. Check your connection and try again.");
  } finally {
    authSubmitButton.disabled = false;
  }
});

function onLoggedIn(data) {
  currentUser = { username: data.username, scores: data.scores || {} };
  accountUsername.textContent = currentUser.username;
  accountBadge.classList.remove("hidden");
  authForm.reset();
  hideAuthError();
  hideScreen(authScreen);
  showScreen(startScreen);
  updatePersonalBestDisplay();
}

async function checkSession() {
  try {
    const response = await fetch("/api/me");
    const data = await response.json();
    if (data.username) {
      onLoggedIn(data);
    }
  } catch (err) {
    // No backend reachable (e.g. the file was opened directly instead of
    // through the Flask server) - just leave the login screen showing.
  }
}

document.getElementById("logoutButton").addEventListener("click", async () => {
  try {
    await fetch("/api/logout", { method: "POST" });
  } catch (err) {
    // Even if the request fails, still reset the local UI to logged-out.
  }
  currentUser = null;
  accountBadge.classList.add("hidden");
  hideScreen(startScreen);
  showScreen(authScreen);
  setAuthMode("login");
});

// Fire-and-forget: tells the server about a finished run's score. Never
// blocks the end-screen UI on this - if it fails (e.g. the session expired
// mid-run), the run's result still displays normally either way.
function submitScore(mode, value) {
  if (!currentUser) return;
  fetch("/api/score", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode, score: value }),
  })
    .then((response) => (response.ok ? response.json() : null))
    .then((data) => {
      if (data) {
        currentUser.scores[data.mode] = data.best_score;
        updatePersonalBestDisplay();
      }
    })
    .catch(() => {});
}

function updatePersonalBestDisplay() {
  const text = document.getElementById("personalBestText");
  if (!currentUser) {
    text.textContent = "—";
    return;
  }
  const best = currentUser.scores[selectedGameMode];
  text.textContent = best ? String(best).padStart(4, "0") + " PTS" : "NO RUNS YET";
}

checkSession();

// These read/update account state (updatePersonalBestDisplay reads
// currentUser), so they run last - after every `let`/`const` above them
// has actually been initialized, not just hoisted.
applyModeCopy(); // sync intro copy/deploy label/briefing section with the default selected mode
onWindowResize();
