/* actions.js — Actions board/list/calendar (inspection + issue follow-ups + manual).
   Owns view 'actions'. Persists only via Data.*. */

'use strict';

(function () {
  const STATUS_LABEL = { todo: 'To Do', inprogress: 'In Progress', complete: 'Complete' };
  const SOURCE_LABEL = { inspection: 'Inspection', issue: 'Issue', manual: 'Manual' };
  const STATUSES = ['todo', 'inprogress', 'complete'];

  let subview = 'board';
  let sortCol = 'dueDate';
  let sortDir = 'asc';
  let calDate = new Date(); calDate.setDate(1);
  let mountEl = null;

  function todayKey() { return UI.dayKey(new Date()); }
  // Persona-scoped actions (company-wide actions with no store stay visible to everyone)
  function scopedActions() {
    const ids = new Set(App.visibleStores().map(s => s.id));
    return Data.list('actions').filter(a => a.storeId == null || ids.has(a.storeId));
  }
  function isOverdue(a) { return a.status !== 'complete' && a.dueDate && a.dueDate < todayKey(); }
  function sourceLabel(a) { return SOURCE_LABEL[a.source] || a.source; }
  function statusLabel(s) { return STATUS_LABEL[s] || s; }
  function storeName(id) { if (!id) return 'All stores'; const s = Data.get('stores', id); return s ? s.name : 'Unknown store'; }

  function renderBody() {
    if (!mountEl) return;
    const body = mountEl.querySelector('#act-body');
    if (!body) return;
    if (subview === 'board') renderBoard(body);
    else if (subview === 'list') renderListView(body);
    else renderCalendar(body);
  }

  /* ---------------- Board ---------------- */
  function renderBoard(container) {
    const actions = scopedActions();
    container.innerHTML = `<div class="board">${STATUSES.map(st => `
      <div class="board-col" data-status="${st}">
        <h3 class="micro">${UI.esc(statusLabel(st))} <span class="badge">${actions.filter(a => a.status === st).length}</span></h3>
        <div class="board-col-body" data-dropzone="${st}"></div>
      </div>`).join('')}</div>`;
    STATUSES.forEach(st => {
      const zone = container.querySelector(`.board-col-body[data-dropzone="${st}"]`);
      const items = actions.filter(a => a.status === st).sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''));
      if (!items.length) zone.innerHTML = '<div class="empty">Nothing here.</div>';
      else items.forEach(a => zone.appendChild(actionCardEl(a, st)));
      zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('dragover'); });
      zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
      zone.addEventListener('drop', (e) => {
        e.preventDefault(); zone.classList.remove('dragover');
        const id = e.dataTransfer.getData('text/plain');
        if (id) moveAction(id, st);
      });
    });
  }

  function actionCardEl(a, currentStatus) {
    const overdue = isOverdue(a);
    const card = UI.el('div', { class: 'board-card', draggable: 'true' }, `
      <div class="board-card-title">${UI.esc(a.title)}</div>
      <div class="micro">${UI.esc(storeName(a.storeId))}</div>
      <div class="board-card-meta">
        <span class="${overdue ? 'due-danger' : 'micro'}">${a.dueDate ? UI.esc(UI.fmtDate(a.dueDate)) : 'No due date'}</span>
        <span class="badge">${UI.esc(sourceLabel(a))}</span>
      </div>
    `);
    card.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', a.id); });
    card.addEventListener('click', (e) => { if (e.target.closest('.move-btn')) return; openDetailModal(a.id); });
    const others = STATUSES.filter(s => s !== currentStatus);
    const moveBtn = UI.el('button', { class: 'btn small ghost move-btn', type: 'button', onclick: (e) => { e.stopPropagation(); openMoveMenu(a, others); } }, 'Move');
    card.appendChild(moveBtn);
    return card;
  }

  function openMoveMenu(a, statuses) {
    UI.modal('Move Action', `<p class="micro">${UI.esc(a.title)}</p>`, [
      ...statuses.map(s => ({ label: 'Move to ' + statusLabel(s), cls: 'secondary', onClick: (close) => { moveAction(a.id, s); close(); } })),
      { label: 'Cancel', cls: 'ghost' },
    ]);
  }

  function moveAction(id, status) {
    const a = Data.get('actions', id);
    if (!a) return;
    if (status === 'complete') completeAction(a);
    else { Data.update('actions', id, { status }); renderBody(); }
  }

  function completeAction(a) {
    Data.update('actions', a.id, { status: 'complete' });
    if (a.source === 'issue' && a.sourceId) {
      const issue = Data.get('issues', a.sourceId);
      if (issue && issue.status !== 'resolved') {
        UI.modal('Also resolve linked issue?', `<p>This action was created from an issue: "${UI.esc(issue.description)}"</p>`, [
          { label: 'No', cls: 'ghost' },
          { label: 'Yes, resolve issue', onClick: (close) => { Data.update('issues', issue.id, { status: 'resolved' }); UI.toast('Issue resolved.'); close(); renderBody(); } },
        ]);
        return;
      }
    }
    UI.toast('Action completed.');
    renderBody();
  }

  /* ---------------- List ---------------- */
  function renderListView(container) {
    const cols = [['title', 'Title'], ['store', 'Store'], ['dueDate', 'Due'], ['status', 'Status'], ['source', 'Source']];
    const actions = scopedActions().map(a => Object.assign({}, a, { storeNameCache: storeName(a.storeId) }));
    if (!actions.length) { container.innerHTML = '<div class="empty">No actions yet.</div>'; return; }
    const dir = sortDir === 'asc' ? 1 : -1;
    actions.sort((a, b) => {
      let av, bv;
      if (sortCol === 'store') { av = a.storeNameCache; bv = b.storeNameCache; }
      else if (sortCol === 'dueDate') { av = a.dueDate || ''; bv = b.dueDate || ''; }
      else if (sortCol === 'status') { av = a.status; bv = b.status; }
      else if (sortCol === 'source') { av = a.source; bv = b.source; }
      else { av = a.title; bv = b.title; }
      return av < bv ? -1 * dir : av > bv ? 1 * dir : 0;
    });
    container.innerHTML = `<div class="table-scroll"><table class="data"><thead><tr>
        ${cols.map(([key, label]) => `<th data-col="${key}">${UI.esc(label)}${sortCol === key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}</th>`).join('')}
      </tr></thead><tbody>
        ${actions.map(a => `<tr data-id="${UI.esc(a.id)}">
          <td>${UI.esc(a.title)}</td>
          <td>${UI.esc(a.storeNameCache)}</td>
          <td class="${isOverdue(a) ? 'due-danger' : ''}">${a.dueDate ? UI.esc(UI.fmtDate(a.dueDate)) : '—'}</td>
          <td>${UI.esc(statusLabel(a.status))}</td>
          <td>${UI.esc(sourceLabel(a))}</td>
        </tr>`).join('')}
      </tbody></table></div>`;
    container.querySelectorAll('th[data-col]').forEach(th => th.addEventListener('click', () => {
      const col = th.dataset.col;
      if (sortCol === col) sortDir = sortDir === 'asc' ? 'desc' : 'asc'; else { sortCol = col; sortDir = 'asc'; }
      renderBody();
    }));
    container.querySelectorAll('tbody tr').forEach(tr => tr.addEventListener('click', () => openDetailModal(tr.dataset.id)));
  }

  /* ---------------- Calendar ---------------- */
  function renderCalendar(container) {
    const year = calDate.getFullYear(), month = calDate.getMonth();
    const first = new Date(year, month, 1);
    const startDow = first.getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const byDay = {};
    scopedActions().filter(a => a.dueDate).forEach(a => { (byDay[a.dueDate] = byDay[a.dueDate] || []).push(a); });
    const monthLabel = first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    let cells = '';
    for (let i = 0; i < startDow; i++) cells += `<div class="cal-cell cal-empty"></div>`;
    for (let d = 1; d <= daysInMonth; d++) {
      const dk = year + '-' + String(month + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
      const dayActions = byDay[dk] || [];
      cells += `<div class="cal-cell"><div class="cal-daynum micro">${d}</div>${dayActions.map(a =>
        `<button type="button" class="cal-chip${isOverdue(a) ? ' cal-chip-danger' : ''}" data-id="${UI.esc(a.id)}">${UI.esc(a.title.slice(0, 24))}</button>`).join('')}</div>`;
    }
    const trailing = (7 - ((startDow + daysInMonth) % 7)) % 7;
    for (let i = 0; i < trailing; i++) cells += `<div class="cal-cell cal-empty"></div>`;
    container.innerHTML = `
      <div class="cal-header">
        <button type="button" class="btn small secondary" id="cal-prev">‹ Prev</button>
        <div class="micro">${UI.esc(monthLabel)}</div>
        <button type="button" class="btn small secondary" id="cal-next">Next ›</button>
      </div>
      <div class="calendar-grid">
        ${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => `<div class="cal-dow micro">${d}</div>`).join('')}
        ${cells}
      </div>`;
    container.querySelector('#cal-prev').addEventListener('click', () => { calDate.setMonth(calDate.getMonth() - 1); renderBody(); });
    container.querySelector('#cal-next').addEventListener('click', () => { calDate.setMonth(calDate.getMonth() + 1); renderBody(); });
    container.querySelectorAll('.cal-chip').forEach(ch => ch.addEventListener('click', () => openDetailModal(ch.dataset.id)));
  }

  /* ---------------- New / Detail modals ---------------- */
  function openNewActionForm() {
    const stores = Data.list('stores').slice().sort((a, b) => a.name.localeCompare(b.name));
    const storeOpts = `<option value="">No specific store</option>` + stores.map(s => `<option value="${UI.esc(s.id)}">${UI.esc(s.name)}</option>`).join('');
    const dk = todayKey();
    const html = `
      <div class="field"><label>Title</label><input type="text" id="na-title"></div>
      <div class="field"><label>Detail</label><textarea id="na-detail"></textarea></div>
      <div class="field"><label>Store</label><select id="na-store">${storeOpts}</select></div>
      <div class="field"><label>Due date</label><input type="date" id="na-due" value="${dk}"></div>
    `;
    const m = UI.modal('New Action', html, [
      { label: 'Cancel', cls: 'ghost' },
      { label: 'Create', onClick: (close) => {
          const title = m.body.querySelector('#na-title').value.trim();
          if (!title) { UI.toast('Title is required.'); return; }
          const detail = m.body.querySelector('#na-detail').value.trim();
          const storeId = m.body.querySelector('#na-store').value || null;
          const dueDate = m.body.querySelector('#na-due').value || dk;
          Data.insert('actions', { title, detail, storeId, assigneeId: null, source: 'manual', sourceId: null, status: 'todo', dueDate, createdAt: new Date().toISOString() });
          UI.toast('Action created.');
          close(); renderBody();
        } },
    ]);
  }

  function confirmDeleteAction(id, parentClose) {
    UI.modal('Delete this action?', '<p>This cannot be undone.</p>', [
      { label: 'Cancel', cls: 'ghost' },
      { label: 'Delete', cls: 'danger', onClick: (close) => { Data.remove('actions', id); UI.toast('Action deleted.'); close(); if (parentClose) parentClose(); renderBody(); } },
    ]);
  }

  function openDetailModal(id) {
    const a = Data.get('actions', id);
    if (!a) { UI.toast('Action not found.'); return; }
    const stores = Data.list('stores').slice().sort((x, y) => x.name.localeCompare(y.name));
    const storeOpts = `<option value="">No specific store</option>` + stores.map(s => `<option value="${UI.esc(s.id)}"${a.storeId === s.id ? ' selected' : ''}>${UI.esc(s.name)}</option>`).join('');
    let sourceHTML = '';
    if (a.source === 'issue' && a.sourceId) {
      const issue = Data.get('issues', a.sourceId);
      sourceHTML = `<div class="field"><label>Source</label><p class="micro">From issue: ${issue ? UI.esc(issue.description) : 'linked issue not found'}</p></div>`;
    } else if (a.source === 'inspection') {
      sourceHTML = `<div class="field"><label>Source</label><p class="micro">From inspection.</p></div>`;
    }
    const html = `
      <div class="field"><label>Title</label><input type="text" id="ad-title" value="${UI.esc(a.title)}"></div>
      <div class="field"><label>Detail</label><textarea id="ad-detail">${UI.esc(a.detail || '')}</textarea></div>
      <div class="field"><label>Store</label><select id="ad-store">${storeOpts}</select></div>
      <div class="field"><label>Due date</label><input type="date" id="ad-due" value="${UI.esc(a.dueDate || '')}"></div>
      <div class="field"><label>Status</label><select id="ad-status">
        <option value="todo"${a.status === 'todo' ? ' selected' : ''}>To Do</option>
        <option value="inprogress"${a.status === 'inprogress' ? ' selected' : ''}>In Progress</option>
        <option value="complete"${a.status === 'complete' ? ' selected' : ''}>Complete</option>
      </select></div>
      ${sourceHTML}
    `;
    const m = UI.modal('Action Detail', html, [
      { label: 'Delete', cls: 'danger', onClick: (close) => { confirmDeleteAction(a.id, close); } },
      { label: 'Cancel', cls: 'ghost' },
      { label: 'Save', onClick: (close) => {
          const title = m.body.querySelector('#ad-title').value.trim();
          if (!title) { UI.toast('Title is required.'); return; }
          const detail = m.body.querySelector('#ad-detail').value.trim();
          const storeId = m.body.querySelector('#ad-store').value || null;
          const dueDate = m.body.querySelector('#ad-due').value || null;
          const status = m.body.querySelector('#ad-status').value;
          if (status === 'complete' && a.status !== 'complete') {
            Data.update('actions', a.id, { title, detail, storeId, dueDate });
            close();
            completeAction(Data.get('actions', a.id));
          } else {
            Data.update('actions', a.id, { title, detail, storeId, dueDate, status });
            UI.toast('Action saved.');
            close(); renderBody();
          }
        } },
    ]);
  }

  /* ---------------- View shell ---------------- */
  function render(el) {
    mountEl = el;
    el.innerHTML = `
      <div class="actions-toolbar">
        <div class="view-switch" id="act-switch">
          <button type="button" data-sv="board" class="${subview === 'board' ? 'active' : ''}">Board</button>
          <button type="button" data-sv="list" class="${subview === 'list' ? 'active' : ''}">List</button>
          <button type="button" data-sv="calendar" class="${subview === 'calendar' ? 'active' : ''}">Calendar</button>
        </div>
        <button type="button" class="btn" id="act-new-btn">New Action</button>
      </div>
      <div id="act-body"></div>
    `;
    el.querySelector('#act-new-btn').addEventListener('click', openNewActionForm);
    el.querySelectorAll('#act-switch button').forEach(b => b.addEventListener('click', () => { subview = b.dataset.sv; render(el); }));
    renderBody();
  }

  App.registerView('actions', { title: 'Actions', order: 40, render });

  // Bridge so js/issues.js (same owner) can deep-link a linked action's detail modal.
  window.ebOpenActionDetail = function (id) {
    App.show('actions');
    setTimeout(() => openDetailModal(id), 0);
  };
})();
