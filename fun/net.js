// PeerJS networking. No backend code.
// Host creates a room and runs the sim. Clients send inputs and render snapshots.

export const Net = {
  isHost: false,
  peer: null,
  conns: new Map(),   // host holds many, client holds one
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

export async function initNet(onMessage, onClientsChange) {
  Net.onMessage = onMessage;
  Net.onClientsChange = onClientsChange;

  const hash = location.hash.replace("#", "");
  if (!hash) { Net.isHost = true; Net.room = randomId("room"); location.hash = Net.room; }
  else { Net.isHost = false; Net.room = hash; }

  Net.peer = await setupPeer();
  Net.myId = Net.peer.id;

  if (Net.isHost) {
    Net.hostId = Net.peer.id;
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
    if (!maybeHost) {
      const manual = prompt("Enter Host Peer ID. Ask the host to read it on screen.");
      Net.hostId = manual;
    } else Net.hostId = maybeHost;

    const conn = Net.peer.connect(Net.hostId);
    conn.on("open", () => {
      Net.conns.set(Net.hostId, conn);
      notifyClientsCount();
      conn.on("data", msg => handleInbound(msg, Net.hostId));
      conn.send({ type: "join", data: { id: Net.myId } });
    });
  }

  document.getElementById("roomId").textContent = Net.isHost ? `${Net.room}@${Net.hostId}` : Net.room;
  document.getElementById("role").textContent = Net.isHost ? "Host" : "Client";
}

function handleInbound(msg, from) { if (Net.onMessage) Net.onMessage({ ...msg, from }); }
function notifyClientsCount() { const c = Net.conns.size; if (Net.onClientsChange) Net.onClientsChange(c); }

export function send(type, data) {
  if (Net.isHost) {
    for (const [, conn] of Net.conns) if (conn.open) conn.send({ type, data });
  } else {
    const conn = Net.conns.get(Net.hostId);
    if (conn && conn.open) conn.send({ type, data });
  }
}
