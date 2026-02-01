// simulation-engine.js
(function(){
  if(window.SimulationEngine) return;

  const SimulationEngine = (function(){
    const DEFAULT = {
      minInterval: 4000,
      maxInterval: 18000,
      recentHistoryLimit: 5000,
      memberCooldownMs: 60 * 1000
    };

    let running = false;
    let timers = [];
    let options = Object.assign({}, DEFAULT);

    const recentHashes = [];
    const recentHashSet = new Set();
    const memberLastSent = new Map();

    const TEMPLATES = [
      "Anyone following {coin}? Thoughts?",
      "I think {coin} will {direction} after the next candle.",
      "Bought the dip on {coin} @ {price}.",
      "Where do you get your indicators?",
      "Setting a stop at {price}.",
      "This chart looks like {pattern}.",
      "Who’s using the bot to auto-trade?",
      "Signals incoming — check pinned message.",
      "I’m seeing divergence on {coin}.",
      "{emoji} Strong move today on {coin}."
    ];

    const COINS = ['BTC','ETH','SOL','ADA','XRP','DOGE','LTC','BNB','DOT','AVAX','MATIC'];
    const DIRECTIONS = ['pump','dump','moon','stabilize','retest support','explode'];
    const PATTERNS = ['double bottom','head and shoulders','ascending triangle','cup and handle','flag'];
    const EMOJIS = ['🚀','💎','🔥','🔒','🤔','📈'];

    function fingerprint(text){
      return String(text).slice(0,160).replace(/\s+/g,' ').toLowerCase();
    }
    function isDuplicate(text){ return recentHashSet.has(fingerprint(text)); }
    function pushRecent(text){
      const f = fingerprint(text);
      if(recentHashSet.has(f)) return;
      recentHashes.push(f); recentHashSet.add(f);
      if(recentHashes.length > options.recentHistoryLimit){
        const remove = recentHashes.splice(0, recentHashes.length - options.recentHistoryLimit);
        remove.forEach(r=>recentHashSet.delete(r));
      }
    }

    function pickMember(){
      const pool = (window.SyntheticPeople && window.SyntheticPeople.people) ? window.SyntheticPeople.people : (window._abrox && window._abrox.sampleMembers ? window._abrox.sampleMembers : []);
      if(!pool || !pool.length) return null;
      const now = Date.now();
      const candidates = pool.filter(p=>{
        const last = memberLastSent.get(p.name) || 0;
        if(now - last < options.memberCooldownMs * (1 + (p.fatigue || 0))) return false;
        return Math.random() < 0.98;
      });
      if(!candidates.length) return pool[Math.floor(Math.random()*pool.length)];
      candidates.sort((a,b)=> (b.authority - a.authority) + ((Math.random()>0.5)?1:-1));
      return candidates[Math.floor(Math.random() * Math.min(60, candidates.length))];
    }

    function generateMessage(member){
      let t = TEMPLATES[Math.floor(Math.random()*TEMPLATES.length)];
      const coin = COINS[Math.floor(Math.random()*COINS.length)];
      const direction = DIRECTIONS[Math.floor(Math.random()*DIRECTIONS.length)];
      const pattern = PATTERNS[Math.floor(Math.random()*PATTERNS.length)];
      const price = (Math.random()*1000 + (coin==='BTC'?20000:100)).toFixed(2);
      const emoji = EMOJIS[Math.floor(Math.random()*EMOJIS.length)];
      let text = t.replace('{coin}', coin).replace('{direction}', direction).replace('{pattern}', pattern).replace('{price}', price).replace('{emoji}', emoji);
      if(Math.random() < 0.25) text += ' ' + (member.personality||'').split(' ')[0] + ' view: ' + (Math.random()>0.5?'agree':'watching');
      if(Math.random() < 0.12) text += ' #' + Math.floor(Math.random()*9999);
      return text;
    }

    function scheduleOnce(){
      if(!running) return;
      const member = pickMember();
      if(!member) return scheduleNext();

      let text = generateMessage(member);
      if(isDuplicate(text)){
        for(let i=0;i<4 && isDuplicate(text); i++){
          text = text + ' ' + Math.floor(Math.random()*999);
        }
        if(isDuplicate(text)) return scheduleNext();
      }

      const typingHandle = (window.TypingEngine && window.TypingEngine.requestTyping) ? window.TypingEngine.requestTyping(member, { length: text.length, punctuation: (text.match(/[.,!?]/g)||[]).length, emoji: (text.match(/[\u{1F300}-\u{1F6FF}]/u)||[]).length, mobile: false }) : null;

      const onSend = function(e){
        const detail = e.detail || {};
        if(!detail || !detail.member) return;
        if(detail.member.name !== member.name && detail.member.displayName !== member.displayName) return;
        window._abrox.postMessage({
          name: member.name,
          displayName: member.displayName,
          role: member.role,
          avatar: member.avatar,
          text: text,
          out: false,
          replyTo: null,
          replyMeta: null
        });
        pushRecent(text);
        memberLastSent.set(member.name, Date.now());
        window.removeEventListener('typing:send', onSend);
      };

      if(!typingHandle){
        const fallbackDelay = Math.min(options.maxInterval, Math.max(options.minInterval, text.length * 60));
        setTimeout(() => {
          window._abrox.postMessage({
            name: member.name,
            displayName: member.displayName,
            role: member.role,
            avatar: member.avatar,
            text: text,
            out: false
          });
          pushRecent(text);
          memberLastSent.set(member.name, Date.now());
        }, fallbackDelay);
      } else {
        window.addEventListener('typing:send', onSend);
      }

      scheduleNext();
    }

    function scheduleNext(){
      if(!running) return;
      const delay = options.minInterval + Math.floor(Math.random() * (options.maxInterval - options.minInterval));
      const t = setTimeout(scheduleOnce, delay);
      timers.push(t);
    }

    function start(opts){
      if(running) return;
      options = Object.assign({}, options, opts || {});
      running = true;
      timers.forEach(t=>clearTimeout(t));
      timers = [];
      for(let i=0;i<4;i++){
        const t = setTimeout(scheduleOnce, 300 + Math.random()*1200*i);
        timers.push(t);
      }
    }

    function stop(){
      running = false;
      timers.forEach(t=>clearTimeout(t));
      timers = [];
    }

    function status(){ return { running, options, recentCount: recentHashes.length }; }

    return { start, stop, status, generateMessage };
  })();

  window.SimulationEngine = SimulationEngine;

  setTimeout(()=> {
    if(window._abrox){
      window._abrox.simulation = window._abrox.simulation || {};
      window._abrox.simulation.start = SimulationEngine.start;
      window._abrox.simulation.stop = SimulationEngine.stop;
      window._abrox.simulation.status = SimulationEngine.status;
    }
  }, 300);
})();
