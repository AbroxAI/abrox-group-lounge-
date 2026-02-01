// ui-adapter.js
(function(){
  if(window.UIAdapter) return;

  // Provide a safe setSampleMembers for SyntheticPeople to call
  window._abrox = window._abrox || {};
  window._abrox.setSampleMembers = window._abrox.setSampleMembers || function(arr){
    try{
      const normalized = (arr||[]).map(p => ({
        name: p.name || p.displayName || ('m_' + Math.random().toString(36).slice(2,8)),
        displayName: p.displayName || p.name,
        role: p.role || 'VERIFIED',
        avatar: p.avatar || `https://api.dicebear.com/6.x/adventurer/svg?seed=${encodeURIComponent(p.displayName||p.name)}&scale=85`,
        language: p.language || 'en',
        personality: p.personality || '',
        fatigue: p.fatigue || 0,
        authority: p.authority || (p.role==='ADMIN'?3:p.role==='MOD'?2:1),
        lastActive: p.lastActive || Date.now()
      }));
      // if index page exposes internal hook, use it
      if(window._abrox._internal && typeof window._abrox._internal.setSampleMembers === 'function'){
        window._abrox._internal.setSampleMembers(normalized);
      } else {
        // fallback: set global sampleMembers and update memberCount if present
        window.sampleMembers = normalized;
        if(window._abrox) window._abrox.sampleMembers = normalized;
        if(typeof renderMemberWindow === 'function') try{ renderMemberWindow(); }catch(e){}
        if(document.getElementById('memberCount')) document.getElementById('memberCount').textContent = (normalized.length||0).toLocaleString();
      }
      return true;
    }catch(e){
      console.error('setSampleMembers failed', e);
      return false;
    }
  };

  // Typing adapter: show typing rows
  function showTypingText(text){
    const typingRow = document.getElementById('typingRow');
    const typingText = document.getElementById('typingText');
    const membersRow = document.getElementById('membersRow');
    if(!typingRow || !typingText) return;
    typingText.textContent = text;
    typingRow.classList.add('active');
    if(membersRow) membersRow.classList.add('hidden');
  }
  function hideTyping(){
    const typingRow = document.getElementById('typingRow');
    const membersRow = document.getElementById('membersRow');
    if(!typingRow) return;
    typingRow.classList.remove('active');
    if(membersRow) membersRow.classList.remove('hidden');
  }

  const currentlyTyping = new Map();
  function refreshTypingText(){
    const names = Array.from(currentlyTyping.keys()).slice(0,3);
    if(names.length === 0){ hideTyping(); return; }
    if(names.length === 1) showTypingText(`${names[0]} is typing…`);
    else if(names.length === 2) showTypingText(`${names[0]} and ${names[1]} are typing…`);
    else showTypingText(`${names[0]}, ${names[1]} and ${names.length-2} others are typing…`);
  }

  window.addEventListener('typing:start', (e) => {
    const member = e.detail && e.detail.member;
    if(!member) return;
    currentlyTyping.set(member.displayName || member.name, Date.now());
    refreshTypingText();
    setTimeout(()=> {
      currentlyTyping.delete(member.displayName || member.name);
      refreshTypingText();
    }, (e.detail && e.detail.estimated) ? Math.max(3000, e.detail.estimated + 1200) : 5000);
  });

  window.addEventListener('typing:pause', (e)=>{ });
  window.addEventListener('typing:resume', (e)=>{ });
  window.addEventListener('typing:send', (e)=>{
    const member = e.detail && e.detail.member;
    if(!member) return;
    currentlyTyping.delete(member.displayName||member.name);
    refreshTypingText();
  });
  window.addEventListener('typing:abandoned', (e)=>{
    const member = e.detail && e.detail.member;
    if(!member) return;
    currentlyTyping.delete(member.displayName||member.name);
    refreshTypingText();
  });

  setInterval(()=>{
    const now = Date.now();
    for(const [k,t] of currentlyTyping.entries()){
      if(now - t > 8000) currentlyTyping.delete(k);
    }
    refreshTypingText();
  }, 2200);

  window.UIAdapter = {
    currentlyTyping,
    refreshTypingText
  };

})();
