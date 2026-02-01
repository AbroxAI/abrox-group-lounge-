// simulation-engine.js
// Demo SimulationEngine that wires MessagePool.streamToUI(), TypingEngine.triggerTyping()
// and optionally uses MessagePool.createGeneratorView() for memory-light paging.
// - Default: useStreamAPI: true, simulateTypingBeforeSend: true
// - Deterministic: configure({ seedBase })
//
// API:
//   SimulationEngine.configure(opts)
//   SimulationEngine.start()
//   SimulationEngine.stop()
//   SimulationEngine.isRunning()
//   SimulationEngine.previewOnce(count)
//   SimulationEngine.emitOnce(idx)  // emit a single message by index (for tests)

(function globalSimulationEngine(){
  if(window.SimulationEngine) return;

  // small xorshift PRNG for deterministic behaviour when seedBase provided
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

  function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }

  const DEFAULTS = {
    seedBase: null,               // null => non-deterministic Math.random
    useStreamAPI: true,           // prefer streaming from MessagePool for huge pools
    simulateTypingBeforeSend: true, // show typing indicator before emit
    msgsPerMin: 45,               // emission rate when streaming locally/emulation
    typingBeforeMsMin: 400,       // typing indicator min duration (ms)
    typingBeforeMsMax: 1800,      // typing indicator max duration (ms)
    burstChance: 0.08,            // chance a message event emits small burst instead of single msg
    burstSizeMin: 2,
    burstSizeMax: 4,
    generatorPageSize: 200        // when createGeneratorView used, page size
  };

  let cfg = Object.assign({}, DEFAULTS);
  let running = false;
  let rng = Math.random;
  let streamController = null;    // for streamToUI stop handle
  let localTimer = null;         // fallback timer when not using MessagePool.streamToUI
  let nextIndex = 0;             // next index to emit when using local generation
  let generatorView = null;      // view returned by MessagePool.createGeneratorView
  let generatorPage = null;      // current page buffer
  let generatorPageIdx = 0;      // index within current buffer
  let generatorPageStart = 0;    // absolute index of page start

  // internal helper: choose typing hook
  function showTyping(names, duration){
    try{
      if(window.TypingEngine && typeof window.TypingEngine.triggerTyping === 'function'){
        try{ window.TypingEngine.triggerTyping(names, duration); return; }catch(e){}
      }
      if(window._abrox && typeof window._abrox.showTyping === 'function'){
        try{ window._abrox.showTyping(names); return; }catch(e){}
      }
      // fallback: console
      console.debug('Typing:', names, 'for', duration);
    }catch(e){}
  }

  // getMessageAt: prefer generatorView -> MessagePool.getRange -> MessagePool._generateMessageForIndex (if exposed)
  function getMessageAt(idx){
    // generator view: if present, ensure page loaded
    try{
      if(generatorView && typeof generatorView.get === 'function'){
        const itm = generatorView.get(idx);
        if(itm) return Promise.resolve(itm);
      }
    }catch(e){ console.warn('generatorView.get failed', e); }

    // fallback: MessagePool.getRange
    if(window.MessagePool && typeof window.MessagePool.getRange === 'function'){
      try{
        const arr = window.MessagePool.getRange(idx, 1);
        if(arr && arr.length) return Promise.resolve(arr[0]);
      }catch(e){ console.warn('MessagePool.getRange failed', e); }
    }

    // last fallback: if MessagePool exposes a generator function _generateMessageForIndex (internal)
    if(window.MessagePool && typeof window.MessagePool._generateMessageForIndex === 'function'){
      try{
        return Promise.resolve(window.MessagePool._generateMessageForIndex(idx, {}));
      }catch(e){ console.warn('MessagePool._generateMessageForIndex failed', e); }
    }

    return Promise.resolve(null);
  }

  // helper: emit a single message to UI (renderMessage) with optional typing simulation
  async function emitMessageWithTyping(msg){
    if(!msg) return;
    // optionally simulate typing
    if(cfg.simulateTypingBeforeSend){
      const who = (msg.displayName || msg.name || 'Someone');
      const duration = Math.max(cfg.typingBeforeMsMin, Math.floor(cfg.typingBeforeMsMin + rng() * (cfg.typingBeforeMsMax - cfg.typingBeforeMsMin)));
      showTyping([who], duration);
      await new Promise(r => setTimeout(r, duration + 40));
    }
    // render
    try{
      if(typeof window.renderMessage === 'function'){
        window.renderMessage(msg, true);
      } else {
        console.warn('renderMessage not available to emit message');
      }
    }catch(e){ console.warn('emitMessage render failed', e); }
  }

  // local stream loop (when not using MessagePool.streamToUI)
  function startLocalLoop(){
    stopLocalLoop();
    const intervalMs = Math.max(20, Math.round(60000 / clamp(cfg.msgsPerMin, 1, 5000)));
    localTimer = setInterval(async ()=>{
      try{
        if(!running) return;
        // burst vs single
        if(rng() < cfg.burstChance){
          const burstSize = Math.floor(cfg.burstSizeMin + rng() * (cfg.burstSizeMax - cfg.burstSizeMin + 1));
          for(let i=0;i<burstSize;i++){
            const idx = nextIndex++;
            const msg = await getMessageAt(idx);
            if(msg) await emitMessageWithTyping(msg);
          }
        } else {
          const idx = nextIndex++;
          const msg = await getMessageAt(idx);
          if(msg) await emitMessageWithTyping(msg);
        }
      }catch(e){ console.warn('localLoop error', e); }
    }, intervalMs);
    return localTimer;
  }

  function stopLocalLoop(){
    if(localTimer){ clearInterval(localTimer); localTimer = null; }
  }

  // when using MessagePool.streamToUI: call streamToUI with a hook that triggers TypingEngine for "typing before send" if requested.
  // We cannot intercept internal streamToUI emission easily, but we can mimic typing by scheduling TypingEngine.triggerTyping() at intervals that align with rate.
  function startStreamedMode(){
    stopStreamedMode();
    if(!window.MessagePool || typeof window.MessagePool.streamToUI !== 'function'){
      console.warn('MessagePool.streamToUI unavailable — falling back to local loop.');
      return startLocalLoop();
    }

    // If simulateTypingBeforeSend is false, just delegate to streamToUI directly.
    if(!cfg.simulateTypingBeforeSend){
      streamController = window.MessagePool.streamToUI({
        startIndex: nextIndex,
        ratePerMin: cfg.msgsPerMin,
        jitterMs: Math.round(60000/cfg.msgsPerMin*0.25),
        onEmit: (m, idx) => { nextIndex = idx + 1; } // keep nextIndex in sync
      });
      return streamController;
    }

    // If simulateTypingBeforeSend is true, we cannot easily intercept streamToUI to delay emission,
    // so we create our own lightweight streaming by using MessagePool.getRange or createGeneratorView in pages.
    // Use createGeneratorView if available for efficiency.
    if(window.MessagePool && typeof window.MessagePool.createGeneratorView === 'function'){
      try{
        generatorView = window.MessagePool.createGeneratorView({ pageSize: cfg.generatorPageSize, seedBase: cfg.seedBase, spanDays: (window.MessagePool.meta && window.MessagePool.meta.spanDays) || undefined });
        generatorPage = null;
        generatorPageIdx = 0;
        generatorPageStart = nextIndex;
        // set up local loop but this time drawing from generatorView pages (efficient paging)
        stopLocalLoop();
        const intervalMs = Math.max(20, Math.round(60000 / clamp(cfg.msgsPerMin, 1, 5000)));
        localTimer = setInterval(async ()=>{
          try{
            if(!running) return;
            // refill page buffer if exhausted
            if(!generatorPage || generatorPageIdx >= generatorPage.length){
              generatorPageStart = nextIndex;
              generatorPage = generatorView.nextPage(generatorPageStart);
              generatorPageIdx = 0;
              if(!generatorPage || !generatorPage.length){
                // no page available -> attempt to wrap to 0
                nextIndex = 0;
                generatorPageStart = nextIndex;
                generatorPage = generatorView.nextPage(generatorPageStart);
                generatorPageIdx = 0;
                if(!generatorPage || !generatorPage.length) return;
              }
            }

            // emit one or burst
            if(rng() < cfg.burstChance){
              const burstSize = Math.floor(cfg.burstSizeMin + rng() * (cfg.burstSizeMax - cfg.burstSizeMin + 1));
              for(let i=0;i<burstSize;i++){
                if(generatorPageIdx >= generatorPage.length){ break; }
                const msg = generatorPage[generatorPageIdx++];
                nextIndex++;
                if(msg) await emitMessageWithTyping(msg);
              }
            } else {
              if(generatorPageIdx < generatorPage.length){
                const msg = generatorPage[generatorPageIdx++];
                nextIndex++;
                if(msg) await emitMessageWithTyping(msg);
              }
            }
          }catch(e){ console.warn('streamedMode (generator) inner error', e); }
        }, intervalMs);
        return localTimer;
      }catch(e){
        console.warn('generatorView streaming failed, falling back to getRange/local loop', e);
      }
    }

    // fallback: stream by repeatedly calling MessagePool.getRange( nextIndex, 1 ) in intervals
    stopLocalLoop();
    const intervalMs = Math.max(20, Math.round(60000 / clamp(cfg.msgsPerMin, 1, 5000)));
    localTimer = setInterval(async ()=>{
      try{
        if(!running) return;
        if(rng() < cfg.burstChance){
          const burstSize = Math.floor(cfg.burstSizeMin + rng() * (cfg.burstSizeMax - cfg.burstSizeMin + 1));
          for(let i=0;i<burstSize;i++){
            const idx = nextIndex++;
            const arr = window.MessagePool.getRange(idx, 1);
            const msg = arr && arr[0];
            if(msg) await emitMessageWithTyping(msg);
          }
        } else {
          const idx = nextIndex++;
          const arr = window.MessagePool.getRange(idx, 1);
          const msg = arr && arr[0];
          if(msg) await emitMessageWithTyping(msg);
        }
      }catch(e){ console.warn('streamToUI fallback local loop error', e); }
    }, intervalMs);
    return localTimer;
  }

  function stopStreamedMode(){
    if(streamController && typeof streamController.stop === 'function'){ try{ streamController.stop(); }catch(e){} }
    streamController = null;
    // stop any local timers
    stopLocalLoop();
  }

  /* ---------- Public API ---------- */
  const SimulationEngine = {
    configure(opts){
      opts = opts || {};
      if(opts.seedBase !== undefined && opts.seedBase !== null){
        cfg.seedBase = Number(opts.seedBase);
        rng = xorshift32(cfg.seedBase);
      } else {
        // if user cleared seedBase, revert to Math.random
        if(opts.seedBase === null) rng = Math.random;
      }

      // shallow merge of other opts
      const keys = ['useStreamAPI','simulateTypingBeforeSend','msgsPerMin','typingBeforeMsMin','typingBeforeMsMax','burstChance','burstSizeMin','burstSizeMax','generatorPageSize'];
      keys.forEach(k => { if(opts[k] !== undefined) cfg[k] = opts[k]; });

      return Object.assign({}, cfg);
    },

    start(){
      if(running) return;
      running = true;
      // ensure rng respects current seedBase
      if(cfg.seedBase !== null && cfg.seedBase !== undefined) rng = xorshift32(cfg.seedBase);
      else rng = Math.random;

      // initialize nextIndex (if MessagePool has state, try to resume near newest)
      if(window.MessagePool && Array.isArray(window.MessagePool.messages) && window.MessagePool.messages.length){
        // start near end if not previously set, to simulate "recent messages"
        if(nextIndex <= 0) nextIndex = Math.max(0, window.MessagePool.messages.length - 60);
      } else {
        if(nextIndex <= 0) nextIndex = 0;
      }

      // if useStreamAPI and streamToUI present, try to start streamed mode
      if(cfg.useStreamAPI && window.MessagePool && typeof window.MessagePool.streamToUI === 'function'){
        startStreamedMode();
      } else {
        // fallback: local loop that reads messages individually
        startLocalLoop();
      }

      console.info('SimulationEngine started', cfg);
    },

    stop(){
      if(!running) return;
      running = false;
      stopStreamedMode();
      stopLocalLoop();
      console.info('SimulationEngine stopped');
    },

    isRunning(){ return !!running; },

    // emit a single message by absolute index (useful for tests)
    async emitOnce(index){
      if(typeof index !== 'number') { console.warn('emitOnce expects numeric index'); return null; }
      const m = await getMessageAt(index);
      if(m) await emitMessageWithTyping(m);
      return m;
    },

    // preview N messages synchronously using best available read API
    previewOnce(count){
      count = clamp(Number(count) || 20, 1, 1000);
      if(window.MessagePool && typeof window.MessagePool.preGenerateTemplates === 'function'){
        try{
          return window.MessagePool.preGenerateTemplates(count, { seedBase: cfg.seedBase, spanDays: (window.MessagePool.meta && window.MessagePool.meta.spanDays) || undefined });
        }catch(e){ console.warn('preGenerateTemplates failed', e); }
      }
      // fallback: synchronous getRange
      if(window.MessagePool && typeof window.MessagePool.getRange === 'function'){
        try{ return window.MessagePool.getRange(0, count); }catch(e){}
      }
      return [];
    },

    // reset internal index to a specific value
    seekTo(index){
      nextIndex = Math.max(0, Number(index) || 0);
      // clear generator caches so streaming will reflect new index
      generatorView = null; generatorPage = null; generatorPageIdx = 0; generatorPageStart = nextIndex;
    }
  };

  // attach the engine
  window.SimulationEngine = SimulationEngine;

  // auto-configure: default deterministic seed if MessagePool has a seed
  setTimeout(()=>{
    try{
      if(window.MessagePool && window.MessagePool.meta && window.MessagePool.meta.seedBase){
        SimulationEngine.configure({ seedBase: window.MessagePool.meta.seedBase });
      } else {
        // keep default (non-deterministic)
      }
    }catch(e){}
  }, 200);

  console.info('SimulationEngine loaded — call SimulationEngine.configure(...) then .start() to run.');

})();
