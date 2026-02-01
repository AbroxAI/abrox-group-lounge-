// synthetic-people.js
// Synthetic People generator (pool = 4872, seedBase = 20264872, DiceBear style "adventurer")

(function(){
  if(window.SyntheticPeople) return;

  // seeded PRNG (xorshift32)
  function xorshift32(seed){
    let x = seed >>> 0;
    if(x === 0) x = 0x811c9dc5;
    return function(){
      x ^= x << 13; x >>>= 0;
      x ^= x >>> 17; x >>>= 0;
      x ^= x << 5; x >>>= 0;
      return (x >>> 0) / 4294967295;
    };
  }

  function clamp(v, min, max){ return Math.max(min, Math.min(max, v)); }
  function lsGet(k, fallback){ try{ const s = localStorage.getItem(k); return s?JSON.parse(s):fallback; }catch(e){ return fallback; } }
  function lsSet(k, v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} }

  const FIRST = ['Alex','Sam','Taylor','Jordan','Morgan','Casey','Riley','Cameron','Jamie','Robin','Avery','Drew','Quinn','Harper','Kai','Noah','Luna','Maya','Omar','Zoe','Ivy','Eli','Nora','Ibrahim','Fatima','Diego','Sofia','Yara','Ilya','Amir','Leila','Olu','Chinwe'];
  const LAST = ['Lee','Patel','Singh','Garcia','Kim','Nguyen','Johnson','Brown','Wilson','Martinez','Silva','Costa','Ivanov','Chen','Khan','Hassan','Popov','Moretti','Dubois','Okafor','Mensah'];
  const COUNTRIES = ['US','GB','NG','IN','PK','CN','RU','BR','CA','AU','TR','AE','DE','FR','NL','ES','AR','MX'];
  const LANG = ['en','es','fr','pt','ar','ru','zh','hi','tr','ur'];
  const ARCHETYPES = ['Analyst','MemeTrader','HODLer','BotBuilder','Shiller','Moderator','QuietObserver','Questioner','WhaleWatcher','Scalper','LongTerm'];
  const EMOTIONS = ['neutral','positive','excited','angry','skeptical','curious','tired'];

  const DEFAULT_POOL_SIZE = 4872;
  const SEED_BASE = 20264872;
  const AVATAR_STYLE = 'adventurer'; // chosen style

  function dicebearAvatar(seed, style){
    style = style || AVATAR_STYLE;
    // use svg endpoint
    return `https://api.dicebear.com/6.x/${encodeURIComponent(style)}/svg?seed=${encodeURIComponent(seed)}&scale=85`;
  }

  function loadProfile(key){ return lsGet('abrox.profile.' + key, null); }
  function saveProfile(key, profile){ lsSet('abrox.profile.' + key, profile); }

  // ensure unique short names
  function uniqueName(base, used){
    let name = base;
    let i = 1;
    while(used.has(name)){
      name = base + (Math.random() > 0.5 ? `_${i}` : `${i}`);
      i++;
      if(i>10000) break;
    }
    used.add(name);
    return name;
  }

  function generateMember(i, opts){
    opts = opts || {};
    const seedBase = Number(opts.seedBase || SEED_BASE);
    const rnd = xorshift32(seedBase + i + 11);
    const first = FIRST[Math.floor(rnd()*FIRST.length)];
    const last = LAST[Math.floor(rnd()*LAST.length)];

    const nameForms = [
      `${first} ${last}`,
      `${first}.${last}`,
      `${first}_${Math.floor(rnd()*99)}`,
      `${first}${['','!','🚀','💎'][Math.floor(rnd()*4)]}`,
      `${first} ${last}${Math.random()>0.85?(' ' + Math.floor(rnd()*999)):''}`
    ];
    const displayName = nameForms[Math.floor(rnd()*nameForms.length)];

    let role = 'VERIFIED';
    if(i===0 && opts.includeAdmin) role='ADMIN';
    else if(i===1 && opts.includeMod) role='MOD';
    else {
      const r = rnd();
      role = r < 0.015 ? 'ADMIN' : r < 0.07 ? 'MOD' : 'VERIFIED';
    }

    const country = COUNTRIES[Math.floor(rnd()*COUNTRIES.length)];
    const language = LANG[Math.floor(rnd()*LANG.length)];
    const personality = ARCHETYPES[Math.floor(rnd()*ARCHETYPES.length)];
    const emotion = EMOTIONS[Math.floor(rnd()*EMOTIONS.length)];

    const shortName = `member_${i+1}`;
    let profile = loadProfile(shortName) || {};
    if(profile.fatigue === undefined) profile.fatigue = clamp(rnd()*0.35, 0, 0.95);
    if(!profile.archetype) profile.archetype = personality;
    if(!profile.lang) profile.lang = language;
    saveProfile(shortName, profile);

    const avatarSeed = `${shortName}|${displayName}|${seedBase}`;
    const styleChoice = (rnd() < 0.18) ? 'pixel-art' : AVATAR_STYLE;
    const avatarUrl = dicebearAvatar(avatarSeed, styleChoice);

    const mem = {
      id: 'm_' + i + '_' + (seedBase||0),
      name: uniqueName(shortName, generateMember._usedNames || (generateMember._usedNames = new Set())),
      displayName: displayName,
      role: role,
      avatar: avatarUrl,
      country: country,
      language: profile.lang || language,
      emotionBaseline: emotion,
      personality: profile.archetype || personality,
      fatigue: profile.fatigue,
      authority: role==='ADMIN'?3:role==='MOD'?2:1,
      lastActive: Date.now() - Math.floor(rnd()*1000*60*60)
    };
    return mem;
  }

  const SyntheticPeople = {
    people: [],
    generatePool(opts){
      opts = opts || {};
      const size = clamp(Number(opts.size) || DEFAULT_POOL_SIZE, 3, 20000);
      const seedBase = Number(opts.seedBase || SEED_BASE);
      const includeAdmin = opts.includeAdmin !== false;
      const includeMod = opts.includeMod !== false;

      generateMember._usedNames = new Set();
      const arr = [];
      for(let i=0;i<size;i++){
        const m = generateMember(i, { seedBase, includeAdmin, includeMod });
        arr.push(m);
      }
      this.people = arr;
      lsSet('abrox.pool.meta', { size, seedBase, ts: Date.now() });
      return this.people;
    },
    exportForSimulation(){
      return this.people.map(p=>({
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
    injectToUI(){
      if(window._abrox && typeof window._abrox.setSampleMembers === 'function'){
        try{ window._abrox.setSampleMembers(this.exportForSimulation()); return true; }catch(e){ console.warn('SyntheticPeople.injectToUI failed', e); return false; }
      }
      // fallback: try internal hook
      if(window._abrox && window._abrox._internal && typeof window._abrox._internal.setSampleMembers === 'function'){
        try{ window._abrox._internal.setSampleMembers(this.exportForSimulation()); return true; }catch(e){ console.warn('SyntheticPeople.injectToUI internal failed', e); return false; }
      }
      return false;
    },
    pickRandom(filter){
      const pool = filter ? this.people.filter(filter) : this.people;
      if(!pool || !pool.length) return null;
      return pool[Math.floor(Math.random()*pool.length)];
    },
    findByName(n){ return this.people.find(p => p.name === n || p.displayName === n); },
    setProfile(name, patch){ if(!name) return; const key = name; let profile = loadProfile(key) || {}; Object.assign(profile, patch); saveProfile(key, profile); const p = this.findByName(name); if(p){ if(patch.fatigue !== undefined) p.fatigue = patch.fatigue; if(patch.archetype) p.personality = patch.archetype; } },
    // optional: prefetch and cache first N avatars as data urls (careful: localStorage size)
    async precacheAvatars(limit){
      limit = Math.min(2000, Number(limit) || 200);
      for(let i=0;i<Math.min(limit, this.people.length); i++){
        const p = this.people[i];
        try{
          const key = 'abrox.avatar.' + p.name;
          if(localStorage.getItem(key)) continue;
          const resp = await fetch(p.avatar);
          if(!resp.ok) continue;
          const svgText = await resp.text();
          // store raw svg (safer than base64 for size)
          lsSet(key, { svg: svgText, ts: Date.now() });
        }catch(e){ /* ignore fetch errors to avoid blocking */ }
      }
      return true;
    }
  };

  window.SyntheticPeople = SyntheticPeople;

  // auto-generate pool and inject
  (function autoInit(){
    try{
      const meta = lsGet('abrox.pool.meta', null);
      const shouldGen = !meta || meta.size !== DEFAULT_POOL_SIZE || meta.seedBase !== SEED_BASE;
      if(shouldGen || !Array.isArray(window.SyntheticPeople.people) || window.SyntheticPeople.people.length < 50){
        window.SyntheticPeople.generatePool({ size: DEFAULT_POOL_SIZE, seedBase: SEED_BASE, includeAdmin:true, includeMod:true });
      }
      setTimeout(()=>{ try{ window.SyntheticPeople.injectToUI(); }catch(e){} }, 250);
    }catch(e){}
  })();

})();
