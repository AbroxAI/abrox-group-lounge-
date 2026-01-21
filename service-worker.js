<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>Abrox – Private Lounge</title>

<meta name="viewport"
  content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">

<meta name="theme-color" content="#1c1f26">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">

<link rel="manifest" href="manifest.json">

<script src="https://cdn.tailwindcss.com"></script>
<script>
tailwind.config = {
  theme: {
    extend: {
      colors: {
        bg:'#1c1f26',
        panel:'#232833',
        border:'#343a4a',
        muted:'#a0a6b5',
        accent:'#2ecc71',
        admin:'#f1c40f',
        bubble:'#262b38'
      }
    }
  }
}
</script>

<style>
html, body {
  height:100%;
  width:100%;
}
#chatMessages { scroll-behavior:smooth; }
.caret-accent { caret-color:#2ecc71 }
</style>

<script src="https://unpkg.com/lucide@latest"></script>
</head>

<body class="bg-bg text-white min-h-[100dvh]">

<div class="flex h-[100dvh] overflow-hidden">

<!-- MAIN CHAT -->
<main class="flex flex-col flex-1 min-h-0 border-r border-border">

<!-- HEADER -->
<header class="bg-panel border-b border-border px-4 py-3 shrink-0">
  <div class="flex justify-between items-start">
    <div class="flex gap-4">
      <i data-lucide="arrow-left" class="w-5 h-5 text-muted mt-1"></i>
      <img src="assets/logo.png" class="w-10 h-10 rounded-full" />
      <div class="space-y-1">
        <div class="text-sm font-semibold">Abrox Binary Bot – Private Lounge</div>
        <div class="text-xs text-muted flex items-center gap-1">
          <i data-lucide="lock" class="w-3.5 h-3.5"></i>
          <span>Private Group</span>
        </div>
        <div class="text-xs text-muted">
          Members: 4,872 • Online: <span id="onlineCount">132</span>
        </div>
      </div>
    </div>
  </div>
</header>

<!-- CHAT -->
<section id="chatMessages"
  class="flex-1 min-h-0 px-3 sm:px-4 overflow-y-auto space-y-4 py-4 pb-32">
</section>

<!-- INPUT -->
<footer class="bg-panel border-t border-border px-3 py-3
               pb-[env(safe-area-inset-bottom)]
               sticky bottom-0 z-50">
  <div class="flex items-center gap-3 bg-bg rounded-xl px-4 py-2 min-h-[48px]">

    <button class="text-muted">
      <i data-lucide="smile" class="w-5 h-5"></i>
    </button>

    <input id="chatInput"
      class="flex-1 bg-transparent outline-none text-sm caret-accent"
      placeholder="Message">

    <button class="text-muted">
      <i data-lucide="paperclip" class="w-5 h-5"></i>
    </button>

    <button class="text-muted">
      <i data-lucide="camera" class="w-5 h-5"></i>
    </button>

    <div class="relative w-10 h-10 shrink-0">
      <button id="micBtn"
        class="absolute inset-0 rounded-full bg-white text-bg flex items-center justify-center">
        <i data-lucide="mic" class="w-5 h-5"></i>
      </button>
      <button id="sendBtn"
        class="absolute inset-0 hidden rounded-full bg-accent text-white flex items-center justify-center">
        <i data-lucide="send" class="w-5 h-5"></i>
      </button>
    </div>

  </div>
</footer>

</main>

<!-- DESKTOP SIDEBAR (RESTORED) -->
<aside class="hidden md:block w-80 bg-panel px-4 py-5 border-l border-border">
  <div class="text-xs text-muted mb-3">ADMINS</div>

  <div class="flex items-center gap-3 mb-3">
    <img src="https://i.pravatar.cc/32?img=12" class="w-8 h-8 rounded-full">
    <div class="text-sm">Sam_Admin</div>
    <span class="ml-auto w-2 h-2 bg-accent rounded-full"></span>
  </div>

  <div class="flex items-center gap-3">
    <img src="https://i.pravatar.cc/32?img=24" class="w-8 h-8 rounded-full">
    <div class="text-sm">Alex_Admin</div>
    <span class="ml-auto w-2 h-2 bg-muted rounded-full"></span>
  </div>
</aside>

</div>

<!-- INSTALL BANNERS -->
<div id="installBanner"
  class="hidden fixed bottom-24 left-1/2 -translate-x-1/2
         bg-panel border border-border px-4 py-2 rounded-xl
         flex items-center gap-3 z-50">
  <span class="text-sm">📲 Install Abrox App</span>
  <button id="installBtn"
    class="bg-accent text-bg text-xs px-3 py-1 rounded-lg">
    Install
  </button>
</div>

<div id="iosInstall"
  class="hidden fixed inset-0 bg-black/70 z-50 flex items-end justify-center">
  <div class="bg-panel rounded-t-xl p-4 w-full max-w-md">
    <div class="text-sm mb-2 font-semibold">Install Abrox App</div>
    <p class="text-xs text-muted mb-3">
      Tap <b>Share</b> then <b>Add to Home Screen</b>
    </p>
    <button onclick="closeIOSInstall()"
      class="w-full bg-accent text-bg py-2 rounded-lg text-sm">
      Got it
    </button>
  </div>
</div>

<script>
lucide.createIcons();

/* ONLINE COUNT */
let online=132;
setInterval(()=>{
  online+=Math.random()>.5?1:-1;
  onlineCount.textContent=online;
},8000);

/* CHAT */
const chat=document.getElementById('chatMessages');
const input=document.getElementById('chatInput');
const sendBtn=document.getElementById('sendBtn');
const micBtn=document.getElementById('micBtn');

/* SYSTEM MESSAGE */
(() => {
  const r=document.createElement('div');
  r.className='flex justify-center text-xs text-muted';
  r.innerHTML=`
    <div class="max-w-[90%] text-center leading-relaxed">
      <div class="text-admin font-medium mb-1">📌 Group Rules</div>
      New members are read-only until verified<br>
      Admins DM individually<br>
      No screenshots in chat<br>
      Ignore unsolicited messages
    </div>`;
  chat.appendChild(r);
})();

/* SEND / MIC TOGGLE */
function updateSend(){
  const hasText=input.value.trim().length>0;
  micBtn.classList.toggle('hidden',hasText);
  sendBtn.classList.toggle('hidden',!hasText);
}
input.addEventListener('input',updateSend);

/* SEND MESSAGE */
sendBtn.onclick=()=>{
  if(!input.value.trim())return;

  const time=new Date().toLocaleTimeString([],{
    hour:'2-digit',minute:'2-digit'
  });

  const d=document.createElement('div');
  d.className='flex justify-end';
  d.innerHTML=`
    <div class="bg-accent/20 px-3 py-2
                rounded-[14px_14px_4px_14px]
                text-sm max-w-[80%] relative">
      <div class="pr-10">${input.value}</div>
      <span class="absolute bottom-1 right-2 text-[10px] text-muted">
        ${time}
      </span>
    </div>`;
  chat.appendChild(d);

  input.value='';
  updateSend();
  chat.scrollTop=chat.scrollHeight;
};

/* ANDROID INSTALL */
let deferredPrompt=null;
window.addEventListener('beforeinstallprompt',e=>{
  e.preventDefault();
  deferredPrompt=e;
  installBanner.classList.remove('hidden');
});
installBtn.onclick=async()=>{
  if(!deferredPrompt)return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  installBanner.classList.add('hidden');
};

/* IOS INSTALL */
const isStandalone=
  window.matchMedia('(display-mode: standalone)').matches ||
  window.navigator.standalone===true;
const isIOS=/iphone|ipad|ipod/i.test(navigator.userAgent);
if(isIOS&&!isStandalone){
  setTimeout(()=>iosInstall.classList.remove('hidden'),2000);
}
function closeIOSInstall(){
  iosInstall.classList.add('hidden');
}

/* SERVICE WORKER */
if('serviceWorker' in navigator){
  navigator.serviceWorker.register('service-worker.js');
}
</script>

</body>
</html>
