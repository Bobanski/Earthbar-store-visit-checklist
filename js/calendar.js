/* calendar.js — role-aware compliance calendar (Eitan 9/17 spec).
   Default = the signed-in user's own calendar:
   - GM → their store's calendar: color-coded squares per checklist (filled ✓ done,
     outline ✗ missed) for the Redbook dailies + OEA + Health Code.
   - DL/RD/admin → leader tasks: DM Travel Path (daily) + store visits done in scope.
   A search box (stores + GMs) switches to any store's calendar; legend sits below
   the grid. Owns view 'calendar'. Reads only via Data/Sched/UI/App. */

'use strict';

(function () {
  // color per template — legend + squares (distinct, colorblind-spaced hues)
  const STORE_TPLS = [
    { id: 'daily-open',  short: 'Open',  color: '#17663a' },
    { id: 'daily-mid',   short: 'Mid',   color: '#17558c' },
    { id: 'daily-close', short: 'Close', color: '#633461' },
    { id: 'oea-audit',   short: 'OEA',   color: '#b8720e' },
    { id: 'health-code', short: 'HC',    color: '#a32925' },
  ];
  const LEADER_TPLS = [
    { id: 'travel-path', short: 'TP',    color: '#17558c' },
    { id: 'store-visit', short: 'Visit', color: '#633461' },
  ];

  let calDate = new Date(); calDate.setDate(1);
  let selStoreId = null; // null → "my calendar" for the current persona

  function sq(t, state, title) { // state: done | missed
    const style = state === 'done'
      ? `background:${t.color};border-color:${t.color};color:#fff`
      : `background:none;border-color:${t.color};color:${t.color}`;
    return `<span class="csq" style="${style}" title="${UI.esc(title)}">${state === 'done' ? '✓' : '✗'}</span>`;
  }
  function legendHtml(tpls) {
    return `<div class="cal-legend">${tpls.map(t => {
      const tpl = Data.template(t.id);
      return `<span class="cal-legend-item"><span class="csq" style="background:${t.color};border-color:${t.color};color:#fff">✓</span> ${UI.esc(tpl ? tpl.name : t.id)}</span>`;
    }).join('')}<span class="cal-legend-item"><span class="csq" style="background:none;border-color:var(--muted);color:var(--muted)">✗</span> missed</span></div>`;
  }

  function monthGrid(year, month, cellFn) {
    const first = new Date(year, month, 1);
    const startDow = first.getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    let cells = '';
    for (let i = 0; i < startDow; i++) cells += '<div class="cal-cell cal-empty"></div>';
    for (let d = 1; d <= daysInMonth; d++) cells += cellFn(d, daysInMonth);
    const trailing = (7 - ((startDow + daysInMonth) % 7)) % 7;
    for (let i = 0; i < trailing; i++) cells += '<div class="cal-cell cal-empty"></div>';
    return cells;
  }

  // ---- store calendar: one store's compliance squares ----
  function storeCells(year, month, storeId, todayK) {
    const doneByDay = {};
    Data.list('submissions').forEach(s => {
      if (s.storeId !== storeId || s.status !== 'submitted') return;
      const dk = s.periodKey && /^\d{4}-\d{2}-\d{2}$/.test(s.periodKey) ? s.periodKey : (s.submittedAt || '').slice(0, 10);
      if (dk) (doneByDay[dk] = doneByDay[dk] || new Set()).add(s.templateId);
    });
    const monthK = year + '-' + String(month + 1).padStart(2, '0');
    const oeaDoneMonth = Data.list('submissions').some(s => s.storeId === storeId && s.templateId === 'oea-audit' && s.status === 'submitted' && s.periodKey === monthK);
    const qK = year + '-Q' + (Math.floor(month / 3) + 1);
    const hcDoneQ = Data.list('submissions').some(s => s.storeId === storeId && s.templateId === 'health-code' && s.status === 'submitted' && s.periodKey === qK);
    return monthGrid(year, month, (d, daysInMonth) => {
      const dk = year + '-' + String(month + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
      const done = doneByDay[dk] || new Set();
      let chips = '';
      STORE_TPLS.slice(0, 3).forEach(t => { // dailies: done or missed for past days
        if (dk > todayK) return;
        const tpl = Data.template(t.id);
        chips += sq(t, done.has(t.id) ? 'done' : 'missed', `${tpl ? tpl.name : t.id} — ${done.has(t.id) ? 'done' : 'missed'}`);
      });
      if (done.has('oea-audit')) chips += sq(STORE_TPLS[3], 'done', 'OEA Audit — done');
      if (done.has('health-code')) chips += sq(STORE_TPLS[4], 'done', 'Health Code — done');
      if (d === daysInMonth && !oeaDoneMonth) chips += sq(STORE_TPLS[3], 'missed', 'OEA Audit — due by month end');
      if (d === daysInMonth && month % 3 === 2 && !hcDoneQ) chips += sq(STORE_TPLS[4], 'missed', 'Health Code — due by quarter end');
      return `<div class="cal-cell${dk === todayK ? ' cal-today' : ''}"><div class="cal-daynum micro">${d}</div><div class="csq-row">${chips}</div></div>`;
    });
  }

  // ---- leader calendar: own tasks across scope ----
  function leaderCells(year, month, storeIds, todayK) {
    const tpByDay = {}, visitByDay = {};
    Data.list('submissions').forEach(s => {
      if (s.status !== 'submitted' || !storeIds.has(s.storeId)) return;
      if (s.templateId === 'travel-path' && s.periodKey) (tpByDay[s.periodKey] = tpByDay[s.periodKey] || new Set()).add(s.storeId);
      if (s.templateId === 'store-visit' && s.submittedAt) { const dk = s.submittedAt.slice(0, 10); (visitByDay[dk] = visitByDay[dk] || new Set()).add(s.storeId); }
    });
    return monthGrid(year, month, d => {
      const dk = year + '-' + String(month + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
      let chips = '';
      if (dk <= todayK && storeIds.size) {
        const n = (tpByDay[dk] || new Set()).size;
        chips += sq(LEADER_TPLS[0], n ? 'done' : 'missed', `DM Travel Path — ${n ? n + ' of ' + storeIds.size + ' stores' : 'not run'}`);
        const v = (visitByDay[dk] || new Set()).size;
        if (v) chips += sq(LEADER_TPLS[1], 'done', `Store visit${v > 1 ? 's' : ''} — ${v} store${v > 1 ? 's' : ''}`);
      }
      return `<div class="cal-cell${dk === todayK ? ' cal-today' : ''}"><div class="cal-daynum micro">${d}</div><div class="csq-row">${chips}</div></div>`;
    });
  }

  function render(el) {
    const user = App.user();
    const scope = App.visibleStores();
    const scopeIds = new Set(scope.map(s => s.id));
    if (selStoreId && !scopeIds.has(selStoreId)) selStoreId = null; // persona switched — drop out-of-scope selection
    const year = calDate.getFullYear(), month = calDate.getMonth();
    const todayK = UI.dayKey(new Date());
    const monthLabel = new Date(year, month, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

    // GM default = their own store's calendar
    const gmDefault = (user && user.role === 'gm' && user.storeIds && user.storeIds[0]) || null;
    const viewStoreId = selStoreId || gmDefault;
    const viewStore = viewStoreId ? Data.get('stores', viewStoreId) : null;
    const storeMode = !!viewStore;

    // People-first view switcher (ops-dashboard admin-menu pattern): each in-scope
    // store is listed under its manager's name (GM, else MUM); pick a person to see
    // their store's month. Stores between managers fall back to the store name.
    const ddTitle = storeMode
      ? (viewStore.gmName ? `${viewStore.gmName} — ${viewStore.name}` : viewStore.name)
      : 'My calendar';
    const ddRows = scope.slice().sort((a, b) => (a.gmName || a.name).localeCompare(b.gmName || b.name));

    el.innerHTML = `
      <div class="cal-header">
        <button type="button" class="btn small secondary" id="acal-prev">‹ Prev</button>
        <div class="micro">${UI.esc(monthLabel)}${!storeMode && user ? ' — ' + UI.esc(user.name) : ''}</div>
        <button type="button" class="btn small secondary" id="acal-next">Next ›</button>
      </div>
      <div class="cal-toolbar">
        <details class="dd" id="acal-dd">
          <summary>${UI.esc(ddTitle)}</summary>
          <div class="dd-panel">
            <input type="search" class="picker-search" id="acal-q" placeholder="Type a person’s name…" autocomplete="off">
            <div class="dd-options" id="acal-opts"></div>
          </div>
        </details>
      </div>
      <div class="calendar-grid">
        ${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(x => `<div class="cal-dow micro">${x}</div>`).join('')}
        ${storeMode ? storeCells(year, month, viewStore.id, todayK) : leaderCells(year, month, scopeIds, todayK)}
      </div>
      ${legendHtml(storeMode ? STORE_TPLS : LEADER_TPLS)}`;

    el.querySelector('#acal-prev').onclick = () => { calDate.setMonth(calDate.getMonth() - 1); render(el); };
    el.querySelector('#acal-next').onclick = () => { calDate.setMonth(calDate.getMonth() + 1); render(el); };
    const optsEl = el.querySelector('#acal-opts');
    const qEl = el.querySelector('#acal-q');
    const renderOpts = () => {
      const q = qEl.value.trim().toLowerCase();
      const rows = ddRows.filter(s => !q || (s.gmName || '').toLowerCase().includes(q) || s.name.toLowerCase().includes(q));
      optsEl.innerHTML = `<button type="button" data-mine${!storeMode ? ' aria-current="true"' : ''}>My calendar<small>${UI.esc(user ? user.name : '')}</small></button>` +
        rows.slice(0, 40).map(s => `<button type="button" data-sid="${UI.esc(s.id)}"${viewStoreId === s.id ? ' aria-current="true"' : ''}>
          ${UI.esc(s.gmName || s.name)}<small>${UI.esc(s.gmName ? s.name : 'no manager on file')}</small></button>`).join('') +
        (rows.length > 40 ? `<div class="micro" style="padding:8px">+${rows.length - 40} more — keep typing</div>` : '');
      optsEl.querySelectorAll('[data-sid]').forEach(b => b.onclick = () => { selStoreId = b.dataset.sid; render(el); });
      const mine = optsEl.querySelector('[data-mine]');
      if (mine) mine.onclick = () => { selStoreId = null; render(el); };
    };
    qEl.oninput = renderOpts;
    renderOpts();
    el.querySelector('#acal-dd').addEventListener('toggle', e => { if (e.target.open) qEl.focus(); });
  }

  App.registerView('calendar', { title: 'Calendar', order: 45, render });
})();
