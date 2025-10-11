// net.js — Supabase Realtime networking for Thanh's game
// API used by game.js: initNet(onMessage, onClientsChange) + send(type, data)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = "https://uuxodsedpdjhokissevt.supabase.co";   // TODO: paste your Project URL
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV1eG9kc2VkcGRqaG9raXNzZXZ0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjAwODUzNzIsImV4cCI6MjA3NTY2MTM3Mn0.9OUC81YCfxFj9Hk6GYEqlsETPUW4tK35h4Qse5dcF4o";                 // TODO: paste your anon public key
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export const Net = {
  isHost: false,
  myId: null,
  room: null,
  hostId: null,
  channel: null,
  onMessage: null,
  onClientsChange: null,
};

function randomRoom(prefix = "room") {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  for (let i = 0; i < 8; i++) s += chars[(Math.random() * chars.length) | 0];
  return `${prefix}-${s}`;
}

function updateHud() {
  const roomEl = document.getElementById("roomId");
  const roleEl = document.getElementById("role");
  const hostOnly = document.getElementById("hostOnly");
  const hostIdEl = document.getElementById("hostId");
  const inviteEl = document.getElementById("inviteLink");

  if (roleEl) roleEl.textContent = Net.isHost ? "Host" : "Client";
  if (roomEl) roomEl.textContent = Net.hostId ? `${Net.room}@${Net.hostId}` : Net.room;
  if (hostOnly) hostOnly.style.display = Net.isHost ? "block" : "none";
  if (hostIdEl) hostIdEl.textContent = Net.hostId || "(waiting…)";

  if (inviteEl) {
    const base = `${location.origin}${location.pathname}`;
    const hash = Net.hostId ? `#${Net.room}@${Net.hostId}` : `#${Net.room}`;
    inviteEl.value = `${base}${hash}`;
  }
}

function notifyPlayerCount() {
  try {
    const st = Net.channel?.presenceState?.() || {};
    const count = Object.keys(st).length || 1;
    const el = document.getElementById("playerCount");
    if (el) el.textContent = String(count);
    if (Net.onClientsChange) Net.onClientsChange(Math.max(0, count - 1));
  } catch {}
}

export async function initNet(onMessage, onClientsChange) {
  Net.onMessage = onMessage;
  Net.onClientsChange = onClientsChange;

  // Host if no hash yet; otherwise client.
  let hash = location.hash.replace("#", "");
  if (!hash) {
    Net.isHost = true;
    Net.room = randomRoom("room");
    location.hash = Net.room;
  } else {
    Net.isHost = !hash.includes("@"); // if link already has @hostId, assume joining
    Net.room = hash.split("@")[0];
  }

  Net.myId = crypto.randomUUID();
  if (Net.isHost) Net.hostId = Net.myId;
  else Net.hostId = (hash.split("@")[1]) || null;

  // Create/join channel with presence keyed by myId
  Net.channel = sb.channel(Net.room, { config: { presence: { key: Net.myId } } });

  Net.channel.on("presence", { event: "sync" }, () => {
    // If client & we didn't know host, pick presence marked host:true
    if (!Net.isHost && !Net.hostId) {
      const st = Net.channel.presenceState?.() || {};
      const hostKey = Object.keys(st).find(k => st[k]?.some(meta => meta?.host));
      if (hostKey) Net.hostId = hostKey;
    }
    notifyPlayerCount();
    updateHud();
  });

  // Broadcast handlers
  Net.channel.on("broadcast", { event: "snapshot" }, ({ payload }) => {
    Net.onMessage?.({ type: "snapshot", data: payload, from: Net.hostId });
  });
  Net.channel.on("broadcast", { event: "input" }, ({ payload }) => {
    Net.onMessage?.({ type: "input", data: payload, from: payload?.id });
  });
  Net.channel.on("broadcast", { event: "join" }, ({ payload }) => {
    Net.onMessage?.({ type: "join", data: payload, from: payload?.id });
  });

  // Subscribe & announce presence
  await Net.channel.subscribe(async (status) => {
    if (status === "SUBSCRIBED") {
      await Net.channel.track({ joinedAt: Date.now(), host: Net.isHost });
      // tell host we joined
      Net.channel.send({ type: "broadcast", event: "join", payload: { id: Net.myId } });
      updateHud();
    }
  });

  updateHud();
  notifyPlayerCount();
}

export function send(type, data) {
  Net.channel?.send({ type: "broadcast", event: type, payload: data });
}
