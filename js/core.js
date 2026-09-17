/* core.js — shared contract for all modules.
   Owns: view registry + router, UI helpers, schedule helpers, the Data layer
   (localStorage + deterministic demo seed), and the persona (auth stub).
   Modules must go through Data.* for ALL persistence — never touch localStorage.
   Template CONTENT lives in js/templates-data.js (registered via Data.registerTemplates).
   Seeded history references the canonical template ids in CORE_TEMPLATE_IDS. */

'use strict';

/* ---------------- UI helpers ---------------- */
const UI = {
  esc(s){ return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); },
  el(tag, attrs = {}, html){ const e = document.createElement(tag);
    for (const [k,v] of Object.entries(attrs)) { if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v); }
    if (html !== undefined) e.innerHTML = html; return e; },
  toast(msg){ const t = document.getElementById('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(UI._tt); UI._tt = setTimeout(()=>t.classList.remove('show'), 2600); },
  modal(title, bodyHTML, actions = []){ // actions: [{label, cls?, onClick(close)}] — returns close()
    const wrap = UI.el('div', {class:'modal-wrap'});
    const m = UI.el('div', {class:'modal'});
    m.appendChild(UI.el('h2', {}, UI.esc(title)));
    const body = UI.el('div', {}); body.innerHTML = bodyHTML; m.appendChild(body);
    const act = UI.el('div', {class:'modal-actions'});
    const close = () => wrap.remove();
    actions.forEach(a => act.appendChild(UI.el('button', {class:'btn ' + (a.cls || ''), onclick: () => a.onClick ? a.onClick(close) : close()}, UI.esc(a.label))));
    m.appendChild(act); wrap.appendChild(m);
    wrap.addEventListener('click', e => { if (e.target === wrap) close(); });
    document.body.appendChild(wrap);
    return { close, body };
  },
  fmtDate(iso){ if (!iso) return '—'; const d = new Date(iso); return d.toLocaleDateString(undefined, {month:'short', day:'numeric'}); },
  fmtDateTime(iso){ if (!iso) return '—'; const d = new Date(iso); return d.toLocaleDateString(undefined, {month:'short', day:'numeric'}) + ' ' + d.toLocaleTimeString(undefined, {hour:'numeric', minute:'2-digit'}); },
  dayKey(d){ const x = d instanceof Date ? d : new Date(d); return x.getFullYear() + '-' + String(x.getMonth()+1).padStart(2,'0') + '-' + String(x.getDate()).padStart(2,'0'); },
};

/* ---------------- Schedule helpers ---------------- */
const Sched = {
  isoWeek(d = new Date()){ const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); const day = x.getUTCDay() || 7; x.setUTCDate(x.getUTCDate() + 4 - day); const y0 = new Date(Date.UTC(x.getUTCFullYear(),0,1)); return Math.ceil((((x - y0)/86400000) + 1)/7); },
  quarter(d = new Date()){ return Math.floor(d.getMonth()/3) + 1; },
  // period identity for a cadence — one completion expected per periodKey
  periodKey(cadence, d = new Date(), tpl = null){
    switch (cadence) {
      case 'daily': {
        // overnight windows (e.g. close 16:00–02:00): before the window closes, the
        // submission belongs to the PREVIOUS day's periodKey (the day the window opened).
        if (tpl && tpl.window && tpl.window.startHH > tpl.window.endHH && d.getHours() < tpl.window.endHH) {
          const prev = new Date(d); prev.setDate(prev.getDate() - 1); return UI.dayKey(prev);
        }
        return UI.dayKey(d);
      }
      case 'weekly': return d.getFullYear() + '-W' + String(Sched.isoWeek(d)).padStart(2,'0');
      case 'monthly': return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0');
      case 'quarterly': return d.getFullYear() + '-Q' + Sched.quarter(d);
      default: return null; // adhoc
    }
  },
  // Time-lock: is this template startable right now? Returns {open, reason, opensAt?}
  isOpen(tpl, now = new Date()){
    if (!tpl.window || tpl.cadence === 'adhoc') return { open: true };
    const h = now.getHours() + now.getMinutes()/60;
    const { startHH, endHH } = tpl.window;
    const inWin = startHH <= endHH ? (h >= startHH && h < endHH) : (h >= startHH || h < endHH); // supports overnight windows
    if (inWin) return { open: true };
    const opens = new Date(now); opens.setHours(Math.floor(startHH), Math.round((startHH % 1)*60), 0, 0);
    if (h >= endHH && startHH <= endHH) opens.setDate(opens.getDate() + 1);
    return { open: false, reason: 'Locked until ' + opens.toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'}), opensAt: opens.toISOString() };
  },
  rotatingTheme(tpl, d = new Date()){ if (!tpl.rotatingThemes || !tpl.rotatingThemes.length) return null; return tpl.rotatingThemes[Sched.isoWeek(d) % tpl.rotatingThemes.length]; },
};

/* ---------------- Data layer ---------------- */
const SEED_VERSION = 3; // v3: real store universe seeded from data/org-chart.json when present
let LS_KEY = 'eb_ops_v' + SEED_VERSION; // '-org' suffix added when the real store universe is active
const CORE_TEMPLATE_IDS = ['store-visit','daily-open','daily-mid','daily-close','oea-audit','health-code','travel-path'];

const Data = (() => {
  let db = null;
  let templates = [];           // registered by templates-data.js (defs may also live in db.customTemplates)
  let orgStoresSeed = null;     // real stores from data/org-chart.json (passed to init); null → demo STORE_SEED
  const listeners = new Set();

  function mulberry32(a){ return function(){ a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

  function seed(){
    const rnd = mulberry32(20260916);
    const stores = (orgStoresSeed && orgStoresSeed.length) ? orgStoresSeed.map(s => ({ ...s })) : STORE_SEED.map(s => ({ ...s }));
    // deterministic per-district completion base so Reports show spread whatever the district names are
    const distHash = d => { let h = 0; for (const c of String(d)) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h); };
    const users = [
      { id:'admin',    name:'Eitan Sneider',                   role:'admin',             district:null,    coast:null },
      { id:'rd-west',  name:'Regional Director — West Coast',  role:'regional_director', district:null,    coast:'West' },
      { id:'rd-east',  name:'Regional Director — East Coast',  role:'regional_director', district:null,    coast:'East' },
      { id:'dl-west-a',name:'District Leader (West A)',        role:'district_leader',   district:'West A', coast:'West' },
      { id:'dl-west-b',name:'District Leader (West B)',        role:'district_leader',   district:'West B', coast:'West' },
      { id:'dl-nyc-a', name:'District Leader (NYC A)',         role:'district_leader',   district:'NYC A',  coast:'East' },
      { id:'dl-nyc-b', name:'District Leader (NYC B)',         role:'district_leader',   district:'NYC B',  coast:'East' },
      { id:'gm-brentwood', name:'GM — EB Brentwood',           role:'gm', storeIds:['la-brentwood'], district:'West A', coast:'West' },
    ];
    // 14 days of history for daily templates + sparse store-visit/OEA history.
    const submissions = []; let n = 0;
    const dailyIds = ['daily-open','daily-mid','daily-close','travel-path'];
    const today = new Date(); today.setHours(12,0,0,0);
    for (let back = 13; back >= 0; back--) {
      const day = new Date(today); day.setDate(day.getDate() - back);
      for (const st of stores) {
        for (const tid of dailyIds) {
          // completion probability varies by district so Reports show real spread
          const base = .72 + (distHash(st.district) % 25) / 100;
          if (rnd() < base) {
            const done = new Date(day); done.setHours(tid === 'daily-open' ? 7 : tid === 'daily-mid' ? 13 : tid === 'daily-close' ? 21 : 15, Math.floor(rnd()*50), 0, 0);
            if (done > new Date()) continue;
            submissions.push({ id:'seed-' + (++n), templateId: tid, storeId: st.id, userId: null, seeded: true,
              startedAt: done.toISOString(), submittedAt: done.toISOString(), status:'submitted',
              periodKey: Sched.periodKey('daily', done), score: Math.round(70 + rnd()*30), grade: null, answers: null, photos: null });
          }
        }
      }
    }
    // Every store gets exactly one recent DL store visit, 2–32 days back — the spread
    // powers "Schedule your next store visit" (some stores land at 3–4+ weeks unvisited).
    for (const st of stores) {
      const daysAgo = 2 + Math.floor(rnd() * 31);
      const done = new Date(today); done.setDate(done.getDate() - daysAgo); done.setHours(10 + Math.floor(rnd()*5), Math.floor(rnd()*50), 0, 0);
      submissions.push({ id:'seed-' + (++n), templateId:'store-visit', storeId: st.id, userId: null, seeded: true,
        startedAt: done.toISOString(), submittedAt: done.toISOString(), status:'submitted', periodKey: null,
        score: Math.round(62 + rnd()*38), grade: null, answers: null, photos: null });
    }
    for (const st of stores) if (rnd() < .8) { // monthly OEA for most stores
      const done = new Date(today); done.setDate(2 + Math.floor(rnd()*8)); done.setHours(11, 0, 0, 0);
      if (done <= new Date()) submissions.push({ id:'seed-' + (++n), templateId:'oea-audit', storeId: st.id, userId: null, seeded: true,
        startedAt: done.toISOString(), submittedAt: done.toISOString(), status:'submitted',
        periodKey: Sched.periodKey('monthly', done), score: Math.round(65 + rnd()*35), grade: null, answers: null, photos: null });
    }
    const issueCats = ['Maintenance','Equipment','Food Safety','IT / POS','Marketing / Signage','Staffing'];
    const issues = []; const actions = [];
    for (let i = 0; i < 10; i++) {
      const st = stores[Math.floor(rnd()*stores.length)];
      const cat = issueCats[Math.floor(rnd()*issueCats.length)];
      const created = new Date(today); created.setDate(created.getDate() - Math.floor(rnd()*10)); created.setHours(9 + Math.floor(rnd()*9));
      issues.push({ id:'seed-iss-' + i, storeId: st.id, userId: null, seeded: true, category: cat,
        severity: rnd() < .25 ? 'high' : rnd() < .6 ? 'medium' : 'low',
        description: ['Blender 2 making grinding noise','Walk-in temp reading 44°F','POS terminal frozen at register','Menu board light out','Be-back sign is handwritten — needs approved sign','Low on 16oz cups'][Math.floor(rnd()*6)],
        status: rnd() < .5 ? 'open' : rnd() < .8 ? 'inprogress' : 'resolved',
        createdAt: created.toISOString(), routedTo: { 'Maintenance':'Facilities', 'Equipment':'Facilities', 'Food Safety':'Ops Leadership', 'IT / POS':'IT Helpdesk', 'Marketing / Signage':'Marketing', 'Staffing':'People Team' }[cat], actionId: null });
    }
    const actionTitles = ['Replace lobby menu board bulb','Schedule blender service','Re-train team on curbside handoff','Post approved Power Hour signage','Deep-clean walk-in and re-log temps','Submit planogram photos','Fix patio umbrella','Order backup register tape'];
    for (let i = 0; i < 15; i++) {
      const st = stores[Math.floor(rnd()*stores.length)];
      const created = new Date(today); created.setDate(created.getDate() - Math.floor(rnd()*12));
      const due = new Date(created); due.setDate(due.getDate() + 3 + Math.floor(rnd()*7));
      actions.push({ id:'seed-act-' + i, title: actionTitles[i % actionTitles.length], detail:'', storeId: st.id, seeded: true,
        assigneeId: null, source: rnd() < .4 ? 'inspection' : rnd() < .7 ? 'issue' : 'manual', sourceId: null,
        status: rnd() < .4 ? 'todo' : rnd() < .75 ? 'inprogress' : 'complete',
        dueDate: UI.dayKey(due), createdAt: created.toISOString() });
    }
    const routingRules = [
      { id:'rule-1', category:'Food Safety', minSeverity:'medium', routeTo:'Ops Leadership', autoAction:true,  dueOffsetDays:1 },
      { id:'rule-2', category:'Equipment',   minSeverity:'high',   routeTo:'Facilities',     autoAction:true,  dueOffsetDays:2 },
      { id:'rule-3', category:'IT / POS',    minSeverity:'low',    routeTo:'IT Helpdesk',    autoAction:false, dueOffsetDays:3 },
    ];
    return { seedVersion: SEED_VERSION, storesFingerprint: storesFingerprint(), stores, users, submissions, issues, actions, routingRules, customTemplates: [], templateOverrides: {}, settings: { plAssumptions: { avgCheck: 8.75, txnPerStoreDay: 210 }, testingMode: true } };
  }

  function storesFingerprint(){ return orgStoresSeed ? orgStoresSeed.map(s => s.id).sort().join('|') : 'demo'; }
  function load(){
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        db = JSON.parse(raw);
        if (db.storesFingerprint === storesFingerprint()) return;
        // org-chart store universe changed since this seed (e.g. generator rebuilt) → fresh seed
        setTimeout(() => UI.toast('Store network updated — demo data reseeded'), 400);
      }
    } catch(e){ /* fall through to reseed */ }
    db = seed(); save();
  }
  function save(){ // returns true on success, false if the write itself failed (e.g. storage quota)
    let ok = true;
    try { localStorage.setItem(LS_KEY, JSON.stringify(db)); } catch(e){ UI.toast('Storage full — photo too large? Data not saved.'); ok = false; }
    listeners.forEach(fn => { try { fn(); } catch(_){} });
    return ok;
  }

  return {
    init(orgStores){ orgStoresSeed = orgStores || null; LS_KEY = 'eb_ops_v' + SEED_VERSION + (orgStoresSeed ? '-org' : ''); load(); },
    onChange(fn){ listeners.add(fn); },
    reseed(){ db = seed(); save(); },
    // templates: static defs registered at boot + admin-created customs + admin overrides
    registerTemplates(defs){ templates = defs; },
    templates(){ const overr = db.templateOverrides || {}; const statics = templates.map(t => overr[t.id] ? overr[t.id] : t); return statics.concat(db.customTemplates || []); },
    template(id){ return this.templates().find(t => t.id === id) || null; },
    saveTemplate(tpl){ // admin edit: static ids go to overrides, new ids to customTemplates
      if (templates.some(t => t.id === tpl.id)) { db.templateOverrides[tpl.id] = tpl; }
      else { const i = db.customTemplates.findIndex(t => t.id === tpl.id); if (i >= 0) db.customTemplates[i] = tpl; else db.customTemplates.push(tpl); }
      save(); },
    resetTemplate(id){ delete db.templateOverrides[id]; db.customTemplates = db.customTemplates.filter(t => t.id !== id); save(); },
    // generic collections
    list(coll){ return (db[coll] || []).slice(); },
    get(coll, id){ return (db[coll] || []).find(r => r.id === id) || null; },
    insert(coll, row){ // dedupes by id: an existing row with the same id is replaced, not duplicated
      if (!row.id) row.id = coll.slice(0,3) + '-' + Date.now().toString(36) + '-' + Math.floor(Math.random()*1e4).toString(36);
      const arr = (db[coll] = db[coll] || []);
      const i = arr.findIndex(r => r.id === row.id);
      if (i >= 0) arr[i] = row; else arr.push(row);
      return save() ? row : null;
    },
    update(coll, id, patch){ const r = (db[coll] || []).find(r => r.id === id); if (!r) return null; Object.assign(r, patch); return save() ? r : null; },
    remove(coll, id){ db[coll] = (db[coll] || []).filter(r => r.id !== id); save(); },
    settings(){ return db.settings; },
    saveSettings(patch){ Object.assign(db.settings, patch); save(); },
  };
})();

/* ---------------- Store seed (Adrian's 35 + hierarchy: store → state → coast) ---------------- */
const STORE_SEED = (() => {
  const west = ['la-brentwood','la-westwood','la-cc','la-dtla','weho-sm','weho-sunset','la-encino','la-pasadena','la-culver','ca-hawthorne','ca-hb','ca-newport','ca-irvine','ca-lacosta','ca-sandiego'];
  const districts = { // demo districting for rollups — real mapping comes with the master directory
    'West A': ['la-brentwood','la-westwood','la-cc','weho-sm','weho-sunset'],
    'West B': ['la-dtla','la-encino','la-pasadena','la-culver','ca-hawthorne'],
    'West C': ['ca-hb','ca-newport','ca-irvine','ca-lacosta','ca-sandiego'],
    'NYC A': ['ny-columbus','ny-broadway','ny-hudsonyards','ny-e54','ny-e61','ny-lexington','ny-e85','ny-2ndave','ny-grandcentral'],
    'NYC B': ['ny-parkave','ny-amsterdam','ny-chelsea','ny-hudson','ny-liberty','ny-wallst','ny-soho','ny-flatiron','ny-brooklyn'],
    'Beaming': ['beam-lb','beam-wpb'],
  };
  const distOf = id => Object.keys(districts).find(d => districts[d].includes(id)) || 'Other';
  const RAW = [
    ['la-brentwood','EB Brentwood','CA',34.0490,-118.4698],['la-westwood','EB Westwood','CA',34.0608,-118.4431],
    ['la-cc','EB Century City','CA',34.0573,-118.4173],['la-dtla','EB DTLA','CA',34.0491,-118.2578],
    ['weho-sm','EB West Hollywood (Santa Monica)','CA',34.0897,-118.3638],['weho-sunset','EB West Hollywood (Sunset)','CA',34.0903,-118.3866],
    ['la-encino','EB Encino','CA',34.1573,-118.4953],['la-pasadena','EB Pasadena','CA',34.1478,-118.1411],
    ['la-culver','EB Culver City','CA',34.0215,-118.3914],['ca-hawthorne','EB Hawthorne','CA',33.8963,-118.3550],
    ['ca-hb','EB Huntington Beach','CA',33.6603,-118.0052],['ca-newport','EB Newport Beach','CA',33.6200,-117.9350],
    ['ca-irvine','EB Irvine','CA',33.6618,-117.8568],['ca-lacosta','EB La Costa','CA',33.1032,-117.2665],
    ['ca-sandiego','EB San Diego','CA',32.7228,-117.1672],['ny-columbus','EB Columbus Circle','NY',40.7685,-73.9838],
    ['ny-broadway','EB Midtown Broadway','NY',40.7625,-73.9848],['ny-hudsonyards','EB Hudson Yards','NY',40.7538,-74.0015],
    ['ny-e54','EB East 54th','NY',40.7572,-73.9625],['ny-e61','EB East 61st','NY',40.7619,-73.9644],
    ['ny-lexington','EB Lexington UES','NY',40.7661,-73.9679],['ny-e85','EB Upper East Side','NY',40.7778,-73.9543],
    ['ny-2ndave','EB Yorkville','NY',40.7731,-73.9553],['ny-grandcentral','EB Grand Central','NY',40.7516,-73.9773],
    ['ny-parkave','EB Park Ave','NY',40.7484,-73.9780],['ny-amsterdam','EB Upper West Side','NY',40.7854,-73.9812],
    ['ny-chelsea','EB Chelsea','NY',40.7462,-74.0063],['ny-hudson','EB West Village','NY',40.7296,-74.0046],
    ['ny-liberty','EB Brookfield Place','NY',40.7116,-74.0144],['ny-wallst','EB Wall Street','NY',40.7067,-74.0114],
    ['ny-soho','EB SoHo','NY',40.7262,-74.0010],['ny-flatiron','EB Flatiron','NY',40.7393,-73.9897],
    ['ny-brooklyn','EB Brooklyn','NY',40.7090,-73.9564],['beam-lb','Beaming Long Beach','CA',33.7557,-118.1021],
    ['beam-wpb','Beaming West Palm Beach','FL',26.7099,-80.0544],
  ];
  return RAW.map(([id, name, state, lat, lng]) => ({ id, name, state, lat, lng,
    coast: (state === 'CA') ? 'West' : 'East', brand: id.startsWith('beam') ? 'Beaming' : 'Earthbar',
    district: distOf(id), gmId: id === 'la-brentwood' ? 'gm-brentwood' : null }));
})();

/* ---------------- App shell: views, router, persona ---------------- */
const App = (() => {
  const views = new Map(); // id -> {title, order, render, onShow}
  let currentUser = null;
  let active = null;
  let orgChart = null; // data/org-chart.json — real UKG people (daily pull); null when absent

  async function loadOrgChart(){
    try {
      const res = await fetch('data/org-chart.json', { cache: 'no-store' });
      if (res.ok) orgChart = await res.json();
    } catch(_){ /* file:// or missing file — picker falls back to demo personas */ }
  }
  function orgPeople(){ return (orgChart && orgChart.people) || []; }
  // A picker selection from the org chart becomes a persona object (id 'org:<personNumber>').
  function orgUser(pid){
    const p = orgPeople().find(x => String(x.id) === String(pid));
    if (!p) return null;
    return { id: 'org:' + p.id, name: p.name, role: p.role, coast: p.coast || null, brand: p.brand || null, district: null,
      storeIds: p.storeIds || p.demoStoreIds || [], orgPerson: true, realStore: p.realStore || null, title: p.title || null };
  }

  function registerView(id, def){ views.set(id, def); }
  function user(){ return currentUser; }
  function setUser(u){ currentUser = u; try { localStorage.setItem('eb_ops_persona', u.id); } catch(_){} renderNav(); show(active || 'home', true); }
  function isAdmin(){ return currentUser && currentUser.role === 'admin'; }

  // Role-scoped store visibility — single source of truth for Home, Checklists,
  // Actions, and Reports (admin sees all; RD by coast; DL by district; GM own stores).
  function visibleStores(u = currentUser){
    const stores = Data.list('stores');
    if (!u || u.role === 'admin') return stores;
    if (u.role === 'regional_director'){
      if (u.coast === 'Beaming' || u.brand === 'Beaming') return stores.filter(s => s.brand === 'Beaming'); // VP Beaming Ops (org people carry brand, demo used coast)
      return stores.filter(s => s.coast === u.coast && s.brand !== 'Beaming'); // Earthbar RDs never see Beaming (beam-lb is coast-West)
    }
    if (u.role === 'district_leader'){
      if (u.orgPerson) return stores.filter(s => (u.storeIds || []).includes(s.id)); // real DL/MUM: union of their GMs' matched stores
      if (u.district && !String(u.district).startsWith('*')) return stores.filter(s => s.district === u.district);
      return stores.filter(s => s.coast === u.coast); // legacy '*Coast*' personas
    }
    if (u.role === 'gm') return stores.filter(s => (u.storeIds || []).includes(s.id));
    return stores;
  }

  function renderNav(){
    const nav = document.getElementById('nav-inner'); nav.innerHTML = '';
    [...views.entries()].sort((a,b) => (a[1].order ?? 99) - (b[1].order ?? 99)).forEach(([id, v]) => {
      if (v.adminOnly && !isAdmin()) return;
      const b = UI.el('button', { onclick: () => show(id) }, UI.esc(v.title));
      b.dataset.view = id; if (id === active) b.classList.add('active');
      nav.appendChild(b);
    });
    const p = document.getElementById('persona-btn');
    p.textContent = currentUser ? currentUser.name : 'Choose user';
  }

  function show(id, force){
    if (!views.has(id)) id = 'home';
    let v = views.get(id);
    if (v && v.adminOnly && !isAdmin()) id = 'home';
    if (id === active && !force) return;
    active = id; location.hash = id;
    document.querySelectorAll('.nav button').forEach(b => b.classList.toggle('active', b.dataset.view === id));
    document.querySelectorAll('main .view').forEach(v => v.classList.remove('active'));
    let el = document.getElementById('view-' + id);
    if (!el) { el = UI.el('section', { class:'view', id:'view-' + id }); document.getElementById('main').appendChild(el); }
    el.classList.add('active');
    v = views.get(id);
    v.render(el);
    if (v.onShow) v.onShow(el);
    window.scrollTo(0, 0);
  }

  const ROLE_GROUPS = [
    { role:'gm',                label:'GM test view' },
    { role:'district_leader',   label:'District Leader test view' },
    { role:'regional_director', label:'Regional Director test view' },
    { role:'admin',             label:'Admin' },
  ];
  const ROLE_LABEL = { gm:'GM', district_leader:'District Leader', regional_director:'Regional Director' };

  function demoGroupsHtml(usersList){
    return ROLE_GROUPS.map(g => {
      const rows = usersList.filter(u => u.role === g.role);
      if (!rows.length) return '';
      return `<div class="micro" style="margin:12px 0 6px">${UI.esc(g.label)}</div>` +
        rows.map(u => `<button class="btn secondary" style="width:100%;text-align:left;margin-bottom:6px" data-uid="${UI.esc(u.id)}">${UI.esc(u.name)}</button>`).join('');
    }).join('');
  }

  function personaPicker(){
    const usersList = Data.list('users');
    const people = orgPeople();
    if (!people.length){ // no org-chart data (file:// or not generated) — demo personas only
      const m = UI.modal('Choose a view (demo)', `<p class="micro">Test views — pick who to experience the app as. Production uses Microsoft sign-in.</p>${demoGroupsHtml(usersList)}`, [{ label:'Cancel', cls:'ghost' }]);
      m.body.querySelectorAll('[data-uid]').forEach(b => b.addEventListener('click', () => { setUser(Data.get('users', b.dataset.uid)); m.close(); }));
      return;
    }
    const html = `
      <p class="micro">Real org chart — refreshed daily from UKG. Production uses Microsoft sign-in.</p>
      <div class="picker-controls">
        <input type="search" id="pp-q" class="picker-search" placeholder="Search a GM, District Leader, or Regional Director…" autocomplete="off">
        <select id="pp-role" class="filter-select">
          <option value="all">All roles</option>
          <option value="gm">GMs</option>
          <option value="district_leader">District Leaders</option>
          <option value="regional_director">Regional Directors</option>
        </select>
      </div>
      <button class="btn secondary picker-row" data-uid="admin"><span>Eitan Sneider</span><span class="badge">Admin</span></button>
      <div id="pp-list"></div>`;
    const m = UI.modal('Choose a view', html, [{ label:'Cancel', cls:'ghost' }]);
    const listEl = m.body.querySelector('#pp-list');
    const renderList = () => {
      const q = m.body.querySelector('#pp-q').value.trim().toLowerCase();
      const role = m.body.querySelector('#pp-role').value;
      let rows = people.filter(p =>
        (role === 'all' || p.role === role) &&
        (!q || p.name.toLowerCase().includes(q) || (p.realStore || '').toLowerCase().includes(q) || (p.title || '').toLowerCase().includes(q)));
      const shown = rows.slice(0, 30);
      listEl.innerHTML = shown.map(p => {
        const sids = p.storeIds || p.demoStoreIds || [];
        const unmapped = !sids.length && p.role !== 'regional_director';
        const where = p.role === 'gm' ? (p.realStore || '')
          : p.role === 'regional_director' ? (p.coast || p.brand || '')
          : (sids.length ? `${sids.length} stores` : (p.realStore || ''));
        return `<button class="btn secondary picker-row" data-pid="${UI.esc(p.id)}">
          <span>${UI.esc(p.name)}<span class="micro picker-sub">${UI.esc(ROLE_LABEL[p.role] || p.role)}${where ? ' · ' + UI.esc(where) : ''}</span></span>
          ${unmapped ? '<span class="badge">no stores linked</span>' : ''}
        </button>`;
      }).join('') + (rows.length > 30 ? `<div class="micro" style="padding:6px 0">+${rows.length - 30} more — keep typing to narrow</div>` : '')
        || '<div class="empty">No one matches that search.</div>';
      listEl.querySelectorAll('[data-pid]').forEach(b => b.addEventListener('click', () => { const u = orgUser(b.dataset.pid); if (u) { setUser(u); m.close(); } }));
    };
    m.body.querySelector('#pp-q').addEventListener('input', renderList);
    m.body.querySelector('#pp-role').addEventListener('change', renderList);
    m.body.querySelectorAll('[data-uid]').forEach(b => b.addEventListener('click', () => { setUser(Data.get('users', b.dataset.uid)); m.close(); }));
    renderList();
    m.body.querySelector('#pp-q').focus();
  }

  async function boot(){
    await loadOrgChart(); // before Data.init so the seed can use the real store universe
    Data.init(orgChart && orgChart.stores && orgChart.stores.length ? orgChart.stores : null);
    let saved = null; try { saved = localStorage.getItem('eb_ops_persona'); } catch(_){}
    if (saved && saved.startsWith('org:')) currentUser = orgUser(saved.slice(4));
    if (!currentUser) currentUser = Data.get('users', saved || 'admin') || Data.get('users', 'admin') || Data.list('users')[0];
    document.getElementById('persona-btn').addEventListener('click', personaPicker);
    renderNav();
    const startView = (location.hash || '#home').slice(1);
    show(views.has(startView) ? startView : 'home');
    window.addEventListener('hashchange', () => { const id = location.hash.slice(1); if (id && id !== active) show(id); });
  }

  return { registerView, show, boot, user, setUser, isAdmin, visibleStores, orgPeople, renderNav };
})();

window.addEventListener('DOMContentLoaded', () => App.boot());
