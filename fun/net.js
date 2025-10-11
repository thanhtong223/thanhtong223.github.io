// PeerJS networking with visible Host ID and copyable invite link.
// Host creates a room and runs the sim. Clients send inputs and render snapshots.

export const Net = {
  isHost: false,
  peer: null,
  conns: new Map(),
  hostId: null,
  myId: null,
  room: null,
  onMessage: null,
  onClientsChange: null,
};

function randomId(prefix="room") {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  for (let i=0;i<8;i++) s += chars[Math.floor(Math.random()*chars.length)];
  return `${prefix}-${s}`;
}

function setupPeer() {
  return new Promise(resolve => {
    const p = new Peer(undefined, { host: "0.peerjs.com", port: 443, path: "/", secure: true });
    p.on("open", () => resolve(p));
  });
}

function updateHud() {
  const roomEl = document.getElementById("roomId");
  const roleEl = document.getElementById("role");
  const hostOnly = document.getElementById("hostOnly");
  const hostIdEl = document.getElementById("hostId");
  const inviteEl = document.getElementById("inviteLink");

  if (!roomEl || !roleEl) return;

  roleEl.textContent = Net.isHost ? "Host" : "Client";

  if (Net.isHost) {
    const fullRoom = Net.hostId ? `${Net.room}@${Net.hostId}` : Net.room;
    roomEl.textContent = fullRoom;
    if (hostOnly) hostOnly.style.display = "block";
    if (hostIdEl) hostIdEl.textContent = Net.hostId || "(waiting…)";

    if (inviteEl) {
      const base = `${location.origin}${location.pathname}`;
      const hash = Net.hostId ? `#${Net.room}@${Net.hostId}` : `#${Net.room}`;
      inviteEl.value = `${base}${hash}`;
    }
  } else {
    roomEl.textContent = Net.room;
    if (hostOnly) hostOnly.style.display = "none";
  }
}

function handleInbound(msg, from) {
  if (Net.onMessage) Net.onMessage({ ...msg, from });
}

function notifyClientsCount() {
  const c = Net.conns.size;
  const el = document.getElementById("playerCount");
  if (el) el.textContent = String(c + 1); // + host
  if (Net.onClientsChange) Net.onClientsChange(c);
}

export async function initNet(onMessage, onClientsChange) {
  Net.onMessage = onMessage;
  Net.onClientsChange = onClientsChange;

  const hash = location.hash.replace("#", "");
  if (!hash) {
    Net.isHost = true;
    Net.room = randomId("room");
    location.hash = Net.room;
  } else {
    Net.isHost = false;
    Net.room = hash;
  }

  Net.peer = await setupPeer();
  Net.myId = Net.peer.id;

  if (Net.isHost) {
    Net.hostId = Net.peer.id;
    updateHud();

    Net.peer.on("connection", conn => {
      Net.conns.set(conn.peer, conn);
      conn.on("data", msg => handleInbound(msg, conn.peer));
      conn.on("close", () => { Net.conns.delete(conn.peer); notifyClientsCount(); });
      notifyClientsCount();
      conn.send({ type: "hello", data: { hostId: Net.hostId, room: Net.room } });
    });
  } else {
    const [roomOnly, maybeHost] = Net.room.split("@");
    Net.room = roomOnly;
    Net.hostId = maybeHost || prompt("Enter Host Peer ID shown on host screen");
    updateHud();

    const conn = Net.peer.connect(Net.hostId);
    conn.on("open", () => {
      Net.conns.set(Net.hostId, conn);
      notifyClientsCount();
      conn.on("data", msg => handleInbound(msg, Net.hostId));
      conn.send({ type: "join", data: { id: Net.myId } });
    });
  }

  updateHud();
}

export function send(type, data) {
  if (Net.isHost) {
    for (const [, conn] of Net.conns) if (conn.open) conn.send({ type, data });
  } else {
    const conn = Net.conns.get(Net.hostId);
    if (conn && conn.open) conn.send({ type, data });
  }
}
