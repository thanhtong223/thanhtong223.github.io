// Minimal multiplayer Asteroids
import { initNet, Net, send } from "./net.js";

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const WIDTH = canvas.width, HEIGHT = canvas.height;

const state = {
  me: { id: null },
  players: new Map(), // id -> player
  rocks: [],
  keys: {},
  lastShot: 0,
  snapshotTimer: 0,
  sendTimer: 0,
};

function wrap(v, max){ if(v<0)return v+max; if(v>max)return v-max; return v }
function rand(a,b){ return Math.random()*(b-a)+a }
function randomColor(){
  const hues=[0,45,90,140,200,260,300];
  const h=hues[Math.floor(Math.random()*hues.length)];
  return `hsl(${h} 90% 60%)`;
}

function addPlayer(id){
  if(state.players.has(id)) return;
  state.players.set(id, {
    id, x: rand(100, WIDTH-100), y: rand(100, HEIGHT-100),
    rot: rand(0, Math.PI*2), vx: 0, vy: 0,
    alive: true, score: 0, color: randomColor(),
    bullets: [],
  });
}

function spawnRocks(n=7){
  for(let i=0;i<n;i++){
    state.rocks.push({ x: rand(0,WIDTH), y: rand(0,HEIGHT), vx: rand(-40,40), vy: rand(-40,40), r: rand(18,38) });
  }
}

function drawShip(p){
  ctx.save(); ctx.translate(p.x,p.y); ctx.rotate(p.rot);
  ctx.strokeStyle = p.color; ctx.lineWidth=2;
  ctx.beginPath();
  ctx.moveTo(14,0); ctx.lineTo(-10,-8); ctx.lineTo(-6,0); ctx.lineTo(-10,8); ctx.closePath(); ctx.stroke();
  ctx.restore();
}
function drawBullet(b){ ctx.fillStyle="#fff"; ctx.beginPath(); ctx.arc(b.x,b.y,2,0,Math.PI*2); ctx.fill(); }
function drawRock(r){ ctx.strokeStyle="#aaa"; ctx.beginPath(); ctx.arc(r.x,r.y,r.r,0,Math.PI*2); ctx.stroke(); }

function draw(){
  ctx.clearRect(0,0,WIDTH,HEIGHT);
  for(const r of state.rocks) drawRock(r);
  for(const [,p] of state.players){ if(!p.alive) continue; drawShip(p); for(const b of p.bullets) drawBullet(b); }
  ctx.fillStyle="#9ecbff"; ctx.font="14px system-ui";
  let y=20; for(const [,p] of state.players){ ctx.fillText(`${p.id.slice(0,4)}: ${p.score}`,10,y); y+=18; }
}

function update(dt){
  const me = state.players.get(state.me.id);
  if(me){
    if(state.keys["ArrowLeft"]||state.keys["a"]) me.rot -= 3*dt;
    if(state.keys["ArrowRight"]||state.keys["d"]) me.rot += 3*dt;
    if(state.keys["ArrowUp"]||state.keys["w"]){ me.vx += Math.cos(me.rot)*160*dt; me.vy += Math.sin(me.rot)*160*dt; }
    me.vx *= 0.99; me.vy *= 0.99;
    me.x = wrap(me.x + me.vx*dt, WIDTH);
    me.y = wrap(me.y + me.vy*dt, HEIGHT);

    state.lastShot += dt;
    if((state.keys[" "]||state.keys["Space"]) && state.lastShot>0.2){
      state.lastShot=0;
      me.bullets.push({ x: me.x + Math.cos(me.rot)*14, y: me.y + Math.sin(me.rot)*14, vx: Math.cos(me.rot)*320, vy: Math.sin(me.rot)*320, t:0 });
    }
  }

  if(Net.isHost){
    for(const [,p] of state.players){
      p.bullets = p.bullets.filter(b => { b.x=wrap(b.x+b.vx*dt,WIDTH); b.y=wrap(b.y+b.vy*dt,HEIGHT); b.t+=dt; return b.t<2.5; });
    }
    for(const r of state.rocks){ r.x=wrap(r.x+r.vx*dt,WIDTH); r.y=wrap(r.y+r.vy*dt,HEIGHT); }
    for(const [,p] of state.players){
      for(const b of p.bullets){
        for(const r of state.rocks){
          const dx=b.x-r.x, dy=b.y-r.y;
          if(dx*dx+dy*dy < r.r*r.r){
            p.score += 10; b.t=999; r.r*=0.66;
            if(r.r<12){ r.x=rand(0,WIDTH); r.y=rand(0,HEIGHT); r.r=rand(18,38); r.vx=rand(-40,40); r.vy=rand(-40,40); }
          }
        }
      }
    }
    state.snapshotTimer += dt;
    if(state.snapshotTimer>1/12){
      state.snapshotTimer=0;
      const payload = {
        rocks: state.rocks,
        players: Array.from(state.players.values()).map(p => ({
          id:p.id,x:p.x,y:p.y,rot:p.rot,vx:p.vx,vy:p.vy,alive:p.alive,score:p.score,color:p.color,
          bullets:p.bullets.map(b=>({x:b.x,y:b.y,vx:b.vx,vy:b.vy,t:b.t}))
        }))
      };
      send("snapshot", payload);
    }
  } else {
    state.sendTimer += dt;
    if(state.sendTimer>1/15){
      state.sendTimer=0;
      if(me) send("input",{ id:me.id, x:me.x,y:me.y,rot:me.rot,vx:me.vx,vy:me.vy, shooting: state.keys[" "]||state.keys["Space"] });
    }
  }
}

function loop(ts){ if(!loop.last) loop.last=ts; const dt=Math.min(0.05,(ts-loop.last)/1000); loop.last=ts; update(dt); draw(); requestAnimationFrame(loop); }

function onMessage(msg){
  const {type, data} = msg;
  if(Net.isHost){
    if(type==="join"){
      addPlayer(data.id);
      send("snapshot",{ rocks: state.rocks, players: Array.from(state.players.values()).map(p=>({id:p.id,x:p.x,y:p.y,rot:p.rot,vx:p.vx,vy:p.vy,alive:p.alive,score:p.score,color:p.color, bullets:[]})) });
    }
    if(type==="input"){
      const p = state.players.get(data.id); if(p){ p.x=wrap(data.x,WIDTH); p.y=wrap(data.y,HEIGHT); p.rot=data.rot; p.vx=data.vx; p.vy=data.vy; }
    }
  } else {
    if(type==="snapshot"){
      state.rocks = data.rocks;
      state.players = new Map(data.players.map(p => [p.id,p]));
      if(!state.players.has(state.me.id)) addPlayer(state.me.id);
    }
  }
}

function onClientsChange(count){ document.getElementById("playerCount").textContent = String(count+1); }

function setupInput(){
  window.addEventListener("keydown", e => { state.keys[e.key]=true; if(e.code==="Space") state.keys[" "]=true; });
  window.addEventListener("keyup", e => { state.keys[e.key]=false; if(e.code==="Space") state.keys[" "]=false; });
}

async function start(){
  setupInput();
  await initNet(onMessage, onClientsChange);
  state.me.id = Net.myId;
  addPlayer(state.me.id);
  if(Net.isHost) spawnRocks(7);
  requestAnimationFrame(loop);
}

start();
