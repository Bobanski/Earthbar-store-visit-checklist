/* runner.js — template-driven inspection runner.
   Owns the "checklists" view: template grid, geolocation gate, section-by-section
   runner, draft autosave, summary + follow-up loop, GM confirmation parity.
   Persists ONLY via Data.*. Reads template content from Data.templates()
   (registered elsewhere via Data.registerTemplates — this file never edits templates-data.js). */
'use strict';

(function () {
  const esc = UI.esc;

  /* ---------------- module state ---------------- */
  let container = null;      // current view element
  let mode = 'grid';         // grid | geo | runner | summary
  let selStoreId = null;     // store picker selection
  let runState = null;       // in-progress run
  let geoCtx = null;         // { storeId, label, onSuccess }
  let expandedKeys = new Set();   // question rows explicitly opened (transient, per section)
  let collapsedKeys = new Set();  // auto-expanded rows the user closed (transient, per section)

  /* ---------------- testing mode (demo): skip-through + requirement overrides ---------------- */
  function isTesting() { return !!(Data.settings() || {}).testingMode; }
  function testingChipHtml() {
    return `<button type="button" class="testing-chip${isTesting() ? ' on' : ''}" id="testing-toggle">Testing mode: ${isTesting() ? 'On' : 'Off'}</button>`;
  }
  function wireTestingChip(el) {
    const chip = el.querySelector('#testing-toggle');
    if (chip) chip.onclick = () => { Data.saveSettings({ testingMode: !isTesting() }); draw(); };
  }

  /* ---------------- geolocation (ported from legacy distFt ~L1879) ---------------- */
  function distFt(lat1, lon1, lat2, lon2) {
    const R = 3958.8, toR = Math.PI / 180;
    const dLat = (lat2 - lat1) * toR, dLon = (lon2 - lon1) * toR;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toR) * Math.cos(lat2 * toR) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 5280;
  }

  /* ---------------- photo compression: canvas downscale max 900px, JPEG q0.7 ---------------- */
  function compressImage(file, cb) {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, 900 / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale)), h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
        if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) { UI.toast('Could not process photo'); return; }
        cb(dataUrl);
      };
      img.onerror = () => UI.toast('Could not read photo');
      img.src = e.target.result;
    };
    reader.onerror = () => UI.toast('Could not read photo');
    reader.readAsDataURL(file);
  }

  /* ---------------- helpers ---------------- */
  function itemKey(section, item) { return section.id + '|' + item.id; }
  function findDraft(templateId, storeId) { return Data.list('drafts').find(d => d.templateId === templateId && d.storeId === storeId) || null; }
  function defaultStoreId() {
    const u = App.user();
    if (u && u.role === 'gm' && u.storeIds && u.storeIds.length) return u.storeIds[0];
    const visible = App.visibleStores();
    const s = Data.settings();
    if (s && s.lastStoreId && visible.some(st => st.id === s.lastStoreId)) return s.lastStoreId; // lastStoreId only honored inside the persona's scope
    return visible[0] ? visible[0].id : null;
  }
  function draw() {
    if (!container) return;
    if (mode === 'geo') return drawGeoGate();
    if (mode === 'runner') return drawRunner(container);
    if (mode === 'summary') return drawSummary(container);
    drawGrid(container);
  }

  /* ================= GRID (checklists view) ================= */
  function render(el) {
    container = el;
    if (!selStoreId) selStoreId = defaultStoreId();
    draw();
  }

  function pendingConfirmationsHtml(u) {
    const storeIds = u.storeIds || [];
    const pending = Data.list('confirmations').filter(c => c.status === 'pending' && storeIds.includes(c.storeId));
    if (!pending.length) return '';
    const rows = pending.map(c => {
      const sub = Data.get('submissions', c.submissionId);
      const store = Data.get('stores', c.storeId);
      const tpl = sub ? Data.template(sub.templateId) : null;
      return `<div class="runner-confirm-row">
        <div>${esc(store ? store.name : c.storeId)} &mdash; ${esc(tpl ? tpl.name : 'Visit')}
          <div class="micro">${sub ? esc(UI.fmtDateTime(sub.submittedAt)) : ''}</div></div>
        <button class="btn small" data-confirm="${esc(c.id)}">Confirm</button>
      </div>`;
    }).join('');
    return `<div class="card runner-confirm-card"><h3>Pending Confirmations</h3>${rows}</div>`;
  }

  // Rotating-theme templates run only their untagged core sections plus the
  // section tagged with this week's theme (Sched.rotatingTheme).
  function secsOf(tpl) {
    const all = tpl.sections || [];
    const theme = Sched.rotatingTheme(tpl);
    if (!theme) return all;
    const filtered = all.filter(s => !s.theme || s.theme === theme);
    return filtered.length ? filtered : all;
  }

  function templateCardHtml(tpl) {
    const gate = Sched.isOpen(tpl);
    const periodKey = Sched.periodKey(tpl.cadence, new Date(), tpl);
    const draft = findDraft(tpl.id, selStoreId);
    const completed = periodKey ? Data.list('submissions').some(s => s.templateId === tpl.id && s.storeId === selStoreId && s.status === 'submitted' && s.periodKey === periodKey) : false;
    const theme = Sched.rotatingTheme(tpl);
    const locked = !gate.open;
    let statusBadge = '<span class="badge">Due</span>';
    if (locked) statusBadge = '<span class="badge">Locked</span>';
    else if (completed) statusBadge = '<span class="badge ink">Completed</span>';
    else if (draft) statusBadge = '<span class="badge outline-danger">In Progress</span>';
    const btnLabel = draft ? 'Resume' : 'Start';
    return `<div class="card runner-tpl-card${locked ? ' locked' : ''}">
      <div class="runner-tpl-top"><span class="badge">${esc(tpl.cadence)}</span>${statusBadge}</div>
      <h3>${esc(tpl.name)}</h3>
      ${theme ? `<div class="micro">This week: ${esc(theme)}</div>` : ''}
      ${locked ? `<div class="micro runner-lock-reason">${esc(gate.reason)}</div>` : ''}
      ${locked
        ? `<button class="btn secondary" data-locked data-reason="${esc(gate.reason)}">${esc(btnLabel)}</button>`
        : `<button class="btn" data-start="${esc(tpl.id)}">${esc(btnLabel)}</button>`}
      ${locked && (App.isAdmin() || isTesting()) ? `<button class="btn ghost small" data-admin-start="${esc(tpl.id)}">Start anyway (${App.isAdmin() ? 'admin demo' : 'testing'})</button>` : ''}
    </div>`;
  }

  function drawGrid(el) {
    const u = App.user();
    const stores = App.visibleStores(); // store picker respects the persona's scope
    if (!stores.some(s => s.id === selStoreId)) selStoreId = defaultStoreId();
    let html = `<div class="runner-storebar"><label class="micro" for="store-pick">Store</label>
      <select id="store-pick">${stores.map(s => `<option value="${esc(s.id)}"${s.id === selStoreId ? ' selected' : ''}>${esc(s.name)}</option>`).join('')}</select>
      <span class="spacer" style="flex:1"></span>${testingChipHtml()}</div>`;
    if (u && u.role === 'gm') html += pendingConfirmationsHtml(u);
    const templates = Data.templates();
    if (!templates.length) {
      html += '<div class="empty">No checklist templates yet.</div>';
    } else {
      html += '<div class="grid cols-3">' + templates.map(templateCardHtml).join('') + '</div>';
    }
    el.innerHTML = html;
    const pick = el.querySelector('#store-pick');
    if (pick) pick.onchange = e => { selStoreId = e.target.value; Data.saveSettings({ lastStoreId: selStoreId }); drawGrid(el); };
    wireTestingChip(el);
    el.querySelectorAll('[data-start]').forEach(b => b.onclick = () => startTemplate(Data.template(b.dataset.start)));
    el.querySelectorAll('[data-admin-start]').forEach(b => b.onclick = () => startTemplate(Data.template(b.dataset.adminStart), true));
    el.querySelectorAll('[data-locked]').forEach(b => b.onclick = () => UI.toast(b.dataset.reason || 'This checklist is locked right now.'));
    el.querySelectorAll('[data-confirm]').forEach(b => b.onclick = () => confirmVisit(Data.get('confirmations', b.dataset.confirm)));
  }

  /* ================= GEOLOCATION GATE ================= */
  function drawGeoGate() {
    const ctx = geoCtx;
    const store = Data.get('stores', ctx.storeId);
    container.innerHTML = `<div class="card runner-geo">
      <h3>Confirm you're on-site</h3>
      <p class="micro">${esc(ctx.label)}</p>
      <div class="micro" id="geo-status">Tap below to check your location against ${esc(store ? store.name : 'the store')}.</div>
      <div class="runner-geo-actions">
        <button class="btn" id="geo-check-btn">Check My Location</button>
        <button class="btn ghost" id="geo-cancel-btn">Cancel</button>
      </div>
      ${(App.isAdmin() || isTesting()) ? '<div class="runner-geo-bypass"><button class="btn secondary small" id="geo-bypass-btn">Bypass location (demo)</button></div>' : ''}
    </div>`;
    container.querySelector('#geo-check-btn').onclick = () => doGeoCheck(store, ctx);
    container.querySelector('#geo-cancel-btn').onclick = () => { geoCtx = null; mode = 'grid'; draw(); };
    const byp = container.querySelector('#geo-bypass-btn');
    if (byp) byp.onclick = () => ctx.onSuccess(true, null);
  }

  function doGeoCheck(store, ctx) {
    const status = container.querySelector('#geo-status');
    if (!store) { status.textContent = 'Store not found.'; return; }
    if (!navigator.geolocation) { status.textContent = 'Geolocation is unavailable on this device.'; return; }
    status.textContent = 'Checking…';
    navigator.geolocation.getCurrentPosition(
      pos => {
        const ft = distFt(pos.coords.latitude, pos.coords.longitude, store.lat, store.lng);
        if (ft <= 1000) ctx.onSuccess(false, { lat: pos.coords.latitude, lng: pos.coords.longitude });
        else status.textContent = 'You are about ' + Math.round(ft) + ' ft from ' + store.name + ' — must be within 1000 ft to proceed.';
      },
      () => { status.textContent = 'Location denied or unavailable.'; },
      { enableHighAccuracy: true, timeout: 12000 }
    );
  }

  function startTemplate(tpl, bypassLock) {
    if (!tpl) return;
    const gate = Sched.isOpen(tpl);
    if (!gate.open && !(bypassLock && (App.isAdmin() || isTesting()))) { UI.toast(gate.reason); return; } // enforced in code, not just card styling; bypass needs admin or testing mode
    if (!selStoreId) { UI.toast('Select a store first'); return; }
    const draft = findDraft(tpl.id, selStoreId);
    if (draft) { beginRun(tpl, selStoreId, draft, null); return; }
    const selStore = Data.get('stores', selStoreId);
    if (tpl.requiresOnsite && selStore && selStore.lat == null) { beginRun(tpl, selStoreId, null, null); return; } // real org stores carry no coordinates yet — geo gate can't apply
    if (tpl.requiresOnsite) {
      geoCtx = { storeId: selStoreId, label: 'This checklist requires you to be at the store to start.',
        onSuccess: (bypassed, geo) => beginRun(tpl, selStoreId, null, geo) };
      mode = 'geo'; draw(); return;
    }
    beginRun(tpl, selStoreId, null, null);
  }

  function confirmVisit(conf) {
    if (!conf) return;
    geoCtx = { storeId: conf.storeId, label: 'Confirm you are at the store to approve this visit.',
      onSuccess: () => {
        Data.update('confirmations', conf.id, { status: 'confirmed', confirmedAt: new Date().toISOString() });
        UI.toast('Visit confirmed');
        geoCtx = null; mode = 'grid'; draw();
      } };
    mode = 'geo'; draw();
  }

  /* ================= RUNNER ================= */
  function beginRun(tpl, storeId, draft, geo) {
    resetExpand();
    if (draft) {
      runState = Object.assign({}, draft);
    } else {
      runState = { draftId: null, pendingSubmissionId: null, templateId: tpl.id, storeId, userId: App.user().id,
        startedAt: new Date().toISOString(), sectionIdx: 0, answers: {}, notes: {}, photos: {},
        sectionPhotos: {}, sectionNotes: {}, geo: geo || null };
    }
    mode = (secsOf(tpl).length) ? 'runner' : 'summary';
    draw();
  }

  function saveRunDraft() {
    // returns true on success, false if the underlying save failed (e.g. storage quota) — callers
    // that just changed a photo use this to surface an inline warning next to the thumbnail.
    if (!runState) return true;
    const existing = Data.list('drafts').find(d => d.templateId === runState.templateId && d.storeId === runState.storeId);
    const payload = { templateId: runState.templateId, storeId: runState.storeId, userId: runState.userId,
      startedAt: runState.startedAt, pendingSubmissionId: runState.pendingSubmissionId, sectionIdx: runState.sectionIdx,
      answers: runState.answers, notes: runState.notes, photos: runState.photos, sectionPhotos: runState.sectionPhotos,
      sectionNotes: runState.sectionNotes, geo: runState.geo || null, updatedAt: new Date().toISOString() };
    if (existing) { const r = Data.update('drafts', existing.id, payload); return !!r; }
    else { const row = Data.insert('drafts', payload); if (row) runState.draftId = row.id; return !!row; }
  }

  // Collapsed-state marker for a question row: what has been answered, in black & white.
  function ansGlyph(item, ans) {
    if (item.type === 'passfail') {
      if (ans === 'pass') return '<span class="ans-mark">✓</span>';
      if (ans === 'fail') return '<span class="ans-mark">✗</span>';
      if (ans === 'na') return '<span class="ans-mark ans-mark-na">N/A</span>';
      return '';
    }
    if (item.type === 'rating') return (typeof ans === 'number') ? `<span class="ans-mark ans-mark-na">${ans}/5</span>` : '';
    if (item.type === 'people') return (Array.isArray(ans) && ans.length) ? `<span class="ans-mark ans-mark-na">${ans.length} added</span>` : '';
    if (item.type === 'select') return ans ? `<span class="ans-mark ans-mark-na">${esc(String(ans))}</span>` : '';
    return (ans && String(ans).trim()) ? '<span class="ans-mark">✓</span>' : '';
  }

  function itemCardHtml(section, item, open) {
    const k = itemKey(section, item);
    const ans = runState.answers[k];
    const note = runState.notes[k] || '';
    const photo = runState.photos[k];
    let control;
    if (item.type === 'passfail') {
      control = `<div class="runner-ans-row">
        <button class="ans-btn${ans === 'pass' ? ' sel-pass' : ''}" data-k="${esc(k)}" data-v="pass" aria-label="Pass">✓</button>
        <button class="ans-btn${ans === 'fail' ? ' sel-fail' : ''}" data-k="${esc(k)}" data-v="fail" aria-label="Fail">✗</button>
        ${item.allowNA ? `<button class="ans-btn ans-btn-na${ans === 'na' ? ' sel-na' : ''}" data-k="${esc(k)}" data-v="na">N/A</button>` : ''}
      </div>`;
    } else if (item.type === 'rating') {
      control = `<div class="runner-rating" data-k="${esc(k)}">${[1, 2, 3, 4, 5].map(n => `<span class="rate-sq${(typeof ans === 'number' && ans >= n) ? ' lit' : ''}" data-n="${n}">${n}</span>`).join('')}</div>`;
    } else if (item.type === 'select') {
      control = `<select class="runner-select" data-sel="${esc(k)}">
        <option value=""${!ans ? ' selected' : ''} disabled>Select…</option>
        ${(item.options || []).map(o => `<option value="${esc(o)}"${ans === o ? ' selected' : ''}>${esc(o)}</option>`).join('')}
      </select>`;
    } else if (item.type === 'people') {
      const names = Array.isArray(ans) ? ans : [];
      control = `<div class="people-picker" data-pp="${esc(k)}">
        <div class="pp-chips">${names.map(nm => `<span class="pp-chip">${esc(nm)}<button type="button" class="pp-x" data-rm="${esc(nm)}" aria-label="Remove ${esc(nm)}">×</button></span>`).join('')}</div>
        <input type="text" class="runner-text-input pp-input" placeholder="Type a name to add…" autocomplete="off">
        <div class="pp-sugg" hidden></div>
      </div>`;
    } else {
      control = `<input type="text" class="runner-text-input" data-k="${esc(k)}" value="${esc(ans || '')}" placeholder="Type response…">`;
    }
    return `<div class="runner-item${open ? ' open' : ''}">
      <button type="button" class="runner-item-head" data-toggle="${esc(k)}" aria-expanded="${open ? 'true' : 'false'}">
        <span class="runner-item-q">${item.critical ? '<span class="badge outline-danger">Critical</span> ' : ''}${esc(item.text)}</span>
        <span class="runner-item-state">${ansGlyph(item, ans)}<span class="runner-item-chev">${open ? '−' : '+'}</span></span>
      </button>
      <div class="runner-item-body" style="display:${open ? 'block' : 'none'}">
        ${control}
        <div class="runner-item-tools">
          <button type="button" class="link-btn" data-note="${esc(k)}">${note ? 'Edit note' : '+ Note'}</button>
          <label class="link-btn" for="ph-${esc(k)}">${photo ? 'Replace photo' : '+ Photo'}</label>
          <input type="file" accept="image/*" capture="environment" id="ph-${esc(k)}" data-photo="${esc(k)}" style="display:none">
          <button type="button" class="link-btn" data-issue="${esc(k)}" data-itemtext="${esc(item.text)}">+ Issue</button>
        </div>
        <div class="runner-note-wrap" data-notewrap="${esc(k)}" style="display:${note ? 'block' : 'none'}">
          <textarea class="field-textarea" data-notefield="${esc(k)}" placeholder="Note…">${esc(note)}</textarea>
        </div>
        ${(photo && photo.startsWith('data:image/')) ? `<div class="runner-item-photo"><img src="${esc(photo)}" alt=""><button type="button" class="link-btn" data-rmphoto="${esc(k)}">Remove photo</button></div>` : ''}
        ${(photo && !photo.startsWith('data:image/')) ? `<div class="micro runner-photo-warn">Photo could not be saved — please retake.</div>` : ''}
        ${(runState.photoSaveError === k) ? `<div class="micro runner-photo-warn">Could not save photo — device storage full. Remove a photo and retry.</div>` : ''}
      </div>
    </div>`;
  }

  // Which rows are open: ONLY rows the user explicitly tapped (Eitan 9/17 —
  // no auto-expansion; the question text is the toggle).
  function openKeysFor(_section) {
    return new Set(expandedKeys);
  }

  function drawRunner(el) {
    const tpl = Data.template(runState.templateId);
    if (!tpl) { el.innerHTML = '<div class="empty">Template not found.</div>'; return; }
    const sections = secsOf(tpl);
    if (!sections.length) { mode = 'summary'; return drawSummary(el); } // zero sections: nothing to run
    if (runState.sectionIdx >= sections.length) runState.sectionIdx = sections.length - 1;
    const idx = runState.sectionIdx;
    const section = sections[idx];
    const store = Data.get('stores', runState.storeId);
    const photo = runState.sectionPhotos[section.id];
    const validPhoto = !!(photo && photo.startsWith('data:image/'));
    const openKeys = openKeysFor(section);
    let html = `<div class="runner">
      <div class="runner-head">
        <button type="button" class="btn ghost small" id="run-exit">Save &amp; Exit</button>
        <div class="micro">${esc(store ? store.name : '')} &mdash; ${esc(tpl.name)}</div>
        ${testingChipHtml()}
      </div>
      <div class="micro runner-sec-label">Section ${idx + 1} of ${sections.length}</div>
      <div class="runner-progress"><div class="runner-progress-bar" style="width:${Math.round((idx + 1) / sections.length * 100)}%"></div></div>
      <h3 class="runner-section-title">${esc(section.title)}</h3>
      ${(section.items || []).map(item => itemCardHtml(section, item, openKeys.has(itemKey(section, item)))).join('')}`;
    if (section.requirePhoto) {
      html += `<div class="micro runner-sec-label">Section Photo ${validPhoto ? '' : '<span class="badge outline-danger">Required</span>'}</div>
        <div class="runner-photo-zone">
          ${validPhoto ? `<img src="${esc(photo)}" class="runner-photo-preview" alt=""><button type="button" class="btn ghost small" id="sec-photo-remove">Remove photo</button>`
                   : `<label class="btn secondary small" for="sec-photo-input">Add Section Photo</label>`}
          ${(photo && !validPhoto) ? `<div class="micro runner-photo-warn">Photo could not be saved — please retake.</div>` : ''}
          ${runState.sectionPhotoSaveError ? `<div class="micro runner-photo-warn">Could not save photo — device storage full. Remove a photo and retry.</div>` : ''}
          <input type="file" accept="image/*" capture="environment" id="sec-photo-input" style="display:none">
        </div>`;
    }
    html += `<div class="micro runner-sec-label">Section Notes</div>
      <textarea class="field-textarea" id="sec-notes" placeholder="Optional observations…">${esc(runState.sectionNotes[section.id] || '')}</textarea>
      <div class="runner-nav">
        ${idx > 0 ? '<button type="button" class="btn secondary" id="run-back">Back</button>' : '<span></span>'}
        <span style="flex:1"></span>
        ${isTesting() ? '<button type="button" class="btn ghost" id="run-skip">Skip →</button>' : ''}
        <button type="button" class="btn" id="run-next">${idx === sections.length - 1 ? 'Review & Finish' : 'Next Section'}</button>
      </div>
    </div>`;
    el.innerHTML = html;
    wireRunnerEvents(el, tpl, section);
  }

  function resetExpand() { expandedKeys = new Set(); collapsedKeys = new Set(); }

  function wireRunnerEvents(el, tpl, section) {
    el.querySelector('#run-exit').onclick = () => { saveRunDraft(); runState = null; mode = 'grid'; draw(); UI.toast('Draft saved'); };
    wireTestingChip(el);
    el.querySelectorAll('[data-toggle]').forEach(b => b.onclick = () => {
      const k = b.dataset.toggle;
      const isOpen = b.getAttribute('aria-expanded') === 'true';
      if (isOpen) { expandedKeys.delete(k); collapsedKeys.add(k); }
      else { expandedKeys.add(k); collapsedKeys.delete(k); }
      drawRunner(el);
    });
    el.querySelectorAll('.ans-btn').forEach(b => b.onclick = () => {
      const k = b.dataset.k;
      runState.answers[k] = b.dataset.v;
      expandedKeys.add(k); // stays open — they may want + Note / + Photo / + Issue next (Eitan 9/17)
      saveRunDraft(); drawRunner(el);
    });
    el.querySelectorAll('[data-issue]').forEach(b => b.onclick = () => {
      if (window.ebReportIssue) window.ebReportIssue({
        storeId: runState.storeId,
        description: b.dataset.itemtext,
        context: tpl.name + ' · ' + section.title,
      });
    });
    el.querySelectorAll('.runner-rating').forEach(r => r.querySelectorAll('.rate-sq').forEach(sq => sq.onclick = () => { runState.answers[r.dataset.k] = Number(sq.dataset.n); expandedKeys.add(r.dataset.k); saveRunDraft(); drawRunner(el); })); // ratings stay open for revision — no auto-collapse
    el.querySelectorAll('.runner-text-input[data-k]').forEach(inp => inp.oninput = () => { runState.answers[inp.dataset.k] = inp.value; saveRunDraft(); });
    el.querySelectorAll('[data-sel]').forEach(s => s.onchange = () => { runState.answers[s.dataset.sel] = s.value; saveRunDraft(); drawRunner(el); });
    el.querySelectorAll('[data-pp]').forEach(pp => {
      const k = pp.dataset.pp;
      const input = pp.querySelector('.pp-input');
      const sugg = pp.querySelector('.pp-sugg');
      const current = () => Array.isArray(runState.answers[k]) ? runState.answers[k] : [];
      input.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); const first = sugg.querySelector('[data-add]'); if (first) first.click(); } };
      input.oninput = () => {
        const q = input.value.trim().toLowerCase();
        if (!q) { sugg.hidden = true; sugg.innerHTML = ''; return; }
        const have = new Set(current().map(n => n.toLowerCase()));
        const hits = (App.orgPeople() || []).filter(p => p.name.toLowerCase().includes(q) && !have.has(p.name.toLowerCase())).slice(0, 8);
        sugg.innerHTML = hits.map(p => `<button type="button" class="pp-opt" data-add="${esc(p.name)}">${esc(p.name)}<small>${esc(p.title || '')}</small></button>`).join('')
          || `<button type="button" class="pp-opt" data-add="${esc(input.value.trim())}">Add “${esc(input.value.trim())}”</button>`;
        sugg.hidden = false;
        sugg.querySelectorAll('[data-add]').forEach(b => b.onclick = () => {
          runState.answers[k] = current().concat([b.dataset.add]);
          expandedKeys.add(k); saveRunDraft(); drawRunner(el);
        });
      };
      pp.querySelectorAll('.pp-x').forEach(x => x.onclick = () => {
        runState.answers[k] = current().filter(n => n !== x.dataset.rm);
        expandedKeys.add(k); saveRunDraft(); drawRunner(el);
      });
    });
    el.querySelectorAll('[data-note]').forEach(b => b.onclick = () => { const w = el.querySelector(`[data-notewrap="${b.dataset.note}"]`); if (w) w.style.display = (w.style.display === 'none' ? 'block' : 'none'); });
    el.querySelectorAll('[data-notefield]').forEach(t => t.oninput = () => { runState.notes[t.dataset.notefield] = t.value; saveRunDraft(); });
    el.querySelectorAll('[data-photo]').forEach(inp => inp.onchange = e => { const f = e.target.files[0]; if (!f) return; compressImage(f, url => { runState.photos[inp.dataset.photo] = url; const ok = saveRunDraft(); runState.photoSaveError = ok ? null : inp.dataset.photo; drawRunner(el); }); });
    el.querySelectorAll('[data-rmphoto]').forEach(b => b.onclick = () => { delete runState.photos[b.dataset.rmphoto]; if (runState.photoSaveError === b.dataset.rmphoto) runState.photoSaveError = null; saveRunDraft(); drawRunner(el); });
    const secInput = el.querySelector('#sec-photo-input');
    if (secInput) secInput.onchange = e => { const f = e.target.files[0]; if (!f) return; compressImage(f, url => { runState.sectionPhotos[section.id] = url; const ok = saveRunDraft(); runState.sectionPhotoSaveError = !ok; drawRunner(el); }); };
    const secRemove = el.querySelector('#sec-photo-remove');
    if (secRemove) secRemove.onclick = () => { delete runState.sectionPhotos[section.id]; runState.sectionPhotoSaveError = false; saveRunDraft(); drawRunner(el); };
    const secNotes = el.querySelector('#sec-notes');
    if (secNotes) secNotes.oninput = e => { runState.sectionNotes[section.id] = e.target.value; saveRunDraft(); };
    const back = el.querySelector('#run-back');
    if (back) back.onclick = () => { runState.sectionIdx--; resetExpand(); saveRunDraft(); drawRunner(el); };
    const skip = el.querySelector('#run-skip');
    if (skip) skip.onclick = () => nextSection(tpl, section, el, true);
    el.querySelector('#run-next').onclick = () => nextSection(tpl, section, el);
  }

  function nextSection(tpl, section, el, skipValidation) {
    // Testing mode (demo) overrides completeness + photo requirements; Skip forces through.
    if (!skipValidation && !isTesting()) {
      const missing = (section.items || []).filter(it => {
        if (it.type === 'rating') return false;
        const a = runState.answers[itemKey(section, it)];
        if (it.type === 'people') return !Array.isArray(a) || !a.length;
        return a === undefined || a === '';
      });
      if (missing.length) { UI.toast('Answer ' + missing.length + ' remaining item' + (missing.length > 1 ? 's' : '') + ' in this section'); return; }
      if (section.requirePhoto && !runState.sectionPhotos[section.id]) { UI.toast('A photo is required for this section'); return; }
    }
    saveRunDraft();
    const sections = secsOf(tpl);
    if (runState.sectionIdx < sections.length - 1) { runState.sectionIdx++; resetExpand(); drawRunner(el); }
    else { mode = 'summary'; draw(); }
  }

  /* ================= SUMMARY + FOLLOW-UP + SUBMIT ================= */
  function computeScore(tpl) {
    let pts = 0, cnt = 0; const failed = []; const bySection = {};
    secsOf(tpl).forEach(section => {
      let sPts = 0, sCnt = 0;
      (section.items || []).forEach(item => {
        const k = itemKey(section, item), ans = runState.answers[k];
        if (item.type === 'passfail') {
          if (ans === 'na' || ans === undefined) return;
          cnt++; sCnt++;
          if (ans === 'pass') { pts++; sPts++; } else failed.push({ section, item, k });
        } else if (item.type === 'rating') {
          if (typeof ans !== 'number') return;
          cnt++; sCnt++; pts += ans / 5; sPts += ans / 5;
        }
      });
      bySection[section.id] = sCnt ? Math.round(sPts / sCnt * 100) : null;
    });
    return { score: cnt ? Math.round(pts / cnt * 100) : null, failed, bySection };
  }
  function gradeFor(tpl, score) {
    const th = tpl.thresholds || {};
    const A = th.A ?? 90, B = th.B ?? 75, C = th.C ?? 60;
    return score >= A ? 'A' : score >= B ? 'B' : score >= C ? 'C' : 'D';
  }
  function trailingAvg(tpl, storeId) {
    const subs = Data.list('submissions').filter(s => s.templateId === tpl.id && s.storeId === storeId && typeof s.score === 'number');
    if (!subs.length) return null;
    return Math.round(subs.reduce((a, s) => a + s.score, 0) / subs.length);
  }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  function buildNarrative(tpl, storeId, score, gradeLetter, failed, bySection, store) {
    const name = store ? store.name : 'This store';
    const avg = trailingAvg(tpl, storeId);
    const gradeFrag = (tpl.scored && gradeLetter != null) ? ` (Grade ${gradeLetter})` : '';
    const sentences = [];
    if (avg === null) {
      sentences.push(pick([
        `${name} scored ${score}%${gradeFrag} on this ${tpl.name} — the first recorded run for this template at this store.`,
        `This is the first ${tpl.name} on record for ${name}, landing at ${score}%${gradeFrag}.`,
      ]));
    } else if (score > avg) {
      sentences.push(pick([
        `${name} came in at ${score}%${gradeFrag}, ahead of its trailing average of ${avg}% on ${tpl.name}.`,
        `This run beat ${name}'s typical ${tpl.name} performance — ${score}% versus a ${avg}% trailing average.`,
      ]));
    } else if (score < avg) {
      sentences.push(pick([
        `${name} scored ${score}%${gradeFrag} on ${tpl.name}, below its trailing average of ${avg}%.`,
        `This result trails ${name}'s usual ${tpl.name} pace — ${score}% against a ${avg}% average.`,
      ]));
    } else {
      sentences.push(`${name} scored ${score}%${gradeFrag}, in line with its trailing average of ${avg}% on ${tpl.name}.`);
    }
    const worst = Object.entries(bySection).filter(([, v]) => v !== null).sort((a, b) => a[1] - b[1])[0];
    if (worst && worst[1] < 90) {
      const secTitle = (secsOf(tpl).find(s => s.id === worst[0]) || {}).title || worst[0];
      sentences.push(pick([
        `${secTitle} was the standout weak spot at ${worst[1]}%.`,
        `The biggest gap was in ${secTitle}, at ${worst[1]}%.`,
      ]));
    }
    const crit = failed.filter(f => f.item.critical);
    if (crit.length) {
      sentences.push(pick([
        `${crit.length} critical item${crit.length > 1 ? 's' : ''} failed and need${crit.length > 1 ? '' : 's'} immediate attention: ${crit.map(c => c.item.text).slice(0, 2).join('; ')}.`,
        `Flagging ${crit.length} critical failure${crit.length > 1 ? 's' : ''} for immediate follow-up: ${crit.map(c => c.item.text).slice(0, 2).join('; ')}.`,
      ]));
    } else if (failed.length) {
      sentences.push(pick([
        `${failed.length} non-critical item${failed.length > 1 ? 's' : ''} failed and ${failed.length > 1 ? 'are' : 'is'} queued for follow-up.`,
        `${failed.length} item${failed.length > 1 ? 's' : ''} missed the mark and can be tracked as follow-up actions.`,
      ]));
    } else {
      sentences.push('No items failed this run.');
    }
    return sentences.join(' ');
  }

  function ensureSubmissionId() {
    if (!runState.pendingSubmissionId) runState.pendingSubmissionId = 'sub-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e4).toString(36);
    return runState.pendingSubmissionId;
  }

  function drawSummary(el) {
    const tpl = Data.template(runState.templateId);
    const store = Data.get('stores', runState.storeId);
    const sections = secsOf(tpl);
    let score = null, gradeLetter = null, failed = [], bySection = {};
    if (sections.length) {
      const r = computeScore(tpl); score = r.score; failed = r.failed; bySection = r.bySection;
      if (tpl.scored && score !== null) gradeLetter = gradeFor(tpl, score);
    }
    const narrative = sections.length
      ? buildNarrative(tpl, runState.storeId, score || 0, gradeLetter, failed, bySection, store)
      : 'This template has no sections configured — nothing to score.';
    const scoreBlock = (tpl.scored && score !== null)
      ? `<div class="runner-score-ring"><div class="runner-score-pct">${score}%</div><div class="micro">Grade ${gradeLetter}</div></div>` : '';
    let html = `<div class="runner">
      <div class="micro">${esc(store ? store.name : '')} &mdash; ${esc(tpl.name)}</div>
      <h3 class="runner-section-title">Summary</h3>
      ${scoreBlock}
      <div class="card runner-narrative">
        <div class="micro">Draft summary &mdash; review before saving</div>
        <p>${esc(narrative)}</p>
      </div>`;
    if (failed.length) {
      html += '<div class="micro runner-sec-label">Items to address</div>' + failed.map((f, i) => `
        <div class="runner-failed-row">
          <div>${f.item.critical ? '<span class="badge outline-danger">Critical</span> ' : ''}${esc(f.item.text)}</div>
          <button type="button" class="btn ghost small" data-followup="${i}">Create follow-up action</button>
        </div>`).join('');
    }
    html += `<div class="card runner-submit-error" id="sum-error" style="display:none"></div>
      <div class="runner-nav">
        <button type="button" class="btn secondary" id="sum-back">Back</button>
        <button type="button" class="btn" id="sum-submit">Submit</button>
      </div>
    </div>`;
    el.innerHTML = html;
    const back = el.querySelector('#sum-back');
    back.onclick = () => { if (sections.length) { runState.sectionIdx = sections.length - 1; mode = 'runner'; draw(); } };
    if (!sections.length) back.style.display = 'none';
    const submitBtn = el.querySelector('#sum-submit');
    submitBtn.onclick = () => {
      if (submitBtn.disabled) return; // guards against double-submit from a fast double-tap
      submitBtn.disabled = true;
      submitRun(tpl, store, score, gradeLetter, narrative, submitBtn);
    };
    el.querySelectorAll('[data-followup]').forEach(b => b.onclick = () => {
      const f = failed[Number(b.dataset.followup)];
      const due = new Date(); due.setDate(due.getDate() + 3);
      Data.insert('actions', { title: f.item.text, storeId: runState.storeId, source: 'inspection',
        sourceId: ensureSubmissionId(), status: 'todo', dueDate: UI.dayKey(due), createdAt: new Date().toISOString() });
      saveRunDraft();
      b.disabled = true; b.textContent = 'Action added';
      UI.toast('Follow-up action created');
    });
  }

  function submitRun(tpl, store, score, gradeLetter, narrative, submitBtn) {
    const now = new Date().toISOString();
    const submissionId = ensureSubmissionId();
    const sub = { id: submissionId, templateId: tpl.id, storeId: runState.storeId, userId: App.user().id,
      startedAt: runState.startedAt, submittedAt: now, status: 'submitted', periodKey: Sched.periodKey(tpl.cadence, new Date(), tpl),
      score: tpl.scored ? score : null, grade: tpl.scored ? gradeLetter : null,
      answers: runState.answers, notes: { item: runState.notes, section: runState.sectionNotes },
      photos: { item: runState.photos, section: runState.sectionPhotos }, summary: narrative };
    const saved = Data.insert('submissions', sub);
    if (!saved) { // storage full or otherwise failed — do NOT show Submitted or leave the runner
      if (submitBtn) submitBtn.disabled = false;
      const errEl = container ? container.querySelector('#sum-error') : null;
      const msg = 'Could not save — device storage full. Remove a photo and retry.';
      if (errEl) { errEl.textContent = msg; errEl.style.display = ''; } else UI.toast(msg);
      return;
    }
    if (tpl.requiresOnsite) Data.insert('confirmations', { submissionId, storeId: runState.storeId, status: 'pending' });
    if (runState.draftId) Data.remove('drafts', runState.draftId);
    const storeName = store ? store.name : '';
    runState = null; mode = 'grid'; draw();
    UI.toast('Submitted — ' + tpl.name + ' for ' + storeName);
  }

  /* ---------------- register view ---------------- */
  App.registerView('checklists', { title: 'Checklists', order: 20, render });

  // Direct launch from Home ("clicking the button actually opens up the checklist"):
  // navigate to the checklists view, then start the template at the persona's store.
  window.ebStartChecklist = function (templateId, storeId) {
    App.show('checklists');
    const visible = App.visibleStores();
    if (storeId && visible.some(s => s.id === storeId)) selStoreId = storeId;
    if (!visible.some(s => s.id === selStoreId)) selStoreId = defaultStoreId();
    const tpl = Data.template(templateId);
    if (!tpl) { UI.toast('Checklist not found'); return; }
    startTemplate(tpl);
  };
})();
