// message-pool.js
// Deterministic, large message pool generator for Abrox chat simulation.
// - Default pool size: 100000 messages (configurable)
// - Deterministic via seedBase so same seed reproduces same messages
// - Templates + tokenization & numeric variety to reduce duplicates
// - Integrates with SyntheticPeople for senders/avatars/roles
// - Methods: generatePool, regenerateAndInject, getMessageByIndex, getRange, pickRandom,
//            streamToUI (simulate live emission), exportToJSON, estimatePoolForDuration, preGenerateTemplates
// - New: createGeneratorView(opts) -> lightweight paging + streamToUI without full pool allocation
//
// Usage (example):
//   MessagePool.generatePool({ size:100000, seedBase:4000, spanDays:730 });
//   const view = MessagePool.createGeneratorView({ size: 100000, seedBase: 4000 });
//   view.getRange(0, 50);
//   view.streamToUI({ startIndex:0, ratePerMin:45, onEmit: (m,i)=> window.renderMessage(m,true) });

(function globalMessagePool(){
  if(window.MessagePool) return;

  /* ---------- small deterministic PRNG (xorshift32) ---------- */
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
  function uid(prefix='msg'){ return prefix + '_' + Math.random().toString(36).slice(2,10); }

  /* ---------- Crypto vocabulary & templates ---------- */
  const TOKENS = ['BTC','ETH','SOL','LTC','DOGE','XRP','ADA','BNB','MATIC','AVAX','DOT','LINK','OP','ARB'];
  const INDICATORS = ['RSI','MACD','EMA50','EMA200','SMA20','OBV','VWAP','Volume'];
  const TIMEFRAMES = ['1m','5m','15m','1h','4h','1d','1w'];
  const ORDERS = ['buy','sell','long','short','swing','scalp','hodl'];
  const COMMON_PHRASES = [
    'Anyone watching {token}?',
    'Set a stop at {stop}.',
    'TP at {tp}.',
    'Looks like accumulation to me.',
    'This looks like a retrace — waiting for confirmation.',
    'FOMO incoming 🚀',
    'Diamond hands.',
    'Paper hands everywhere 😅',
    'Watching the order book — strong sell wall.',
    'Good time to DCA?',
    'That was a nasty wick on the 1h.',
    'Whale alert on {token} 🐳',
    'IIRC that indicator signals reversal.',
    'Use limit orders if you care about price.',
    'The bot produced a noisy signal today.',
    'Anyone sharing indicators? DM me.',
    'This feels like a fakeout.',
    'LFG to the moon 🚀💎',
    'That TA lines up with weekly resistance.',
    'Small position only — too risky for me.'
  ];
  const ATTACH_TITLES = ['chart.png','screenshot.jpg','trade.mp4','report.pdf','indicator.png'];
  const EMOJI = ['🚀','💎','🔥','📉','📈','🤖','🔒','⚠️','✅','❌','🐳'];

  /* ---------- Defaults (tuned for long-run realism) ---------- */
  const DEFAULT = {
    size: 100000,       // default message count
    seedBase: 4000,
    spanDays: 730,      // 2 years
    minWords: 4,
    maxWords: 28,
    replyFraction: 0.06,
    attachmentFraction: 0.04,
    pinnedFraction: 0.0008,
    adminSpeakBoost: 0.04
  };

  /* ---------- Helpers ---------- */
  function pickFrom(arr, rnd) { if(!arr || !arr.length) return null; return arr[Math.floor((typeof rnd === 'function' ? rnd() : Math.random())*arr.length)]; }
  function renderTemplate(template, env){ return template.replace(/\{(\w+)\}/g, (m,k)=> env[k] !== undefined ? env[k] : m); }
  function fmtPrice(v){ return (Math.round(v*100)/100).toLocaleString(); }
  function fmtPercent(p){ return (Math.round(p*100)/100).toFixed(2) + '%'; }

  function randPriceForToken(token, rnd){
    let base = 100 * (1 + (token.charCodeAt(0) % 7));
    if(token === 'BTC') base = 30000;
    if(token === 'ETH') base = 2000;
    if(token === 'DOGE') base = 0.08;
    const jitter = ((typeof rnd === 'function' ? rnd() : Math.random())-0.5) * base * 0.12;
    return Math.max(0.0001, base + jitter);
  }

  // FNV-ish content hash (fast, deterministic)
  function contentHash(s){
    let h = 2166136261 >>> 0;
    for(let i=0;i<s.length;i++){
      h ^= s.charCodeAt(i);
      h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
    }
    return (h >>> 0).toString(16);
  }

  // small LRU for dedupe tracking
  function makeLRU(cap){
    const keys = [], set = new Set();
    return {
      has(k){ return set.has(k); },
      push(k){
        if(set.has(k)) return;
        keys.push(k); set.add(k);
        while(keys.length > cap){
          const rem = keys.shift(); set.delete(rem);
        }
      }
    };
  }

  /* ---------- MessagePool Implementation ---------- */
  const MessagePool = {
    messages: [],
    meta: Object.assign({}, DEFAULT),

    // generate message for index i deterministically
    _generateMessageForIndex(i, opts){
      opts = opts || {};
      const seedBase = Number(opts.seedBase || this.meta.seedBase || DEFAULT.seedBase);
      const rnd = xorshift32(seedBase + (i * 15721)); // deterministic per-index PRNG

      // pick sender from SyntheticPeople if available
      let sender = null;
      const sp = (window.SyntheticPeople && Array.isArray(window.SyntheticPeople.people) && window.SyntheticPeople.people.length) ? window.SyntheticPeople : null;
      if(sp){
        // bias toward more active accounts (simple deterministic selection)
        const idx = Math.floor(rnd() * sp.people.length);
        sender = sp.people[idx];
      } else {
        sender = { name: 'Member_' + ((i % 5000) + 1), displayName: 'Member ' + ((i % 5000) + 1), role: 'VERIFIED', avatar: '' };
      }

      // template env
      const token = pickFrom(TOKENS, rnd);
      const indicator = pickFrom(INDICATORS, rnd);
      const timeframe = pickFrom(TIMEFRAMES, rnd);
      const order = pickFrom(ORDERS, rnd);

      const price = randPriceForToken(token, rnd);
      const tp = fmtPrice(price * (1 + (rnd()*0.08 + 0.02)));
      const stop = fmtPrice(price * (1 - (rnd()*0.12 + 0.01)));
      const pct = fmtPercent((rnd()-0.5) * 20);

      const env = { token, indicator, timeframe, order, tp, stop, pct };

      // choose template family
      const tPick = rnd();
      let text = '';
      if(tPick < 0.42){
        // direct phrase template
        const tpl = pickFrom(COMMON_PHRASES, rnd);
        text = renderTemplate(tpl, env);
      } else if(tPick < 0.72){
        // chatty/noisy message
        const words = Math.floor(rnd()*(this.meta.maxWords - this.meta.minWords) + this.meta.minWords);
        const parts = [];
        for(let w=0; w<words; w++){
          if(rnd() < 0.13) parts.push(pickFrom(TOKENS, rnd));
          else if(rnd() < 0.11) parts.push(pickFrom(EMOJI, rnd));
          else {
            parts.push(pickFrom(['check','signal','buy','sell','watch','nice','yikes','rekt','hold','wait','now','looks'], rnd));
          }
        }
        text = parts.join(' ');
      } else if(tPick < 0.87){
        // trade/report style
        text = `${sender.displayName.split(' ')[0]} posted: ${token} ${order} @ ${fmtPrice(price)} — TP ${tp} / SL ${stop} (${pct})`;
      } else {
        // question/callout
        const q = pickFrom(['Anyone got thoughts on {token}?','Who else is holding {token}?','Is {indicator} bearish on {timeframe}?','Just saw a whale move on {token}'], rnd);
        text = renderTemplate(q, env);
      }

      // attachments
      const hasAttachment = rnd() < (opts.attachmentFraction || this.meta.attachmentFraction);
      const attachment = hasAttachment ? pickFrom(ATTACH_TITLES, rnd) : null;

      // replies (deterministic earlier index)
      const isReply = rnd() < (opts.replyFraction || this.meta.replyFraction);
      let replyTo = null;
      if(isReply && i > 8){
        const offset = 2 + Math.floor(rnd() * Math.min(500, i - 2));
        replyTo = 'msg_' + (i - offset);
      }

      // pinned (rare)
      const pinned = rnd() < (opts.pinnedFraction || this.meta.pinnedFraction);

      // timestamp distribution across spanDays
      const now = Date.now();
      const spanDays = Number(opts.spanDays || this.meta.spanDays || DEFAULT.spanDays);
      const frac = i / Math.max(1, (opts.size || this.meta.size || DEFAULT.size));
      const earliest = now - spanDays * 86400000; // careful: 86400000 = 24*60*60*1000
      const jitter = (rnd() - 0.5) * 3600000; // up to ±1h jitter
      const time = Math.round(earliest + frac * (spanDays * 86400000) + jitter);

      // small safety: ensure not tiny text
      if(text.length < 6) text += ' ' + pickFrom(EMOJI, rnd);

      // final message object
      const msg = {
        id: 'msg_' + (i+1),
        name: sender.name || sender.displayName || ('Member_' + ((i%5000)+1)),
        displayName: sender.displayName || sender.name,
        role: sender.role || 'VERIFIED',
        avatar: sender.avatar || '',
        text: text,
        out: false,
        time: time,
        replyTo: replyTo,
        pinned: pinned,
        attachment: hasAttachment ? { filename: attachment, url: (/\.(png|jpe?g)$/i.test(attachment || '') ? 'assets/' + attachment : '') } : null
      };

      return msg;
    },

    // generate the full pool (dedupe LRU applied)
    generatePool(opts){
      opts = opts || {};
      const size = clamp(Number(opts.size || this.meta.size || DEFAULT.size), 50, 500000);
      const seedBase = Number(opts.seedBase || this.meta.seedBase || DEFAULT.seedBase);
      const spanDays = Number(opts.spanDays || this.meta.spanDays || DEFAULT.spanDays);

      this.meta.size = size;
      this.meta.seedBase = seedBase;
      this.meta.spanDays = spanDays;

      const lru = makeLRU(2048);
      const arr = new Array(size);
      for(let i=0;i<size;i++){
        let m = this._generateMessageForIndex(i, { size, seedBase, spanDays, replyFraction: this.meta.replyFraction, attachmentFraction: this.meta.attachmentFraction });
        // dedupe attempts
        let attempts = 0;
        let h = contentHash(m.text);
        while(lru.has(h) && attempts < 6){
          // regenerate with slight seed tweak to vary wording
          const alt = this._generateMessageForIndex(i + attempts + 1, { size, seedBase: seedBase + attempts + 1, spanDays });
          // FIX: pass a RNG function into pickFrom (not a numeric sample)
          m.text = alt.text + ((attempts % 2 === 0) ? (' ' + pickFrom(EMOJI, xorshift32(seedBase + attempts + i))) : '');
          h = contentHash(m.text);
          attempts++;
        }
        lru.push(h);
        arr[i] = m;
      }

      this.messages = arr;
      // id -> index quick map
      this._idIndex = {};
      for(let i=0;i<this.messages.length;i++) this._idIndex[this.messages[i].id] = i;
      return this.messages;
    },

    // regenerate & optionally inject an initial window into UI
    async regenerateAndInject(opts){
      opts = opts || {};
      const pool = this.generatePool(opts);
      if(opts.inject && typeof window.renderMessage === 'function'){
        const initial = Math.min(pool.length, opts.initialCount || 40);
        for(let i=0;i<initial;i++){
          try{ window.renderMessage(pool[i], false); }catch(e){ console.warn('renderMessage failed', e); }
        }
      }
      return pool;
    },

    getMessageByIndex(i){
      if(this.messages && this.messages.length){
        if(i < 0 || i >= this.messages.length) return null;
        return this.messages[i];
      }
      // if no messages array allocated, create on-the-fly using meta
      if(typeof i !== 'number' || i < 0) return null;
      return this._generateMessageForIndex(i, { size: this.meta.size, seedBase: this.meta.seedBase, spanDays: this.meta.spanDays });
    },

    // existing getRange (works against allocated pool)
    getRange(start, count){
      if(this.messages && this.messages.length) {
        start = clamp(start,0, Math.max(0,this.messages.length-1));
        count = clamp(count,0,this.messages.length-start);
        return this.messages.slice(start, start+count);
      }
      // generate on-demand
      start = clamp(start, 0, Math.max(0,(this.meta.size||DEFAULT.size)-1));
      count = clamp(count, 0, (this.meta.size||DEFAULT.size) - start);
      const out = [];
      for(let i=0;i<count;i++){
        out.push(this._generateMessageForIndex(start + i, { size: this.meta.size, seedBase: this.meta.seedBase, spanDays: this.meta.spanDays }));
      }
      return out;
    },

    pickRandom(filter){ 
      const pool = filter ? (this.messages && this.messages.length ? this.messages.filter(filter) : null) : (this.messages && this.messages.length ? this.messages : null);
      if(pool && pool.length) return pool[Math.floor(Math.random()*pool.length)];
      // fallback: try generating a random index
      const size = this.meta.size || DEFAULT.size;
      const idx = Math.floor(Math.random() * size);
      return this.getMessageByIndex(idx);
    },

    // stream messages to UI like a live feed (existing array-based implementation)
    // opts: { startIndex, ratePerMin, jitterMs, onEmit(msg,idx) }
    streamToUI(opts){
      opts = opts || {};
      if(!this.messages || !this.messages.length){
        console.warn('MessagePool.streamToUI: no messages generated yet.');
        return { stop: ()=>{} };
      }
      const start = clamp(Number(opts.startIndex || 0), 0, this.messages.length-1);
      const ratePerMin = clamp(Number(opts.ratePerMin || 45), 1, 2000); // default 45/min
      const intervalMs = Math.round(60000 / ratePerMin); // careful bucket math
      const jitter = Number(opts.jitterMs || Math.round(intervalMs * 0.25));
      let idx = start;
      let stopped = false;
      const timer = setInterval(()=>{
        if(stopped) return;
        const m = this.messages[idx];
        if(m){
          try{ if(typeof opts.onEmit === 'function') opts.onEmit(m, idx); else window.renderMessage(m, true); }catch(e){ console.warn('renderMessage error', e); }
        }
        idx++;
        if(idx >= this.messages.length){
          // loop but start at random offset to avoid immediate repeat patterns
          idx = Math.max(0, Math.floor(Math.random() * Math.min(1000, this.messages.length)));
        }
      }, Math.max(20, intervalMs + (Math.random() * jitter - jitter/2)));

      return { stop: function(){ stopped = true; clearInterval(timer); } };
    },

    // NEW: create a generator view that generates messages on demand and provides lightweight paging + stream
    // opts: { size, seedBase, spanDays, attachmentFraction, replyFraction }
    createGeneratorView(opts){
      opts = opts || {};
      const size = clamp(Number(opts.size || this.meta.size || DEFAULT.size), 1, 10_000_000);
      const seedBase = Number(opts.seedBase || this.meta.seedBase || DEFAULT.seedBase);
      const spanDays = Number(opts.spanDays || this.meta.spanDays || DEFAULT.spanDays);
      const replyFraction = Number(opts.replyFraction || this.meta.replyFraction || DEFAULT.replyFraction);
      const attachmentFraction = Number(opts.attachmentFraction || this.meta.attachmentFraction || DEFAULT.attachmentFraction);

      // generator object
      const self = this;
      let streamTicker = null;
      let stopped = false;

      return {
        size,
        seedBase,
        spanDays,
        getMessageByIndex(i){
          if(typeof i !== 'number' || i < 0) return null;
          return self._generateMessageForIndex(i, { size, seedBase, spanDays, replyFraction, attachmentFraction });
        },
        getRange(start, count){
          start = clamp(Number(start) || 0, 0, Math.max(0, size-1));
          count = clamp(Number(count) || 0, 0, Math.max(0, size - start));
          const out = [];
          for(let j=0;j<count;j++){
            out.push(self._generateMessageForIndex(start + j, { size, seedBase, spanDays, replyFraction, attachmentFraction }));
          }
          return out;
        },
        // streamToUI similar API to MessagePool.streamToUI but generates on the fly
        // opts: { startIndex, ratePerMin, jitterMs, onEmit(msg,idx) }
        streamToUI(opts){
          opts = opts || {};
          const startIndex = clamp(Number(opts.startIndex || 0), 0, Math.max(0,size-1));
          const ratePerMin = clamp(Number(opts.ratePerMin || 45), 1, 5000);
          const intervalMs = Math.round(60000 / ratePerMin);
          const jitter = Number(opts.jitterMs || Math.round(intervalMs * 0.25));
          let idx = startIndex;
          stopped = false;
          const timer = setInterval(()=>{
            if(stopped) return;
            const m = self._generateMessageForIndex(idx % size, { size, seedBase, spanDays, replyFraction, attachmentFraction });
            if(m){
              try{ if(typeof opts.onEmit === 'function') opts.onEmit(m, idx); else window.renderMessage(m, true); }catch(e){ console.warn('generator view render error', e); }
            }
            idx++;
            if(idx >= size){
              idx = Math.max(0, Math.floor(Math.random() * Math.min(1000, size)));
            }
          }, Math.max(20, intervalMs + (Math.random() * jitter - jitter/2)));

          return { stop: function(){ stopped = true; clearInterval(timer);} };
        },
        // synchronous iterator for pages (useful for UI virtual lists)
        createPageIterator(pageSize){
          pageSize = Math.max(1, Math.floor(pageSize || 50));
          let page = 0;
          return {
            next(){ const start = page * pageSize; const out = []; for(let i=0;i<pageSize && start+i < size;i++) out.push(self._generateMessageForIndex(start + i, { size, seedBase, spanDays, replyFraction, attachmentFraction })); page++; return { value: out, done: start >= size }; },
            reset(){ page = 0; }
          };
        }
      };
    },

    // export to JSON (careful — large)
    exportToJSON(opts){ opts = opts || {}; const start = clamp(Number(opts.start || 0), 0, this.messages.length); const end = clamp(Number(opts.end || this.messages.length), start, this.messages.length); return JSON.stringify(this.messages.slice(start,end)); },

    findById(id){ return (this._idIndex && this._idIndex[id] !== undefined) ? this.messages[this._idIndex[id]] : null; },

    // estimate pool size needed for a given duration and rate (useful for planning non-duplicate coverage)
    // msgsPerMin: average messages per minute; durationDays: total days to cover; avgMsgsPerPersonPerDay: expected messages per person/day
    estimatePoolForDuration({ msgsPerMin = 45, durationDays = 365 * 2, avgMsgsPerPersonPerDay = 5 } = {}){
      const totalMsgs = msgsPerMin * 60 * 24 * durationDays; // total messages over period
      const estimatedPeople = Math.ceil(totalMsgs / (avgMsgsPerPersonPerDay * durationDays));
      return { totalMsgs, estimatedPeople };
    },

    // pre-generate templated sentence fragments to inspect variety (no full pool allocation)
    preGenerateTemplates(count, opts){
      opts = opts || {};
      const size = clamp(Number(count) || 500, 1, 200000);
      const seedBase = Number(opts.seedBase || this.meta.seedBase || DEFAULT.seedBase);
      const out = [];
      for(let i=0;i<size;i++){
        const m = this._generateMessageForIndex(i, { size, seedBase, spanDays: opts.spanDays || this.meta.spanDays });
        out.push(m.text);
      }
      return out;
    }
  };

  // attach globally
  window.MessagePool = MessagePool;

  // quick sanity: if SyntheticPeople exists and message pool empty, create a small sample preview
  setTimeout(()=>{
    try{
      if(window.SyntheticPeople && (!window.MessagePool.messages || !window.MessagePool.messages.length)){
        MessagePool.generatePool({ size: 500, seedBase: MessagePool.meta.seedBase, spanDays: MessagePool.meta.spanDays });
        if(window.renderMessage){
          const initial = Math.min(20, MessagePool.messages.length);
          for(let i=0;i<initial;i++) try{ window.renderMessage(MessagePool.messages[i], false); }catch(e){}
        }
      }
    }catch(e){
      console.warn('MessagePool auto-sanity failed', e);
    }
  }, 250);

})();
