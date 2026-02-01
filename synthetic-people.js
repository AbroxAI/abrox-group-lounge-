// synthetic-people-expanded.js
// Expanded SyntheticPeople for long-lived realism (years)
// Patched: avatar selection logic, explicit avatarMix handling, large-pool warning.
// Save as synthetic-people-expanded.js and include it before other simulation scripts.

(function globalSyntheticPeopleExpanded(){
  if (window.SyntheticPeople) return; // don't override if another implementation exists

  /* ---------------- Storage helpers ---------------- */
  const LS_PREFIX = 'abrox.synthetic.';
  function lsGet(key, fallback){ try{ const v = localStorage.getItem(LS_PREFIX + key); return v ? JSON.parse(v) : fallback; }catch(e){ return fallback; } }
  function lsSet(key, val){ try{ localStorage.setItem(LS_PREFIX + key, JSON.stringify(val)); }catch(e){} }

  /* ---------------- Deterministic PRNG (xorshift32) ---------------- */
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
  function uid(prefix='m'){ return prefix + '_' + Math.random().toString(36).slice(2,9); }

  /* ---------------- Fixed admin/mod ---------------- */
  const FIXED_ADMIN = {
    shortName: 'Profit_Hunter',
    displayName: 'Profit Hunter 🌐',
    role: 'ADMIN',
    avatar: 'assets/admin.jpg',
    id: 'admin_profit_hunter'
  };
  const FIXED_MOD = {
    shortName: 'Kitty_Star',
    displayName: 'Kitty Star ⭐',
    role: 'MOD',
    avatar: 'assets/mod.jpg',
    id: 'mod_kitty_star'
  };

  /* ---------------- Expanded name pools ---------------- */
  const FIRST = [
    'Alex','Sam','Taylor','Jordan','Morgan','Casey','Riley','Cameron','Jamie','Robin','Avery','Drew','Quinn','Harper','Sky','Kai','Dev','Noor','Maya','Ibrahim',
    'Omar','Amira','Levi','Zoe','Liam','Aria','Mateo','Nina','Yara','Eli','Sofia','Lucas','Isla','Ethan','Chloe','Noah','Luna','Ava','Mason','Mila',
    'Hugo','Ivy','Arjun','Fatima','Salim','Diego','Sara','Rosa','Hana','Kofi','Ines','Rafael','Marta','Anya','Viktor','Ken','Aisha','Olu','Evelyn','Nora',
    'Theo','Oscar','Lara','Zain','Yuki','Rina','Sven','Mariam','Boris','Alina','Hassan','Rami','Jade','Ruben','Nadia','Gabe','Tara','Iris','Kian','Mira',
    'Selin','Anil','Sora','Mitsu','Hector','Lina','Kei','Raya','Iman','Zara','Beno','Celia','Dara','Enzo','Fahad','Gina','Youssef','Leela','Pavan','Ritu'
  ];

  const MIDDLE = [
    '', 'Lee', 'Kai', 'Jean', 'Noor', 'Lynn', 'Roy', 'Anne', 'Ray', 'J', 'A.', 'X', 'Sol', 'Ny', 'Rey', ''
  ];

  const LAST = [
    'Lee','Patel','Singh','Garcia','Kim','Nguyen','Johnson','Brown','Wilson','Martinez','Silva','Costa','Ivanov','Chen','Khan','Mendes','Gomez','Rossi','Moreau','Okoye',
    'Hernandez','Santos','Lopez','Kaur','Yamamoto','Kowalski','Popov','Petrov','Kilic','Muller','Schmidt','Nowak','Ferreira','Ali','Hosseini','Osei','Bello','Akande',
    'Park','Tran','Liu','Zhang','Wang','Hussain','Ramos','Pereira','Das','Mehta','Abdullah','Bakar','Herrera','Gonzalez','Moretti','Ricci','Bianchi','Youssef',
    'Souza','Pinto','Martins','Khatri','Chowdhury','Okafor','Ibrahim','Roman','Diaz','Blanco','Klein','Smith','Adams','Ng','Sato','Ito','Murphy','Kelly','Parker'
  ];

  const EMOJI = ['🌐','⭐','🚀','💎','🔥','📈','🤖','🪙','⚡','🔒','✨','🦄'];
  const TITLES = ['', '', '', 'Jr','Sr','II','III','_x','_bot','_VIP','_OG'];

  const COUNTRIES = ['US','GB','NG','IN','PK','CN','RU','BR','CA','AU','TR','AE','DE','FR','ZA','EG','SA','JP','KR','ES','IT','NL','SE','NO','MX','AR'];
  const LANGS = ['en','es','fr','pt','ar','ru','zh','hi','tr','ur','nl','sv','no','it','de','fa','bn','yo','ig','ha'];

  const ARCHETYPES = ['Analyst','MemeTrader','HODLer','BotBuilder','Shiller','Moderator','QuietObserver','Questioner','Researcher','Whale','DayTrader','Scalper','Investor'];
  const EMOTIONS = ['neutral','positive','excited','angry','skeptical','curious','tired','confident','nervous'];

  /* ---------------- Avatar helpers ---------------- */
  const DEFAULT_DICEBEAR_STYLES = ['micah','adventurer','pixel-art','identicon','personas','big-ears','gridy'];
  function dicebear(seed, style){
    return `https://api.dicebear.com/6.x/${encodeURIComponent(style)}/svg?seed=${encodeURIComponent(seed)}&scale=100`;
  }
  function pravatar(index){
    const id = (index % 70) + 1;
    return `https://i.pravatar.cc/150?img=${id}`;
  }

  /* ---------------- Profile persistence helpers ---------------- */
  function profileKey(shortName){ return 'profile.' + shortName; }
  function loadProfile(shortName){ return lsGet(profileKey(shortName), null); }
  function saveProfile(shortName, profile){ lsSet(profileKey(shortName), profile); }

  /* ---------------- Generator factory ---------------- */
  function makeGenerator(seedBase, dicebearStyles, avatarMix){
    const rnd = xorshift32(seedBase || 2026);
    const styles = Array.isArray(dicebearStyles) && dicebearStyles.length ? dicebearStyles.slice() : DEFAULT_DICEBEAR_STYLES.slice();
    const mix = (typeof avatarMix === 'number' ? clamp(avatarMix,0,1) : 0.6);

    return {
      rnd,
      pickFirst: () => FIRST[Math.floor(rnd()*FIRST.length)],
      pickMiddle: () => MIDDLE[Math.floor(rnd()*MIDDLE.length)],
      pickLast: () => LAST[Math.floor(rnd()*LAST.length)],
      pickEmoji: () => EMOJI[Math.floor(rnd()*EMOJI.length)],
      pickTitle: () => TITLES[Math.floor(rnd()*TITLES.length)],
      pickCountry: () => COUNTRIES[Math.floor(rnd()*COUNTRIES.length)],
      pickLang: () => LANGS[Math.floor(rnd()*LANGS.length)],
      pickArchetype: () => ARCHETYPES[Math.floor(rnd()*ARCHETYPES.length)],
      pickEmotion: () => EMOTIONS[Math.floor(rnd()*EMOTIONS.length)],
      pickStyle: () => styles[Math.floor(rnd()*styles.length)],
      avatarMix: mix,
      avatarForIndex(i, nameSeed, allowRealPhotos = true){
        // Clear, predictable behavior:
        // - if allowRealPhotos === false => always DiceBear
        // - else: use DiceBear with probability avatarMix, else pravatar
        const v = rnd();
        if(!allowRealPhotos){
          const st = this.pickStyle();
          return dicebear(nameSeed + '|' + i, st);
        }
        if(v <= this.avatarMix){
          const st = this.pickStyle();
          return dicebear(nameSeed + '|' + i, st);
        } else {
          return pravatar(i + Math.floor(rnd()*1000));
        }
      },
      rollRole(i, includeAdmin, includeMod){
        if(i === 0 && includeAdmin) return 'ADMIN';
        if(i === 1 && includeMod) return 'MOD';
        const r = rnd();
        if(r < 0.02) return 'ADMIN';
        if(r < 0.08) return 'MOD';
        return 'VERIFIED';
      }
    };
  }

  /* ---------------- Unique display name helper ---------------- */
  function ensureUnique(displayName, used, rndForSuffix){
    if(!used.has(displayName)){ used.add(displayName); return displayName; }
    const base = displayName.replace(/[^a-zA-Z0-9\s_]/g,'').trim() || 'User';
    for(let i=1;i<=9999;i++){
      let candidate;
      if(i < 10 && typeof rndForSuffix === 'function'){
        const r = rndForSuffix();
        if(r < 0.18){
          candidate = `${base} ${EMOJI[i % EMOJI.length]}`;
        } else if(r < 0.36){
          candidate = `${base}${TITLES[i % TITLES.length]}${i}`;
        } else {
          candidate = `${base}_${i}`;
        }
      } else {
        candidate = `${base}_${i}`;
      }
      if(!used.has(candidate)){ used.add(candidate); return candidate; }
    }
    const fallback = displayName + '_' + Date.now();
    used.add(fallback);
    return fallback;
  }

  /* ---------------- SyntheticPeople API ---------------- */
  const SyntheticPeople = {
    people: [],
    meta: {
      size: 4872,
      seedBase: 2026,
      dicebearStyles: DEFAULT_DICEBEAR_STYLES.slice(),
      avatarMix: 0.6,
      includeAdmin: true,
      includeMod: true
    },

    // generatePool: deterministic generation (can scale up). Keep lazy=false for full memory pool.
    generatePool(opts){
      opts = opts || {};
      const size = clamp(Number(opts.size) || this.meta.size || 4872, 3, 500000); // allow large but warn in docs
      const seedBase = Number(opts.seedBase) || this.meta.seedBase || 2026;
      const dicebearStyles = opts.dicebearStyles && Array.isArray(opts.dicebearStyles) && opts.dicebearStyles.length ? opts.dicebearStyles : this.meta.dicebearStyles;
      const avatarMix = typeof opts.avatarMix === 'number' ? clamp(opts.avatarMix, 0, 1) : this.meta.avatarMix;
      const includeAdmin = opts.includeAdmin !== false;
      const includeMod = opts.includeMod !== false;
      const allowRealPhotos = opts.allowRealPhotos !== false;

      // warn if user tries to create huge in-browser pools
      if(size > 100000){
        console.warn(`SyntheticPeople.generatePool: creating very large pool (${size}) in-browser may be slow or memory-heavy. Consider pre-generating server-side or using lazy message generation.`);
      }

      this.meta = { size, seedBase, dicebearStyles, avatarMix, includeAdmin, includeMod };

      // build generator with access to avatarMix
      const gen = makeGenerator(seedBase, dicebearStyles, avatarMix);

      const arr = [];
      const usedNames = new Set();

      // Reserve fixed admin/mod display names to prevent collision
      if(includeAdmin) usedNames.add(FIXED_ADMIN.displayName);
      if(includeMod) usedNames.add(FIXED_MOD.displayName);

      for(let i=0;i<size;i++){
        // fixed admin slot
        if(i === 0 && includeAdmin){
          const shortName = FIXED_ADMIN.shortName;
          const displayName = FIXED_ADMIN.displayName;
          let profile = loadProfile(shortName) || {};
          if(profile.fatigue === undefined) profile.fatigue = 0.05;
          if(!profile.archetype) profile.archetype = 'Moderator';
          if(!profile.lang) profile.lang = 'en';
          saveProfile(shortName, profile);

          arr.push({
            id: FIXED_ADMIN.id,
            name: shortName,
            displayName: displayName,
            role: FIXED_ADMIN.role,
            avatar: FIXED_ADMIN.avatar,
            country: 'US',
            language: profile.lang,
            emotionBaseline: 'neutral',
            personality: profile.archetype,
            fatigue: profile.fatigue,
            authority: 3,
            lastActive: Date.now()
          });
          continue;
        }

        // fixed mod slot
        if(i === 1 && includeMod){
          const shortName = FIXED_MOD.shortName;
          const displayName = FIXED_MOD.displayName;
          let profile = loadProfile(shortName) || {};
          if(profile.fatigue === undefined) profile.fatigue = 0.08;
          if(!profile.archetype) profile.archetype = 'Moderator';
          if(!profile.lang) profile.lang = 'en';
          saveProfile(shortName, profile);

          arr.push({
            id: FIXED_MOD.id,
            name: shortName,
            displayName: displayName,
            role: FIXED_MOD.role,
            avatar: FIXED_MOD.avatar,
            country: 'US',
            language: profile.lang,
            emotionBaseline: 'neutral',
            personality: profile.archetype,
            fatigue: profile.fatigue,
            authority: 2,
            lastActive: Date.now() - 60000
          });
          continue;
        }

        // otherwise generate deterministic profile
        const shortName = `Member_${(i+1).toString().padStart(6,'0')}`; // padded for large pools
        const rndLocal = xorshift32(seedBase + i * 97); // per-member deterministic PRNG
        const first = gen.pickFirst();
        const middle = gen.pickMiddle();
        const last = gen.pickLast();
        let displayName = middle ? `${first} ${middle} ${last}` : `${first} ${last}`;

        const nameFlavor = Math.floor(gen.rnd()*100);
        if(nameFlavor < 6){
          displayName = (gen.rnd() < 0.5) ? `${gen.pickEmoji()} ${displayName}` : `${displayName} ${gen.pickEmoji()}`;
        } else if(nameFlavor < 14){
          displayName = gen.rnd() < 0.5 ? displayName.toLowerCase() : displayName.charAt(0).toUpperCase() + displayName.slice(1);
        } else if(nameFlavor < 24){
          displayName = `${displayName}${TITLES[Math.floor(gen.rnd()*TITLES.length)]}${Math.floor(gen.rnd()*999)}`;
        }

        // ensure uniqueness, passing rndLocal for varied suffixes
        displayName = ensureUnique(displayName, usedNames, rndLocal);

        // role and persisted profile
        const role = gen.rollRole(i, includeAdmin, includeMod);
        let profile = loadProfile(shortName) || {};
        if(profile.fatigue === undefined) {
          profile.fatigue = clamp(gen.rnd() * 0.25 + (i % 50 === 0 ? 0.1 : 0), 0, 0.95);
        }
        if(!profile.archetype) profile.archetype = gen.pickArchetype();
        if(!profile.lang) profile.lang = gen.pickLang();
        saveProfile(shortName, profile);

        // avatar (use allowRealPhotos to reduce calls to pravatar for purely-cartoon setups)
        const avatar = (i === 0 && includeAdmin) ? FIXED_ADMIN.avatar :
                       (i === 1 && includeMod) ? FIXED_MOD.avatar :
                       gen.avatarForIndex(i, shortName, allowRealPhotos);

        const country = gen.pickCountry();
        const emotionBaseline = gen.pickEmotion();
        const personality = profile.archetype || gen.pickArchetype();
        // lastActive spread so not everyone is at same time
        const lastActive = Date.now() - Math.floor(gen.rnd()*1000*60*60*24*14); // up to 14 days

        const member = {
          id: 'm_' + (i+1) + '_' + seedBase,
          name: shortName,
          displayName,
          role,
          avatar,
          country,
          language: profile.lang,
          emotionBaseline,
          personality,
          fatigue: profile.fatigue,
          authority: role === 'ADMIN' ? 3 : role === 'MOD' ? 2 : 1,
          lastActive
        };
        arr.push(member);
      }

      this.people = arr;
      lsSet('last_meta', this.meta);
      lsSet('pool_size', size);
      return this.people;
    },

    // regenerate and inject into UI, with optional prefetch of avatars
    async regenerateAndInject(opts){
      opts = opts || {};
      const asyncPrefetch = !!opts.async;
      const pool = this.generatePool(opts);
      if(opts.prefetchAvatars){
        const p = this.prefetchAvatars(opts.prefetchCount || Math.min(pool.length, 2000));
        if(!asyncPrefetch) await p;
      }
      this.injectToUI();
      return pool;
    },

    // export minimal format for UI
    exportForSimulation(){
      return (this.people || []).map(p => ({
        id: p.id,
        name: p.name,
        displayName: p.displayName,
        role: p.role,
        avatar: p.avatar,
        language: p.language,
        emotionBaseline: p.emotionBaseline,
        personality: p.personality,
        fatigue: p.fatigue,
        authority: p.authority,
        lastActive: p.lastActive
      }));
    },

    // inject into UI: expects window._abrox.setSampleMembers
    injectToUI(){
      if(window._abrox && typeof window._abrox.setSampleMembers === 'function'){
        try{
          window._abrox.setSampleMembers(this.exportForSimulation());
          return true;
        }catch(err){
          console.warn('SyntheticPeople.injectToUI failed', err);
          return false;
        }
      } else {
        console.warn('SyntheticPeople.injectToUI: _abrox.setSampleMembers not found');
        return false;
      }
    },

    // prefetch avatars to warm browser cache (returns Promise)
    prefetchAvatars(count){
      count = Math.max(1, Math.min((this.people && this.people.length) || 0, Number(count) || 200));
      const list = (this.people || []).slice(0, count).map(m => m.avatar).filter(Boolean);
      return new Promise((resolve) => {
        if(!list.length){ resolve([]); return; }
        let loaded = 0; const results = [];
        list.forEach((src, idx) => {
          try{
            const img = new Image();
            let done = false;
            const fin = (ok) => {
              if(done) return; done = true;
              results[idx] = { src, ok: !!ok };
              loaded++;
              if(loaded >= list.length) resolve(results);
            };
            img.onload = () => fin(true);
            img.onerror = () => fin(false);
            setTimeout(()=> fin(false), 4500);
            img.src = src;
          }catch(e){
            results[idx] = { src, ok:false }; loaded++;
            if(loaded >= list.length) resolve(results);
          }
        });
      });
    },

    // pre-generate name variants to inspect or warm uniqueness without making full members (useful for very large pools)
    preGenerateNames(count, opts){
      opts = opts || {};
      const seedBase = Number(opts.seedBase || this.meta.seedBase || 2026);
      const dicebearStyles = opts.dicebearStyles || this.meta.dicebearStyles;
      const avatarMix = typeof opts.avatarMix === 'number' ? clamp(opts.avatarMix, 0, 1) : this.meta.avatarMix;
      const gen = makeGenerator(seedBase, dicebearStyles, avatarMix);
      const used = new Set();
      const out = [];
      for(let i=0;i<count;i++){
        const rndLocal = xorshift32(seedBase + i * 97);
        const first = gen.pickFirst();
        const middle = gen.pickMiddle();
        const last = gen.pickLast();
        let displayName = middle ? `${first} ${middle} ${last}` : `${first} ${last}`;
        const nameFlavor = Math.floor(gen.rnd()*100);
        if(nameFlavor < 6){
          displayName = (gen.rnd() < 0.5) ? `${gen.pickEmoji()} ${displayName}` : `${displayName} ${gen.pickEmoji()}`;
        } else if(nameFlavor < 14){
          displayName = gen.rnd() < 0.5 ? displayName.toLowerCase() : displayName.charAt(0).toUpperCase() + displayName.slice(1);
        } else if(nameFlavor < 24){
          displayName = `${displayName}${TITLES[Math.floor(gen.rnd()*TITLES.length)]}${Math.floor(gen.rnd()*999)}`;
        }
        const unique = ensureUnique(displayName, used, rndLocal);
        out.push(unique);
      }
      return out;
    },

    // change profile and persist for a member
    setProfile(shortName, patch){
      if(!shortName) return false;
      const key = profileKey(shortName);
      const profile = lsGet(key, {}) || {};
      Object.assign(profile, patch || {});
      saveProfile(shortName, profile);
      const p = (this.people || []).find(x => x.name === shortName);
      if(p){
        if(patch.fatigue !== undefined) p.fatigue = patch.fatigue;
        if(patch.archetype) p.personality = patch.archetype;
        if(patch.lang) p.language = patch.lang;
      }
      return true;
    },

    findByName(nameOrDisplay){
      return (this.people || []).find(p => p.name === nameOrDisplay || p.displayName === nameOrDisplay || p.id === nameOrDisplay) || null;
    },

    pickRandom(filter){
      const pool = filter ? (this.people || []).filter(filter) : (this.people || []);
      if(!pool || !pool.length) return null;
      const idx = Math.floor(Math.random()*pool.length);
      return pool[idx];
    },

    previewAvatarUrls(count){
      const gen = makeGenerator(this.meta.seedBase, this.meta.dicebearStyles, this.meta.avatarMix);
      gen.avatarMix = this.meta.avatarMix;
      const out = [];
      for(let i=0;i<count;i++){
        if(i === 0 && this.meta.includeAdmin) out.push(FIXED_ADMIN.avatar);
        else if(i === 1 && this.meta.includeMod) out.push(FIXED_MOD.avatar);
        else out.push(gen.avatarForIndex(i, `Member_${i+1}`));
      }
      return out;
    },

    // Simulate presence step: nudges lastActive for a fraction of members to simulate activity cycles.
    // call this periodically (e.g., every minute) to animate online counts.
    simulatePresenceStep(opts){
      opts = opts || {};
      if(!this.people || !this.people.length) return 0;
      const pct = typeof opts.percent === 'number' ? clamp(opts.percent, 0, 1) : 0.01; // default 1% churn
      const seed = Number(opts.seedBase || this.meta.seedBase || 2026);
      const rnd = xorshift32(seed + Date.now() % 100000);
      const count = Math.max(1, Math.floor(this.people.length * pct));
      for(let i=0;i<count;i++){
        const idx = Math.floor(rnd() * this.people.length);
        const p = this.people[idx];
        // nudge lastActive to now - small offset to mark as online/idle
        p.lastActive = Date.now() - Math.floor(rnd()*1000*60*3); // active within last 3 minutes
      }
      return count;
    },

    // Estimate how many unique people you'd need to avoid name repeats over a duration
    // based on approximate message rate. Useful for planning pool size for "years" of unique-looking names.
    estimatePoolForDuration({ msgsPerMin = 40, durationDays = 365 * 2, messagesPerPersonPerDay = 5 } = {}){
      const totalMsgs = msgsPerMin * 60 * 24 * durationDays;
      const estimatedPeople = Math.ceil(totalMsgs / (messagesPerPersonPerDay * durationDays));
      return { totalMsgs, estimatedPeople };
    }

  }; // end SyntheticPeople object

  // attach to window
  window.SyntheticPeople = SyntheticPeople;

  /* ---------------- Auto-init: restore or generate default pool ---------------- */
  (function autoInit(){
    try{
      const lastMeta = lsGet('last_meta', null);
      if(lastMeta && lastMeta.size && lastMeta.seedBase){
        SyntheticPeople.generatePool(lastMeta);
        setTimeout(()=> { try{ SyntheticPeople.injectToUI(); }catch(e){} }, 300);
      } else {
        SyntheticPeople.generatePool({ size: 4872, seedBase: 2026, dicebearStyles: ['micah','adventurer','pixel-art'], avatarMix: 0.6, includeAdmin:true, includeMod:true });
        setTimeout(()=> { try{ SyntheticPeople.injectToUI(); }catch(e){} }, 300);
      }
    }catch(e){
      console.warn('SyntheticPeople.autoInit failed', e);
    }
  })();

})();
