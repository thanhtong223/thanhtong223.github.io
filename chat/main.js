import { SUPABASE_URL, SUPABASE_ANON_KEY, ROOM_ID } from "./supabase-config.js";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const statusDot = document.getElementById("statusDot");
const roomLabel = document.getElementById("roomLabel");
const log = document.getElementById("log");
const form = document.getElementById("composer");
const authorEl = document.getElementById("author");
const contentEl = document.getElementById("content");
const sendBtn = document.getElementById("sendBtn");

roomLabel.textContent = `Room: ${ROOM_ID}`;

let channel = null;
let isLive = false;

function setLiveState(live) {
  isLive = live;
  statusDot.classList.toggle("live", live);
}

function formatTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function getMe() {
  return (authorEl.value || "").trim() || "Anon";
}

function saveName() {
  localStorage.setItem("chat_name", authorEl.value.trim());
}

function loadName() {
  const n = localStorage.getItem("chat_name");
  if (n) authorEl.value = n;
}

function bubble({ author, content, created_at }) {
  const me = getMe();
  const wrap = document.createElement("div");
  wrap.className = "msg" + (author === me ? " me" : "");
  wrap.innerHTML = `
    <div class="author">${author}</div>
    <div class="body">${escapeHtml(content)}</div>
    <div class="meta">${formatTime(created_at)}</div>
  `;
  log.appendChild(wrap);
  log.parentElement.scrollTop = log.parentElement.scrollHeight;
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, m => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[m]));
}

async function ensureRoom(room) {
  await supabase.from("rooms").upsert({ id: room });
}

async function loadHistory(room) {
  const { data, error } = await supabase
    .from("messages")
    .select("author, content, created_at")
    .eq("room_id", room)
    .order("created_at", { ascending: true })
    .limit(300);
  if (error) return;
  log.innerHTML = "";
  data.forEach(bubble);
}

async function subscribe(room) {
  if (channel) await supabase.removeChannel(channel);
  channel = supabase.channel(`room-${room}`);

  channel.on("postgres_changes",
    { event: "INSERT", schema: "public", table: "messages", filter: `room_id=eq.${room}` },
    payload => bubble(payload.new)
  );

  await channel.subscribe(status => setLiveState(status === "SUBSCRIBED"));
}

async function sendMessage(room, author, content) {
  const { error } = await supabase.from("messages").insert({ room_id: room, author, content });
  if (error) {
    sendBtn.disabled = false;
    contentEl.disabled = false;
    alert("Send failed, " + error.message);
  }
}

function initComposer() {
  // Enter sends, Shift+Enter inserts newline
  contentEl.addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      form.requestSubmit();
    }
  });

  authorEl.addEventListener("change", saveName);
  authorEl.addEventListener("blur", saveName);

  form.addEventListener("submit", async e => {
    e.preventDefault();
    const author = getMe();
    const content = contentEl.value.trim();
    if (!content) return;

    // Optimistic UI
    const now = new Date().toISOString();
    bubble({ author, content, created_at: now });

    // disable briefly to reduce spam
    sendBtn.disabled = true;
    contentEl.disabled = true;
    try {
      await sendMessage(ROOM_ID, author, content);
    } finally {
      contentEl.value = "";
      contentEl.disabled = false;
      sendBtn.disabled = false;
      contentEl.focus();
    }
  });
}

async function start() {
  loadName();
  await ensureRoom(ROOM_ID);
  await loadHistory(ROOM_ID);
  await subscribe(ROOM_ID);
}

start();
initComposer();
