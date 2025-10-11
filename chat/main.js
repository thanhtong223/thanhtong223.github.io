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
const themeToggle = document.getElementById("themeToggle");

roomLabel.textContent = `· Room: ${ROOM_ID}`;

/* ---------------- Theme toggle ---------------- */
function applyTheme(mode) {
  // mode: "auto" | "light" | "dark"
  document.documentElement.setAttribute("data-theme", mode);
  localStorage.setItem("chat_theme", mode);
  themeToggle.textContent = mode === "auto" ? "Theme" : `Theme: ${mode}`;
}
(function initTheme() {
  const saved = localStorage.getItem("chat_theme") || "auto";
  applyTheme(saved);
  themeToggle.addEventListener("click", () => {
    const cur = document.documentElement.getAttribute("data-theme") || "auto";
    const next = cur === "auto" ? "light" : cur === "light" ? "dark" : "auto";
    applyTheme(next);
  });
})();

/* ---------------- State ---------------- */
let lastId = null;        // bigint identity cursor to avoid duplicates
let polling = false;
let pollTimer = null;
let pollIntervalMs = 2000;
let backoffMs = pollIntervalMs;

function setLiveState(live) {
  statusDot.classList.toggle("live", live);
}

function loadName() {
  const n = localStorage.getItem("chat_name");
  if (n) authorEl.value = n;
}
function saveName() {
  localStorage.setItem("chat_name", (authorEl.value || "").trim());
}
function getMe() {
  return (authorEl.value || "").trim() || "Anon";
}

/* ---------------- UI helpers ---------------- */
function autoGrow(textarea) {
  textarea.style.height = "auto";
  textarea.style.height = Math.min(textarea.scrollHeight, 180) + "px";
}
contentEl.addEventListener("input", () => autoGrow(contentEl));

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, m => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[m]));
}
function fmt(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
function bubble({ id, author, content, created_at }, mine = false, pending = false) {
  const me = getMe();
  const wrap = document.createElement("div");
  wrap.className = "msg " + (author === me ? "me" : "you");
  if (id != null) wrap.dataset.id = String(id);

  const metaText = pending ? `${fmt(created_at)} · sending` : fmt(created_at);
  wrap.innerHTML = `
    <div class="bubble">${escapeHtml(content)}</div>
    <div class="meta">${author} · ${metaText}</div>
  `;
  log.appendChild(wrap);
  log.parentElement.scrollTop = log.parentElement.scrollHeight;
  return wrap;
}

/* ---------------- Data ---------------- */
async function ensureRoom(room) {
  await supabase.from("rooms").upsert({ id: room });
}

async function loadInitial(room) {
  const { data, error } = await supabase
    .from("messages")
    .select("id, author, content, created_at")
    .eq("room_id", room)
    .order("id", { ascending: true })
    .limit(200);
  if (error) {
    console.error("Initial load failed:", error.message);
    return;
  }
  log.innerHTML = "";
  data.forEach(row => bubble(row));
  if (data.length) lastId = data[data.length - 1].id;
}

async function poll(room) {
  if (polling) return;
  polling = true;
  setLiveState(true);

  try {
    let q = supabase
      .from("messages")
      .select("id, author, content, created_at")
      .eq("room_id", room)
      .order("id", { ascending: true });
    if (lastId != null) q = q.gt("id", lastId);

    const { data, error } = await q;
    if (error) throw error;

    if (data && data.length) {
      data.forEach(row => {
        // Avoid duplicates by id
        bubble(row);
        lastId = row.id;
      });
    }
    backoffMs = pollIntervalMs;
  } catch (err) {
    console.warn("Polling error:", err.message);
    backoffMs = Math.min(backoffMs + 1000, 10000);
  } finally {
    polling = false;
    scheduleNextPoll();
  }
}

function scheduleNextPoll() {
  clearTimeout(pollTimer);
  pollTimer = setTimeout(() => poll(ROOM_ID), document.hidden ? 8000 : backoffMs);
}

/* ---------------- Send ---------------- */
async function sendMessage(room, author, content) {
  // Return inserted id so we can advance the cursor and avoid duplicates
  const { data, error } = await supabase
    .from("messages")
    .insert({ room_id: room, author, content })
    .select("id, created_at")
    .single();
  if (error) throw error;
  return data; // { id, created_at }
}

function initComposer() {
  authorEl.addEventListener("change", saveName);
  authorEl.addEventListener("blur", saveName);

  // Enter to send, Shift+Enter for newline
  contentEl.addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      form.requestSubmit();
    }
  });

  form.addEventListener("submit", async e => {
    e.preventDefault();
    const author = getMe();
    const content = contentEl.value.trim();
    if (!content) return;

    // optimistic show
    const nowIso = new Date().toISOString();
    const node = bubble({ id: null, author, content, created_at: nowIso }, true, true);

    sendBtn.disabled = true;
    contentEl.disabled = true;
    try {
      const inserted = await sendMessage(ROOM_ID, author, content);
      // Mark as sent and attach id
      node.dataset.id = String(inserted.id);
      const meta = node.querySelector(".meta");
      meta.textContent = `${author} · ${fmt(inserted.created_at)}`;
      // Advance cursor to the inserted id so next poll will fetch only newer rows
      lastId = inserted.id;
    } catch (err) {
      const meta = node.querySelector(".meta");
      meta.textContent = `${author} · failed to send`;
      alert("Send failed, " + err.message);
    } finally {
      contentEl.value = "";
      contentEl.disabled = false;
      sendBtn.disabled = false;
      autoGrow(contentEl);
      contentEl.focus();
      // Quick catch-up
      setTimeout(() => poll(ROOM_ID), 250);
    }
  });
}

/* ---------------- Visibility ---------------- */
function initVisibilityPause() {
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      backoffMs = pollIntervalMs;
      poll(ROOM_ID);
    }
  });
}

/* ---------------- Start ---------------- */
async function start() {
  loadName();
  autoGrow(contentEl);
  await ensureRoom(ROOM_ID);
  await loadInitial(ROOM_ID);
  initComposer();
  initVisibilityPause();
  poll(ROOM_ID);
  contentEl.focus();
}
start();