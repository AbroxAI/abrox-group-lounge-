/**
 * typing-engine.js
 *
 * Simulate human-like typing with many realistic behaviors:
 * - Telegram-like timing curves / role-based speed profiles
 * - Punctuation hesitation, backspace corrections, emoji slowdown
 * - Night-time slowdown, mobile vs desktop adjustments
 * - Emotional pacing, fatigue persistence (localStorage)
 * - Ghost typing + abandoned typing
 *
 * Exposes window.TypingEngine
 *
 * Events emitted (CustomEvent on window + optional onEvent callback):
 *   typing:start   -> { id, person, text, meta }
 *   typing:progress-> { id, person, typed, remaining, percent, meta }
 *   typing:pause   -> { id, person, reason, meta }
 *   typing:abandoned-> { id, person, meta }
 *   typing:stop    -> { id, person, meta } (stopped without sending)
 *   typing:send    -> { id, person, text, meta }
 *
 * Lightweight, synchronous API. No blocking loops. Works in modern browsers.
 */

(function () {
  if (window.TypingEngine) return;

  // --- small util
  const LS_FATIGUE = 'abrox_typing_fatigue_v1';
  const uuid = () => (crypto && crypto.randomUUID) ? crypto.randomUUID() : ('t' + Math.random().toString(36).slice(2, 9));
  const now = () => Date.now();
  const clamp = (v, a, b) => Math.min(Math.max(v, a), b);
  const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];
  const isRTLText = (s) => /[\u0591-\u07FF\uFB1D-\uFDFD\uFE70-\uFEFC]/.test(s);

  // --- seeded RNG helper for reproducibility (xorshift)
  function makeRng(seed) {
    let x = seed >>> 0 || (Math.floor(Math.random() * 2 ** 31) >>> 0);
    return function () {
      x ^= x << 13;
      x ^= x >>> 17;
      x ^= x << 5;
      return (x >>> 0) / 0x100000000;
    };
  }

  // --- default config / profiles
  const DEFAULT = {
    baseWPM: 42, // baseline words-per-minute
    jitter: 0.18,
    punctuationPauseMs: 250,
    emojiPauseMultiplier: 1.6,
    backspaceChance: 0.09,
    correctionSpeedRatio: 0.6,
    ghostTypingChance: 0.06,
    abandonChance: 0.02,
    nightSlowdown: 0.6,
    mobileSlowdown: 0.82,
    fatigueRecoveryPerHour: 0.08, // recovers 8% per hour
    fatigueIncreasePerSession: 0.06 // increases fatigue by 6% after a send
  };

  // Role profile adjustments
  const ROLE_PROFILES = {
    ADMIN: { speedMult: 1.05, variance: 0.06, emojiAffinity: 0.18, punctuationCare: 0.9, assertiveness: 0.9 },
    MOD: { speedMult: 0.98, variance: 0.08, emojiAffinity: 0.24, punctuationCare: 0.85, assertiveness: 0.8 },
    VERIFIED: { speedMult: 1.0, variance: 0.12, emojiAffinity: 0.32, punctuationCare: 0.75, assertiveness: 0.6 },
    VERIFIED_HIGH: { speedMult: 1.12, variance: 0.16, emojiAffinity: 0.45, punctuationCare: 0.6, assertiveness: 0.5 },
    GENERIC: { speedMult: 0.92, variance: 0.18, emojiAffinity: 0.28, punctuationCare: 0.7, assertiveness: 0.5 }
  };

  // small bezier easing approximations (telegram-like feel)
  function bezierEase(t, p0 = 0.0, p1 = 0.42, p2 = 0.58, p3 = 1.0) {
    // Cubic bezier approximation using De Casteljau
    // For our usage we invert by sampling — simple and cheap for small N (ok).
    // But here we just return eased t using typical ease-in-out curve
    // Use a simple smoothstep-ish curve for speed
    return t < 0.5 ? (2 * t * t) : (1 - Math.pow(-2 * t + 2, 2) / 2);
  }

  // --- fatigue store (persisted)
  const FatigueStore = {
    _data: null,
    _load() {
      if (this._data) return this._data;
      try {
        this._data = JSON.parse(localStorage.getItem(LS_FATIGUE) || '{}') || {};
      } catch (e) { this._data = {}; }
      return this._data;
    },
    get(personId) {
      const d = this._load();
      const item = d[personId];
      if (!item) return 0;
      // recover fatigue over time
      const elapsedH = (now() - (item.t || 0)) / 3600000;
      const recovered = elapsedH * DEFAULT.fatigueRecoveryPerHour;
      const val = Math.max(0, clamp(item.v - recovered, 0, 1));
      return val;
    },
    increase(personId, amount) {
      const d = this._load();
      const old = this.get(personId) || 0;
      const v = clamp(old + (amount || DEFAULT.fatigueIncreasePerSession), 0, 1);
      d[personId] = { v, t: now() };
      try { localStorage.setItem(LS_FATIGUE, JSON.stringify(d)); } catch (e) {}
      this._data = d;
      return v;
    },
    set(personId, v) {
      const d = this._load();
      d[personId] = { v: clamp(v, 0, 1), t: now() };
      try { localStorage.setItem(LS_FATIGUE, JSON.stringify(d)); } catch (e) {}
      this._data = d;
    }
  };

  // --- event emitter helper (dispatches windows events and optionally callback)
  function emitEvent(evName, detail, onEvent) {
    try {
      const ce = new CustomEvent(evName, { detail });
      window.dispatchEvent(ce);
    } catch (e) { /* ignore */ }
    if (typeof onEvent === 'function') {
      try { onEvent(evName, detail); } catch (e) {}
    }
  }

  // --- main engine object
  const TypingEngine = {
    _rng: makeRng((Date.now() & 0x7fffffff) >>> 0),
    _seed: Date.now() & 0x7fffffff,
    _log: false,
    init(opts = {}) {
      if (opts.seed !== undefined) { this._rng = makeRng(Number(opts.seed) >>> 0); this._seed = Number(opts.seed) >>> 0; }
      if (opts.log) this._log = true;
      return { seed: this._seed, log: this._log };
    },

    /**
     * simulate(person, text, opts)
     *
     * person: { id?, name, role?, personality?, country?, fatigue? } — engine will try to use fields if present
     * text: string to type
     * opts: {
     *   onEvent: function(evName, detail) // optional callback
     *   channelId: string // optional UI channel id
     *   mobile: bool // simulate mobile typing
     *   copyPasteThresh: 300 // ms threshold to consider copy/paste (if text lengthy and time budget small)
     *   allowGhost: bool // allow ghost typing
     *   interruptable: bool // true by default
     *   seed: number // optional
     * }
     *
     * Returns a controller:
     *  { id, cancel(), interrupt(), forceSend(), setPaused(bool) }
     */
    simulate(person = {}, text = '', opts = {}) {
      const id = uuid();
      const rng = opts.seed !== undefined ? makeRng(Number(opts.seed) >>> 0) : (this._rng);
      const onEvent = opts.onEvent;
      const mobile = !!opts.mobile || /Mobi|Android|iPhone|iPad|Windows Phone|Opera Mini|LG/i.test(navigator.userAgent || '');
      const interruptable = opts.interruptable !== false;
      const channelId = opts.channelId || 'main';
      const allowGhost = opts.allowGhost !== false;
      const copyPasteThresh = Number(opts.copyPasteThresh || 300);

      const role = (person && person.role) || 'GENERIC';
      const roleProfile = ROLE_PROFILES[role] || ROLE_PROFILES.GENERIC;
      const emotional = (person && person.personality && person.personality.emotion) || (person && person.emotionalBaseline) || 0; // -1..1
      const personality = person && person.personality ? person.personality : {};
      const fatigue = FatigueStore.get(person.id || person.name || 'anon');

      // compute baseline WPM adjusted
      let baseWpm = DEFAULT.baseWPM * roleProfile.speedMult;
      // personality adjustments
      if (personality.wpmMult) baseWpm *= personality.wpmMult;
      // mobile & night slowdown
      const hour = new Date().getHours();
      if (hour < 6 || hour > 22) baseWpm *= DEFAULT.nightSlowdown;
      if (mobile) baseWpm *= DEFAULT.mobileSlowdown;
      // fatigue reduces speed
      baseWpm *= (1 - fatigue * 0.38); // fatigue penalizes up to ~38% at max

      // adjust for emotion: angry faster, hesitant slower
      if (emotional > 0.45) baseWpm *= 1.08;
      else if (emotional < -0.45) baseWpm *= 0.86;

      // length metrics
      const totalChars = String(text || '').length;
      const words = (text || '').trim().split(/\s+/).filter(Boolean).length || 1;
      const avgCharsPerWord = Math.max(3, Math.round(totalChars / words));

      // compute per-character delay distribution in ms
      // base: msPerWord = 60000 / baseWpm; perChar = msPerWord / avgCharsPerWord
      const msPerWord = 60000 / Math.max(6, baseWpm);
      let baseMsPerChar = msPerWord / avgCharsPerWord;

      // role variance
      const variance = roleProfile.variance || 0.14;

      // small helper to compute char delay with jitter & punctuation handling
      function charDelay(ch, nextCh, typedSoFar) {
        let d = baseMsPerChar * (1 + (rng() - 0.5) * variance * 2);
        // punctuation hesitation
        if (/[.,;:!?]/.test(ch)) d += DEFAULT.punctuationPauseMs * (roleProfile.punctuationCare || 1);
        // emoji slowdown
        if (/[\u{1F300}-\u{1FAFF}]/u.test(ch) || /[:;()-]/.test(ch) && /[\u{1F300}-\u{1FAFF}]/u.test(nextCh || '')) {
          d *= DEFAULT.emojiPauseMultiplier;
        }
        // add emotional micro-pause
        if (emotional < -0.5 && rng() < 0.1) d *= 1.15;
        if (emotional > 0.6 && rng() < 0.06) d *= 0.9;
        // longer pause before uppercase phrases sometimes
        if (/[A-Z]/.test(ch) && rng() < 0.02) d += 40;
        return Math.max(20, Math.round(d));
      }

      // detect potential copy/paste: if text is long and msPerChar extremely small -> instant send
      const predictedTotalMs = totalChars * baseMsPerChar;
      const likelyCopyPaste = (totalChars > 70 && predictedTotalMs < copyPasteThresh);

      // If copy/paste detected, emit a very short typing burst and then send
      if (likelyCopyPaste) {
        const evStart = { id, person, text, meta: { channelId, method: 'copy-paste', seed: this._seed } };
        emitEvent('typing:start', evStart, onEvent);
        setTimeout(() => {
          emitEvent('typing:send', evStart, onEvent);
          // increase fatigue slightly
          if (person && (person.id || person.name)) FatigueStore.increase(person.id || person.name, DEFAULT.fatigueIncreasePerSession * 0.5);
        }, Math.max(120, Math.min(800, Math.round(Math.sqrt(totalChars) * 12))));
        return {
          id,
          cancel: () => { /* nothing to cancel */ },
          interrupt: () => { /* not applicable */ },
          forceSend: () => { emitEvent('typing:send', { id, person, text, meta: { channelId, method: 'copy-paste' } }, onEvent); }
        };
      }

      // Build schedule of actions: array of {type: 'type'|'backspace'|'pause'|'ghost', ch }
      // We'll simulate typing by stepping through characters, occasionally inserting backspaces & corrections
      const chars = Array.from(String(text)); // preserves surrogate pairs (emojis)
      const isRTL = isRTLText(text);

      // create a timeline generator (non-blocking)
      let idx = 0;
      let typed = '';
      let running = true;
      let paused = false;
      let abandoned = false;
      let sent = false;
      let interrupted = false;
      let lastEventTs = now();

      // Emit start
      emitEvent('typing:start', { id, person, text: '', meta: { channelId, seed: this._seed } }, onEvent);
      if (this._log) console.debug('[TypingEngine]', 'start', id, 'for', person && (person.name || person.id));

      // internal step function
      function stepOnce() {
        if (!running) return;
        if (paused) { lastEventTs = now(); scheduleNext(); emitEvent('typing:pause', { id, person, reason: 'manual-pause', meta: { channelId } }, onEvent); return; }
        if (abandoned) { running = false; emitEvent('typing:abandoned', { id, person, meta: { channelId } }, onEvent); return; }
        // chance of ghost typing (type then stop before send)
        if (allowGhost && rng() < (DEFAULT.ghostTypingChance * (1 - fatigue))) {
          // start ghost typing: type few chars then stop
          const ghostLen = Math.max(1, Math.floor(rng() * Math.min(6, chars.length)));
          for (let g = 0; g < ghostLen && idx < chars.length; g++) {
            typed += (isRTL ? chars[chars.length - 1 - idx] : chars[idx]);
            idx++;
          }
          emitEvent('typing:progress', { id, person, typed, remaining: chars.length - idx, percent: typed.length / Math.max(1, chars.length), meta: { channelId, ghost: true } }, onEvent);
          // stop without sending — mark abandoned or pause briefly
          if (rng() < 0.5) {
            // pause longer then either abandon or resume later
            paused = true;
            setTimeout(() => { paused = false; if (rng() < 0.25) abandoned = true; }, 800 + Math.round(rng() * 3500));
            scheduleNext();
            return;
          }
        }

        // normal typing flow: decide next atomic action
        // Occasionally do corrections/backspace
        if (idx > 2 && rng() < DEFAULT.backspaceChance * (1 - (person && person.personality && person.personality.perfection ? 0.5 : 0)) ) {
          // perform a backspace correction sequence: delete 1-3 chars then retype them slower
          const del = 1 + Math.floor(rng() * 2);
          const toDelete = Math.min(del, typed.length);
          // delete characters
          const deleted = typed.slice(-toDelete);
          typed = typed.slice(0, -toDelete);
          emitEvent('typing:progress', { id, person, typed, remaining: chars.length - idx, percent: typed.length / Math.max(1, chars.length), meta: { channelId, correction: true, deleted } }, onEvent);
          // schedule retype of deleted characters at correction speed
          const correctionDelay = Math.max(40, Math.round(baseMsPerChar / (DEFAULT.correctionSpeedRatio) ));
          let rIdx = 0;
          const retype = () => {
            if (!running) return;
            if (rIdx >= deleted.length) { scheduleNext(); return; }
            const ch = deleted[rIdx];
            typed += ch;
            rIdx++;
            emitEvent('typing:progress', { id, person, typed, remaining: chars.length - idx, percent: typed.length / Math.max(1, chars.length), meta: { channelId, correction: true } }, onEvent);
            setTimeout(retype, correctionDelay * (1 + (rng() - 0.5) * 0.3));
          };
          setTimeout(retype, correctionDelay);
          return;
        }

        // normal char
        if (idx < chars.length) {
          const ch = (isRTL ? chars[chars.length - 1 - idx] : chars[idx]);
          // compute delay for this character
          const nextCh = (isRTL ? chars[chars.length - 1 - (idx + 1)] : chars[idx + 1]);
          const delay = charDelay(ch, nextCh, typed.length);
          // apply small ramp using bezier based on progress
          const progress = (idx / Math.max(1, chars.length));
          const ramp = 1 + (bezierEase(progress) - 0.5) * 0.25; // small effect
          const finalDelay = Math.round(delay * ramp * (1 + (rng() - 0.5) * DEFAULT.jitter));

          setTimeout(() => {
            if (!running || paused) { scheduleNext(); return; }
            typed += ch;
            idx++;
            emitEvent('typing:progress', { id, person, typed, remaining: chars.length - idx, percent: typed.length / Math.max(1, chars.length), meta: { channelId } }, onEvent);
            lastEventTs = now();
            // small pause after punctuation or end-of-sentence
            if (/[.!?]/.test(ch) && rng() < 0.42) {
              // punctuation hesitation
              const p = Math.round(DEFAULT.punctuationPauseMs * (1 + (rng() - 0.5) * 0.6));
              setTimeout(scheduleNext, p);
            } else {
              scheduleNext();
            }
          }, finalDelay);

          return;
        }

        // finished typing all characters - small think time then send
        if (!sent) {
          const finalPause = Math.round(120 + (rng() * 650) + (emotional > 0.7 ? -80 : 0));
          setTimeout(() => {
            if (!running) return;
            // chance to abandon instead of sending (user typed and left)
            if (allowGhost && rng() < DEFAULT.abandonChance * (1 + fatigue)) {
              abandoned = true;
              emitEvent('typing:abandoned', { id, person, meta: { channelId } }, onEvent);
              running = false;
              return;
            }
            // finally send
            emitEvent('typing:send', { id, person, text, meta: { channelId } }, onEvent);
            sent = true;
            running = false;
            // increase fatigue for person
            if (person && (person.id || person.name)) FatigueStore.increase(person.id || person.name, DEFAULT.fatigueIncreasePerSession);
            if (TypingEngine._log) console.debug('[TypingEngine] send', id, person && (person.name || person.id));
          }, finalPause);
          return;
        }

        // else finished
        running = false;
      }

      // schedule next tick in a conservative manner
      function scheduleNext() {
        if (!running) return;
        // lower CPU when page hidden
        const hiddenMult = (document.hidden ? 3 : 1);
        const baseTick = 60 * hiddenMult; // minimal tick
        // random micro spacing
        setTimeout(() => { requestAnimationFrame(stepOnce); }, baseTick + Math.round(rng() * 120));
      }

      // start scheduler
      scheduleNext();

      // return controller
      const controller = {
        id,
        cancel() {
          running = false;
          emitEvent('typing:stop', { id, person, meta: { channelId, reason: 'cancelled' } }, onEvent);
        },
        interrupt() {
          if (!interruptable) return;
          interrupted = true;
          // immediate pause and potential abbreviated send
          paused = true;
          emitEvent('typing:pause', { id, person, reason: 'interrupted', meta: { channelId } }, onEvent);
          // after short gap, abandon
          setTimeout(() => { if (!running) return; paused = false; abandoned = true; running = false; emitEvent('typing:abandoned', { id, person, meta: { channelId } }, onEvent); }, 800 + Math.round(rng() * 1600));
        },
        forceSend() {
          if (sent) return;
          running = false;
          sent = true;
          emitEvent('typing:send', { id, person, text, meta: { channelId, forced: true } }, onEvent);
          if (person && (person.id || person.name)) FatigueStore.increase(person.id || person.name, DEFAULT.fatigueIncreasePerSession);
        },
        pause(flag = true) {
          paused = !!flag;
          emitEvent('typing:pause', { id, person, reason: flag ? 'manual' : 'resume', meta: { channelId } }, onEvent);
        },
        getState() { return { id, running, paused, abandoned, sent, typed, idx }; }
      };

      // return controller immediately
      return controller;
    }
  };

  // init with default seed
  TypingEngine.init({});

  // expose
  window.TypingEngine = TypingEngine;

})();
