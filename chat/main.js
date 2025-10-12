import { SUPABASE_URL, SUPABASE_ANON_KEY, appConfig } from "./supabase-config.js";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* elements */
const startView = document.getElementById("startView");
const chatView = document.getElementById("chatView");
const composer = document.getElementById("composer");
const logEl = document.getElementById("log");
const titleRoom = document.getElementById("titleRoom");

const themeBtn = document.getElementById("themeBtn");
const menuBtn = document.getElementById("menuBtn");

const profileBtn = document.getElementById("profileBtn");
const nameModal = document.getElementById("nameModal");
const authorEl = document.getElementById("author");
const saveNameBtn = document.getElementById("saveNameBtn");

const contentEl = document.getElementById("content");
const sendBtn = document.getElementById("sendBtn");

/* Drawer */
const drawer = document.getElementById("drawer");
const drawerBackdrop = document.getElementById("drawerBackdrop");
const drawerClose = document.getElementById("drawerClose");
const drawerRoomId = document.getElementById("drawerRoomId");
const inviteLinkEl = document.getElementById("inviteLink");
const copyInviteBtn = document.getElementById("copyInvite");
const roomCodeField = document.getElementById("roomCodeField");
const copyCodeBtn = document.getElementById("copyCode");
const drawerNewRoom = document.getElementById("drawerNewRoom");
const drawerCreateBtn = document.getElementById("drawerCreate");
const drawerJoinCode = document.getElementById("drawerJoinCode");
const drawerJoinBtn = document.getElementById("drawerJoin");

/* Start screen fields */
const startName = document.getElementById("startName");
const tabs = document.querySelectorAll(".tab");
const panes = {
  create: document.getElementById("tab-create"),
  join: document.getElementById("tab-join"),
};
const newRoomName = document.getElementById("newRoomName");
const createRoomBtn = document.getElementById("createRoomBtn");
const joinRoomCode = document.getElementById("joinRoomCode");
const joinRoomBtn = document.getElementById("joinRoomBtn");

/* Theme (light/dark only) */
function setTheme(mode) {
  document.documentElement.setAttribute("data-theme", mode);
  localStorage.setItem("chat_theme", mode);
  themeBtn.textContent = mode === "dark" ? "Dark" : "Light";
}
(function initTheme() {
  const saved = localStorage.getItem("chat_theme") || "light";
  setTheme(saved);
  themeBtn.addEventListener("click", () => {
    setTheme(document.documentElement.getAttribute("data-theme") === "light" ? "dark" : "light");
  });
})();

/* Name handling */
const getSavedName = () => localStorage.getItem("chat_name") || "";
const saveName = (v) => { v = (v || "").trim(); if (v) localStorage.setItem("chat_name", v); };
const meName = () => (getSavedName().trim() || "Anon");

(function initStartName() {
  const saved = getSavedName();
  if (saved) startName.value = saved;
  startName.addEventListener("input", () => saveName(startName.value));
})();

profileBtn.addEventListener("click", () => {
  authorEl.value = getSavedName();
  if (typeof nameModal.showModal === "function") nameModal.showModal();
});
saveNameBtn.addEventListener("click", () => saveName(authorEl.value));

/* Rooms + polling */
let roomId = null;
let lastId = null;         // bigint identity cursor
let polling = false;
let timer = null;
const basePoll = 2000;
let backoff = basePoll;

/* Utilities */
function slugify(s) {
  return (s || "")
    .toLowerCase().trim()
    .replace(/[^a-z0-9\-_\s]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 48) || "room";
}
const genCode = () => Math.random().toString(36).slice(2, 8);
const roomUrl = (id) => `${appConfig.baseUrl}?room=${encodeURIComponent(id)}`;

async function ensureRoom(id) { await supabase.from("rooms").upsert({ id }); }
function fmt(ts) { return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }

/* -------- Correct scroll container detection ---------- */
function getScroller() {
  const el = logEl.parentElement; // <main> .chat
  if (el && el.scrollHeight > el.clientHeight + 1) return el; // element is scrollable
  // fallback to page scroller
  return document.scrollingElement || document.documentElement;
}
function isWindowScroller(sc) {
  return sc === document.scrollingElement || sc === document.documentElement || sc === document.body;
}
function nearBottom(sc, threshold = 100) {
  return sc.scrollHeight - sc.scrollTop - sc.clientHeight < threshold;
}
function doScroll(sc, top, smooth) {
  if (isWindowScroller(sc)) {
    window.scrollTo({ top, behavior: smooth ? "smooth" : "auto" });
  } else {
    sc.scrollTo({ top, behavior: smooth ? "smooth" : "auto" });
  }
}

/* Smooth/Smart scroll helpers */
const scrollDownBtn = document.getElementById("scrollDownBtn");
function scrollToBottom(smooth = false) {
  const sc = getScroller();
  doScroll(sc, sc.scrollHeight, smooth);
  scrollDownBtn.classList.remove("visible");
}
function installScrollWatcher() {
  const sc = getScroller();
  const handler = () => {
    if (nearBottom(getScroller())) {
      scrollDownBtn.classList.remove("visible");
    }
  };
  // listen on both window and main to be safe
  window.addEventListener("scroll", handler);
  if (!isWindowScroller(sc)) sc.addEventListener("scroll", handler);
}
installScrollWatcher();
scrollDownBtn.addEventListener("click", () => scrollToBottom(true));

/* Rendering */
function renderBubble({ id, author, content, created_at }) {
  const wrap = document.createElement("div");
  wrap.className = "msg " + (author === meName() ? "me" : "you");
  wrap.dataset.id = String(id);

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = content;

  const meta = document.createElement("div");
  meta.className = "meta";
  meta.textContent = `${author} · ${fmt(created_at)}`;

  wrap.appendChild(bubble);
  wrap.appendChild(meta);
  logEl.appendChild(wrap);

  const sc = getScroller();
  if (nearBottom(sc)) {
    scrollToBottom(true);
  } else {
    scrollDownBtn.classList.add("visible");
    bubble.classList.add("pulse");
    if (navigator.vibrate) navigator.vibrate(25);
    setTimeout(() => bubble.classList.remove("pulse"), 1500);
  }
  return wrap;
}

/* Initial load */
async function loadInitial() {
  const { data, error } = await supabase
    .from("messages")
    .select("id, author, content, created_at")
    .eq("room_id", roomId)
    .order("id", { ascending: true })
    .limit(200);

  if (error) {
    console.error("Initial load:", error.message);
    return;
  }

  logEl.innerHTML = "";
  data.forEach(renderBubble);
  setTimeout(() => scrollToBottom(true), 100);

  if (data.length) lastId = data[data.length - 1].id;
}

/* Polling */
async function poll() {
  if (polling || !roomId) return;
  polling = true;
  try {
    let q = supabase
      .from("messages")
      .select("id, author, content, created_at")
      .eq("room_id", roomId)
      .order("id", { ascending: true });
    if (lastId != null) q = q.gt("id", lastId);

    const { data, error } = await q;
    if (error) throw error;

    if (data && data.length) {
      data.forEach(r => { renderBubble(r); lastId = r.id; });
    }
    backoff = basePoll;
  } catch (e) {
    console.warn("Poll error:", e.message);
    backoff = Math.min(backoff + 1000, 10000);
  } finally {
    polling = false;
    clearTimeout(timer);
    timer = setTimeout(poll, document.hidden ? 8000 : backoff);
  }
}
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) { backoff = basePoll; poll(); }
});

/* Send messages */
contentEl.addEventListener("input", () => {
  contentEl.style.height = "auto";
  contentEl.style.height = Math.min(contentEl.scrollHeight, 200) + "px";
});
contentEl.addEventListener("keydown", e => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    composer.requestSubmit();
  }
});
composer.addEventListener("submit", async e => {
  e.preventDefault();
  const a = meName();
  const c = contentEl.value.trim();
  if (!c || !roomId) return;

  // optimistic
  const now = new Date().toISOString();
  const node = renderBubble({ id: -1, author: a, content: c, created_at: now });

  // ensure we scroll when *you* send even if you weren't near bottom
  scrollToBottom(true);

  sendBtn.disabled = true; contentEl.disabled = true;
  try {
    const { data, error } = await supabase
      .from("messages")
      .insert({ room_id: roomId, author: a, content: c })
      .select("id, created_at")
      .single();
    if (error) throw error;

    node.dataset.id = String(data.id);
    node.querySelector(".meta").textContent = `${a} · ${fmt(data.created_at)}`;
    lastId = data.id;
  } catch (err) {
    node.querySelector(".meta").textContent = `${a} · failed to send`;
    alert("Send failed, " + err.message);
  } finally {
    contentEl.value = ""; contentEl.style.height = "auto";
    sendBtn.disabled = false; contentEl.disabled = false; contentEl.focus();
    setTimeout(poll, 250);
  }
});

/* Drawer */
function openDrawer() {
  drawer.classList.add("open");
  drawerRoomId.textContent = roomId || "—";
  const url = roomId ? roomUrl(roomId) : "";
  inviteLinkEl.value = url;
  roomCodeField.value = roomId || "";
}
function closeDrawer() { drawer.classList.remove("open"); }
menuBtn.addEventListener("click", openDrawer);
drawerClose.addEventListener("click", closeDrawer);
drawerBackdrop.addEventListener("click", closeDrawer);

copyInviteBtn.addEventListener("click", async () => {
  if (!inviteLinkEl.value) return;
  try {
    await navigator.clipboard.writeText(inviteLinkEl.value);
    copyInviteBtn.textContent = "Copied";
    setTimeout(() => (copyInviteBtn.textContent = "Copy"), 1200);
  } catch {}
});
copyCodeBtn.addEventListener("click", async () => {
  if (!roomCodeField.value) return;
  try {
    await navigator.clipboard.writeText(roomCodeField.value);
    copyCodeBtn.textContent = "Copied";
    setTimeout(() => (copyCodeBtn.textContent = "Copy"), 1200);
  } catch {}
});
drawerCreateBtn.addEventListener("click", () => {
  const n = slugify(drawerNewRoom.value || `room-${genCode()}`);
  createAndEnter(n);
});
drawerJoinBtn.addEventListener("click", () => {
  const c = slugify(drawerJoinCode.value);
  if (c) enterRoom(c);
});

/* Start tabs */
tabs.forEach(btn => btn.addEventListener("click", () => {
  tabs.forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
  panes.create.classList.toggle("hidden", btn.dataset.tab !== "create");
  panes.join.classList.toggle("hidden", btn.dataset.tab !== "join");
}));
createRoomBtn.addEventListener("click", () => {
  const name = slugify(newRoomName.value || `room-${genCode()}`);
  createAndEnter(name);
});
joinRoomBtn.addEventListener("click", () => {
  const code = slugify(joinRoomCode.value);
  if (code) enterRoom(code);
});

/* Flow */
function showChatUI() {
  startView.classList.add("hidden");
  startView.setAttribute("aria-hidden", "true");
  // remove from DOM so it cannot appear under composer on mobile
  setTimeout(() => { try { startView.remove(); } catch {} }, 300);
  chatView.classList.remove("hidden");
  composer.classList.remove("hidden");
}
async function createAndEnter(id) {
  saveName(startName.value || getSavedName());
  await ensureRoom(id);
  enterRoom(id);
}
function enterRoom(id) {
  saveName(startName.value || getSavedName());
  roomId = id;
  localStorage.setItem("last_room", roomId);
  titleRoom.textContent = roomId;
  inviteLinkEl.value = roomUrl(roomId);
  history.replaceState({}, "", `?room=${encodeURIComponent(roomId)}`);
  showChatUI();
  bootRoom();
  closeDrawer();
}
async function bootRoom() {
  lastId = null;
  await ensureRoom(roomId);
  await loadInitial();
  poll();
  contentEl.focus();
}

/* Routing: ALWAYS show start at /chat; only join when ?room=... is present */
(function initRouting() {
  const params = new URLSearchParams(location.search);
  const queryRoom = params.get("room");

  if (queryRoom) {
    const slug = slugify(queryRoom);
    if (getSavedName()) {
      enterRoom(slug);
    } else {
      // prefill join tab and keep start visible for name
      tabs.forEach(b => b.classList.remove("active"));
      document.querySelector('.tab[data-tab="join"]').classList.add("active");
      panes.create.classList.add("hidden");
      panes.join.classList.remove("hidden");
      joinRoomCode.value = slug;
      startName.focus();
    }
  } else {
    // no auto-enter; always show start screen
    startName.focus();
  }
})();
