import { SUPABASE_URL, SUPABASE_ANON_KEY, appConfig } from "./supabase-config.js";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* elements */
const startView=document.getElementById("startView"),chatView=document.getElementById("chatView"),composer=document.getElementById("composer"),logEl=document.getElementById("log"),titleRoom=document.getElementById("titleRoom"),themeBtn=document.getElementById("themeBtn"),menuBtn=document.getElementById("menuBtn"),profileBtn=document.getElementById("profileBtn"),nameModal=document.getElementById("nameModal"),authorEl=document.getElementById("author"),saveNameBtn=document.getElementById("saveNameBtn"),contentEl=document.getElementById("content"),sendBtn=document.getElementById("sendBtn"),drawer=document.getElementById("drawer"),drawerBackdrop=document.getElementById("drawerBackdrop"),drawerClose=document.getElementById("drawerClose"),drawerRoomId=document.getElementById("drawerRoomId"),inviteLinkEl=document.getElementById("inviteLink"),copyInviteBtn=document.getElementById("copyInvite"),drawerNewRoom=document.getElementById("drawerNewRoom"),drawerCreateBtn=document.getElementById("drawerCreate"),drawerJoinCode=document.getElementById("drawerJoinCode"),drawerJoinBtn=document.getElementById("drawerJoin"),startName=document.getElementById("startName"),tabs=document.querySelectorAll(".tab"),panes={create:document.getElementById("tab-create"),join:document.getElementById("tab-join")},newRoomName=document.getElementById("newRoomName"),createRoomBtn=document.getElementById("createRoomBtn"),joinRoomCode=document.getElementById("joinRoomCode"),joinRoomBtn=document.getElementById("joinRoomBtn"),scrollDownBtn=document.getElementById("scrollDownBtn");

/* theme */
function setTheme(m){document.documentElement.setAttribute("data-theme",m);localStorage.setItem("chat_theme",m);themeBtn.textContent=m==="dark"?"Dark":"Light"}
(function(){setTheme(localStorage.getItem("chat_theme")||"light");themeBtn.addEventListener("click",()=>{setTheme(document.documentElement.getAttribute("data-theme")==="light"?"dark":"light")})})();

/* name handling */
const getSavedName=()=>localStorage.getItem("chat_name")||"";const saveName=v=>{v=v.trim();if(v)localStorage.setItem("chat_name",v)};const meName=()=>getSavedName().trim()||"Anon";
(function(){const s=getSavedName();if(s)startName.value=s;startName.addEventListener("input",()=>saveName(startName.value))})();
profileBtn.addEventListener("click",()=>{authorEl.value=getSavedName();if(typeof nameModal.showModal==="function")nameModal.showModal()});saveNameBtn.addEventListener("click",()=>saveName(authorEl.value));

/* rooms + polling */
let roomId=null,lastId=null,polling=false,timer=null;const basePoll=2000;let backoff=basePoll;
function slugify(s){return(s||"").toLowerCase().trim().replace(/[^a-z0-9\-_\s]/g,"").replace(/\s+/g,"-").slice(0,48)||"room"}
const genCode=()=>Math.random().toString(36).slice(2,8);const roomUrl=id=>`${appConfig.baseUrl}?room=${encodeURIComponent(id)}`;
async function ensureRoom(id){await supabase.from("rooms").upsert({id})}

/* scroll helpers */
function scrollToBottom(smooth=false){const sc=logEl.parentElement;if(!sc)return;sc.scrollTo({top:sc.scrollHeight,behavior:smooth?"smooth":"auto"});scrollDownBtn.classList.remove("visible")}

/* render bubble with pulse + smart scroll */
function renderBubble({id,author,content,created_at}){const wrap=document.createElement("div");wrap.className="msg "+(author===meName()?"me":"you");wrap.dataset.id=String(id);const bubble=document.createElement("div");bubble.className="bubble";bubble.textContent=content;const meta=document.createElement("div");meta.className="meta";meta.textContent=`${author} · ${fmt(created_at)}`;wrap.appendChild(bubble);wrap.appendChild(meta);logEl.appendChild(wrap);const sc=logEl.parentElement;if(sc){const nearBottom=sc.scrollHeight-sc.scrollTop-sc.clientHeight<100;if(nearBottom){scrollToBottom(true)}else{scrollDownBtn.classList.add("visible");bubble.classList.add("pulse");if(navigator.vibrate)navigator.vibrate(25);setTimeout(()=>bubble.classList.remove("pulse"),1500)}}return wrap}

/* load initial messages */
async function loadInitial(){const {data,error}=await supabase.from("messages").select("id,author,content,created_at").eq("room_id",roomId).order("id",{ascending:true}).limit(200);if(error){console.error("Initial load:",error.message);return}logEl.innerHTML="";data.forEach(renderBubble);setTimeout(()=>scrollToBottom(true),100);if(data.length)lastId=data[data.length-1].id}

/* polling */
async function poll(){if(polling||!roomId)return;polling=true;try{let q=supabase.from("messages").select("id,author,content,created_at").eq("room_id",roomId).order("id",{ascending:true});if(lastId!=null)q=q.gt("id",lastId);const {data,error}=await q;if(error)throw error;if(data&&data.length){data.forEach(r=>{renderBubble(r);lastId=r.id})}backoff=basePoll}catch(e){console.warn("Poll error:",e.message);backoff=Math.min(backoff+1000,10000)}finally{polling=false;clearTimeout(timer);timer=setTimeout(poll,document.hidden?8000:backoff)}}
document.addEventListener("visibilitychange",()=>{if(!document.hidden){backoff=basePoll;poll()}});

/* send messages */
contentEl.addEventListener("input",()=>{contentEl.style.height="auto";contentEl.style.height=Math.min(contentEl.scrollHeight,180)+"px"});contentEl.addEventListener("keydown",e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();composer.requestSubmit()}});
composer.addEventListener("submit",async e=>{e.preventDefault();const a=meName(),c=contentEl.value.trim();if(!c||!roomId)return;const now=new Date().toISOString();const node=renderBubble({id:-1,author:a,content:c,created_at:now});sendBtn.disabled=true;contentEl.disabled=true;try{const {data,error}=await supabase.from("messages").insert({room_id:roomId,author:a,content:c}).select("id,created_at").single();if(error)throw error;node.dataset.id=String(data.id);node.querySelector(".meta").textContent=`${a} · ${fmt(data.created_at)}`;lastId=data.id}catch(err){node.querySelector(".meta").textContent=`${a} · failed to send`;alert("Send failed, "+err.message)}finally{contentEl.value="";contentEl.style.height="auto";sendBtn.disabled=false;contentEl.disabled=false;contentEl.focus();setTimeout(poll,250)}});

/* helpers */
function fmt(ts){return new Date(ts).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}

/* drawer */
function openDrawer(){drawer.classList.add("open");drawerRoomId.textContent=roomId||"—";inviteLinkEl.value=roomId?roomUrl(roomId):""}
function closeDrawer(){drawer.classList.remove("open")}
menuBtn.addEventListener("click",openDrawer);drawerClose.addEventListener("click",closeDrawer);drawerBackdrop.addEventListener("click",closeDrawer);
copyInviteBtn.addEventListener("click",async()=>{if(!inviteLinkEl.value)return;try{await navigator.clipboard.writeText(inviteLinkEl.value);copyInviteBtn.textContent="Copied";setTimeout(()=>copyInviteBtn.textContent="Copy",1200)}catch{}});
drawerCreateBtn.addEventListener("click",()=>{const n=slugify(drawerNewRoom.value||`room-${genCode()}`);createAndEnter(n)});
drawerJoinBtn.addEventListener("click",()=>{const c=slugify(drawerJoinCode.value);if(c)enterRoom(c)});

/* start screen tabs */
tabs.forEach(b=>b.addEventListener("click",()=>{tabs.forEach(x=>x.classList.remove("active"));b.classList.add("active");panes.create.classList.toggle("hidden",b.dataset.tab!=="create");panes.join.classList.toggle("hidden",b.dataset.tab!=="join")}));
createRoomBtn.addEventListener("click",()=>{const n=slugify(newRoomName.value||`room-${genCode()}`);createAndEnter(n)});
joinRoomBtn.addEventListener("click",()=>{const c=slugify(joinRoomCode.value);if(c)enterRoom(c)});

/* flow */
function showChatUI(){startView.classList.add("hidden");chatView.classList.remove("hidden");composer.classList.remove("hidden")}
async function createAndEnter(id){saveName(startName.value||getSavedName());await ensureRoom(id);enterRoom(id)}
function enterRoom(id){saveName(startName.value||getSavedName());roomId=id;localStorage.setItem("last_room",roomId);titleRoom.textContent=roomId;inviteLinkEl.value=roomUrl(roomId);history.replaceState({}, "",`?room=${encodeURIComponent(roomId)}`);showChatUI();bootRoom();closeDrawer()}
async function bootRoom(){lastId=null;await ensureRoom(roomId);await loadInitial();poll();contentEl.focus()}

/* new messages button scroll */
const scroller=logEl.parentElement;
if(scroller){
  scroller.addEventListener("scroll",()=>{const nearBottom=scroller.scrollHeight-scroller.scrollTop-scroller.clientHeight<100;if(nearBottom){scrollDownBtn.classList.remove("visible");}});
}
scrollDownBtn.addEventListener("click",()=>scrollToBottom(true));

/* routing */
(function(){const p=new URLSearchParams(location.search);const q=p.get("room");const savedRoom=localStorage.getItem("last_room");const savedName=getSavedName();if(q){const slug=slugify(q);if(savedName){enterRoom(slug)}else{tabs.forEach(x=>x.classList.remove("active"));document.querySelector('.tab[data-tab="join"]').classList.add("active");panes.create.classList.add("hidden");panes.join.classList.remove("hidden");joinRoomCode.value=slug;startName.focus()}}else if(savedRoom&&savedName){enterRoom(savedRoom)}else{startName.focus()}})();
