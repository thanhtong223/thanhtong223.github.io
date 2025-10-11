import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./supabase-config.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const roomInput = document.getElementById("room");
const joinBtn = document.getElementById("join");
const statusEl = document.getElementById("status");
const log = document.getElementById("log");
const form = document.getElementById("sendForm");
const authorEl = document.getElementById("author");
const contentEl = document.getElementById("content");

let currentRoom = null;
let channel = null;

function line(msg, meta) {
  const div = document.createElement("div");
  div.className = "msg";
  div.innerHTML = `<div>${msg}</div>${meta ? `<div class="meta">${meta}</div>` : ""}`;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
}

async function loadHistory(room) {
  const { data, error } = await supabase
    .from("messages")
    .select("author, content, created_at")
    .eq("room_id", room)
    .order("created_at", { ascending: true })
    .limit(200);

  if (error) {
    line("Failed to load history", error.message);
    return;
  }
  log.innerHTML = "";
  data.forEach((m) => line(`${m.author}: ${m.content}`, new Date(m.created_at).toLocaleTimeString()));
}

async function ensureRoom(room) {
  await supabase.from("rooms").upsert({ id: room });
}

async function subscribe(room) {
  if (channel) {
    await supabase.removeChannel(channel);
    channel = null;
  }

  channel = supabase.channel(`room-${room}`);

  channel.on(
    "postgres_changes",
    { event: "INSERT", schema: "public", table: "messages", filter: `room_id=eq.${room}` },
    (payload) => {
      const m = payload.new;
      line(`${m.author}: ${m.content}`, new Date(m.created_at).toLocaleTimeString());
    }
  );

  await channel.subscribe((status) => {
    statusEl.textContent = status === "SUBSCRIBED" ? "Live" : status;
  });
}

joinBtn.addEventListener("click", async () => {
  const room = roomInput.value.trim();
  if (!room) return;
  currentRoom = room;
  await ensureRoom(room);
  await loadHistory(room);
  await subscribe(room);
  window.history.replaceState({}, "", `#${encodeURIComponent(room)}`);
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!currentRoom) return;
  const author = authorEl.value.trim() || "Anon";
  const content = contentEl.value.trim();
  if (!content) return;

  const { error } = await supabase
    .from("messages")
    .insert({ room_id: currentRoom, author, content });

  if (error) {
    line("Send failed", error.message);
  } else {
    contentEl.value = "";
  }
});

// Auto join from URL hash
const initial = decodeURIComponent(location.hash.slice(1) || "");
if (initial) {
  roomInput.value = initial;
  joinBtn.click();
}
