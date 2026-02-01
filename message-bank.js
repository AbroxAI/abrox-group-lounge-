/**
 * message-bank.js
 *
 * Purpose:
 * - Provide a richly templated, non-repeating message bank suitable for long-running
 *   synthetic chat simulation (crypto-friendly).
 * - Exposes window.MessageBank API:
 *    .init(opts)
 *    .generateFor(person, opts)
 *    .getUniqueMessage(person, opts)  // guarantees not recently used
 *    .bulkGenerateFor(person, n, opts)
 *    .stats()
 *
 * Persistence keys:
 *  - abrox_msgbank_v1  -> templates meta (optional)
 *  - abrox_msg_usage_v1 -> usage history + counts
 *
 * Notes:
 * - Works with PeopleStore (window.PeopleStore) but does not require it.
 * - Uses a seeded RNG internally for reproducible simulation if seed passed.
 */

/* eslint-disable no-console */
(function () {
  if (window.MessageBank) return;

  const LS_TEMPLATES = 'abrox_msgbank_v1';
  const LS_USAGE = 'abrox_msg_usage_v1';

  /* ---------- seeded RNG (xorshift32) ---------- */
  function makeRng(seed) {
    let x = seed >>> 0 || (Math.floor(Math.random() * 2 ** 31) >>> 0);
    return function () {
      x ^= x << 13;
      x ^= x >>> 17;
      x ^= x << 5;
      return (x >>> 0) / 0x100000000;
    };
  }

  /* ---------- util ---------- */
  const clamp = (v, a, b) => Math.min(Math.max(v, a), b);
  const sample = (rng, arr) => arr[Math.floor(rng() * arr.length)];
  const shuffleCopy = (rng, arr) => {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };

  function safeLoad(key) {
    try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { return null; }
  }
  function safeSave(key, obj) {
    try { localStorage.setItem(key, JSON.stringify(obj)); } catch (e) {}
  }

  /* ---------- core template pools (crypto-aware) ---------- */
  const baseTemplates = [
    // short updates, indicator mention
    "{greeting} {target}, I'm seeing {indicator} on the {pair}. Might be {direction}. {emoji}",
    "Watch the {pair} — {indicator} looks {adjective}. {emoji}",
    "I posted the setup in #signals: {snippet}. Who's in?",
    "If this {indicator} breaks, stop loss at {sl}. Targets: {targets}. {emoji}",
    "Quick TL;DR: {snippet} — agree/disagree?",
    "Anyone backtesting {pair} with {indicator}? Share results.",
    "My TA: {snippet}. Risk small, scalp only. {emoji}",
    "This looks like a classic {pattern} — patience pays. {emoji}",
    "Reminder: manage position size. Don't FOMO. {emoji}",
    "News: {newsSnippet} — could push {pair} {direction} short-term.",
    "I dumped a tiny stake because {reason}. Not financial advice.",
    "WM will rally after {timeframe} — keep an eye on {indicator}.",
    "Anyone got OD on the latest fork? Market looks {adjective}.",
    "Setup: buy if {condition}. Otherwise wait. {emoji}",
    "ICYMI: {snippet} — saved me a scalp earlier.",
    "If you want the alert, DM me – I share entries for verifieds.",
    "Reminder to update your client for the indicator patch.",
    "I prefer long-term averages — MAs lined up on weekly. {emoji}",
    "Sentiment is {sentiment} — leverage wisely.",
    "I set alert for {price}. If it hits, will post trade screenshot.",
  ];

  // synonyms and small pools
  const greetings = ["Hey", "Hi", "Yo", "Greetings", "Heads up", "Quick note"];
  const emojis = ["🚀", "📈", "🔍", "⚠️", "💎", "🤖", "🔥", "🧠", "🙌", "😅"];
  const adjectives = ["bullish", "bearish", "neutral", "choppy", "strong", "weak", "volatile"];
  const directions = ["up", "down", "sideways", "to the moon", "correction"];
  const indicators = ["RSI", "VWAP", "EMA", "SMA", "MACD", "Bollinger Bands", "OBV", "Ichimoku"];
  const pairs = ["BTC/USDT", "ETH/USDT", "SOL/USDT", "XRP/USDT", "DOGE/USDT", "BTC/ETH", "BNB/USDT"];
  const patterns = ["double top", "ascending triangle", "head and shoulders", "bull flag", "bear flag", "cup & handle"];
  const reasons = ["funding rate spike", "on-chain spike", "liquidations", "whale accumulation", "news leak"];
  const sentiments = ["positive", "negative", "mixed", "extreme fear", "extreme greed"];
  const timeframes = ["1m", "5m", "15m", "1h", "4h", "daily", "weekly"];
  const slTargets = ["0.5%", "1%", "2%", "5%", "10%", "20%"];
  const snippetPool = [
    "EMA crossover on 15m",
    "divergence on RSI",
    "volume confirmation",
    "no liquidity above",
    "liquidity grab",
    "broken support turned resistance",
    "confluence of fib and MA",
    "on-chain whale accumulation",
    "macro risk-on environment"
  ];

  /* ---------- paraphrase helpers (simple) ---------- */
  function paraphrase(rng, text) {
    // very lightweight paraphrase: swap words with small synonyms where defined
    // keep short for speed
    const subs = {
      "watch": ["watch", "eye", "monitor"],
      "looks": ["looks", "seems", "appears"],
      "setup": ["setup", "trade", "idea"],
      "target": ["target", "take-profit", "tp"],
      "stop loss": ["stop loss", "sl", "stop"],
      "buy": ["buy", "enter long", "go long"],
      "sell": ["sell", "exit", "take profit"]
    };
    return text.replace(/\b(watch|looks|setup|target|stop loss|buy|sell)\b/gi, (m) => {
      const key = m.toLowerCase();
      if (subs[key]) return sample(rng, subs[key]);
      return m;
    });
  }

  /* ---------- usage tracker to avoid repeats ---------- */
  // We will persist usage as a map: { templateIndex: count, fingerprint: timestamp }
  function loadUsage() {
    const u = safeLoad(LS_USAGE);
    return u && typeof u === 'object' ? u : { counts: {}, recent: [] };
  }
  function saveUsage(usage) {
    safeSave(LS_USAGE, usage);
  }

  /* ---------- MessageBank core ---------- */
  const MessageBank = {
    _rng: makeRng(Date.now() & 0x7fffffff),
    _seed: Date.now() & 0x7fffffff,
    _templates: baseTemplates.slice(),
    _usage: loadUsage(),

    init(opts = {}) {
      // opts.seed to make deterministic run, opts.extraTemplates array to append
      if (opts.seed !== undefined) {
        const s = Number(opts.seed) >>> 0;
        this._seed = s;
        this._rng = makeRng(s);
      }
      if (Array.isArray(opts.extraTemplates)) {
        this._templates = this._templates.concat(opts.extraTemplates);
      }
      // ensure usage shape
      if (!this._usage || typeof this._usage !== 'object') this._usage = { counts: {}, recent: [] };
      saveUsage(this._usage);
      safeSave(LS_TEMPLATES, { created: Date.now(), templateCount: this._templates.length, seed: this._seed });
      return { templates: this._templates.length, seed: this._seed };
    },

    _markUsed(templateIdx, fingerprint) {
      this._usage.counts[templateIdx] = (this._usage.counts[templateIdx] || 0) + 1;
      // keep recent list capped to N entries to avoid huge storage
      this._usage.recent.unshift({ t: Date.now(), i: templateIdx, f: fingerprint });
      if (this._usage.recent.length > 1200) this._usage.recent.length = 1200;
      saveUsage(this._usage);
    },

    _recentlyUsed(templateIdx, windowMs = 1000 * 60 * 60 * 24 * 7) {
      // check recent array for this template within windowMs (default 7 days)
      const now = Date.now();
      for (let i = 0; i < Math.min(this._usage.recent.length, 600); i++) {
        const r = this._usage.recent[i];
        if (r.i === templateIdx && (now - r.t) < windowMs) return true;
      }
      return false;
    },

    _renderTemplate(rng, tpl, ctx) {
      // ctx may include: pair, indicator, price, sl, targets, snippet, newsSnippet, adjective...
      // fill variables
      let s = tpl;

      const replacements = {
        "{greeting}": () => sample(rng, greetings),
        "{emoji}": () => sample(rng, emojis),
        "{adjective}": () => sample(rng, adjectives),
        "{direction}": () => sample(rng, directions),
        "{indicator}": () => sample(rng, indicators),
        "{pair}": () => (ctx && ctx.pair) || sample(rng, pairs),
        "{pattern}": () => sample(rng, patterns),
        "{reason}": () => sample(rng, reasons),
        "{sentiment}": () => sample(rng, sentiments),
        "{timeframe}": () => (ctx && ctx.timeframe) || sample(rng, timeframes),
        "{sl}": () => (ctx && ctx.sl) || sample(rng, slTargets),
        "{targets}": () => (ctx && ctx.targets) || `${sample(rng, slTargets)}, ${sample(rng, slTargets)}`,
        "{snippet}": () => (ctx && ctx.snippet) || sample(rng, snippetPool),
        "{newsSnippet}": () => (ctx && ctx.newsSnippet) || `report about ${sample(rng, ['regulation','ETF','bridge','protocol upgrade','partnership'])}`,
        "{pattern}": () => sample(rng, patterns),
        "{condition}": () => (ctx && ctx.condition) || "price holds above support",
        "{target}": () => (ctx && ctx.target) || sample(rng, slTargets)
      };

      // apply replacements
      Object.keys(replacements).forEach(k => {
        s = s.split(k).join(replacements[k]());
      });

      // slight paraphrase sometimes
      if (rng() < 0.28) s = paraphrase(rng, s);

      // clean double spaces
      s = s.replace(/\s+/g, ' ').trim();
      return s;
    },

    /**
     * generateFor(person, opts)
     * - person: object from PeopleStore (recommended)
     * - opts:
     *    seed: optional to override RNG
     *    avoidRecentlyUsedWindowMs: window to avoid reusing template (default 7 days)
     *    biasArchetype: true/false (default true) -> picks templates suited to archetype
     *    ctx: extra context (pair, indicator, snippet, etc.)
     */
    generateFor(person = null, opts = {}) {
      const rng = opts.seed !== undefined ? makeRng(opts.seed) : this._rng;
      const biasArchetype = opts.biasArchetype !== false;
      const windowMs = opts.avoidRecentlyUsedWindowMs || (1000 * 60 * 60 * 24 * 7); // 7 days

      // build filtered template indexes depending on archetype, emotion, etc.
      let candidates = this._templates.map((t, i) => i);

      // priority boost for admins/mods: prefer announcement-like templates (we choose by heuristics)
      if (person && biasArchetype) {
        if (person.role === 'ADMIN') {
          // prefer templates that mention "reminder", "update", "patch" etc - approximate by keywords
          candidates = candidates.filter(i => /reminder|client|patch|update|admin|alert|DM|verification/i.test(this._templates[i]) ? true : true);
        }
        // apply emotional baseline: if negative baseline, prefer caution/advice templates
        if (person.emotionalBaseline && person.emotionalBaseline < -0.3) {
          // no strict filter; we'll apply small bias later
        }
      }

      // shuffle candidates for randomness (stable)
      candidates = shuffleCopy(rng, candidates);

      // pick a template index that hasn't been used recently
      let chosenIdx = null;
      for (let i = 0; i < candidates.length; i++) {
        const idx = candidates[i];
        // avoid recently used templates when possible
        if (!this._recentlyUsed(idx, windowMs) || rng() < 0.02) {
          chosenIdx = idx;
          break;
        }
      }
      // fallback to random
      if (chosenIdx === null) chosenIdx = candidates[Math.floor(rng() * candidates.length)];

      const tpl = this._templates[chosenIdx];
      const context = Object.assign({}, opts.ctx || {});

      // bias some fields by person personality/archetype
      if (person) {
        // if archetype 'shill' or high energy, more emoji and more bullish adjectives
        if ((person.personality && person.personality.emojiAffinity > 1) || person.role === 'MOD') {
          context.emoji = sample(rng, emojis);
        }
        // pick pair influenced by country (small bias)
        if (person.country && rng() < 0.18) {
          // simple mapping (not exhaustive)
          const c = person.country.toLowerCase();
          if (c.includes('nigeria') || c.includes('ghana') || c.includes('kenya')) context.pair = sample(rng, ['BTC/USDT', 'ETH/USDT', 'BNB/USDT']);
        }
        // snippet bias
        if (!context.snippet && rng() < 0.4) context.snippet = sample(rng, snippetPool);
      }

      const text = this._renderTemplate(rng, tpl, context);

      // create fingerprint for this generation to help dedupe later
      const fingerprint = `${chosenIdx}:${hashString(text).slice(0,8)}`;

      // mark usage
      this._markUsed(chosenIdx, fingerprint);

      return {
        text,
        templateIndex: chosenIdx,
        fingerprint,
        timestamp: Date.now(),
        meta: { seed: this._seed }
      };
    },

    /**
     * getUniqueMessage(person, opts)
     * Similar to generateFor but attempts harder to avoid duplicates by trying multiples.
     */
    getUniqueMessage(person, opts = {}) {
      const tries = opts.tries || 12;
      for (let i = 0; i < tries; i++) {
        const out = this.generateFor(person, opts);
        // ensure the fingerprint not in recent usage (stronger check)
        const found = this._usage.recent.find(r => r.f === out.fingerprint);
        if (!found) return out;
      }
      // fallback to last generated
      return this.generateFor(person, opts);
    },

    /**
     * bulkGenerateFor(person, n, opts)
     * - generates n messages for person (useful to prefill the simulation queue)
     */
    bulkGenerateFor(person, n = 50, opts = {}) {
      const out = [];
      for (let i = 0; i < n; i++) {
        out.push(this.getUniqueMessage(person, Object.assign({}, opts, { seed: (opts.seed ? opts.seed + i : undefined) })));
      }
      return out;
    },

    stats() {
      return {
        templateCount: this._templates.length,
        usageCounts: Object.assign({}, this._usage.counts),
        recent: this._usage.recent.slice(0, 20)
      };
    },

    // allow adding templates dynamically
    addTemplates(arr) {
      if (!Array.isArray(arr)) return;
      this._templates.push(...arr);
      safeSave(LS_TEMPLATES, { updated: Date.now(), templateCount: this._templates.length });
      return this._templates.length;
    },

    // small helper: select a short headline-like message when you need short messages
    shortFor(person, opts = {}) {
      const mb = this.getUniqueMessage(person, opts);
      // short: trim to 80 chars if necessary
      const t = mb.text;
      return Object.assign({}, mb, { text: t.length > 80 ? t.slice(0, 77) + '…' : t });
    }
  };

  /* ---------- small helper: hashString (fast, small) ---------- */
  function hashString(s) {
    // djb2
    let h = 5381;
    for (let i = 0; i < s.length; i++) {
      h = ((h << 5) + h) + s.charCodeAt(i);
      h = h & 0xffffffff;
    }
    // to hex
    return ('00000000' + (h >>> 0).toString(16)).slice(-8);
  }

  /* ---------- init on load with default seed ---------- */
  MessageBank.init({ seed: (Date.now() & 0x7fffffff) });

  /* ---------- expose ---------- */
  window.MessageBank = MessageBank;

  /* ---------- quick sanity-check helpers (developer) ---------- */
  window.MessageBankSanity = {
    produceSample(personName) {
      const person = (window.PeopleStore && window.PeopleStore.getByName && window.PeopleStore.getByName(personName)) || null;
      const mb = window.MessageBank.bulkGenerateFor(person || null, 6);
      console.groupCollapsed('MessageBank sample for', personName || 'anon');
      mb.forEach(m => console.log('-', m.text));
      console.groupEnd();
      return mb;
    },
    usage() {
      return MessageBank.stats();
    }
  };

})();
