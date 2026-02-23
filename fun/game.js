// game.js — Multiplayer Asteroids (Supabase)
// Host authoritative-ish; clients send inputs.
// Mouse aim • WASD/Arrows • Auto-fire • 7s respawn • Starfield background.

import { Net, initNet, send } from "./net.js";

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const W = canvas.width, H = canvas.height;
const $scoreHud = document.getElementById("score"); // optional; not used globally

const now = () => performance.now() / 1000;

// ===== Tunables =====
const SHIP_R = 12;
const ROCK_MIN = 18, ROCK_MAX = 38, ROCK_SPEED = 40;
const BULLET_SPEED = 360;
const SHOT_PERIOD = 0.14;
const THRUST = 180, STRAFE = 0.6, BRAKE = 0.985, FRICTION = 0.99, RESPAWN_SECS = 7;

const SNAPSHOT_HZ = 10;     // host broadcast rate
const INPUT_HZ = 15;        // client input send rate

// ===== State =====
const state = {
  me: { id: null },
  players: new Map(),   // id -> player {id,x,y,rot,vx,vy,alive,respawnAt,score,color,bullets:[],lastShot, thrusting, strafe}
  rocks: [],
  keys: {},
  mouse: { x: W/2, y: H/2 },
  gameOver: false,

  snapshotTimer: 0,
  inputTimer: 0,

  // Starfield
  stars: [],
};

// ===== Helpers =====
const clamp = (v,min,max)=>v<min?min:(v>max?max:v);
const rand  = (a,b)=>Math.random()*(b-a)+a;

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
    thrusting: false, strafe: false,
  });
}
function spawnRock(){
  const side = Math.floor(Math.random() * 4);
  let x, y, angle;
  if (side === 0) { x = rand(-50, 0); y = rand(0, H); angle = rand(-Math.PI/4, Math.PI/4); }
  if (side === 1) { x = rand(W, W+50); y = rand(0, H); angle = Math.PI + rand(-Math.PI/4, Math.PI/4); }
  if (side === 2) { x = rand(0, W); y = rand(-50, 0); angle = rand(Math.PI/2 - 0.4, Math.PI/2 + 0.4); }
  if (side === 3) { x = rand(0, W); y = rand(H, H+50); angle = -Math.PI/2 + rand(-0.4, 0.4); }
  const speed = rand(ROCK_SPEED*0.6, ROCK_SPEED*1.3);
  return { x, y, vx: Math.cos(angle)*speed, vy: Math.sin(angle)*speed, r: rand(ROCK_MIN, ROCK_MAX) };
}
function spawnRocks(n=8){ state.rocks=[]; for(let i=0;i<n;i++) state.rocks.push(spawnRock()); }

// ===== Starfield =====
function initStars(){
  state.stars = Array.from({length:120}, () => ({
    x: Math.random()*W,
    y: Math.random()*H,
    r: Math.random()*1.3 + 0.2,
    s: Math.random()*0.5 + 0.2,
    tw: Math.random()*Math.PI*2
  }));
}
function drawStars(dt){
  ctx.save();
  ctx.fillStyle = "#05070a";
  ctx.fillRect(0,0,W,H);
  for (const st of state.stars) {
    st.x += st.s * 5 * dt;
    if (st.x > W) st.x = 0;
    st.tw += dt;
    const alpha = 0.2 + 0.15 * Math.sin(st.tw);
    ctx.beginPath();
    ctx.fillStyle = `rgba(255,255,255,${alpha})`;
    ctx.arc(st.x, st.y, st.r, 0, Math.PI*2);
    ctx.fill();
  }
  ctx.restore();
}

// ===== Drawing =====
function drawShip(p, alpha=1){
  ctx.save(); ctx.globalAlpha=alpha; ctx.translate(p.x,p.y); ctx.rotate(p.rot);
  ctx.strokeStyle=p.color; ctx.lineWidth=2;
  ctx.beginPath(); ctx.moveTo(14,0); ctx.lineTo(-10,-8); ctx.lineTo(-6,0); ctx.lineTo(-10,8); ctx.closePath(); ctx.stroke();

  if(p.thrusting){
    ctx.strokeStyle="orange";
    ctx.beginPath(); ctx.moveTo(-10,0); ctx.lineTo(-18+Math.random()*-4,0); ctx.stroke();
  }
  if(p.strafe){
    ctx.strokeStyle="deepskyblue";
    ctx.beginPath();
    ctx.moveTo(0,-8); ctx.lineTo(0,-12-Math.random()*2);
    ctx.moveTo(0, 8); ctx.lineTo(0, 12+Math.random()*2);
    ctx.stroke();
  }
  ctx.restore(); ctx.globalAlpha=1;
}
function drawBullet(b){ ctx.fillStyle="#fff"; ctx.beginPath(); ctx.arc(b.x,b.y,2,0,Math.PI*2); ctx.fill(); }
function drawRock(r){ ctx.strokeStyle="#aaa"; ctx.beginPath(); ctx.arc(r.x,r.y,r.r,0,Math.PI*2); ctx.stroke(); }
function drawOverlay(text, sub=""){
  ctx.fillStyle="rgba(0,0,0,0.5)"; ctx.fillRect(0,0,W,H);
  ctx.fillStyle="#e6edf3"; ctx.font="28px system-ui"; ctx.textAlign="center";
  ctx.fillText(text, W/2, H/2 - 10);
  if (sub) { ctx.font="16px system-ui"; ctx.fillText(sub, W/2, H/2 + 18); }
  ctx.textAlign="left";
}

// ===== Host simulation =====
function hostSim(dt){
  // Players' bullets
  for (const [,p] of state.players) {
    p.bullets = p.bullets.filter(b => {
      b.x += b.vx*dt; b.y += b.vy*dt; b.t += dt;
      return !(b.t>=2.5 || b.x<0 || b.x>W || b.y<0 || b.y>H);
    });
  }
  // Rocks move; respawn when far outside
  for (const r of state.rocks) {
    r.x += r.vx*dt; r.y += r.vy*dt;
    if (r.x<-80 || r.x>W+80 || r.y<-80 || r.y>H+80) {
      Object.assign(r, spawnRock());
    }
  }
  // Bullets vs rocks
  for (const [,p] of state.players) {
    if (!p.alive) continue;
    for (const b of p.bullets) {
      for (const r of state.rocks) {
        const dx=b.x-r.x, dy=b.y-r.y;
        if (dx*dx+dy*dy < r.r*r.r) {
          b.t=999; r.r *= 0.66; p.score += 10;
          if (r.r < 12) Object.assign(r, spawnRock());
        }
      }
    }
  }
  // Ships vs rocks; respawn
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
      const dx=p.x-r.x, dy=p.y-r.y, rr=r.r+SHIP_R;
      if (dx*dx+dy*dy < rr*rr) {
        p.alive = false;
        p.respawnAt = t + RESPAWN_SECS;
        p.bullets = [];
        break;
      }
    }
  }
  // Game over if no one alive (optional)
  const anyAlive = Array.from(state.players.values()).some(p => p.alive);
  state.gameOver = state.players.size>0 && !anyAlive;

  // Broadcast snapshot
  state.snapshotTimer += dt;
  if (state.snapshotTimer > 1 / SNAPSHOT_HZ) {
    state.snapshotTimer = 0;
    const payload = {
      gameOver: state.gameOver,
      rocks: state.rocks,
      players: Array.from(state.players.values()).map(p => ({
        id: p.id,
        x: p.x, y: p.y, rot: p.rot, vx: p.vx, vy: p.vy,
        alive: p.alive, respawnAt: p.respawnAt, score: p.score, color: p.color,
        bullets: p.bullets.map(b => ({x:b.x,y:b.y,vx:b.vx,vy:b.vy,t:b.t}))
      }))
    };
    send("snapshot", payload);
  }
}

// ===== Client input send =====
function clientSendInputs(dt){
  state.inputTimer += dt;
  if (state.inputTimer > 1 / INPUT_HZ) {
    state.inputTimer = 0;
    const me = state.players.get(state.me.id);
    if (me) {
      send("input", { id: me.id, x: me.x, y: me.y, rot: me.rot, vx: me.vx, vy: me.vy });
    }
  }
}

// ===== Local controls + physics (light prediction) =====
function applyInputAndPhysics(dt){
  const me = state.players.get(state.me.id);
  if (!me || !me.alive) return;

  me.rot = Math.atan2(state.mouse.y - me.y, state.mouse.x - me.x);
  const fwdX = Math.cos(me.rot), fwdY = Math.sin(me.rot);
  const rightX = Math.cos(me.rot + Math.PI/2), rightY = Math.sin(me.rot + Math.PI/2);
  me.thrusting = false; me.strafe = false;

  if (state.keys["w"] || state.keys["arrowup"])    { me.vx += fwdX * THRUST * dt; me.vy += fwdY * THRUST * dt; me.thrusting = true; }
  if (state.keys["s"] || state.keys["arrowdown"])  { me.vx *= BRAKE; me.vy *= BRAKE; }
  if (state.keys["a"] || state.keys["arrowleft"])  { me.vx += rightX * -THRUST * STRAFE * dt; me.vy += rightY * -THRUST * STRAFE * dt; me.strafe = true; }
  if (state.keys["d"] || state.keys["arrowright"]) { me.vx += rightX *  THRUST * STRAFE * dt; me.vy += rightY *  THRUST * STRAFE * dt; me.strafe = true; }

  me.vx *= FRICTION; me.vy *= FRICTION;

  let nx = me.x + me.vx*dt, ny = me.y + me.vy*dt;
  if (nx < SHIP_R) { nx = SHIP_R; me.vx = 0; }
  if (nx > W - SHIP_R) { nx = W - SHIP_R; me.vx = 0; }
  if (ny < SHIP_R) { ny = SHIP_R; me.vy = 0; }
  if (ny > H - SHIP_R) { ny = H - SHIP_R; me.vy = 0; }

  me.x = nx; me.y = ny;

  // Autofire (host will handle bullet collisions; we keep bullets locally for feel)
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

// ===== Message handlers =====
function onMessage(msg){
  const { type, data } = msg;

  if (Net.isHost) {
    if (type === "join") {
      addPlayer(data.id);
      // send immediate snapshot
      const payload = {
        gameOver: state.gameOver,
        rocks: state.rocks,
        players: Array.from(state.players.values()).map(p => ({
          id:p.id, x:p.x,y:p.y,rot:p.rot,vx:p.vx,vy:p.vy,
          alive:p.alive, respawnAt:p.respawnAt, score:p.score, color:p.color, bullets:[]
        }))
      };
      send("snapshot", payload);
    }
    if (type === "input") {
      const p = state.players.get(data.id);
      if (p) { p.x = clamp(data.x, SHIP_R, W-SHIP_R); p.y = clamp(data.y, SHIP_R, H-SHIP_R); p.rot = data.rot; p.vx = data.vx; p.vy = data.vy; }
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

// ===== Draw frame =====
function drawFrame(dt){
  drawStars(dt);
  // Rocks first
  for (const r of state.rocks) drawRock(r);
  // Ships + bullets
  for (const [,p] of state.players) {
    if (p.alive) {
      drawShip(p, 1);
      for (const b of p.bullets) drawBullet(b);
    } else {
      const tLeft = Math.max(0, Math.ceil(p.respawnAt - now()));
      drawShip(p, 0.25);
      ctx.fillStyle = "#9ecbff"; ctx.font = "12px system-ui";
      ctx.fillText(`respawn ${tLeft}s`, p.x + 14, p.y - 14);
    }
  }
  // Scores (top-left of canvas)
  ctx.fillStyle = "#9ecbff"; ctx.font = "14px system-ui";
  let y = 20;
  for (const [,p] of state.players) { ctx.fillText(`${p.id.slice(0,4)}: ${p.score}`, 10, y); y += 18; }

  if (state.gameOver) {
    drawOverlay("GAME OVER", Net.isHost ? "Press R to restart" : "Wait for host to restart");
  }
}

// ===== Loop =====
function loop(ts){
  if (!loop.last) loop.last = ts;
  const dt = Math.min(0.05, (ts - loop.last)/1000);
  loop.last = ts;

  if (!state.gameOver) {
    if (Net.isHost) {
      // host: simulate everyone + rocks
      // also move bullets for all players (host is authoritative)
      // locally we also let each player's bullets exist visually
      // (host already updates them in hostSim)
      for (const [,p] of state.players) {
        // keep bullets visually moving even on host
        p.bullets = p.bullets.filter(b=>{
          b.x += b.vx*dt; b.y += b.vy*dt; b.t += dt;
          return !(b.t>=2.5 || b.x<0 || b.x>W || b.y<0 || b.y>H);
        });
      }
      hostSim(dt);
    } else {
      // client: local feel + send inputs
      applyInputAndPhysics(dt);
      // move my local bullets
      const me = state.players.get(state.me.id);
      if (me) {
        me.bullets = me.bullets.filter(b=>{
          b.x += b.vx*dt; b.y += b.vy*dt; b.t += dt;
          return !(b.t>=2.5 || b.x<0 || b.x>W || b.y<0 || b.y>H);
        });
      }
      clientSendInputs(dt);
    }
  }

  ctx.clearRect(0,0,W,H);
  drawFrame(dt);
  requestAnimationFrame(loop);
}

// ===== Inputs =====
function setupInput(){
  addEventListener("keydown", e => {
    const k = e.key.toLowerCase();
    state.keys[k] = true;

    // Host can restart on R
    if (Net.isHost && state.gameOver && k === "r") {
      state.gameOver = false;
      spawnRocks(8);
      for (const [,p] of state.players) {
        p.alive = true; p.respawnAt = 0;
        p.x = rand(100, W-100); p.y = rand(100, H-100);
        p.vx = p.vy = 0; p.bullets = []; p.lastShot = 0;
      }
    }
  });
  addEventListener("keyup", e => { state.keys[e.key.toLowerCase()] = false; });
  canvas.addEventListener("mousemove", e => {
    const rect = canvas.getBoundingClientRect();
    state.mouse.x = clamp(e.clientX - rect.left, 0, W);
    state.mouse.y = clamp(e.clientY - rect.top, 0, H);
  });
}

// ===== Start =====
async function start(){
  initStars();
  setupInput();
  await initNet(onMessage, onClientsChange);
  state.me.id = Net.myId;
  addPlayer(state.me.id);
  if (Net.isHost) spawnRocks(8);
  requestAnimationFrame(loop);
}
start();
