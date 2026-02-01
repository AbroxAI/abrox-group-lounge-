/**
 * simulation-engine.js
 *
 * Orchestrates synthetic people + message bank + TypingEngine to create realistic long-term chat.
 * Exposes window.SimulationEngine with a simple API:
 *   SimulationEngine.init(opts)
 *   SimulationEngine.start()
 *   SimulationEngine.stop()
 *   SimulationEngine.setIntensity(n)   // 0..1 - scale message frequency
 *   SimulationEngine.triggerManual(person, text)
 *
 * It attempts to avoid verbatim repeats by combining templates, synonyms, random numbers, and short ids.
 * It uses TypingEngine.simulate(...) for realistic typing events and calls your UI's postMessage:
 *   window._abrox.postMessage({ name, role, text, out:false })
 *
 * Guarantees / notes:
 * - This is frontend-only simulation. For "years" of non-repeating activity we use combinatorial templates,
 *   randomization, and a rolling seen-set. It's not infinite but produces a huge variety with low repeat risk.
 * - If you have a server later, you can persist `seenSet` to backend to strengthen uniqueness across clients.
 */

(function () {
  if (window.SimulationEngine) return;

  // ---- utilities
  const now = () => Date.now();
  const uuid = () => (crypto && crypto.randomUUID) ? crypto.randomUUID() : ('s' + Math.random().toString(36).slice(2,9));
  const clamp = (v,a,b) => Math.min(Math.max(v,a),b);
  const defaultLog = (...args) => { if (SimulationEngine && SimulationEngine._log) console.debug('[SimEngine]', ...args); };

  // tiny seeded RNG (xorshift32)
  function makeRng(seed) {
    let x = (seed >>> 0) || (Math.floor(Math.random() * 0x7fffffff) >>> 0);
    return function () {
      x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
      return (x >>> 0) / 0x100000000;
    };
  }

  // scheduleInterval that reduces work when page hidden
  function scheduleInterval(fn, ms) {
    let id = setInterval(() => {
      if (document.hidden) return;
      try { fn(); } catch (e) { console.error(e); }
    }, ms);
    return id;
  }

  // ---- MessageBank fallback (if you don't load message-bank.js)
  const DefaultMessageBank = (function () {
    const templates = [
      "Signal alert: {pair} — entry {entry} sl {sl} tp {tp}. Thoughts?",
      "Coming in with {pair}. Using {indicator} — anyone else using this?",
      "Did anyone notice the {pair} divergence on {timeframe}?",
      "I'm adding to my position at {entry}. Risk small, reward big.",
      "Daily analysis: {pair} dipping into demand. Could flip soon.",
      "Sharing indicator: {indicator} updated with new params.",
      "Reminder: never FOMO. Wait for confirmation on {pair}.",
      "Quick poll — scalp or swing on {pair} now?",
      "Update: closed position on {pair} +{pnl}% — re-entering later.",
      "Watching liquidity at {priceLevel}, might see a wick."
    ];

    const pairs = ["BTC/USDT", "ETH/USDT", "SOL/USDT", "XRP/USDT", "ADA/USDT", "DOGE/USDT", "LTC/USDT"];
    const indicators = ["EMA(50/200)", "RSI(14)", "MACD(12,26)", "VWAP", "Ichimoku", "Bollinger Bands"];
    const timeframes = ["1m","5m","15m","1h","4h","1d"];
    const filler = ["🔥","📉","📈","💡","⚠️","✅","🤔","🚀","🔻","🔺"];

    function pick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }

    function generate(rng, person) {
      const t = pick(rng, templates);
      const pair = pick(rng, pairs);
      const indicator = pick(rng, indicators);
      const tf = pick(rng, timeframes);
      const entry = (Math.random() * (40000 - 1000) + 1000).toFixed(2);
      const sl = (entry * (1 - (0.006 + rng()*0.02))).toFixed(4);
      const tp = (entry * (1 + (0.02 + rng()*0.5))).toFixed(2);
      const priceLevel = (Math.round(entry / (10 + Math.floor(rng()*100)))* (1 + (rng()*0.01))).toFixed(2);
      const pnl = (rng()*5 + 0.2).toFixed(2);
      const out = t.replace('{pair}', pair)
        .replace('{indicator}', indicator)
        .replace('{timeframe}', tf)
        .replace('{entry}', entry)
        .replace('{sl}', sl)
        .replace('{tp}', tp)
        .replace('{priceLevel}', priceLevel)
        .replace('{pnl}', pnl);
      // add small persona flourish occasionally
      const suffix = rng() < 0.35 ? (' ' + pick(rng, filler)) : '';
      return out + suffix;
    }

    return { generate };
  })();

  // ---- SimulationEngine core
  const SimulationEngine = {
    _running: false,
    _intervalId: null,
    _rng: makeRng(Math.floor(Math.random()*0x7fffffff)),
    _seed: Math.floor(Math.random()*0x7fffffff),
    _log: false,
    _intensity: 0.28, // 0..1 (how chatty)
    _minTickMs: 2800,
    _maxTickMs: 12000,
    _seenSet: new Set(), // rolling seen messages for de-dup
    _seenQueue: [], // to prune
    _seenLimit: 25000, // keep rolling memory (client-side)
    _typingControllers: new Map(),
    _config: {},
    _people: [], // injected or read from SyntheticPeople
    _messageBank: DefaultMessageBank,
    _lastAdminSpike: 0,

    init(opts = {}) {
      if (opts.seed !== undefined) this._seed = Number(opts.seed) >>> 0;
      this._rng = makeRng(this._seed);
      if (opts.log) this._log = true;
      if (opts.intensity !== undefined) this._intensity = clamp(Number(opts.intensity), 0, 1);
      if (opts.messageBank) this._messageBank = opts.messageBank;
      // prefer supplied people, else attempt to read from SyntheticPeople
      if (opts.people && Array.isArray(opts.people)) this._people = opts.people.slice();
      else if (window.SyntheticPeople && typeof window.SyntheticPeople.getPeople === 'function') this._people = window.SyntheticPeople.getPeople();
      else if (window.SyntheticPeople && Array.isArray(window.SyntheticPeople.people)) this._people = window.SyntheticPeople.people.slice();
      else {
        // attempt to read UI sampleMembers (some index.html store sampleMembers globally)
        try {
          if (window._abrox && window._abrox._sampleMembers) this._people = window._abrox._sampleMembers;
        } catch (e) {}
      }
      defaultLog('init seed', this._seed, 'people', (this._people || []).length);
      return this;
    },

    // set intensity 0..1 - affects message frequency
    setIntensity(n) {
      this._intensity = clamp(Number(n), 0, 1);
      return this;
    },

    // set message bank (optional)
    setMessageBank(bank) {
      this._messageBank = bank || DefaultMessageBank;
      return this;
    },

    // start engine loop
    start() {
      if (this._running) return;
      if (!window.TypingEngine) console.warn('[SimulationEngine] TypingEngine missing — typing realism reduced.');
      if (!window._abrox || typeof window._abrox.postMessage !== 'function') console.warn('[SimulationEngine] UI postMessage not found. Attach window._abrox.postMessage to render messages.');
      this._running = true;
      // immediately seed some chatter
      for (let i=0;i<2;i++) setTimeout(()=> this._maybeSpawn(), 300 + Math.round(this._rng() * 800));
      // schedule loop
      const baseMs = Math.round(this._minTickMs + (1 - this._intensity) * (this._maxTickMs - this._minTickMs));
      this._intervalId = scheduleInterval(() => {
        if (!this._running) return;
        // randomize next spawn chance by intensity and number of people
        this._maybeSpawn();
      }, Math.max(1200, baseMs * 0.85));
      defaultLog('started, interval base', baseMs);
    },

    stop() {
      if (!this._running) return;
      this._running = false;
      if (this._intervalId) { clearInterval(this._intervalId); this._intervalId = null; }
      // cancel typing controllers
      for (const c of this._typingControllers.values()) { try { c.cancel && c.cancel(); } catch(e){} }
      this._typingControllers.clear();
      defaultLog('stopped');
    },

    // choose whether to spawn a message this tick
    _maybeSpawn() {
      // low probability if no people
      if (!this._people || !this._people.length) {
        defaultLog('no people to simulate');
        return;
      }
      // decide spawn chance scaled by intensity
      const chance = 0.12 + this._intensity * 0.6; // chance per tick
      if (this._rng() > chance) return;
      // pick actor
      const person = this._pickActor();
      if (!person) return;
      // admin-triggered spike logic (sometimes admin posts and causes burst)
      if (person.role === 'ADMIN' && (this._rng() < 0.25) && (now() - this._lastAdminSpike > 60000)) {
        this._lastAdminSpike = now();
        this._adminSpike(person);
        return;
      }
      // choose message text
      const text = this._generateMessageFor(person);
      // call typing engine to simulate
      this._startTypingFor(person, text);
    },

    // picks a person biased by role and recency (less fatigued more likely)
    _pickActor() {
      // build weighted list
      const list = [];
      for (const p of this._people) {
        // very light filter: skip "You"
        if (p.name === 'You') continue;
        // presence weighting: if lastActive very old, lower chance
        const lastAge = p.lastActive ? (Date.now() - p.lastActive) : (1000000);
        let w = 1;
        if (p.role === 'ADMIN') w *= 1.6;
        else if (p.role === 'MOD') w *= 1.25;
        else if (p.role === 'VERIFIED') w *= 1.05;
        // penalize very idle
        w *= (lastAge < 90000 ? 1.0 : (lastAge < 300000 ? 0.9 : 0.7));
        // small randomness
        w *= (0.7 + this._rng() * 0.6);
        list.push({ p, w });
      }
      // pick by weight
      const total = list.reduce((s,i)=>s + i.w, 0);
      let r = this._rng() * total;
      for (const it of list) {
        r -= it.w;
        if (r <= 0) return it.p;
      }
      return list.length ? list[list.length-1].p : null;
    },

    // generate message with template, synonyms, numeric tweaks to avoid duplicates
    _generateMessageFor(person) {
      const text = (this._messageBank && this._messageBank.generate)
        ? this._messageBank.generate(this._rng, person)
        : DefaultMessageBank.generate(this._rng, person);

      // add micro-variation: random suffix / tag / short id
      let suffix = '';
      const r = this._rng();
      if (r < 0.28) suffix = ' ' + ['🔥','📈','💬','⚠️','🔁'][Math.floor(this._rng()*5)];
      else if (r < 0.34) suffix = ' #' + Math.floor(100 + this._rng()*890);
      else if (r < 0.38) suffix = ` (${['FYI','Note','Update'][Math.floor(this._rng()*3)]})`;
      // inject timestamp-ish text sometimes
      if (this._rng() < 0.06) suffix += ' • ' + new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});

      const candidate = (text + suffix).trim();

      // de-dup check — if seen recently, mutate further
      let final = candidate;
      let attempts = 0;
      while (this._seenSet.has(final) && attempts < 6) {
        final = candidate + ' ' + String(Math.floor(this._rng() * 9000) + 100);
        attempts++;
      }
      // commit to seen
      this._rememberSeen(final);
      return final;
    },

    _rememberSeen(text) {
      if (!text) return;
      this._seenSet.add(text);
      this._seenQueue.push(text);
      if (this._seenQueue.length > this._seenLimit) {
        const old = this._seenQueue.shift();
        this._seenSet.delete(old);
      }
    },

    // start the TypingEngine simulation for actor + message
    _startTypingFor(person, text) {
      defaultLog('starting typing', person && person.name, text.slice(0,60));
      if (!window.TypingEngine) {
        // instant post fallback
        this._finalizeSend(person, text);
        return;
      }

      // show typing slot: we will manage a small UI stub to display names (typingRow)
      this._showTypingUI(person);

      const controller = window.TypingEngine.simulate(person, text, {
        onEvent: (ev, detail) => {
          // translate events to UI / actions
          if (ev === 'typing:start') {
            this._showTypingUI(person);
          } else if (ev === 'typing:progress') {
            // optionally show partial typed (we won't redrawn message body — only typing row)
            this._updateTypingUI(person, detail.typed);
          } else if (ev === 'typing:pause') {
            this._updateTypingUI(person, null, 'paused');
          } else if (ev === 'typing:abandoned') {
            this._hideTypingUI(person);
          } else if (ev === 'typing:send') {
            this._hideTypingUI(person);
            this._finalizeSend(person, detail.text || text);
          } else if (ev === 'typing:stop') {
            this._hideTypingUI(person);
          }
        },
        mobile: /Mobi|Android|iPhone|iPad|Windows Phone|Opera Mini|LG/i.test(navigator.userAgent || '')
      });

      // store controller so we can cancel if needed
      this._typingControllers.set(controller.id, controller);

      // cleanup when done (best-effort)
      setTimeout(() => {
        if (this._typingControllers.has(controller.id)) this._typingControllers.delete(controller.id);
      }, 60000);
    },

    // finalize send -> call your UI postMessage (non-outgoing)
    _finalizeSend(person, text) {
      const msg = {
        name: person.name || (person.id || 'Member'),
        role: person.role || 'VERIFIED',
        text,
        out: false,
        replyTo: null,
        replyMeta: null
      };
      // if _abrox.postMessage present, use it; else attempt window.postMessage fallback
      try {
        if (window._abrox && typeof window._abrox.postMessage === 'function') {
          window._abrox.postMessage(msg);
        } else if (typeof window.postMessage === 'function') {
          // post to same window (not ideal), but include channel tag
          window.postMessage({ __abrox_sim_message: true, msg }, '*');
        } else {
          console.warn('[SimulationEngine] cannot deliver message to UI — missing _abrox.postMessage');
        }
      } catch (e) { console.error(e); }
    },

    // admin spike: simulate admin posting and then several others quick replies
    _adminSpike(adminPerson) {
      if (!adminPerson) return;
      const headline = this._generateMessageFor(adminPerson);
      defaultLog('admin spike', adminPerson.name, headline);
      this._startTypingFor(adminPerson, headline);
      // schedule quick replies from 3-6 members
      const replyCount = 2 + Math.floor(this._rng() * 4);
      for (let i=0;i<replyCount;i++) {
        setTimeout(() => {
          const replier = this._pickActor();
          if (!replier) return;
          const replyText = this._generateMessageFor(replier);
          this._startTypingFor(replier, replyText);
        }, 600 + Math.round(this._rng() * 4000));
      }
      // bump online count display externally if available
      try { if (window._abrox && typeof window._abrox._bumpOnline === 'function') window._abrox._bumpOnline(10 + Math.floor(this._rng()*30)); } catch(e){}
    },

    // small UI helpers for typingRow control (coexists with your existing typingRow logic)
    _showTypingUI(person) {
      try {
        const typingRow = document.getElementById('typingRow');
        const typingText = document.getElementById('typingText');
        if (!typingRow || !typingText) return;
        // show "X is typing…" or "X and Y are typing…" - keep up to 3 names
        const current = typingText.dataset.names ? JSON.parse(typingText.dataset.names) : [];
        if (!current.includes(person.name)) current.unshift(person.name);
        while (current.length > 3) current.pop();
        typingText.dataset.names = JSON.stringify(current);
        typingText.textContent = current.length === 1 ? `${current[0]} is typing…` : (current.length === 2 ? `${current[0]} and ${current[1]} are typing…` : `3 people are typing…`);
        typingRow.classList.add('active');
        document.getElementById('membersRow') && document.getElementById('membersRow').classList.add('hidden');
      } catch (e) { /* ignore */ }
    },

    _updateTypingUI(person, typedPart, status) {
      // keep minimal: ensure typing row remains visible; optionally we could show a snippet
      // This function is intentionally lightweight to avoid layout thrash.
      this._showTypingUI(person);
    },

    _hideTypingUI(person) {
      try {
        const typingRow = document.getElementById('typingRow');
        const typingText = document.getElementById('typingText');
        if (!typingRow || !typingText) return;
        const current = typingText.dataset.names ? JSON.parse(typingText.dataset.names) : [];
        const idx = current.indexOf(person.name);
        if (idx >= 0) current.splice(idx, 1);
        typingText.dataset.names = JSON.stringify(current);
        if (current.length === 0) {
          typingRow.classList.remove('active');
          document.getElementById('membersRow') && document.getElementById('membersRow').classList.remove('hidden');
        } else {
          typingText.textContent = current.length === 1 ? `${current[0]} is typing…` : `${current[0]} and ${current[1] || 'someone'} are typing…`;
        }
      } catch (e) { /* ignore */ }
    },

    // manual trigger (for debugging / scheduled promotions)
    triggerManual(personOrName, text) {
      let person = null;
      if (typeof personOrName === 'string') person = (this._people || []).find(p => p.name === personOrName);
      else person = personOrName;
      if (!person) {
        person = (this._people && this._people[0]) || { name: 'Member', role: 'VERIFIED' };
      }
      this._startTypingFor(person, text);
    },

    // set or replace people array
    setPeople(arr) { this._people = (Array.isArray(arr) ? arr.slice() : []); return this; },

    // simple sanity inspect
    status() {
      return {
        running: this._running, seed: this._seed, intensity: this._intensity, people: (this._people||[]).length,
        seen: this._seenSet.size
      };
    },

    // expose internal rng for external controls (rare)
    _rngFunc() { return this._rng; }
  };

  // expose globally
  window.SimulationEngine = SimulationEngine;
  // allow chaining init by default
  SimulationEngine.init();

  // small helper to auto-start if explicitly configured in window (opt-in)
  try {
    if (window.__ABROX_SIM_AUTOSTART) { SimulationEngine.start(); }
  } catch (e) {}

})();
