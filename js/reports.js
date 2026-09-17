/* reports.js — Reports view (Worker D). Four Garrett/Steve queries, each answerable
   in <=2 taps: (a) completion matrix, (b) DL peer comparison, (c) store benchmark,
   (d) P&L impact tile. Owns: view 'reports'. Data only via Data/Sched/UI/App.

   Shared definitions (kept identical across a/b/c so numbers tie out):
   - "expected" cell = a day in range that has already started AND, for time-locked
     templates, whose window has already opened today (today's not-yet-open window
     is 'upcoming', never counted as missed).
   - "done" cell = a submitted submission exists for that template/store/day.
   - "missed" = expected && !done. Cells for days before today render as missed
     with --danger (yesterday-or-older); today's still-open misses render neutral. */

'use strict';

(function(){

  const state = {
    tab: 'matrix',
    matrix: { templateId: 'daily-close', range: '7', from: '', to: '', coast: '', district: '' },
    peer: { range: '7', sortCol: 'completion', sortDir: 'desc' },
    bench: { coast: '', district: '', sortDir: 'asc' },
  };
  let _el = null, _user = null;

  /* ---------- scope + shared data helpers ---------- */

  function scopeStores(user){ return App.visibleStores(user); }

  function dailyTemplates(){ return Data.templates().filter(t => t.cadence === 'daily'); }
  function tplById(){ return Object.fromEntries(Data.templates().map(t => [t.id, t])); }

  function buildDoneIndex(){
    const idx = new Set();
    Data.list('submissions').forEach(s => { if (s.status === 'submitted' && s.periodKey) idx.add(s.templateId + '|' + s.storeId + '|' + s.periodKey); });
    return idx;
  }

  // Returns 'done' | 'missed' | 'missed-old' | 'upcoming'
  function cellState(tpl, storeId, dayDate, idx, todayKey){
    const dayKey = UI.dayKey(dayDate);
    if (dayKey > todayKey) return 'upcoming';
    if (idx.has(tpl.id + '|' + storeId + '|' + dayKey)) return 'done';
    const now = new Date();
    const h = now.getHours() + now.getMinutes() / 60;
    if (dayKey === todayKey && tpl.window){
      // consistent with Sched.isOpen: for an overnight window the day's cell opens at startHH
      const opened = h >= tpl.window.startHH;
      if (!opened) return 'upcoming';
      return 'missed';
    }
    // Overnight windows (startHH > endHH, e.g. close 16:00-02:00): the early-morning span
    // before endHH still belongs to YESTERDAY's window, which is still open — not yet missed.
    // Aligns with B2's periodKey so the matrix cell and the runner card agree at 1 AM.
    if (tpl.window && tpl.window.startHH > tpl.window.endHH && h < tpl.window.endHH) {
      const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
      if (dayKey === UI.dayKey(yesterday)) return 'upcoming';
    }
    return dayKey === todayKey ? 'missed' : 'missed-old';
  }

  function trailingDays(n){
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const days = [];
    for (let i = n - 1; i >= 0; i--) { const d = new Date(today); d.setDate(d.getDate() - i); days.push(d); }
    return days;
  }

  // Earliest submittedAt across all submissions (seeded or real) — used to clamp trailing
  // windows so early-history benchmarks/dilution don't silently average in days with no data.
  function earliestSubmittedAt(){
    let min = null;
    Data.list('submissions').forEach(s => { if (s.submittedAt) { const d = new Date(s.submittedAt); if (!min || d < min) min = d; } });
    return min;
  }

  // Like trailingDays(n), but never reaches back before the earliest submission on record.
  function clampedTrailingDays(n){
    const days = trailingDays(n);
    const earliest = earliestSubmittedAt();
    if (!earliest) return days;
    const earliestMid = new Date(earliest); earliestMid.setHours(0, 0, 0, 0);
    const clamped = days.filter(d => d >= earliestMid);
    return clamped.length ? clamped : days;
  }

  function completionStats(storeIds, templateIds, days, idx, todayKey){
    const T = tplById();
    let done = 0, expected = 0;
    storeIds.forEach(stId => templateIds.forEach(tid => {
      const tpl = T[tid]; if (!tpl) return;
      days.forEach(d => {
        const st = cellState(tpl, stId, d, idx, todayKey);
        if (st === 'done') { done++; expected++; }
        else if (st === 'missed' || st === 'missed-old') expected++;
      });
    }));
    return { done, expected, pct: expected ? (done / expected * 100) : null };
  }

  function distinctDistricts(stores){ return [...new Set(stores.map(s => s.district))].sort(); }
  function distinctCoasts(stores){ return [...new Set(stores.map(s => s.coast))].sort(); }

  function applyFilters(stores, coast, district){
    return stores.filter(s => (!coast || s.coast === coast) && (!district || s.district === district));
  }

  /* ---------- shell + tabs ---------- */

  // Role-gated tabs (Eitan 9/17): DL/GM see the matrix only; peer comparison +
  // store benchmark are RD/admin tools; P&L impact is hidden for everyone for now.
  function allowedTabs(user){
    const role = user ? user.role : 'admin';
    if (role === 'admin' || role === 'regional_director') return ['matrix', 'peer', 'bench'];
    return ['matrix'];
  }
  const TAB_LABELS = { matrix: 'Completion Matrix', peer: 'DL Comparison', bench: 'Store Benchmark' };

  function shellHTML(){
    const tabs = allowedTabs(_user);
    if (!tabs.includes(state.tab)) state.tab = tabs[0];
    return `
      <div class="demo-banner">Sample data — analytics run on seeded demo history</div>
      <h1 class="page-title" style="margin-bottom:12px">Reports</h1>
      ${tabs.length > 1 ? `<div class="report-tabs">
        ${tabs.map(t => `<button class="report-tab" data-tab="${t}">${UI.esc(TAB_LABELS[t])}</button>`).join('')}
      </div>` : ''}
      <div id="reports-body"></div>
    `;
  }

  function refresh(){ renderActiveTab(); }

  function renderActiveTab(){
    if (!_el) return;
    _el.querySelectorAll('.report-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === state.tab));
    const body = _el.querySelector('#reports-body');
    const stores = scopeStores(_user);
    if (state.tab === 'matrix') { body.innerHTML = matrixHTML(stores); wireMatrix(body, stores); }
    else if (state.tab === 'peer') { body.innerHTML = peerHTML(stores); wirePeer(body, stores); }
    else { body.innerHTML = benchHTML(stores); wireBench(body, stores); } // plHTML retained in code but unreachable — P&L hidden for now (Eitan 9/17)
  }

  function render(el){
    _el = el; _user = App.user();
    el.innerHTML = shellHTML();
    el.querySelectorAll('.report-tab').forEach(b => b.addEventListener('click', () => { state.tab = b.dataset.tab; refresh(); }));
    renderActiveTab();
  }

  /* ---------- a) Completion matrix ---------- */

  function matrixDays(){
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const m = state.matrix;
    if (m.range === 'custom' && m.from && m.to){
      const days = []; let d = new Date(m.from); const end = new Date(m.to);
      while (d <= end) { days.push(new Date(d)); d.setDate(d.getDate() + 1); }
      return days;
    }
    if (m.range === 'week'){
      const dow = today.getDay() || 7; const start = new Date(today); start.setDate(start.getDate() - (dow - 1));
      const days = []; let d = new Date(start);
      while (d <= today) { days.push(new Date(d)); d.setDate(d.getDate() + 1); }
      return days;
    }
    const n = m.range === '14' ? 14 : 7;
    return trailingDays(n);
  }

  function matrixHTML(scopeStoresArr){
    const m = state.matrix;
    const tpls = dailyTemplates();
    if (!tpls.length) return `<div class="empty">No daily templates configured yet.</div>`;
    if (!tpls.some(t => t.id === m.templateId)) m.templateId = tpls[0].id;
    const tpl = Data.template(m.templateId);
    const stores = applyFilters(scopeStoresArr, m.coast, m.district).sort((a, b) => (a.district + a.name).localeCompare(b.district + b.name));
    const days = matrixDays();
    const idx = buildDoneIndex();
    const todayKey = UI.dayKey(new Date());

    // headline: most recent day in range (today if included), across the filtered stores
    const refDay = days[days.length - 1];
    const refKey = UI.dayKey(refDay);
    const refIsToday = refKey === todayKey;
    const doneToday = stores.filter(s => cellState(tpl, s.id, refDay, idx, todayKey) === 'done').length;
    const headline = `${doneToday} of ${stores.length} stores completed <strong>${UI.esc(tpl.name)}</strong> ${refIsToday ? 'today' : 'on ' + UI.esc(UI.fmtDate(refKey))}`;

    const coasts = distinctCoasts(scopeStoresArr), districts = distinctDistricts(scopeStoresArr);
    const controls = `
      <div class="report-controls">
        <label class="field-inline">Template
          <select id="mx-tpl">${tpls.map(t => `<option value="${UI.esc(t.id)}" ${t.id === m.templateId ? 'selected' : ''}>${UI.esc(t.name)}</option>`).join('')}</select>
        </label>
        <label class="field-inline">Range
          <select id="mx-range">
            <option value="7" ${m.range === '7' ? 'selected' : ''}>Last 7 days</option>
            <option value="14" ${m.range === '14' ? 'selected' : ''}>Last 14 days</option>
            <option value="week" ${m.range === 'week' ? 'selected' : ''}>This week</option>
            <option value="custom" ${m.range === 'custom' ? 'selected' : ''}>Custom</option>
          </select>
        </label>
        ${m.range === 'custom' ? `
          <label class="field-inline">From <input type="date" id="mx-from" value="${UI.esc(m.from)}"></label>
          <label class="field-inline">To <input type="date" id="mx-to" value="${UI.esc(m.to)}"></label>
        ` : ''}
        <label class="field-inline">Coast
          <select id="mx-coast"><option value="">All</option>${coasts.map(c => `<option value="${UI.esc(c)}" ${c === m.coast ? 'selected' : ''}>${UI.esc(c)}</option>`).join('')}</select>
        </label>
        <label class="field-inline">District
          <select id="mx-district"><option value="">All</option>${districts.map(d => `<option value="${UI.esc(d)}" ${d === m.district ? 'selected' : ''}>${UI.esc(d)}</option>`).join('')}</select>
        </label>
      </div>`;

    if (!stores.length) return controls + `<div class="empty">No stores match these filters.</div>`;

    // group by district with subtotal rows
    const byDistrict = new Map();
    stores.forEach(s => { if (!byDistrict.has(s.district)) byDistrict.set(s.district, []); byDistrict.get(s.district).push(s); });

    const dayHeaders = days.map(d => `<th>${UI.esc(new Date(d).toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' }))}</th>`).join('');
    let bodyRows = '';
    [...byDistrict.entries()].sort((a, b) => a[0].localeCompare(b[0])).forEach(([district, ds]) => {
      let distDone = 0, distExpected = 0;
      let storeRows = '';
      ds.forEach(s => {
        let rowCells = '';
        days.forEach(d => {
          const st = cellState(tpl, s.id, d, idx, todayKey);
          if (st === 'done') { distDone++; distExpected++; }
          else if (st === 'missed' || st === 'missed-old') distExpected++;
          rowCells += `<td class="mx-cell">${cellGlyph(st)}</td>`;
        });
        storeRows += `<tr><td class="mx-store sticky-col">${UI.esc(s.name)}</td>${rowCells}</tr>`;
      });
      bodyRows += `<tr class="mx-subtotal"><td class="sticky-col">${UI.esc(district)} — ${distDone}/${distExpected} days complete</td><td colspan="${days.length}"></td></tr>${storeRows}`;
    });

    return controls + `
      <p class="report-headline">${headline}</p>
      <div class="table-scroll">
        <table class="data mx-table">
          <thead><tr><th class="sticky-col">Store</th>${dayHeaders}</tr></thead>
          <tbody>${bodyRows}</tbody>
        </table>
      </div>
      <p class="micro mx-legend">■ done &nbsp; □ missed &nbsp; <span class="danger-text">□</span> missed (yesterday-or-older) &nbsp; – locked / upcoming</p>
    `;
  }

  function cellGlyph(st){
    if (st === 'done') return '<span class="mx-glyph mx-done">■</span>';
    if (st === 'missed') return '<span class="mx-glyph mx-missed">□</span>';
    if (st === 'missed-old') return '<span class="mx-glyph mx-missed-old">□</span>';
    return '<span class="mx-glyph mx-upcoming">–</span>';
  }

  function wireMatrix(body, stores){
    const bind = (id, key) => { const e = body.querySelector(id); if (e) e.addEventListener('change', () => { state.matrix[key] = e.value; refresh(); }); };
    bind('#mx-tpl', 'templateId'); bind('#mx-range', 'range'); bind('#mx-from', 'from'); bind('#mx-to', 'to');
    bind('#mx-coast', 'coast'); bind('#mx-district', 'district');
  }

  /* ---------- b) DL peer comparison ---------- */

  function peerHTML(scopeStoresArr){
    const p = state.peer;
    const days = p.range === '14' ? trailingDays(14) : trailingDays(7);
    const idx = buildDoneIndex();
    const todayKey = UI.dayKey(new Date());
    const dailyIds = dailyTemplates().map(t => t.id);
    const districts = distinctDistricts(scopeStoresArr);
    if (!districts.length) return `<div class="empty">No stores in scope.</div>`;

    const subs = Data.list('submissions').filter(s => s.status === 'submitted');
    const rangeStart = UI.dayKey(days[0]);
    const issues = Data.list('issues');
    const actions = Data.list('actions');

    let rows = districts.map(district => {
      const stores = scopeStoresArr.filter(s => s.district === district);
      const storeIds = stores.map(s => s.id);
      const stats = completionStats(storeIds, dailyIds, days, idx, todayKey);
      const distSubs = subs.filter(s => storeIds.includes(s.storeId) && s.submittedAt && UI.dayKey(s.submittedAt) >= rangeStart);
      const scored = distSubs.filter(s => s.score != null);
      const avgScore = scored.length ? scored.reduce((a, s) => a + s.score, 0) / scored.length : null;
      const openIssues = issues.filter(i => storeIds.includes(i.storeId) && (i.status === 'open' || i.status === 'inprogress')).length;
      const overdueActions = actions.filter(a => storeIds.includes(a.storeId) && a.status !== 'complete' && a.dueDate < todayKey).length;
      return { district, completion: stats.pct, avgScore, submissions: distSubs.length, openIssues, overdueActions };
    });

    const dir = p.sortDir === 'asc' ? 1 : -1;
    const val = r => p.sortCol === 'district' ? r.district : (r[p.sortCol] == null ? -1 : r[p.sortCol]);
    rows.sort((a, b) => p.sortCol === 'district' ? dir * a.district.localeCompare(b.district) : dir * ((val(a)) - (val(b))));

    const th = (key, label) => `<th data-sort="${key}">${UI.esc(label)}${p.sortCol === key ? (p.sortDir === 'asc' ? ' ▲' : ' ▼') : ''}</th>`;
    const controls = `
      <div class="report-controls">
        <label class="field-inline">Range
          <select id="pr-range">
            <option value="7" ${p.range === '7' ? 'selected' : ''}>Last 7 days</option>
            <option value="14" ${p.range === '14' ? 'selected' : ''}>Last 14 days</option>
          </select>
        </label>
      </div>`;
    const body = rows.map(r => `<tr>
      <td>${UI.esc(r.district)}</td>
      <td>${r.completion == null ? '—' : r.completion.toFixed(0) + '%'}</td>
      <td>${r.avgScore == null ? '—' : r.avgScore.toFixed(1)}</td>
      <td>${r.submissions}</td>
      <td>${r.openIssues}</td>
      <td>${r.overdueActions > 0 ? `<span class="badge danger">${r.overdueActions}</span>` : '0'}</td>
    </tr>`).join('');

    return controls + `
      <div class="table-scroll">
        <table class="data">
          <thead><tr>${th('district', 'Leader')}${th('completion', 'Completion %')}${th('avgScore', 'Avg Score')}${th('submissions', 'Submissions')}${th('openIssues', 'Open Issues')}${th('overdueActions', 'Overdue Actions')}</tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>`;
  }

  function wirePeer(body){
    const r = body.querySelector('#pr-range'); if (r) r.addEventListener('change', () => { state.peer.range = r.value; refresh(); });
    body.querySelectorAll('th[data-sort]').forEach(th => th.addEventListener('click', () => {
      const key = th.dataset.sort;
      if (state.peer.sortCol === key) state.peer.sortDir = state.peer.sortDir === 'asc' ? 'desc' : 'asc';
      else { state.peer.sortCol = key; state.peer.sortDir = key === 'district' ? 'asc' : 'desc'; }
      refresh();
    }));
  }

  /* ---------- c) Store benchmark ---------- */

  function starGlyphs(score){
    const n = score >= 90 ? 5 : score >= 80 ? 4 : score >= 70 ? 3 : score >= 60 ? 2 : 1;
    return '★'.repeat(n) + '☆'.repeat(5 - n);
  }

  function storeCompletionPct(storeId, days, idx, todayKey){
    return completionStats([storeId], dailyTemplates().map(t => t.id), days, idx, todayKey).pct;
  }

  function storeAvgScore30(storeId, subs30){
    const scored = subs30.filter(s => s.storeId === storeId && s.score != null);
    return scored.length ? scored.reduce((a, s) => a + s.score, 0) / scored.length : null;
  }

  function storeSparkline(storeId, subs){
    const days = trailingDays(14);
    const points = days.map(d => {
      const dk = UI.dayKey(d);
      const dayScores = subs.filter(s => s.storeId === storeId && s.score != null && s.submittedAt && UI.dayKey(s.submittedAt) === dk).map(s => s.score);
      return dayScores.length ? dayScores.reduce((a, b) => a + b, 0) / dayScores.length : null;
    });
    const valid = points.filter(v => v != null);
    if (!valid.length) return `<svg class="spark" viewBox="0 0 120 28" aria-hidden="true"></svg>`;
    const min = Math.min(...valid), max = Math.max(...valid), span = (max - min) || 1;
    let last = valid[0];
    const coords = points.map((v, i) => {
      const use = v == null ? last : v; last = use;
      const x = 2 + i * (116 / 13);
      const y = 26 - ((use - min) / span) * 24;
      return x.toFixed(1) + ',' + y.toFixed(1);
    }).join(' ');
    return `<svg class="spark" viewBox="0 0 120 28" preserveAspectRatio="none" aria-hidden="true"><polyline points="${coords}" fill="none" stroke="var(--ink)" stroke-width="1.5"/></svg>`;
  }

  function benchHTML(scopeStoresArr){
    const b = state.bench;
    const stores = applyFilters(scopeStoresArr, b.coast, b.district);
    if (!stores.length) return `<div class="empty">No stores match these filters.</div>`;
    const days30 = clampedTrailingDays(30);
    const winN = days30.length;
    const idx = buildDoneIndex();
    const todayKey = UI.dayKey(new Date());
    const startKey = UI.dayKey(days30[0]);
    const subs30 = Data.list('submissions').filter(s => s.status === 'submitted' && s.submittedAt && UI.dayKey(s.submittedAt) >= startKey);

    let rows = stores.map(s => {
      const avg = storeAvgScore30(s.id, subs30);
      const pct = storeCompletionPct(s.id, days30, idx, todayKey);
      return { store: s, avg, pct };
    });
    rows.sort((a, b2) => (b.sortDir === 'asc' ? 1 : -1) * ((a.avg ?? -1) - (b2.avg ?? -1)));

    const coasts = distinctCoasts(scopeStoresArr), districts = distinctDistricts(scopeStoresArr);
    const controls = `
      <div class="report-controls">
        <label class="field-inline">Coast
          <select id="bn-coast"><option value="">All</option>${coasts.map(c => `<option value="${UI.esc(c)}" ${c === b.coast ? 'selected' : ''}>${UI.esc(c)}</option>`).join('')}</select>
        </label>
        <label class="field-inline">District
          <select id="bn-district"><option value="">All</option>${districts.map(d => `<option value="${UI.esc(d)}" ${d === b.district ? 'selected' : ''}>${UI.esc(d)}</option>`).join('')}</select>
        </label>
      </div>`;

    const body = rows.map(r => `<tr>
      <td>${UI.esc(r.store.name)}<div class="micro">${UI.esc(r.store.district)}</div></td>
      <td>${r.avg == null ? '—' : r.avg.toFixed(1)}</td>
      <td class="stars">${r.avg == null ? '—' : starGlyphs(r.avg)}</td>
      <td>${storeSparkline(r.store.id, subs30)}</td>
      <td>${r.pct == null ? '—' : r.pct.toFixed(0) + '%'}</td>
    </tr>`).join('');

    return controls + `
      <p class="micro" style="margin-bottom:8px">Sorted worst-first by trailing-${winN}-day avg score.</p>
      <div class="table-scroll">
        <table class="data">
          <thead><tr><th>Store</th><th>Avg Score (${winN}d)</th><th>Rating</th><th>Trend (14d)</th><th>Completion % (${winN}d)</th></tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>`;
  }

  function wireBench(body){
    const bind = (id, key) => { const e = body.querySelector(id); if (e) e.addEventListener('change', () => { state.bench[key] = e.value; refresh(); }); };
    bind('#bn-coast', 'coast'); bind('#bn-district', 'district');
  }

  /* ---------- d) P&L impact tile ---------- */

  function plHTML(scopeStoresArr){
    const settings = Data.settings();
    const pl = (settings && settings.plAssumptions) || { avgCheck: 0, txnPerStoreDay: 0 };
    const days30 = clampedTrailingDays(30);
    const winN = days30.length;
    const idx = buildDoneIndex();
    const todayKey = UI.dayKey(new Date());
    const dailyIds = dailyTemplates().map(t => t.id);

    const perStore = scopeStoresArr.map(s => ({ store: s, pct: storeCompletionPct(s.id, days30, idx, todayKey) })).filter(r => r.pct != null);
    if (!perStore.length) return `<div class="empty">Not enough data to estimate impact.</div>`;

    const byDistrict = {};
    distinctDistricts(scopeStoresArr).forEach(d => {
      const ids = scopeStoresArr.filter(s => s.district === d).map(s => s.id);
      byDistrict[d] = completionStats(ids, dailyIds, days30, idx, todayKey).pct;
    });

    const worst5 = [...perStore].sort((a, b) => a.pct - b.pct).slice(0, 5);
    const impactFactor = 0.05;
    let total = 0;
    const lines = worst5.map(r => {
      const benchmark = byDistrict[r.store.district];
      const delta = benchmark != null ? Math.max(0, benchmark - r.pct) / 100 : 0;
      const weekly = pl.txnPerStoreDay * pl.avgCheck * 7 * delta * impactFactor;
      total += weekly;
      return { store: r.store, pct: r.pct, benchmark, weekly };
    });

    const money = n => '$' + n.toLocaleString(undefined, { maximumFractionDigits: 0 });

    return `
      <div class="card pl-tile">
        <h3>Estimated Weekly Revenue at Risk</h3>
        <p class="pl-total">${money(total)}<span class="micro">/week across the 5 lowest-completion stores</span></p>
        <div class="pl-rows">
          ${lines.map(l => `<div class="due-row"><span>${UI.esc(l.store.name)} <span class="micro">(${l.pct.toFixed(0)}% vs ${l.benchmark == null ? '—' : l.benchmark.toFixed(0) + '%'} district)</span></span><span>${l.weekly > 0 ? `~${money(l.weekly)}/week protected if executed at benchmark` : 'At or above benchmark'}</span></div>`).join('')}
        </div>
        <p class="micro pl-formula">Illustrative: assumes 5% of revenue correlates with checklist execution; edit assumptions in Admin.
        Formula: txn/store/day (${pl.txnPerStoreDay}) × avg check (${money(pl.avgCheck)}) × 7 × (district benchmark completion % − store completion %, trailing ${winN}d) × ${impactFactor}.</p>
      </div>`;
  }

  App.registerView('reports', { title: 'Reports', order: 50, render });
})();
