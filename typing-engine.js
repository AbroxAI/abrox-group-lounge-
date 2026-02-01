// typing-engine.js
(function(){
  if(window.TypingEngine) return;

  function emit(evtName, detail){
    try{ window.dispatchEvent(new CustomEvent(evtName, { detail: detail })); } catch(e){ console.warn('emit failed', evtName, e); }
  }
  function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }

  const TypingEngine = {
    requestTyping(member, opts){
      if(!member || !member.name) return;
      opts = opts || {};
      const archetype = member.personality || 'QuietObserver';
      const baseline = Number(member.fatigue || 0);
      const isAdmin = member.role === 'ADMIN' || member.role === 'MOD';
      const mobile = !!opts.mobile;

      let cps = isAdmin ? 6 + Math.random()*6 : 3 + Math.random()*6;
      if(/Analyst|BotBuilder/.test(archetype)) cps *= 1.1;
      if(/HODLer|QuietObserver/.test(archetype)) cps *= 0.8;
      cps *= (1 - clamp(baseline,0,0.6));

      const len = clamp(opts.length || (20 + Math.floor(Math.random()*140)), 8, 400);
      const punctFactor = (opts.punctuation||0) * 0.12;
      const emojiFactor = (opts.emoji||0) * 0.18;

      const baseDurationMs = (len / Math.max(0.5, cps)) * 1000;
      const jitter = (Math.random()*0.6 + 0.7);
      const duration = Math.round(baseDurationMs * jitter * (1 + punctFactor + emojiFactor) * (mobile ? 1.1 : 1));

      const sessionId = 'ts_' + Math.random().toString(36).slice(2,9);
      emit('typing:start', { sessionId, member, estimated: duration });

      const timeline = [];
      const corrections = Math.random() < 0.35;
      const pauseCount = Math.floor(Math.random() * (corrections ? 3 : 2));
      for(let i=0;i<pauseCount;i++){
        const t = Math.round((i+1) * duration / (pauseCount+1) * (0.6 + Math.random()*0.8));
        timeline.push({ type:'pause', at: t });
        timeline.push({ type:'resume', at: t + Math.round(200 + Math.random()*1200) });
      }

      const willAbandon = Math.random() < (member.fatigue ? 0.07 + member.fatigue*0.15 : 0.04);

      const timers = [];
      const startTs = Date.now();
      timeline.sort((a,b)=>a.at-b.at);
      timeline.forEach(ev=>{
        const to = setTimeout(()=>{
          if(ev.type === 'pause') emit('typing:pause', { sessionId, member, at: Date.now()-startTs });
          else if(ev.type === 'resume') emit('typing:resume', { sessionId, member, at: Date.now()-startTs });
        }, ev.at);
        timers.push(to);
      });

      const finalTimeout = setTimeout(()=>{
        if(willAbandon && Math.random() < 0.6){
          emit('typing:abandoned', { sessionId, member });
        } else {
          emit('typing:send', { sessionId, member });
          emit('typing:stop', { sessionId, member });
        }
        timers.forEach(t=>clearTimeout(t));
      }, duration);

      return {
        cancel(){
          clearTimeout(finalTimeout);
          timers.forEach(t=>clearTimeout(t));
          emit('typing:stop', { sessionId, member });
        },
        expectedDuration: duration,
        sessionId
      };
    }
  };

  window.TypingEngine = TypingEngine;
})();
