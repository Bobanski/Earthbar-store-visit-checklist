/* issues.js — "See something, say something" issue reporting + routing.
   Owns view 'issues'. Persists only via Data.*. */

'use strict';

(function () {
  const SEED_CATEGORIES = ['Maintenance', 'Equipment', 'Food Safety', 'IT / POS', 'Marketing / Signage', 'Staffing'];
  const DEFAULT_ROUTES = {
    'Maintenance': 'Facilities', 'Equipment': 'Facilities', 'Food Safety': 'Ops Leadership',
    'IT / POS': 'IT Helpdesk', 'Marketing / Signage': 'Marketing', 'Staffing': 'People Team',
  };
  const SEV_RANK = { low: 0, medium: 1, high: 2 };
  const STATUS_LABEL = { open: 'Open', inprogress: 'In Progress', resolved: 'Resolved' };

  let filterStatus = 'all';
  let filterStore = 'all';
  let mountEl = null;

  function sevRank(s) { return SEV_RANK[s] ?? 0; }

  function ageStr(iso) {
    const ms = Date.now() - new Date(iso).getTime();
    const days = Math.floor(ms / 86400000);
    if (days <= 0) { const hrs = Math.max(1, Math.floor(ms / 3600000)); return hrs + 'h ago'; }
    return days + 'd ago';
  }

  function allCategories() {
    const set = new Set(SEED_CATEGORIES);
    Data.list('routingRules').forEach(r => set.add(r.category));
    return [...set];
  }

  function routeIssue(category, severity) {
    const rules = Data.list('routingRules').filter(r => r.category === category);
    const sr = sevRank(severity);
    let rule = null;
    rules.forEach(r => { if (sr >= sevRank(r.minSeverity) && (!rule || sevRank(r.minSeverity) > sevRank(rule.minSeverity))) rule = r; });
    const routedTo = rule ? rule.routeTo : (DEFAULT_ROUTES[category] || 'Ops Leadership');
    return { routedTo, rule };
  }

  function canAdvance(issue) {
    const u = App.user();
    if (!u) return false;
    if (u.role === 'admin' || u.role === 'district_leader' || u.role === 'regional_director') return true;
    if (u.role === 'gm') return (u.storeIds || []).includes(issue.storeId);
    return false;
  }

  function nextStatus(s) { return s === 'open' ? 'inprogress' : s === 'inprogress' ? 'resolved' : null; }

  function downscaleImage(file, maxDim, quality) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          let { width, height } = img;
          if (width >= height && width > maxDim) { height = Math.round(height * maxDim / width); width = maxDim; }
          else if (height > maxDim) { width = Math.round(width * maxDim / height); height = maxDim; }
          const canvas = document.createElement('canvas');
          canvas.width = width; canvas.height = height;
          canvas.getContext('2d').drawImage(img, 0, 0, width, height);
          const dataUrl = canvas.toDataURL('image/jpeg', quality);
          if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) { reject(new Error('invalid image data')); return; }
          resolve(dataUrl);
        };
        img.onerror = reject;
        img.src = e.target.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function openReportForm(prefill = {}) {
    const stores = Data.list('stores').slice().sort((a, b) => a.name.localeCompare(b.name));
    const cats = allCategories();
    const u = App.user();
    const defaultStoreId = (prefill.storeId && stores.some(s => s.id === prefill.storeId) && prefill.storeId)
      || (u && u.role === 'gm' && u.storeIds && u.storeIds[0]) || (stores[0] && stores[0].id) || '';
    const storeOpts = stores.map(s => `<option value="${UI.esc(s.id)}"${s.id === defaultStoreId ? ' selected' : ''}>${UI.esc(s.name)}</option>`).join('');
    const catOpts = cats.map(c => `<option value="${UI.esc(c)}">${UI.esc(c)}</option>`).join('');
    const html = `
      ${prefill.context ? `<div class="micro" style="margin-bottom:10px">From checklist: ${UI.esc(prefill.context)}</div>` : ''}
      <div class="field"><label>Store</label><select id="iss-store">${storeOpts}</select></div>
      <div class="field"><label>Category</label><select id="iss-cat">${catOpts}</select></div>
      <div class="field"><label>Severity</label><select id="iss-sev">
        <option value="low">Low</option><option value="medium" selected>Medium</option><option value="high">High</option>
      </select></div>
      <div class="field"><label>Description</label><textarea id="iss-desc" placeholder="What did you see?">${UI.esc(prefill.description || '')}</textarea></div>
      <div class="field"><label>Photo (optional)</label><input type="file" accept="image/*" capture="environment" id="iss-photo">
        <div id="iss-photo-preview"></div>
        <div id="iss-form-error" class="micro runner-photo-warn" style="display:none"></div>
      </div>
      <div class="triage-preview"><span class="micro">Auto-triage</span><div id="iss-triage-line"></div></div>
    `;
    let photoData = null;
    const m = UI.modal('Report an Issue', html, [
      { label: 'Cancel', cls: 'ghost' },
      { label: 'Submit', onClick: (close) => {
          const storeId = m.body.querySelector('#iss-store').value;
          const category = m.body.querySelector('#iss-cat').value;
          const severity = m.body.querySelector('#iss-sev').value;
          const description = m.body.querySelector('#iss-desc').value.trim();
          if (!description) { UI.toast('Description is required.'); return; }
          const ok = submitIssue({ storeId, category, severity, description, photo: photoData, sourceContext: prefill.context || null });
          if (ok) { close(); return; }
          // save failed (e.g. storage quota) — keep the modal open with a persistent warning, not just a toast
          const warn = m.body.querySelector('#iss-form-error');
          if (warn && photoData) { warn.textContent = 'Could not save — device storage full. Remove the photo and retry.'; warn.style.display = ''; }
        } },
    ]);
    // Live triage preview: shows where the issue will be routed and whether a
    // follow-up action gets auto-created (rules engine today; AI-assisted in production).
    const updateTriage = () => {
      const category = m.body.querySelector('#iss-cat').value;
      const severity = m.body.querySelector('#iss-sev').value;
      const { routedTo, rule } = routeIssue(category, severity);
      let line = `Routes to <strong>${UI.esc(routedTo)}</strong>`;
      if (rule && rule.autoAction) {
        const due = new Date(); due.setDate(due.getDate() + (rule.dueOffsetDays || 0));
        line += ` · follow-up action auto-created, due ${UI.esc(UI.fmtDate(due.toISOString()))}`;
      } else {
        line += ' · logged for review (no auto-action)';
      }
      m.body.querySelector('#iss-triage-line').innerHTML = line;
    };
    m.body.querySelector('#iss-cat').addEventListener('change', updateTriage);
    m.body.querySelector('#iss-sev').addEventListener('change', updateTriage);
    updateTriage();
    const photoInput = m.body.querySelector('#iss-photo');
    photoInput.addEventListener('change', async () => {
      const f = photoInput.files && photoInput.files[0];
      if (!f) return;
      try {
        photoData = await downscaleImage(f, 900, 0.7);
        m.body.querySelector('#iss-photo-preview').innerHTML = (photoData && photoData.startsWith('data:image/'))
          ? `<img src="${UI.esc(photoData)}" alt="" style="max-width:120px;margin-top:6px;border:1px solid var(--line)">` : '';
      } catch (e) { photoData = null; UI.toast('Could not process photo.'); }
    });
  }

  function submitIssue({ storeId, category, severity, description, photo, sourceContext }) {
    const { routedTo, rule } = routeIssue(category, severity);
    const u = App.user();
    const issue = Data.insert('issues', {
      storeId, category, severity, description, photo: photo || null,
      status: 'open', createdAt: new Date().toISOString(), userId: u ? u.id : null,
      routedTo, actionId: null, sourceContext: sourceContext || null,
    });
    if (!issue) { UI.toast('Could not save — device storage full. Remove the photo and retry.'); return false; }
    let toastMsg = `Issue routed to ${routedTo}.`;
    if (rule && rule.autoAction) {
      const due = new Date(); due.setDate(due.getDate() + (rule.dueOffsetDays || 0));
      const dueDate = UI.dayKey(due);
      const action = Data.insert('actions', {
        title: `[${category}] ${description.slice(0, 60)}`,
        detail: description, storeId, assigneeId: null,
        source: 'issue', sourceId: issue.id, status: 'todo', dueDate,
        createdAt: new Date().toISOString(),
      });
      if (action) { Data.update('issues', issue.id, { actionId: action.id }); toastMsg = `Issue routed to ${routedTo} — follow-up action created (due ${UI.fmtDate(due.toISOString())}).`; }
    }
    UI.toast(toastMsg);
    renderList();
    return true;
  }

  function advanceIssue(i) {
    const next = nextStatus(i.status);
    if (!next) return;
    Data.update('issues', i.id, { status: next });
    UI.toast(`Issue marked ${STATUS_LABEL[next]}.`);
    renderList();
  }

  function issueCardHTML(i) {
    const store = Data.get('stores', i.storeId);
    const sevBadgeCls = i.severity === 'high' ? 'badge danger' : 'badge';
    const next = nextStatus(i.status);
    const canAdv = next && canAdvance(i);
    return `<div class="issue-card" data-issue="${UI.esc(i.id)}">
      <div class="issue-card-top">
        <span class="badge">${UI.esc(i.category)}</span>
        <span class="${sevBadgeCls}">${UI.esc(i.severity)}</span>
        <span class="badge">${UI.esc(STATUS_LABEL[i.status] || i.status)}</span>
        <span class="micro issue-age">${UI.esc(ageStr(i.createdAt))}</span>
      </div>
      <div class="issue-card-body">
        <div class="micro">${UI.esc(store ? store.name : 'Unknown store')} — routed to ${UI.esc(i.routedTo || 'Unrouted')}</div>
        ${i.sourceContext ? `<div class="micro">From checklist: ${UI.esc(i.sourceContext)}</div>` : ''}
        <p>${UI.esc(i.description)}</p>
        ${(i.photo && i.photo.startsWith('data:image/')) ? `<img class="issue-thumb" src="${UI.esc(i.photo)}" alt="">` : ''}
        ${i.actionId ? `<button type="button" class="badge action-chip" data-open-action="${UI.esc(i.actionId)}">Linked action ▸</button>` : ''}
      </div>
      ${canAdv ? `<div class="issue-card-actions"><button type="button" class="btn small secondary iss-advance">Mark ${UI.esc(STATUS_LABEL[next])}</button></div>` : ''}
    </div>`;
  }

  function renderList() {
    if (!mountEl) return;
    const listEl = mountEl.querySelector('#issues-list');
    if (!listEl) return;
    let issues = Data.list('issues').filter(i =>
      (filterStatus === 'all' || i.status === filterStatus) &&
      (filterStore === 'all' || i.storeId === filterStore));
    issues.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    if (!issues.length) { listEl.innerHTML = '<div class="empty">No issues match these filters.</div>'; return; }
    listEl.innerHTML = issues.map(issueCardHTML).join('');
    issues.forEach(i => {
      const card = listEl.querySelector(`[data-issue="${CSS.escape(i.id)}"]`);
      if (!card) return;
      const advBtn = card.querySelector('.iss-advance');
      if (advBtn) advBtn.addEventListener('click', () => advanceIssue(i));
      const chip = card.querySelector('[data-open-action]');
      if (chip) chip.addEventListener('click', () => {
        if (window.ebOpenActionDetail) window.ebOpenActionDetail(i.actionId);
        else App.show('actions');
      });
    });
  }

  function render(el) {
    mountEl = el;
    const stores = Data.list('stores').slice().sort((a, b) => a.name.localeCompare(b.name));
    const storeOpts = `<option value="all">All stores</option>` + stores.map(s =>
      `<option value="${UI.esc(s.id)}"${filterStore === s.id ? ' selected' : ''}>${UI.esc(s.name)}</option>`).join('');
    el.innerHTML = `
      <div class="issues-toolbar">
        <button type="button" class="btn" id="iss-report-btn">Report an Issue</button>
        <div class="issue-filters">
          <select id="iss-filter-status" class="filter-select">
            <option value="all">All statuses</option>
            <option value="open">Open</option>
            <option value="inprogress">In Progress</option>
            <option value="resolved">Resolved</option>
          </select>
          <select id="iss-filter-store" class="filter-select">${storeOpts}</select>
        </div>
      </div>
      <div id="issues-list" class="issue-list"></div>
    `;
    el.querySelector('#iss-filter-status').value = filterStatus;
    el.querySelector('#iss-report-btn').addEventListener('click', openReportForm);
    el.querySelector('#iss-filter-status').addEventListener('change', (e) => { filterStatus = e.target.value; renderList(); });
    el.querySelector('#iss-filter-store').addEventListener('change', (e) => { filterStore = e.target.value; renderList(); });
    renderList();
  }

  App.registerView('issues', { title: 'Issues', order: 30, render });

  // Cross-module hook: the checklist runner's "+ Issue" opens the report form
  // prefilled with the failing item and current store.
  window.ebReportIssue = openReportForm;
})();
