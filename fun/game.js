// Single-player Asteroids
// Mouse aim • WASD/Arrows move • Auto-fire • 7s respawn on crash
// Press R to restart

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const W = canvas.width, H = canvas.height; 
const $score = document.getElementById("score");
const now = () => performance.now() / 1000;

// ---- Tunables ----
const SHIP_R = 12;
const ROCK_MIN = 18, ROCK_MAX = 38;
const ROCK_SPEED = 40;       // base asteroid speed
const BULLET_SPEED = 360;
const SHOT_PERIOD = 0.14;    // autofire rate (sec)
const THRUST = 180;
const STRAFE = 0.6;          // strafe % of thrust
const BRAKE = 0.985;
const FRICTION = 0.99;
const RESPAWN_SECS = 7;

// ---- State ----
const state = {
  score: 0,
  player: {
    x: W/2, y: H/2, rot: 0, vx: 0, vy: 0,
    alive: true, respawnAt: 0, color: "#9ecbff",
    bullets: [], lastShot: 0
  },
  rocks: [],
  keys: {},
  mouse: { x: W/2, y: H/2 },
  gameOver: false,
};

function wrap(v, max){ return v < 0 ? v + max : v > max ? v - max : v; }
function rand(a,b){ return Math.random() * (b - a) + a; }

function spawnRocks(n=8){
  state.rocks = [];
  for (let i=0;i<n;i++){
    state.rocks.push({
      x: rand(0,W), y: rand(0,H),
      vx: rand(-ROCK_SPEED, ROCK_SPEED),
      vy: rand(-ROCK_SPEED, ROCK_SPEED),
      r: rand(ROCK_MIN, ROCK_MAX),
    });
  }
}

function resetGame() {
  state.score = 0;
  $score.textContent = "0";
  state.player.x = W/2; state.player.y = H/2;
  state.player.vx = state.player.vy = 0;
  state.player.alive = true;
  state.player.respawnAt = 0;
  state.player.bullets = [];
  state.player.lastShot = 0;
  state.gameOver = false;
  spawnRocks(8);
}

// ---- Drawing ----
function drawShip(p, alpha=1){
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(p.x, p.y);
  ctx.rotate(p.rot);
  ctx.strokeStyle = p.color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(14,0); ctx.lineTo(-10,-8); ctx.lineTo(-6,0); ctx.lineTo(-10,8); ctx.closePath(); ctx.stroke();
  ctx.restore();
  ctx.globalAlpha = 1;
}
function drawBullet(b){
  ctx.fillStyle = "#fff";
  ctx.beginPath(); ctx.arc(b.x,b.y,2,0,Math.PI*2); ctx.fill();
}
function drawRock(r){
  ctx.strokeStyle = "#aaa";
  ctx.beginPath(); ctx.arc(r.x,r.y,r.r,0,Math.PI*2); ctx.stroke();
}
function drawOverlay(text, sub=""){
  ctx.fillStyle = "rgba(0,0,0,0.5)";
  ctx.fillRect(0,0,W,H);
  ctx.fillStyle = "#e6edf3";
  ctx.font = "28px system-ui";
  ctx.textAlign = "center";
  ctx.fillText(text, W/2, H/2 - 10);
  if (sub) { ctx.font = "16px system-ui"; ctx.fillText(sub, W/2, H/2 + 18); }
  ctx.textAlign = "left";
}

// ---- Update ----
function updatePlayer(dt){
  const p = state.player;
  if (!p.alive) return;

  // Mouse aim
  p.rot = Math.atan2(state.mouse.y - p.y, state.mouse.x - p.x);

  // WASD/Arrows: forward thrust, brake, strafe
  const fwdX = Math.cos(p.rot), fwdY = Math.sin(p.rot);
  const rightX = Math.cos(p.rot + Math.PI/2), rightY = Math.sin(p.rot + Math.PI/2);

  if (state.keys["w"] || state.keys["arrowup"]) {
    p.vx += fwdX * THRUST * dt;
    p.vy += fwdY * THRUST * dt;
  }
  if (state.keys["s"] || state.keys["arrowdown"]) {
    p.vx *= BRAKE; p.vy *= BRAKE;
  }
  if (state.keys["a"] || state.keys["arrowleft"]) {
    p.vx += rightX * -THRUST * STRAFE * dt;
    p.vy += rightY * -THRUST * STRAFE * dt;
  }
  if (state.keys["d"] || state.keys["arrowright"]) {
    p.vx += rightX * THRUST * STRAFE * dt;
    p.vy += rightY * THRUST * STRAFE * dt;
  }

  p.vx *= FRICTION; p.vy *= FRICTION;
  p.x = wrap(p.x + p.vx * dt, W);
  p.y = wrap(p.y + p.vy * dt, H);

  // Auto-fire
  p.lastShot += dt;
  if (p.lastShot > SHOT_PERIOD) {
    p.lastShot = 0;
    p.bullets.push({
      x: p.x + Math.cos(p.rot)*14,
      y: p.y + Math.sin(p.rot)*14,
      vx: Math.cos(p.rot)*BULLET_SPEED,
      vy: Math.sin(p.rot)*BULLET_SPEED,
      t: 0
    });
  }
}

function updateBullets(dt){
  const p = state.player;
  p.bullets = p.bullets.filter(b => {
    b.x = wrap(b.x + b.vx * dt, W);
    b.y = wrap(b.y + b.vy * dt, H);
    b.t += dt;
    return b.t < 2.5;
  });
}

function updateRocks(dt){
  for (const r of state.rocks) {
    r.x = wrap(r.x + r.vx * dt, W);
    r.y = wrap(r.y + r.vy * dt, H);
  }
}

function collisions(){
  const p = state.player;
  if (p.alive) {
    // Bullets vs rocks
    for (const b of p.bullets) {
      for (const r of state.rocks) {
        const dx = b.x - r.x, dy = b.y - r.y;
        if (dx*dx + dy*dy < r.r*r.r) {
          b.t = 999;
          r.r *= 0.66;
          state.score += 10;
          $score.textContent = String(state.score);
          if (r.r < 12) {
            // respawn a new rock elsewhere
            r.x = rand(0,W); r.y = rand(0,H);
            r.r = rand(ROCK_MIN, ROCK_MAX);
            r.vx = rand(-ROCK_SPEED, ROCK_SPEED);
            r.vy = rand(-ROCK_SPEED, ROCK_SPEED);
          }
        }
      }
    }

    // Ship vs rocks
    for (const r of state.rocks) {
      const dx = p.x - r.x, dy = p.y - r.y;
      const rr = r.r + SHIP_R;
      if (dx*dx + dy*dy < rr*rr) {
        // "die" and start respawn timer
        p.alive = false;
        p.respawnAt = now() + RESPAWN_SECS;
        p.bullets = [];
        break;
      }
    }
  } else {
    // Handle respawn
    if (now() >= p.respawnAt && !state.gameOver) {
      p.alive = true;
      p.x = rand(100, W-100); p.y = rand(100, H-100);
      p.vx = p.vy = 0;
      p.bullets = [];
    }
  }
}

function loop(ts){
  if (!loop.last) loop.last = ts;
  const dt = Math.min(0.05, (ts - loop.last) / 1000);
  loop.last = ts;

  if (!state.gameOver) {
    updatePlayer(dt);
    updateBullets(dt);
    updateRocks(dt);
    collisions();
  }

  // Draw
  ctx.clearRect(0,0,W,H);
  for (const r of state.rocks) drawRock(r);

  const p = state.player;
  if (p.alive) {
    drawShip(p, 1);
    for (const b of p.bullets) drawBullet(b);
  } else {
    const secLeft = Math.max(0, Math.ceil(p.respawnAt - now()));
    drawShip(p, 0.25);
    ctx.fillStyle = "#9ecbff"; ctx.font = "12px system-ui";
    ctx.fillText(`respawn ${secLeft}s`, p.x + 14, p.y - 14);
  }

  requestAnimationFrame(loop);
}

// ---- Input ----
function setupInput(){
  addEventListener("keydown", e => {
    const k = e.key.toLowerCase();
    state.keys[k] = true;
    if (k === "r") resetGame();
  });
  addEventListener("keyup", e => {
    const k = e.key.toLowerCase();
    state.keys[k] = false;
  });
  canvas.addEventListener("mousemove", e => {
    const rect = canvas.getBoundingClientRect();
    state.mouse.x = e.clientX - rect.left;
    state.mouse.y = e.clientY - rect.top;
  });
}

// ---- Start ----
function start(){
  setupInput();
  resetGame();
  requestAnimationFrame(loop);
}
start();
