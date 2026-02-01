/**
 * synthetic-people.js
 *
 * Purpose: generate persistent, realistic-looking "people" data for the
 * Synthetic Social Simulation Engine.
 *
 * - Exposes window.PeopleStore
 * - Lightweight seeded RNG for reproducible results per client
 * - Persists personality/fatigue state to localStorage
 * - Generates avatars via DiceBear (configurable)
 * - Provides helpers to inject into existing UI arrays (e.g. window.sampleMembers)
 *
 * Usage (examples):
 *  window.PeopleStore.init({ targetCount: 1000 });
 *  window.PeopleStore.populateGlobal({ fillTo: 1000 });
 *  const online = window.PeopleStore.sampleOnline(30);
 *  const m = window.PeopleStore.getByName('Member_12');
 */

(function () {
  if (window.PeopleStore) return; // don't overwrite if already present

  const LS_KEY = 'abrox_people_v1';
  const LS_FATIGUE = 'abrox_people_fatigue_v1';

  /* ---------- simple seeded RNG (xorshift32) ---------- */
  function makeRng(seed) {
    let x = seed >>> 0 || (Math.floor(Math.random() * 2 ** 31) >>> 0);
    return function () {
      // xorshift32
      x ^= x << 13;
      x ^= x >>> 17;
      x ^= x << 5;
      return (x >>> 0) / 0x100000000;
    };
  }

  /* ---------- small utilities ---------- */
  const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];
  const clamp = (v, a, b) => Math.min(Math.max(v, a), b);

  /* ---------- data pools (curated, compact) ---------- */
  const cryptoHandles = [
    'HODLer', 'BitNinja', 'SatoshiFan', 'MoonChaser', 'AlphaSeer', 'GammaBot',
    'Candlestick', 'DeltaTrader', 'Pulse', 'OnchainGeek', 'DeFiDave', 'ChartQueen'
  ];

  const firstNames = ['Ava','Liam','Noah','Olivia','Emma','Lucas','Mia','Ethan','Amir','Zara','Kai','Nora','Jonah','Layla','Ivy','Owen','Maya','Leo','Hana','Ibrahim'];
  const lastNames = ['Okoye','Smith','Johnson','Chen','Nguyen','Khan','Gonzalez','Ivanov','Patel','Silva','Kim','Park','Andersen','Martin','Brown','Tadesse','Bakare','Mensah','Ndlovu','Almeida'];

  const countries = ['Nigeria','USA','UK','India','Germany','Brazil','Turkey','UAE','Russia','Kenya','Ghana','South Africa','Egypt','China','Spain','France','Netherlands','Canada','Australia','Morocco'];
  const languages = ['en','pt','es','fr','ar','tr','ru','zh','hi','nl','de','yo','ig','ha','sw'];

  const archetypes = [
    { id:'analyst', label:'Analyst', basePace:0.9, emoji:'📈' },
    { id:'shill', label:'Promoter', basePace:1.2, emoji:'🚀' },
    { id:'skeptic', label:'Skeptic', basePace:0.75, emoji:'🧐' },
    { id:'moderator', label:'Moderator', basePace:0.6, emoji:'🛡️' },
    { id:'noisy', label:'Chatter', basePace:1.3, emoji:'💬' },
    { id:'helper', label:'Helper', basePace:0.85, emoji:'🤝' }
  ];

  /* ---------- avatar provider (DiceBear) ---------- */
  const AVATAR_BASE = 'https://api.dicebear.com/8.x/identicon/svg';
  function dicebearUrl(seed, opts = {}) {
    // opts: style, backgroundType, size etc. Keep simple to avoid CORS issues.
    const params = new URLSearchParams();
    params.set('seed', encodeURIComponent(String(seed)));
    // optional styles
    if (opts.scale) params.set('scale', String(opts.scale));
    if (opts.radius) params.set('radius', String(opts.radius));
    return `${AVATAR_BASE}?${params.toString()}`;
  }

  /* ---------- persistence helpers ---------- */
  function saveStore(obj) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(obj)); } catch (e) {}
  }
  function loadStore() {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch (e) { return null; }
  }
  function saveFatigue(map) {
    try { localStorage.setItem(LS_FATIGUE, JSON.stringify(map)); } catch (e) {}
  }
  function loadFatigue() {
    try { return JSON.parse(localStorage.getItem(LS_FATIGUE) || '{}'); } catch (e) { return {}; }
  }

  /* ---------- Person generator ---------- */
  function createPerson(rng, idx, opts = {}) {
    // id/name scheme: prefer human name, otherwise Member_## or crypto handle
    const useHandle = rng() < 0.14;
    const handlePart = useHandle ? pick(rng, cryptoHandles) : `${pick(rng, firstNames)} ${pick(rng, lastNames)}`;
    const name = opts.honorPrefix ? `${opts.honorPrefix} ${handlePart}` : handlePart;

    const roleRand = rng();
    const role = roleRand < 0.01 ? 'ADMIN' : roleRand < 0.06 ? 'MOD' : 'VERIFIED';

    const country = pick(rng, countries);
    const language = pick(rng, languages);

    const archetype = pick(rng, archetypes);

    // emotional baseline [-0.6..0.6], personality memory factor
    const emotBase = (rng() - 0.5) * 1.2;
    const personality = {
      archetype: archetype.id,
      energy: clamp(0.6 + (rng() - 0.5) * 0.6, 0.2, 1.4),
      curiosity: clamp(0.6 + (rng() - 0.5) * 0.6, 0.2, 1.4),
      confidence: clamp(0.6 + (rng() - 0.5) * 0.6, 0.15, 1.6),
      emojiAffinity: rng() < 0.32 ? Math.round(rng() * 3) : Math.round(rng() * 1)
    };

    // fatigue memory defaults
    const fatigue = { score: 0, lastActive: Date.now() };

    // authority relations: admin->mods intimidation scalar
    const authority = {
      level: role === 'ADMIN' ? 3 : role === 'MOD' ? 2 : 1,
      intimidatedByAdmin: role === 'VERIFIED' ? clamp(rng() * 0.6, 0, 1) : 0,
      respectForMods: role === 'VERIFIED' ? clamp(0.3 + rng() * 0.6, 0, 1) : 0.9
    };

    const avatarSeed = `${name}-${idx}-${Date.now() % 1000}`;
    const avatar = dicebearUrl(avatarSeed, { scale: 90 });

    return {
      id: `p_${idx}`,
      name,
      role,
      avatar,
      country,
      language,
      emotionalBaseline: parseFloat(emotBase.toFixed(3)),
      personality,
      fatigue,
      authority,
      lastActive: Date.now() - Math.floor(rng() * 60 * 60 * 1000) // last active within hour random
    };
  }

  /* ---------- PeopleStore core ---------- */
  const PeopleStore = {
    _store: { people: [], meta: { created: Date.now(), seed: undefined } },
    _fatigue: loadFatigue(),

    init(options = {}) {
      const opts = Object.assign({ targetCount: 1000, seed: undefined, honorPrefix: null }, options);
      const seed = opts.seed !== undefined ? Number(opts.seed) : (Date.now() & 0x7fffffff);
      this._store.meta.seed = seed;
      const rng = makeRng(seed);
      const count = Math.max(1, Math.min(5000, Math.floor(opts.targetCount)));
      const arr = [];
      for (let i = 0; i < count; i++) {
        arr.push(createPerson(rng, i + 1, { honorPrefix: opts.honorPrefix }));
      }
      this._store.people = arr;
      saveStore(this._store);
      return this._store.people;
    },

    load() {
      const saved = loadStore();
      if (saved && Array.isArray(saved.people)) {
        this._store = saved;
        return this._store.people;
      }
      return null;
    },

    persist() {
      saveStore(this._store);
    },

    /* returns a cloned subset (doesn't mutate internal) */
    generateBatch(count = 50, opts = {}) {
      const seed = (this._store.meta && this._store.meta.seed) || Date.now();
      const rng = makeRng(seed + (opts.offset || 0));
      const arr = [];
      const base = this._store.people.length;
      for (let i = 0; i < count; i++) {
        arr.push(createPerson(rng, base + i + 1, opts));
      }
      return arr;
    },

    getAll() {
      return this._store.people.slice();
    },

    getByName(name) {
      return this._store.people.find(p => p.name === name) || null;
    },

    getById(id) {
      return this._store.people.find(p => p.id === id) || null;
    },

    /* sampleOnline: returns N members flagged as online (changes lastActive) */
    sampleOnline(n = 10, opts = {}) {
      const people = this._store.people;
      if (!people.length) return [];

      // weight by recent activity & energy
      const now = Date.now();
      const scored = people.map(p => {
        const age = (now - (p.lastActive || now)) / 1000;
        // higher energy & lower fatigue => more likely online
        const energy = (p.personality && p.personality.energy) || 1;
        const fatigue = (this._fatigue[p.id] && this._fatigue[p.id].score) || 0;
        const score = clamp((1 / (1 + Math.log(Math.max(1, age)))) * energy * (1 - fatigue * 0.4) * (p.role === 'ADMIN' ? 1.8 : p.role === 'MOD' ? 1.4 : 1), 0, 5);
        return { p, score };
      });

      // simple roulette selection:
      const total = scored.reduce((s, it) => s + it.score, 0);
      const selection = [];
      for (let i = 0; i < Math.min(n, people.length); i++) {
        let pickVal = Math.random() * (total || 1);
        for (let j = 0; j < scored.length; j++) {
          pickVal -= scored[j].score;
          if (pickVal <= 0) {
            selection.push(scored[j].p);
            scored.splice(j, 1);
            break;
          }
        }
      }

      // update lastActive for chosen
      const nowTs = Date.now();
      selection.forEach(s => {
        s.lastActive = nowTs - Math.floor(Math.random() * 45000); // within last 45s
      });

      return selection;
    },

    /* fatigue management (persisted) */
    setFatigue(id, score) {
      score = clamp(score, 0, 1);
      this._fatigue[id] = { score: Number(score), updated: Date.now() };
      saveFatigue(this._fatigue);
    },
    getFatigue(id) {
      return (this._fatigue[id] && this._fatigue[id].score) || 0;
    },

    /* inject generated people into a target array (mutates targetArray) */
    populateGlobal(opts = {}) {
      // opts.fillTo: total desired count (e.g. 4872)
      const fillTo = Math.max(1, Math.floor(opts.fillTo || 1000));
      // prefer existing stored people
      if (!this._store.people.length) {
        this.init({ targetCount: Math.min(1000, fillTo) });
      }
      const existing = window.sampleMembers && Array.isArray(window.sampleMembers) ? window.sampleMembers : [];
      // If existing length is small, replace with generated store to guarantee uniqueness
      if (existing.length < 30 || opts.replace === true) {
        // create a copy of store.people (cloned) and pad to fillTo
        const arr = this._store.people.slice();
        let idx = arr.length;
        while (arr.length < fillTo) {
          arr.push(this.generateBatch(1, { offset: idx })[0]);
          idx++;
        }
        // set global
        window.sampleMembers = arr;
        // update UI counts if present
        try {
          const el = document.getElementById('memberCount');
          if (el) el.textContent = String(fillTo.toLocaleString ? fillTo.toLocaleString() : fillTo);
        } catch (e) {}
        return window.sampleMembers;
      } else {
        // If there is already a populated sampleMembers, extend it up to fillTo with unique generated entries
        const names = new Set(existing.map(x => x.name));
        const toAdd = [];
        let offset = existing.length;
        while (existing.length + toAdd.length < fillTo) {
          const candidate = this.generateBatch(1, { offset })[0];
          offset++;
          if (!names.has(candidate.name)) {
            toAdd.push(candidate);
            names.add(candidate.name);
          }
          if (toAdd.length > 5000) break;
        }
        existing.push(...toAdd);
        window.sampleMembers = existing;
        try {
          const el = document.getElementById('memberCount');
          if (el) el.textContent = String(window.sampleMembers.length.toLocaleString ? window.sampleMembers.length.toLocaleString() : window.sampleMembers.length);
        } catch (e) {}
        return window.sampleMembers;
      }
    },

    /* helper to pre-generate a name list (for uniqueness and templates) */
    generateNameTemplate(count = 1000, seed) {
      const rng = makeRng(seed || Date.now() & 0x7fffffff);
      const set = new Set();
      const out = [];
      let tries = 0;
      while (out.length < count && tries < count * 5) {
        const name = (Math.random() < 0.12 ? pick(rng, cryptoHandles) : `${pick(rng, firstNames)} ${pick(rng, lastNames)}`);
        if (!set.has(name)) {
          set.add(name);
          out.push(name);
        }
        tries++;
      }
      return out;
    },

    /* small debug / introspect */
    info() {
      return {
        count: this._store.people.length,
        seed: (this._store.meta || {}).seed,
        fatigueEntries: Object.keys(this._fatigue).length
      };
    }
  };

  // Load previously persisted people automatically if present
  const loaded = loadStore();
  if (loaded && Array.isArray(loaded.people) && loaded.people.length > 0) {
    PeopleStore._store = loaded;
  }

  // expose
  window.PeopleStore = PeopleStore;

  // compatibility helper if UI expects sampleMembers at load time (do not override if present)
  if (!window.sampleMembers || !Array.isArray(window.sampleMembers) || window.sampleMembers.length < 20) {
    // create a small set (default 120) to keep UI responsive, dev can extend later
    PeopleStore.init({ targetCount: 120 });
    // assign but keep reference safe
    window.sampleMembers = PeopleStore.getAll();
  }

  // end
})();
