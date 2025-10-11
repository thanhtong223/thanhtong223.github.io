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

let lastTs = null;                // ISO timestamp of the latest message we have
let polling = false;
let pollTimer = null;
let pollIntervalMs = 2000;        // base interval
let backoffMs = pollIntervalMs;   // increases on error up to 10s

function setLiveState(live) {
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

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
}

function bubble({ author, content, created_at }, isOptimistic = false) {
  const me = getMe();
  const wrap = document.createElement("div");
  wrap.className = "msg" + (author === me ? " me" : "");
  wrap.innerHTML = `
    <div class="author">${author}</div>
    <div class="body">${escapeHtml(content)}</div>
    <div class="meta">${formatTime(created_at)}${isOptimistic ? " · sending" : ""}</div>
  `;
  log.appendChild(wrap);
  log.parentElement.scrollTop = log.parentElement.scrollHeight;
  return wrap;
}

async function ensureRoom(room) {
  await supabase.from("rooms").upsert({ id: room });
}

async function loadInitial(room) {
  // Load last 200 messages to build the view
  const { data, error } = await supabase
    .from("messages")
    .select("author, content, created_at")
    .eq("room_id", room)
    .order("created_at", { ascending: true })
    .limit(200);

  if (error) {
    console.error("Initial load failed:", error.message);
    return;
  }

  log.innerHTML = "";
  data.forEach(bubble);

  // Track newest timestamp
  if (data.length) {
    lastTs = data[data.length - 1].created_at;
  }
}

async function poll(room) {
  if (polling) return;
  polling = true;
  setLiveState(true);

  try {
    // Only fetch new rows after lastTs
    let q = supabase
      .from("messages")
      .select("author, content, created_at")
      .eq("room_id", room)
      .order("created_at", { ascending: true });

    if (lastTs) q = q.gt("created_at", lastTs);

    const { data, error } = await q;

    if (error) throw error;

    if (data && data.length) {
      data.forEach(row => {
        bubble(row);
        lastTs = row.created_at;
      });
    }

    // Success, reset backoff
    backoffMs = pollIntervalMs;
  } catch (err) {
    console.warn("Polling error:", err.message);
    // Back off up to 10s
    backoffMs = Math.min(backoffMs + 1000, 10000);
  } finally {
    polling = false;
    scheduleNextPoll();
  }
}

function scheduleNextPoll() {
  clearTimeout(pollTimer);
  if (document.hidden) {
    // Save quota when tab is hidden
    pollTimer = setTimeout(() => poll(ROOM_ID), 8000);
  } else {
    pollTimer = setTimeout(() => poll(ROOM_ID), backoffMs);
  }
}

async function sendMessage(room, author, content) {
  const { error } = await supabase
    .from("messages")
    .insert({ room_id: room, author, content });
  if (error) throw error;
}

function initComposer() {
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

    // optimistic message
    const nowIso = new Date().toISOString();
    const node = bubble({ author, content, created_at: nowIso }, true);

    sendBtn.disabled = true;
    contentEl.disabled = true;
    try {
      await sendMessage(ROOM_ID, author, content);
      // mark as sent
      const meta = node.querySelector(".meta");
      meta.textContent = formatTime(nowIso);
      // set lastTs forward so we do not re-append our own message on next poll
      lastTs = nowIso;
    } catch (err) {
      const meta = node.querySelector(".meta");
      meta.textContent = "failed to send";
      alert("Send failed, " + err.message);
    } finally {
      contentEl.value = "";
      contentEl.disabled = false;
      sendBtn.disabled = false;
      contentEl.focus();
      // kick a quick poll to pick up any concurrent messages
      setTimeout(() => poll(ROOM_ID), 300);
    }
  });
}

function initVisibilityPause() {
  document.addEventListener("visibilitychange", () => {
    // on show, poll quickly to catch up
    if (!document.hidden) {
      backoffMs = pollIntervalMs;
      poll(ROOM_ID);
    }
  });
}

async function start() {
  loadName();
  await ensureRoom(ROOM_ID);
  await loadInitial(ROOM_ID);
  initComposer();
  initVisibilityPause();
  poll(ROOM_ID); // start the loop
  contentEl.focus();
}

start();
