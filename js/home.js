/* home.js — Home view (Worker D). Per-persona at-a-glance:
   due-today / coming-up / open actions / open issues / recent completions.
   Owns: view 'home'. Reads only via Data/Sched/UI/App — never touches localStorage. */

'use strict';

(function(){

  function scopeStores(user){ return App.visibleStores(user); }

  function timeOf(iso){
    return new Date(iso).toLocaleTimeString(undefined, { hour:'numeric', minute:'2-digit' });
  }
  function hhStr(hh){
    const d = new Date(); d.setHours(Math.floor(hh), Math.round((hh % 1) * 60), 0, 0);
    return d.toLocaleTimeString(undefined, { hour:'numeric', minute:'2-digit' });
  }
  function windowText(tpl){
    if (!tpl.window) return 'No time lock';
    return `Window ${hhStr(tpl.window.startHH)} – ${hhStr(tpl.window.endHH)}`;
  }
  function shortDate(d){
    return d.toLocaleDateString(undefined, { month:'short', day:'numeric' });
  }
  function endOfMonth(){ const d = new Date(); return new Date(d.getFullYear(), d.getMonth() + 1, 0); }
  function endOfQuarter(){ const d = new Date(); const q = Math.floor(d.getMonth() / 3); return new Date(d.getFullYear(), q * 3 + 3, 0); }

  // One home row: name + when/lock sub-line, and either a Start button (launches the
  // checklist directly) or a lock badge. Multi-store personas get the completion count.
  function dueRowHtml(tpl, state, stores, doneIds, whenLabel){
    const multi = stores.length > 1;
    let right;
    if (state.open){
      // Single-store personas launch straight into their store; multi-store personas
      // land on the Checklists grid to pick a store (never a silent wrong-store launch).
      right = multi
        ? `<button class="btn small" data-launch="${UI.esc(tpl.id)}">Start</button>`
        : `<button class="btn small" data-launch="${UI.esc(tpl.id)}" data-store="${UI.esc(stores[0] ? stores[0].id : '')}">Start</button>`;
    } else {
      right = `<span class="badge">${UI.esc(state.reason || 'Locked')}</span>`;
    }
    if (!multi && stores[0] && doneIds && doneIds.has(stores[0].id)){
      right = `<span class="badge ink">Done</span>`;
    }
    let sub = `${UI.esc(whenLabel)} · ${UI.esc(windowText(tpl))}`;
    if (multi && doneIds){
      const total = stores.length;
      const doneCount = stores.filter(s => doneIds.has(s.id)).length;
      const laggards = stores.filter(s => !doneIds.has(s.id));
      const shown = laggards.slice(0, 2).map(s => UI.esc(s.name)).join(', ');
      const more = laggards.length > 2 ? ` +${laggards.length - 2} more` : '';
      sub += ` · ${doneCount} of ${total} complete`;
      if (laggards.length && (state.open || !tpl.window)) sub += `<span class="laggards"> — behind: ${shown}${more}</span>`;
    }
    return `<div class="due-row due-row-multi">
      <div class="due-row-head"><strong>${UI.esc(tpl.name)}</strong>${right}</div>
      <div class="micro">${sub}</div>
    </div>`;
  }

  function doneIdsFor(tpl, storeIds, allSubs){
    const key = Sched.periodKey(tpl.cadence, new Date(), tpl);
    return new Set(allSubs.filter(s => s.templateId === tpl.id && s.periodKey === key && storeIds.includes(s.storeId)).map(s => s.storeId));
  }

  // Leaders (DL/RD) don't run the Redbook — their day is store visits (Eitan 9/17).
  // Row 1: today's (dummy-data) scheduled visit, direct-launches the store-visit checklist.
  // Row 2: "Schedule your next store visit" — the scope's least-recently-visited store.
  function leaderDueCard(stores){
    if (!stores.length) return `<div class="card"><h3>Due Today</h3><div class="empty">No stores linked to this leader yet.</div></div>`;
    const now = new Date();
    const doy = Math.floor((now - new Date(now.getFullYear(), 0, 0)) / 86400000);
    const todayStore = stores[doy % stores.length];
    const lastVisit = {};
    Data.list('submissions').forEach(s => {
      if (s.templateId !== 'store-visit' || s.status !== 'submitted' || !s.submittedAt) return;
      if (!lastVisit[s.storeId] || s.submittedAt > lastVisit[s.storeId]) lastVisit[s.storeId] = s.submittedAt;
    });
    let stale = null, staleDays = -1;
    stores.forEach(st => {
      if (st.id === todayStore.id) return; // today's visit already covers it (single-store leaders get only row 1)
      const days = lastVisit[st.id] ? Math.floor((now - new Date(lastVisit[st.id])) / 86400000) : 9999;
      if (days > staleDays) { staleDays = days; stale = st; }
    });
    const alreadyScheduled = stale && Data.list('actions').some(a => a.status !== 'complete' && a.storeId === stale.id && /^Store visit/.test(a.title || ''));
    const staleLabel = staleDays >= 9999 ? 'no visit on record' : `last visited ${staleDays} days ago`;
    return `<div class="card"><h3>Due Today</h3>
      <div class="due-row due-row-multi">
        <div class="due-row-head"><strong>Store visit — ${UI.esc(todayStore.name)}</strong>
          <button class="btn small" data-launch="store-visit" data-store="${UI.esc(todayStore.id)}">Start</button></div>
        <div class="micro">Today, ${UI.esc(now.toLocaleDateString(undefined,{month:'short',day:'numeric'}))} · Scheduled visit</div>
      </div>
      ${stale ? `<div class="due-row due-row-multi">
        <div class="due-row-head"><strong>Schedule your next store visit</strong>
          ${alreadyScheduled ? '<span class="badge ink">Scheduled</span>' : `<button class="btn small secondary" data-schedule-visit="${UI.esc(stale.id)}" data-store-name="${UI.esc(stale.name)}">Schedule</button>`}</div>
        <div class="micro">${UI.esc(stale.name)} — ${UI.esc(staleLabel)}</div>
      </div>` : ''}
    </div>`;
  }

  // Due Today: only time-windowed daily checklists still actionable today (open now,
  // or opening later today). Everything else moves to Coming Up — demo declutter.
  function dueTodayCard(stores, storeIds){
    const now = new Date();
    const h = now.getHours() + now.getMinutes() / 60;
    const allSubs = Data.list('submissions');
    const todayLabel = 'Today, ' + shortDate(now);
    const rows = [];
    Data.templates().filter(t => t.cadence === 'daily' && t.window).forEach(t => {
      const state = Sched.isOpen(t, now);
      const { startHH, endHH } = t.window;
      const overnight = startHH > endHH;
      const closedForToday = !state.open && !overnight && h >= endHH; // window already ended → tomorrow's problem
      if (closedForToday) return;
      rows.push(dueRowHtml(t, state, stores, doneIdsFor(t, storeIds, allSubs), todayLabel));
    });
    const body = rows.length ? rows.join('') : '<div class="empty">All of today’s checklists are wrapped.</div>';
    return `<div class="card"><h3>Due Today</h3>${body}</div>`;
  }

  // Coming Up: the next few non-windowed / longer-cadence checklists, with due dates.
  function comingUpCard(stores, storeIds){
    const now = new Date();
    const h = now.getHours() + now.getMinutes() / 60;
    const allSubs = Data.list('submissions');
    const rows = [];
    // Un-windowed dailies (DM Travel Path / Stock-to-Rock): due today, no lock.
    Data.templates().filter(t => t.cadence === 'daily' && !t.window).forEach(t => {
      rows.push(dueRowHtml(t, { open: true }, stores, doneIdsFor(t, storeIds, allSubs), 'Today, ' + shortDate(now)));
    });
    // Monthly / quarterly: due by end of period.
    Data.templates().filter(t => t.cadence === 'monthly').forEach(t => {
      rows.push(dueRowHtml(t, { open: true }, stores, doneIdsFor(t, storeIds, allSubs), 'Due by ' + shortDate(endOfMonth())));
    });
    Data.templates().filter(t => t.cadence === 'quarterly').forEach(t => {
      rows.push(dueRowHtml(t, { open: true }, stores, doneIdsFor(t, storeIds, allSubs), 'Due by ' + shortDate(endOfQuarter())));
    });
    // Windowed dailies already closed for today → tomorrow, with open time.
    Data.templates().filter(t => t.cadence === 'daily' && t.window).forEach(t => {
      const { startHH, endHH } = t.window;
      if (startHH > endHH || h < endHH) return;
      const tomorrow = new Date(now); tomorrow.setDate(tomorrow.getDate() + 1);
      rows.push(dueRowHtml(t, { open: false, reason: 'Opens ' + hhStr(startHH) }, stores, null, 'Tomorrow, ' + shortDate(tomorrow)));
    });
    const body = rows.slice(0, 3).join('') || '<div class="empty">Nothing else on the horizon.</div>';
    return `<div class="card"><h3>Coming Up</h3>${body}</div>`;
  }

  function actionsCard(storeIds){
    const todayKey = UI.dayKey(new Date());
    let actions = Data.list('actions').filter(a => a.status !== 'complete' && (a.storeId == null || storeIds.includes(a.storeId)));
    actions.sort((a, b) => String(a.dueDate || '').localeCompare(String(b.dueDate || '')));
    actions = actions.slice(0, 3);
    if (!actions.length) return `<div class="card"><h3>My Open Actions</h3><div class="empty">No open actions in scope.</div></div>`;
    const rows = actions.map(a => {
      const overdue = a.dueDate && a.dueDate < todayKey;
      return `<div class="due-row"><span>${UI.esc(a.title)}${overdue ? ' <span class="badge danger">Overdue</span>' : ''}</span><span class="micro">${UI.esc(a.dueDate || '—')}</span></div>`;
    }).join('');
    return `<div class="card"><h3>My Open Actions</h3>${rows}<button class="btn ghost small" data-goto="actions" style="margin-top:8px">View all actions</button></div>`;
  }

  function issuesCard(storeIds, storeById){
    let issues = Data.list('issues').filter(i => (i.status === 'open' || i.status === 'inprogress') && storeIds.includes(i.storeId));
    issues.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    issues = issues.slice(0, 4);
    if (!issues.length) return `<div class="card"><h3>Open Issues</h3><div class="empty">No open issues in scope.</div></div>`;
    const sevBadge = sev => sev === 'high' ? 'badge ink' : 'badge';
    const rows = issues.map(i => {
      const store = storeById[i.storeId];
      return `<div class="due-row"><span>${UI.esc(i.category)} — ${UI.esc(store ? store.name : i.storeId)}</span><span class="${sevBadge(i.severity)}">${UI.esc(i.severity)}</span></div>`;
    }).join('');
    return `<div class="card"><h3>Open Issues</h3>${rows}<button class="btn ghost small" data-goto="issues" style="margin-top:8px">View all issues</button></div>`;
  }

  function completionsCard(storeIds, storeById){
    let subs = Data.list('submissions').filter(s => s.status === 'submitted' && storeIds.includes(s.storeId));
    subs.sort((a, b) => String(b.submittedAt || '').localeCompare(String(a.submittedAt || '')));
    subs = subs.slice(0, 6);
    if (!subs.length) return `<div class="card"><h3>Recent Completions</h3><div class="empty">No completions yet.</div></div>`;
    const rows = subs.map(s => {
      const tpl = Data.template(s.templateId);
      const store = storeById[s.storeId];
      return `<div class="due-row"><span>${UI.esc(tpl ? tpl.name : s.templateId)} — ${UI.esc(store ? store.name : s.storeId)}</span><span class="micro">${s.score != null ? UI.esc(String(s.score)) : '—'} · ${UI.esc(UI.fmtDate(s.submittedAt))}</span></div>`;
    }).join('');
    return `<div class="card"><h3>Recent Completions</h3>${rows}</div>`;
  }

  function render(el){
    const user = App.user();
    const stores = scopeStores(user);
    const storeIds = stores.map(s => s.id);
    const storeById = Object.fromEntries(Data.list('stores').map(s => [s.id, s]));
    const dateStr = new Date().toLocaleDateString(undefined, { weekday:'long', month:'short', day:'numeric' });

    const unmapped = user && user.orgPerson && !stores.length;
    el.innerHTML = `
      <div class="demo-banner">Sample data — analytics run on seeded demo history</div>
      ${unmapped ? `<div class="demo-banner">${UI.esc(user.name)} is real (UKG org chart), but ${
        user.role === 'gm' ? 'no store is on file for them' :
        user.role === 'district_leader' ? 'no stores are linked to them via supervisor links' : 'no stores fall in their region'
      } yet — nothing scoped to show.</div>` : ''}
      <div class="page-head">
        <div>
          <p class="micro" style="margin-bottom:6px">${UI.esc(dateStr)}</p>
          <h1 class="page-title">Hi ${UI.esc(user ? user.name : '')}</h1>
        </div>
        <img class="page-head-photo" src="assets/acai-bowls-lifestyle.jpg" alt="">
      </div>
      <div class="home-cols">
        <div class="home-col">
          ${(user && (user.role === 'district_leader' || user.role === 'regional_director')) ? leaderDueCard(stores) : dueTodayCard(stores, storeIds)}
          ${comingUpCard(stores, storeIds)}
        </div>
        <div class="home-col">
          ${issuesCard(storeIds, storeById)}
          ${completionsCard(storeIds, storeById)}
          ${actionsCard(storeIds)}
        </div>
      </div>
    `;
    el.querySelectorAll('[data-goto]').forEach(b => b.addEventListener('click', () => App.show(b.dataset.goto)));
    el.querySelectorAll('[data-launch]').forEach(b => b.addEventListener('click', () => {
      if (b.dataset.store && window.ebStartChecklist) window.ebStartChecklist(b.dataset.launch, b.dataset.store);
      else App.show('checklists'); // multi-store personas pick a store first
    }));
    el.querySelectorAll('[data-schedule-visit]').forEach(b => b.addEventListener('click', () => {
      const due = new Date(); due.setDate(due.getDate() + 3);
      Data.insert('actions', { title: `Store visit — ${b.dataset.storeName}`, detail: 'Scheduled from Home (overdue-visit suggestion)',
        storeId: b.dataset.scheduleVisit, source: 'manual', status: 'todo', dueDate: UI.dayKey(due), createdAt: new Date().toISOString() });
      UI.toast(`Store visit scheduled — ${b.dataset.storeName}, due ${UI.fmtDate(due.toISOString())}`);
      render(el);
    }));
  }

  App.registerView('home', { title: 'Home', order: 10, render });
})();
