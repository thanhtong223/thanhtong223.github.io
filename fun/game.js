// Multiplayer Asteroids with mouse aim, WASD/Arrows move, auto-fire,
// 7s respawn on crash, game ends if all players die at the same time.
// Host authoritative-ish (host simulates rocks/bullets/respawn, clients send inputs).

import { initNet, Net, send } from "./net.js";

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const W = canvas.width, H = canvas.height;
const now = () => performance.now() / 1000;

const state = {
  me: { id: null },
  players: new Map(),    // id -> {id,x,y,rot,vx,vy,alive,respawnAt,score,color,bullets:[], lastShot}
  rocks: [],
  keys: {},
  mouse: { x: W/2, y: H/2 },
  snapshotTimer: 0,
  sendTimer: 0,
  gameOver: false,
};

const SHIP_R = 12;
const ROCK_MIN = 18, ROCK_MAX = 38;
const BULLET_SPEED = 340;
const SHOT_PERIOD = 0.14;       // continuous fire rate
const THRUST = 180;             // forward thrust
const FRICTION = 0.99;

// ---------- Helpers ----------
function wrap(v, max){ return v < 0 ? v + max : v > max ? v - max : v; }
function rand(a,b){ return Math.random() * (b - a) + a; }
function randomColor(){
  const hues=[0,45,90,140,200,260,300];
  return `hsl(${hues[Math.floor(Math.random()*hues.length)]} 90% 60%)`;
}
function addPlayer(id){
  if (state.players.has(id)) return;
  state.players.set(id, {
    id,
    x: rand(100, W-100), y: rand(100, H-100),
    rot: 0, vx: 0, vy: 0,
    alive: true, respawnAt: 0,
    score: 0, color: randomColor(),
    bullets: [],
    lastShot: 0,
  });
}
function spawnRocks(n=7){
  for (let i=0;i<n;i++){
    state.rocks.push({ x: rand(0,W), y: rand(0,H), vx: rand(-40,40), vy: rand(-40,40), r: rand(ROCK_MIN, ROCK_MAX) });
  }
}

// ---------- Drawing ----------
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

// ---------- Update ----------
function applyInputAndPhysics(dt){
  const me = state.players.get(state.me.id);
  if (me && me.alive) {
    // Mouse aim
    const ang = Math.atan2(state.mouse.y - me.y, state.mouse.x - me.x);
    me.rot = ang;

    // WASD / Arrow movement: W/Up forward, S/Down brake, A/D or Left/Right strafe
    const fwdX = Math.cos(me.rot), fwdY = Math.sin(me.rot);
    const rightX = Math.cos(me.rot + Math.PI/2), rightY = Math.sin(me.rot + Math.PI/2);

    if (state.keys["w"] || state.keys["arrowup"]) {
      me.vx += fwdX * THRUST * dt;
      me.vy += fwdY * THRUST * dt;
    }
    if (state.keys["s"] || state.keys["arrowdown"]) {
      me.vx *= 0.985; me.vy *= 0.985; // brake
    }
    if (state.keys["a"] || state.keys["arrowleft"]) {
      me.vx += rightX * -THRUST * 0.6 * dt;
      me.vy += rightY * -THRUST * 0.6 * dt;
    }
    if (state.keys["d"] || state.keys["arrowright"]) {
      me.vx += rightX * THRUST * 0.6 * dt;
      me.vy += rightY * THRUST * 0.6 * dt;
    }

    me.vx *= FRICTION; me.vy *= FRICTION;
    me.x = wrap(me.x + me.vx * dt, W);
    me.y = wrap(me.y + me.vy * dt, H);

    // Autofire
    me.lastShot += dt;
    if (me.lastShot > SHOT_PERIOD) {
      me.lastShot = 0;
      me.bullets.push({
        x: me.x + Math.cos(me.rot)*14,
        y: me.y + Math.sin(me.rot)*14,
        vx: Math.cos(me.rot)*BULLET_SPEED,
        vy: Math.sin(me.rot)*BULLET_SPEED,
        t: 0
      });
    }
  }
}

function hostSim(dt){
  // Bullets
  for (const [,p] of state.players) {
    p.bullets = p.bullets.filter(b => {
      b.x = wrap(b.x + b.vx * dt, W);
      b.y = wrap(b.y + b.vy * dt, H);
      b.t += dt;
      return b.t < 2.5;
    });
  }
  // Rocks
  for (const r of state.rocks) {
    r.x = wrap(r.x + r.vx * dt, W);
    r.y = wrap(r.y + r.vy * dt, H);
  }
  // Bullets vs rocks
  for (const [,p] of state.players) {
    if (!p.alive) continue;
    for (const b of p.bullets) {
      for (const r of state.rocks) {
        const dx=b.x-r.x, dy=b.y-r.y;
        if (dx*dx + dy*dy < r.r*r.r) {
          p.score += 10; b.t = 999; r.r *= 0.66;
          if (r.r < 12) {
            r.x = rand(0,W); r.y = rand(0,H);
            r.r = rand(ROCK_MIN, ROCK_MAX);
            r.vx = rand(-40,40); r.vy = rand(-40,40);
          }
        }
      }
    }
  }
  // Ships vs rocks -> 7s respawn
  const t = now();
  for (const [,p] of state.players) {
    if (!p.alive) {
      if (t >= p.respawnAt && !state.gameOver) {
        p.alive = true;
        p.x = rand(100, W-100); p.y = rand(100, H-100);
        p.vx = p.vy = 0; p.bullets = [];
      }
      continue;
    }
    for (const r of state.rocks) {
      const dx = p.x - r.x, dy = p.y - r.y;
      if (dx*dx + dy*dy < (r.r + SHIP_R)*(r.r + SHIP_R)) {
        p.alive = false;
        p.respawnAt = t + 7;
        p.bullets = [];
        break;
      }
    }
  }

  // Game over if nobody alive right now
  const anyAlive = Array.from(state.players.values()).some(p => p.alive);
  if (!anyAlive && state.players.size > 0) {
    state.gameOver = true;
  }

  // Broadcast snapshot ~12 Hz
  state.snapshotTimer += dt;
  if (state.snapshotTimer > 1/12) {
    state.snapshotTimer = 0;
    const payload = {
      gameOver: state.gameOver,
      rocks: state.rocks,
      players: Array.from(state.players.values()).map(p => ({
        id:p.id,x:p.x,y:p.y,rot:p.rot,vx:p.vx,vy:p.vy,
        alive:p.alive, respawnAt:p.respawnAt, score:p.score, color:p.color,
        bullets:p.bullets.map(b=>({x:b.x,y:b.y,vx:b.vx,vy:b.vy,t:b.t}))
      }))
    };
    send("snapshot", payload);
  }
}

function clientSendInputs(dt){
  state.sendTimer += dt;
  if (state.sendTimer > 1/15) {
    state.sendTimer = 0;
    const me = state.players.get(state.me.id);
    if (me) {
      send("input", { id: me.id, x: me.x, y: me.y, rot: me.rot, vx: me.vx, vy: me.vy });
    }
  }
}

// ---------- Main loop ----------
function loop(ts){
  if (!loop.last) loop.last = ts;
  const dt = Math.min(0.05, (ts - loop.last)/1000);
  loop.last = ts;

  if (!state.gameOver) {
    applyInputAndPhysics(dt);
    if (Net.isHost) hostSim(dt);
    else clientSendInputs(dt);
  }

  // Draw
  ctx.clearRect(0,0,W,H);
  for (const r of state.rocks) drawRock(r);
  for (const [,p] of state.players) {
    if (p.alive) {
      drawShip(p, 1);
      for (const b of p.bullets) drawBullet(b);
    } else {
      // ghost + countdown
      const tLeft = Math.max(0, Math.ceil(p.respawnAt - now()));
      drawShip(p, 0.25);
      ctx.fillStyle = "#9ecbff";
      ctx.font = "12px system-ui";
      ctx.fillText(`respawn ${tLeft}s`, p.x + 14, p.y - 14);
    }
  }
  // Scores
  ctx.fillStyle = "#9ecbff";
  ctx.font = "14px system-ui";
  let y = 20;
  for (const [,p] of state.players) { ctx.fillText(`${p.id.slice(0,4)}: ${p.score}`, 10, y); y += 18; }

  if (state.gameOver) {
    drawOverlay("GAME OVER", Net.isHost ? "Press R to restart" : "Wait for host to restart");
  }

  requestAnimationFrame(loop);
}

// ---------- Networking ----------
function onMessage(msg){
  const { type, data } = msg;
  if (Net.isHost) {
    if (type === "join") {
      addPlayer(data.id);
      // Send immediate snapshot
      send("snapshot", {
        gameOver: state.gameOver,
        rocks: state.rocks,
        players: Array.from(state.players.values()).map(p => ({
          id:p.id,x:p.x,y:p.y,rot:p.rot,vx:p.vx,vy:p.vy,
          alive:p.alive, respawnAt:p.respawnAt, score:p.score, color:p.color, bullets:[]
        }))
      });
    }
    if (type === "input") {
      const p = state.players.get(data.id);
      if (p) { p.x = wrap(data.x,W); p.y = wrap(data.y,H); p.rot = data.rot; p.vx = data.vx; p.vy = data.vy; }
    }
  } else {
    if (type === "snapshot") {
      state.gameOver = !!data.gameOver;
      state.rocks = data.rocks;
      state.players = new Map(data.players.map(p => [p.id, p]));
      if (!state.players.has(state.me.id)) addPlayer(state.me.id);
    }
  }
}

function onClientsChange(_) { /* HUD handled in net.js */ }

// ---------- Inputs ----------
function setupInput(){
  addEventListener("keydown", e => {
    const k = e.key.toLowerCase();
    state.keys[k] = true;
    if (Net.isHost && state.gameOver && (k === "r")) {
      // host restart
      state.gameOver = false;
      state.rocks = [];
      spawnRocks(7);
      for (const [,p] of state.players) {
        p.alive = true; p.respawnAt = 0;
        p.x = rand(100,W-100); p.y = rand(100,H-100);
        p.vx = p.vy = 0; p.bullets = [];
      }
    }
  });
  addEventListener("keyup", e => {
    const k = e.key.toLowerCase();
    state.keys[k] = false;
  });
  // mouse aim
  canvas.addEventListener("mousemove", e => {
    const rect = canvas.getBoundingClientRect();
    state.mouse.x = e.clientX - rect.left;
    state.mouse.y = e.clientY - rect.top;
  });
}

// ---------- Start ----------
async function start(){
  setupInput();
  await initNet(onMessage, onClientsChange);
  state.me.id = Net.myId;
  addPlayer(state.me.id);
  if (Net.isHost) spawnRocks(7);
  requestAnimationFrame(loop);
}
start();
