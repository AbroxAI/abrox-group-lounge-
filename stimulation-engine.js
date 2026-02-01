// simulation-engine.js
// Demo SimulationEngine that wires MessagePool.createGeneratorView() + TypingEngine.triggerTyping()
// - Default: useStreamAPI: true (efficient for very large pools)
// - If simulateTypingBeforeSend: true -> manual streaming with typing-before-send delays (more natural, slower)
// - Uses TypingEngine.triggerTyping() when available, otherwise falls back to window._abrox.showTyping()
// - Deterministic option via seedBase
// - Methods: configure, start, stop, simulateBurst, oneShot, simulateOnce, setRng
//
// Notes: When MessagePool.createGeneratorView() exists the engine will prefer it for streaming to avoid allocating huge arrays.

(function globalSimulationEngine(){
  if(window.SimulationEngine) return;
  const DEFAULTS = {
    seedBase: null,               // null -> Math.random; number -> deterministic xorshift32
    msgsPerMin: 45,               // average messages per minute when streaming
    useStreamAPI: true,           // prefer MessagePool.streamToUI()/createGeneratorView().streamToUI() for very large pools
    simulateTypingBeforeSend: true, // manual streaming by default for natural typing
    typingDelayPerCharMs: 40,     // approx ms per character to simulate typing duration
    typingDelayMinMs: 400,        // minimum typing indicator duration
    typingDelayMaxMs: 2500,       // maximum typing indicator duration
    burstChance: 0.12,            // chance at each tick to create a burst
    burstMultiplier: 2.5,         // burst will increase rate by this factor
    manualBatchSize: 1,           // when manual streaming, how many messages to emit at once (usually 1)
    rngWarmSeedOffset: 97         // small offset used for deterministic per-message rng tweaks
  };

  // tiny deterministic PRNG (xorshift32)
  function xorshift32(seed){
    let x = (seed >>> 0) || 0x811c9dc5;
    return function(){
      x |= 0;
      x ^= x << 13; x >>>= 0;
      x ^= x >>> 17; x >>>= 0;
      x ^= x << 5; x >>>= 0;
      return (x >>> 0) / 4294967296;
    };
  }

  function now(){ return Date.now(); }
  function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }
  function sleep(ms){ return new Promise(resolve => setTimeout(resolve, ms)); }

  const Engine = {
    _cfg: Object.assign({}, DEFAULTS),
    _running: false,
    _streamHandle: null,
    _manualLoopPromise: null,
    _rnd: Math.random,
    _manualIndex: 0,

    configure(opts){
      opts = opts || {};
      Object.assign(this._cfg, opts);
      // set RNG
      if(this._cfg.seedBase !== null && this._cfg.seedBase !== undefined){
        this.setRng(this._cfg.seedBase);
      } else {
        this._rnd = Math.random;
      }
      return Object.assign({}, this._cfg);
    },

    setRng(seed){
      if(seed === null || seed === undefined) { this._rnd = Math.random; return; }
      this._cfg.seedBase = Number(seed);
      this._rnd = xorshift32(Number(seed));
    },

    _rand(){ return (typeof this._rnd === 'function') ? this._rnd() : Math.random(); },

    _triggerTyping(names, duration){
      try{
        const dur = Math.max(150, Number(duration) || 800);
        if(window.TypingEngine && typeof window.TypingEngine.triggerTyping === 'function'){
          try{ window.TypingEngine.triggerTyping(names, dur); return; }catch(e){}
        }
        if(window._abrox && typeof window._abrox.showTyping === 'function'){
          try{ window._abrox.showTyping(names); return; }catch(e){}
        }
        const typingRow = document.getElementById && document.getElementById('typingRow');
        const typingText = document.getElementById && document.getElementById('typingText');
        if(typingRow && typingText){
          typingText.textContent = names.length === 1 ? `${names[0]} is typing…` : names.length === 2 ? `${names[0]} and ${names[1]} are typing…` : `${names.length} people are typing…`;
          typingRow.classList.add('active');
          setTimeout(()=> typingRow.classList.remove('active'), dur);
        }
      }catch(e){
        console.warn('SimulationEngine._triggerTyping failed', e);
      }
    },

    _estimateTypingDurationForText(text){
      try{
        if(!text) return this._cfg.typingDelayMinMs;
        const base = Math.max(0, (text.length || 0) * (this._cfg.typingDelayPerCharMs || 40));
        const jitter = Math.floor(this._rand() * 350);
        const dur = clamp(base + jitter, this._cfg.typingDelayMinMs, this._cfg.typingDelayMaxMs);
        return dur;
      }catch(e){
        return this._cfg.typingDelayMinMs;
      }
    },

    async _manualStreamLoop(startIndex){
      this._manualIndex = (typeof startIndex === 'number' && startIndex >= 0) ? Number(startIndex) : 0;
      const ratePerMin = clamp(Number(this._cfg.msgsPerMin) || 45, 1, 5000);
      const avgIntervalMs = Math.round(60000 / ratePerMin);

      this._running = true;
      while(this._running){
        try{
          const isBurst = this._rand() < (this._cfg.burstChance || 0.12);
          const mult = isBurst ? (this._cfg.burstMultiplier || 2.5) : 1;
          const toEmit = Math.max(1, Math.round((this._cfg.manualBatchSize || 1) * mult));

          for(let e=0;e<toEmit && this._running; e++){
            // pick next message using generator view or MessagePool
            let msg = null;
            const poolLen = (window.MessagePool && window.MessagePool.meta && window.MessagePool.meta.size) ? window.MessagePool.meta.size : (window.MessagePool && window.MessagePool.messages && window.MessagePool.messages.length) || 1;
            // prefer generator view if available
            if(window.MessagePool && typeof window.MessagePool.createGeneratorView === 'function'){
              try{
                // create a transient view (cheap) using current meta if needed
                const view = window._simulation_cachedView = window._simulation_cachedView || window.MessagePool.createGeneratorView({ size: window.MessagePool.meta.size || window.MessagePool.meta.size, seedBase: window.MessagePool.meta.seedBase || window.MessagePool.meta.seedBase, spanDays: window.MessagePool.meta.spanDays });
                msg = view.getMessageByIndex(this._manualIndex % (view.size || poolLen));
              }catch(e){}
            } else if(window.MessagePool && typeof window.MessagePool.getMessageByIndex === 'function'){
              msg = window.MessagePool.getMessageByIndex(this._manualIndex % (poolLen));
            }

            this._manualIndex++;

            if(this._cfg.simulateTypingBeforeSend){
              const names = [];
              try{
                if(msg && msg.displayName) names.push(msg.displayName);
                if(this._rand() < 0.35 && window.SyntheticPeople && Array.isArray(window.SyntheticPeople.people) && window.SyntheticPeople.people.length){
                  const rndIdx = Math.floor(this._rand() * window.SyntheticPeople.people.length);
                  const extra = window.SyntheticPeople.people[rndIdx];
                  if(extra && extra.displayName && !names.includes(extra.displayName)) names.push(extra.displayName);
                }
              }catch(e){}
              const typingDur = this._estimateTypingDurationForText((msg && msg.text) ? msg.text : '');
              this._triggerTyping(names.length ? names : ['Someone'], typingDur);
              await sleep(Math.max(120, Math.round(typingDur * (0.75 + this._rand()*0.25))));
            }

            try{
              if(msg){
                window.renderMessage(msg, true);
              }
            }catch(e){
              console.warn('SimulationEngine manual render failed', e);
            }
          }

          const nextMs = Math.max(20, Math.round(avgIntervalMs * (0.6 + this._rand()*0.8)));
          await sleep(nextMs);
        }catch(err){
          console.warn('SimulationEngine manual loop error', err);
          await sleep(500);
        }
      }
    },

    _startStreamAPI(){
      // prefer generator view (no heavy allocation)
      if(window.MessagePool && typeof window.MessagePool.createGeneratorView === 'function'){
        try{
          const view = window._simulation_cachedView = window._simulation_cachedView || window.MessagePool.createGeneratorView({ size: window.MessagePool.meta.size || window.MessagePool.meta.size, seedBase: window.MessagePool.meta.seedBase || window.MessagePool.meta.seedBase, spanDays: window.MessagePool.meta.spanDays });
          const rate = clamp(Number(this._cfg.msgsPerMin) || 45, 1, 5000);
          this._streamHandle = view.streamToUI({
            startIndex: 0,
            ratePerMin: rate,
            jitterMs: Math.round((60000 / rate) * 0.25),
            onEmit: (msg, idx) => {
              if(this._cfg.simulateTypingBeforeSend){
                const names = (msg && msg.displayName) ? [msg.displayName] : ['Someone'];
                const typingDur = clamp(this._estimateTypingDurationForText(msg && msg.text) * 0.6, 200, this._cfg.typingDelayMaxMs);
                this._triggerTyping(names, typingDur);
              }
            }
          });
          this._running = true;
          return;
        }catch(e){
          console.warn('SimulationEngine generator view streaming failed, falling back to MessagePool.streamToUI', e);
        }
      }

      // fallback to MessagePool.streamToUI if available and messages allocated
      if(window.MessagePool && typeof window.MessagePool.streamToUI === 'function'){
        try{
          const rate = clamp(Number(this._cfg.msgsPerMin) || 45, 1, 5000);
          this._streamHandle = window.MessagePool.streamToUI({
            startIndex: 0,
            ratePerMin: rate,
            jitterMs: Math.round((60000 / rate) * 0.25),
            onEmit: (msg, idx) => {
              if(this._cfg.simulateTypingBeforeSend){
                const names = (msg && msg.displayName) ? [msg.displayName] : ['Someone'];
                const typingDur = clamp(this._estimateTypingDurationForText(msg && msg.text) * 0.6, 200, this._cfg.typingDelayMaxMs);
                this._triggerTyping(names, typingDur);
              }
            }
          });
          this._running = true;
          return;
        }catch(e){
          console.warn('SimulationEngine._startStreamAPI failed, falling back to manual', e);
        }
      }

      // final fallback: manual
      return this._startManual();
    },

    _startManual(){
      if(this._running) return;
      this._running = true;
      this._manualLoopPromise = this._manualStreamLoop(0);
    },

    start(){
      if(this._running) return;
      if(this._cfg.useStreamAPI && !this._cfg.simulateTypingBeforeSend){
        this._startStreamAPI();
      } else if(this._cfg.useStreamAPI && this._cfg.simulateTypingBeforeSend){
        // prefer generator-based stream if available but we want typing -> manual gives most realistic typing
        if(window.MessagePool && typeof window.MessagePool.createGeneratorView === 'function'){
          // we still use generator view but simulate typing before each message by wrapping the view
          this._startManual(); // manual still uses generator view internally
        } else {
          this._startManual();
        }
      } else {
        this._startManual();
      }
      return true;
    },

    stop(){
      this._running = false;
      if(this._streamHandle && typeof this._streamHandle.stop === 'function'){
        try{ this._streamHandle.stop(); }catch(e){}
        this._streamHandle = null;
      }
      // manual loop will exit on next iteration because _running=false
      return true;
    },

    async simulateBurst(opts){
      opts = opts || {};
      const size = clamp(Number(opts.size) || 8, 1, 1000);
      const delay = clamp(Number(opts.delay) || 800, 50, 10_000);

      if(this._cfg.simulateTypingBeforeSend || !this._cfg.useStreamAPI || !window.MessagePool){
        for(let i=0;i<size;i++){
          let msg = null;
          const poolLen = (window.MessagePool && window.MessagePool.meta && window.MessagePool.meta.size) ? window.MessagePool.meta.size : (window.MessagePool && window.MessagePool.messages && window.MessagePool.messages.length) || 1;
          if(window.MessagePool && typeof window.MessagePool.createGeneratorView === 'function'){
            const view = window._simulation_cachedView = window._simulation_cachedView || window.MessagePool.createGeneratorView({ size: window.MessagePool.meta.size, seedBase: window.MessagePool.meta.seedBase, spanDays: window.MessagePool.meta.spanDays });
            msg = view.getMessageByIndex(Math.floor(this._rand() * view.size));
          } else if(window.MessagePool && typeof window.MessagePool.getMessageByIndex === 'function'){
            msg = window.MessagePool.getMessageByIndex(Math.floor(this._rand() * poolLen));
          }
          if(msg){
            if(this._cfg.simulateTypingBeforeSend){
              const dur = this._estimateTypingDurationForText(msg.text);
              this._triggerTyping([msg.displayName || msg.name || 'Someone'], dur);
              await sleep(Math.max(120, Math.round(dur * (0.6 + this._rand()*0.4))));
            }
            try{ window.renderMessage(msg, true); }catch(e){ console.warn('simulateBurst render failed', e); }
          }
          await sleep(delay + Math.round(this._rand() * (delay * 0.4)));
        }
        return;
      }

      // efficient path: use generator view streamToUI (stop shortly after)
      try{
        const view = window.MessagePool.createGeneratorView ? window.MessagePool.createGeneratorView({ size: window.MessagePool.meta.size || 1, seedBase: window.MessagePool.meta.seedBase }) : null;
        if(view){
          const startIndex = Math.max(0, Math.floor(this._rand() * (view.size || 1)));
          const stream = view.streamToUI({ startIndex, ratePerMin: Math.max(1, Math.round((size / (delay/1000/60)) || this._cfg.msgsPerMin)), jitterMs: 50 });
          await sleep(Math.max(120, size * (delay / Math.max(1, size))));
          if(stream && typeof stream.stop === 'function') stream.stop();
          return;
        }
      }catch(e){
        console.warn('simulateBurst generator stream failed, falling back', e);
      }

      // last fallback: simulate manually
      for(let i=0;i<size;i++){
        const poolLen = (window.MessagePool && window.MessagePool.messages && window.MessagePool.messages.length) || 1;
        const idx = Math.floor(this._rand() * (poolLen));
        const msg = window.MessagePool ? window.MessagePool.getMessageByIndex(idx) : null;
        if(msg){
          if(this._cfg.simulateTypingBeforeSend){
            const dur = this._estimateTypingDurationForText(msg.text);
            this._triggerTyping([msg.displayName || msg.name || 'Someone'], dur);
            await sleep(Math.max(120, Math.round(dur * (0.6 + this._rand()*0.4))));
          }
          try{ window.renderMessage(msg, true); }catch(e){}
        }
        await sleep(delay + Math.round(this._rand() * (delay * 0.4)));
      }
    },

    async oneShot(index){
      index = Number(index) || 0;
      let msg = null;
      if(window.MessagePool && typeof window.MessagePool.createGeneratorView === 'function'){
        const view = window._simulation_cachedView = window._simulation_cachedView || window.MessagePool.createGeneratorView({ size: window.MessagePool.meta.size || 1, seedBase: window.MessagePool.meta.seedBase });
        msg = view.getMessageByIndex(index % (view.size || 1));
      } else if(window.MessagePool && typeof window.MessagePool.getMessageByIndex === 'function'){
        msg = window.MessagePool.getMessageByIndex(index);
      }
      if(!msg) return null;
      if(this._cfg.simulateTypingBeforeSend){
        const dur = this._estimateTypingDurationForText(msg.text);
        this._triggerTyping([msg.displayName || msg.name || 'Someone'], dur);
        await sleep(Math.max(120, Math.round(dur * (0.75 + this._rand()*0.25))));
      }
      try{ window.renderMessage(msg, true); }catch(e){ console.warn('oneShot render failed', e); }
      return msg;
    },

    simulateOnce(){
      if(this._cfg.useStreamAPI && !this._cfg.simulateTypingBeforeSend && window.MessagePool && typeof window.MessagePool.createGeneratorView === 'function'){
        const view = window._simulation_cachedView = window._simulation_cachedView || window.MessagePool.createGeneratorView({ size: window.MessagePool.meta.size || 1, seedBase: window.MessagePool.meta.seedBase });
        const idx = Math.floor(this._rand() * (view.size || 1));
        return this.oneShot(idx);
      } else {
        return this.simulateBurst({ size: 1, delay: 100 });
      }
    },

    isRunning(){ return !!this._running; },

    getConfig(){ return Object.assign({}, this._cfg); }
  };

  window.SimulationEngine = Engine;
  console.info('SimulationEngine ready — generator view wired if available. simulateTypingBeforeSend is enabled by default.');
})();
