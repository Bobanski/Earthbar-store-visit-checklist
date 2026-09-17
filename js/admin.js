/* admin.js — Worker B (templates + admin)
   Registers the 'admin' view (order 60, adminOnly:true): template builder,
   issue-routing rules editor, and data controls. Persists ONLY via Data.*.
   All user-entered strings pass through UI.esc before touching innerHTML. */

'use strict';

(function () {

  const ISSUE_CATEGORIES = ['Maintenance', 'Equipment', 'Food Safety', 'IT / POS', 'Marketing / Signage', 'Staffing'];
  const CADENCES = ['adhoc', 'daily', 'weekly', 'monthly', 'quarterly'];
  const TYPES = ['passfail', 'rating', 'text'];
  const esc = UI.esc;

  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function genId(prefix) { return prefix + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  function defaultFor(id) { return (typeof TEMPLATE_DEFAULTS !== 'undefined' ? TEMPLATE_DEFAULTS : []).find(t => t.id === id) || null; }
  function isCore(id) { return (typeof CORE_TEMPLATE_IDS !== 'undefined' ? CORE_TEMPLATE_IDS : []).includes(id); }

  function badgeFor(tpl) {
    if (!isCore(tpl.id)) return 'custom';
    const def = defaultFor(tpl.id);
    if (def && JSON.stringify(def) !== JSON.stringify(tpl)) return 'modified';
    return 'default';
  }

  /* ------------------------------------------------------------------ */
  /* View root                                                           */
  /* ------------------------------------------------------------------ */

  function render(el) {
    el.innerHTML = `
      <div class="demo-banner">Admin — changes here persist to this browser's demo data only</div>
      <div id="admin-templates" class="admin-section"></div>
      <div id="admin-routing" class="admin-section"></div>
      <div id="admin-data" class="admin-section"></div>
    `;
    renderTemplatesCard(el.querySelector('#admin-templates'), el);
    renderRoutingCard(el.querySelector('#admin-routing'));
    renderDataCard(el.querySelector('#admin-data'), el);
  }

  App.registerView('admin', { title: 'Admin', order: 60, adminOnly: true, render });

  /* ------------------------------------------------------------------ */
  /* (a) Template builder                                                */
  /* ------------------------------------------------------------------ */

  function renderTemplatesCard(container, rootEl) {
    const tpls = Data.templates();
    container.innerHTML = `
      <div class="card">
        <h3>Template Builder</h3>
        <p class="micro" style="margin-bottom:10px">Add or edit checklist templates. Changes appear immediately in Checklists.</p>
        <div class="tpl-list"></div>
        <button class="btn small" id="tpl-new" type="button">+ New Template</button>
      </div>`;
    const list = container.querySelector('.tpl-list');
    tpls.forEach(tpl => {
      const badge = badgeFor(tpl);
      const itemCount = (tpl.sections || []).reduce((n, s) => n + (s.items || []).length, 0);
      const row = UI.el('div', { class: 'tpl-row' });
      row.innerHTML = `
        <div class="tpl-row-main">
          <div class="tpl-row-name">${esc(tpl.name)} <span class="badge ${badge === 'default' ? '' : 'ink'}">${esc(badge)}</span></div>
          <div class="micro">${esc(tpl.cadence)} &middot; ${(tpl.sections || []).length} sections &middot; ${itemCount} items</div>
        </div>
        <div class="tpl-row-actions"></div>`;
      const actions = row.querySelector('.tpl-row-actions');
      const editBtn = UI.el('button', { class: 'btn secondary small', onclick: () => openEditor(tpl, false, rootEl) }, 'Edit');
      actions.appendChild(editBtn);
      if (badge !== 'default') {
        const resetLabel = badge === 'custom' ? 'Delete' : 'Reset to default';
        const resetBtn = UI.el('button', { class: 'btn ghost small', onclick: () => {
          const m = UI.modal(resetLabel + ' template?', `<p>${esc(resetLabel + ' "' + tpl.name + '"? This cannot be undone.')}</p>`, [
            { label: 'Cancel', cls: 'ghost' },
            { label: resetLabel, cls: 'danger', onClick: (close) => { Data.resetTemplate(tpl.id); close(); UI.toast('Template ' + (badge === 'custom' ? 'deleted' : 'reset') + '.'); render(rootEl); } },
          ]);
        } }, resetLabel);
        actions.appendChild(resetBtn);
      }
      list.appendChild(row);
    });

    container.querySelector('#tpl-new').addEventListener('click', () => {
      const blank = { id: genId('c'), name: 'New Template', cadence: 'adhoc', requiresOnsite: false, scored: false, sections: [] };
      openEditor(blank, true, rootEl);
    });
  }

  /* ---- editor modal ---- */

  function openEditor(tpl, isNew, rootEl) {
    const draft = clone(tpl);
    if (!draft.window) draft.window = null;
    if (!draft.thresholds) draft.thresholds = { A: 90, B: 75, C: 60 };
    if (!draft.rotatingThemes) draft.rotatingThemes = [];

    const body = `
      <div class="field"><label>Name</label><input type="text" id="tf-name" value="${esc(draft.name)}"></div>
      <div class="grid cols-2">
        <div class="field"><label>Cadence</label>
          <select id="tf-cadence">${CADENCES.map(c => `<option value="${c}" ${c === draft.cadence ? 'selected' : ''}>${c}</option>`).join('')}</select>
        </div>
        <div class="field"><label>Requires Onsite (geolocation gate)</label>
          <label class="toggle"><input type="checkbox" id="tf-onsite" ${draft.requiresOnsite ? 'checked' : ''}><span>On</span></label>
        </div>
      </div>
      <div class="grid cols-2">
        <div class="field"><label>Window Start Hour (0-26, optional)</label><input type="number" id="tf-start" min="0" max="26" value="${draft.window ? draft.window.startHH : ''}"></div>
        <div class="field"><label>Window End Hour (0-26, optional; &lt; start = overnight)</label><input type="number" id="tf-end" min="0" max="26" value="${draft.window ? draft.window.endHH : ''}"></div>
      </div>
      <div class="grid cols-2">
        <div class="field"><label>Scored</label>
          <label class="toggle"><input type="checkbox" id="tf-scored" ${draft.scored ? 'checked' : ''}><span>On</span></label>
        </div>
        <div class="field" id="tf-thresholds-wrap" style="${draft.scored ? '' : 'display:none'}">
          <label>Thresholds (A / B / C %)</label>
          <div style="display:flex;gap:6px">
            <input type="number" id="tf-tA" min="0" max="100" value="${draft.thresholds.A}" style="width:33%">
            <input type="number" id="tf-tB" min="0" max="100" value="${draft.thresholds.B}" style="width:33%">
            <input type="number" id="tf-tC" min="0" max="100" value="${draft.thresholds.C}" style="width:33%">
          </div>
        </div>
      </div>
      <div class="field"><label>Rotating Themes (comma list, optional)</label><input type="text" id="tf-themes" value="${esc(draft.rotatingThemes.join(', '))}"></div>
      <div class="hairline" style="margin:14px 0 10px"></div>
      <div class="micro" style="margin-bottom:8px">Sections</div>
      <div id="tf-sections"></div>
      <button class="btn ghost small" id="tf-add-section" type="button">+ Add Section</button>
    `;

    const m = UI.modal(isNew ? 'New Template' : 'Edit Template', body, [
      { label: 'Cancel', cls: 'ghost' },
      { label: 'Save', onClick: (close) => saveDraft(draft, close, rootEl) },
    ]);

    m.body.querySelector('#tf-name').addEventListener('input', e => draft.name = e.target.value);
    m.body.querySelector('#tf-cadence').addEventListener('change', e => draft.cadence = e.target.value);
    m.body.querySelector('#tf-onsite').addEventListener('change', e => draft.requiresOnsite = e.target.checked);
    m.body.querySelector('#tf-start').addEventListener('input', e => applyWindow(draft, m.body));
    m.body.querySelector('#tf-end').addEventListener('input', e => applyWindow(draft, m.body));
    m.body.querySelector('#tf-scored').addEventListener('change', e => {
      draft.scored = e.target.checked;
      m.body.querySelector('#tf-thresholds-wrap').style.display = draft.scored ? '' : 'none';
    });
    m.body.querySelector('#tf-tA').addEventListener('input', e => draft.thresholds.A = Number(e.target.value) || 0);
    m.body.querySelector('#tf-tB').addEventListener('input', e => draft.thresholds.B = Number(e.target.value) || 0);
    m.body.querySelector('#tf-tC').addEventListener('input', e => draft.thresholds.C = Number(e.target.value) || 0);
    m.body.querySelector('#tf-themes').addEventListener('input', e => {
      draft.rotatingThemes = e.target.value.split(',').map(s => s.trim()).filter(Boolean);
    });
    m.body.querySelector('#tf-add-section').addEventListener('click', () => {
      draft.sections.push({ id: genId('c'), title: 'New Section', requirePhoto: false, items: [] });
      renderSections(m.body.querySelector('#tf-sections'), draft);
    });

    renderSections(m.body.querySelector('#tf-sections'), draft);
  }

  function applyWindow(draft, body) {
    const s = body.querySelector('#tf-start').value, e = body.querySelector('#tf-end').value;
    draft.window = (s === '' || e === '') ? null : { startHH: Number(s), endHH: Number(e) };
  }

  function renderSections(container, draft) {
    container.innerHTML = '';
    if (!draft.sections.length) container.appendChild(UI.el('div', { class: 'empty' }, 'No sections yet.'));
    draft.sections.forEach((sec, si) => {
      const card = UI.el('div', { class: 'sec-card' });
      card.innerHTML = `
        <div class="sec-head">
          <input type="text" class="sec-title" value="${esc(sec.title)}">
          <div class="sec-controls">
            <label class="toggle small"><input type="checkbox" class="sec-photo" ${sec.requirePhoto ? 'checked' : ''}><span>Photo</span></label>
            <button class="btn ghost small sec-up" type="button" ${si === 0 ? 'disabled' : ''}>&uarr;</button>
            <button class="btn ghost small sec-down" type="button" ${si === draft.sections.length - 1 ? 'disabled' : ''}>&darr;</button>
            <button class="btn ghost small sec-del" type="button">Delete</button>
          </div>
        </div>
        <div class="item-list"></div>
        <button class="btn ghost small item-add" type="button">+ Add Item</button>
      `;
      card.querySelector('.sec-title').addEventListener('input', e => sec.title = e.target.value);
      card.querySelector('.sec-photo').addEventListener('change', e => sec.requirePhoto = e.target.checked);
      card.querySelector('.sec-up').addEventListener('click', () => { if (si > 0) { [draft.sections[si - 1], draft.sections[si]] = [draft.sections[si], draft.sections[si - 1]]; renderSections(container, draft); } });
      card.querySelector('.sec-down').addEventListener('click', () => { if (si < draft.sections.length - 1) { [draft.sections[si + 1], draft.sections[si]] = [draft.sections[si], draft.sections[si + 1]]; renderSections(container, draft); } });
      card.querySelector('.sec-del').addEventListener('click', () => { draft.sections.splice(si, 1); renderSections(container, draft); });
      card.querySelector('.item-add').addEventListener('click', () => {
        sec.items.push({ id: genId('c'), text: 'New item', type: 'passfail' });
        renderItems(card.querySelector('.item-list'), sec, draft, container);
      });
      renderItems(card.querySelector('.item-list'), sec, draft, container);
      container.appendChild(card);
    });
  }

  function renderItems(container, sec, draft, sectionsContainer) {
    container.innerHTML = '';
    sec.items.forEach((item, ii) => {
      const row = UI.el('div', { class: 'item-row' });
      row.innerHTML = `
        <input type="text" class="it-text" value="${esc(item.text)}">
        <select class="it-type">${TYPES.map(t => `<option value="${t}" ${t === item.type ? 'selected' : ''}>${t}</option>`).join('')}</select>
        <label class="toggle small"><input type="checkbox" class="it-crit" ${item.critical ? 'checked' : ''}><span>Critical</span></label>
        <label class="toggle small"><input type="checkbox" class="it-na" ${item.allowNA ? 'checked' : ''}><span>Allow N/A</span></label>
        <button class="btn ghost small it-up" type="button" ${ii === 0 ? 'disabled' : ''}>&uarr;</button>
        <button class="btn ghost small it-down" type="button" ${ii === sec.items.length - 1 ? 'disabled' : ''}>&darr;</button>
        <button class="btn ghost small it-del" type="button">&times;</button>
      `;
      row.querySelector('.it-text').addEventListener('input', e => item.text = e.target.value);
      row.querySelector('.it-type').addEventListener('change', e => item.type = e.target.value);
      row.querySelector('.it-crit').addEventListener('change', e => item.critical = e.target.checked);
      row.querySelector('.it-na').addEventListener('change', e => item.allowNA = e.target.checked);
      row.querySelector('.it-up').addEventListener('click', () => { if (ii > 0) { [sec.items[ii - 1], sec.items[ii]] = [sec.items[ii], sec.items[ii - 1]]; renderItems(container, sec, draft, sectionsContainer); } });
      row.querySelector('.it-down').addEventListener('click', () => { if (ii < sec.items.length - 1) { [sec.items[ii + 1], sec.items[ii]] = [sec.items[ii], sec.items[ii + 1]]; renderItems(container, sec, draft, sectionsContainer); } });
      row.querySelector('.it-del').addEventListener('click', () => { sec.items.splice(ii, 1); renderItems(container, sec, draft, sectionsContainer); });
      container.appendChild(row);
    });
  }

  function saveDraft(draft, close, rootEl) {
    if (!draft.name || !draft.name.trim()) { UI.toast('Template needs a name.'); return; }
    const hasContent = draft.sections.length > 0 && draft.sections.some(s => (s.items || []).length > 0);
    if (!hasContent) { UI.toast('Add at least one section with one item before saving.'); return; }
    if (!draft.scored) delete draft.thresholds;
    if (!draft.rotatingThemes.length) delete draft.rotatingThemes;
    if (!draft.window) delete draft.window;
    Data.saveTemplate(draft);
    close();
    UI.toast('Template saved.');
    render(rootEl);
  }

  /* ------------------------------------------------------------------ */
  /* (b) Issue routing rules                                             */
  /* ------------------------------------------------------------------ */

  function renderRoutingCard(container) {
    const rules = Data.list('routingRules');
    container.innerHTML = `
      <div class="card">
        <h3>Issue Routing Rules</h3>
        <p class="micro" style="margin-bottom:10px">Category + minimum severity determines which team an issue routes to, and whether a follow-up action is auto-created.</p>
        <div class="table-scroll"><table class="data" id="routing-table">
          <thead><tr><th>Category</th><th>Min Severity</th><th>Route To</th><th>Auto Action</th><th>Due Offset (days)</th><th></th></tr></thead>
          <tbody></tbody>
        </table></div>
        <button class="btn small" id="rule-add" type="button">+ Add Rule</button>
      </div>`;
    const tbody = container.querySelector('tbody');
    rules.forEach(rule => tbody.appendChild(routingRow(rule, container)));
    container.querySelector('#rule-add').addEventListener('click', () => {
      const rule = Data.insert('routingRules', { category: ISSUE_CATEGORIES[0], minSeverity: 'low', routeTo: '', autoAction: false, dueOffsetDays: 3 });
      tbody.appendChild(routingRow(rule, container));
    });
  }

  function routingRow(rule, container) {
    const isCustomCat = !ISSUE_CATEGORIES.includes(rule.category);
    const tr = UI.el('tr', {});
    tr.innerHTML = `
      <td>
        <select class="rr-cat">${ISSUE_CATEGORIES.map(c => `<option value="${esc(c)}" ${c === rule.category ? 'selected' : ''}>${esc(c)}</option>`).join('')}<option value="__other" ${isCustomCat ? 'selected' : ''}>Other…</option></select>
        <input type="text" class="rr-cat-other" placeholder="Category name" value="${isCustomCat ? esc(rule.category) : ''}" style="${isCustomCat ? '' : 'display:none'};margin-top:4px">
      </td>
      <td><select class="rr-sev">${['low', 'medium', 'high'].map(s => `<option value="${s}" ${s === rule.minSeverity ? 'selected' : ''}>${s}</option>`).join('')}</select></td>
      <td><input type="text" class="rr-route" value="${esc(rule.routeTo || '')}" placeholder="Team"></td>
      <td><label class="toggle small"><input type="checkbox" class="rr-auto" ${rule.autoAction ? 'checked' : ''}><span>On</span></label></td>
      <td><input type="number" class="rr-due" min="0" value="${rule.dueOffsetDays ?? 3}" style="width:70px"></td>
      <td><button class="btn ghost small rr-del" type="button">Delete</button></td>
    `;
    const catSel = tr.querySelector('.rr-cat'), catOther = tr.querySelector('.rr-cat-other');
    catSel.addEventListener('change', () => {
      if (catSel.value === '__other') { catOther.style.display = ''; Data.update('routingRules', rule.id, { category: catOther.value }); }
      else { catOther.style.display = 'none'; Data.update('routingRules', rule.id, { category: catSel.value }); }
    });
    catOther.addEventListener('input', () => { if (catSel.value === '__other') Data.update('routingRules', rule.id, { category: catOther.value }); });
    tr.querySelector('.rr-sev').addEventListener('change', e => Data.update('routingRules', rule.id, { minSeverity: e.target.value }));
    tr.querySelector('.rr-route').addEventListener('input', e => Data.update('routingRules', rule.id, { routeTo: e.target.value }));
    tr.querySelector('.rr-auto').addEventListener('change', e => Data.update('routingRules', rule.id, { autoAction: e.target.checked }));
    tr.querySelector('.rr-due').addEventListener('input', e => Data.update('routingRules', rule.id, { dueOffsetDays: Number(e.target.value) || 0 }));
    tr.querySelector('.rr-del').addEventListener('click', () => { Data.remove('routingRules', rule.id); tr.remove(); UI.toast('Rule deleted.'); });
    return tr;
  }

  /* ------------------------------------------------------------------ */
  /* (c) Data controls                                                   */
  /* ------------------------------------------------------------------ */

  function renderDataCard(container, rootEl) {
    const settings = Data.settings();
    const pl = settings.plAssumptions || { avgCheck: 8.75, txnPerStoreDay: 210 };
    container.innerHTML = `
      <div class="card">
        <h3>Data Controls</h3>
        <div class="field"><label>P&amp;L Assumptions — Avg Check ($)</label><input type="number" step="0.01" min="0" id="pl-avgcheck" value="${pl.avgCheck}"></div>
        <div class="field"><label>P&amp;L Assumptions — Transactions / Store / Day</label><input type="number" min="0" id="pl-txn" value="${pl.txnPerStoreDay}"></div>
        <p class="micro" style="margin-bottom:10px">Used by the Reports P&amp;L impact tile. Illustrative — edit to match current assumptions.</p>
        <button class="btn danger small" id="reset-demo" type="button">Reset Demo Data</button>
      </div>`;
    const save = () => {
      const avgCheck = Number(container.querySelector('#pl-avgcheck').value) || 0;
      const txnPerStoreDay = Number(container.querySelector('#pl-txn').value) || 0;
      Data.saveSettings({ plAssumptions: { avgCheck, txnPerStoreDay } });
    };
    container.querySelector('#pl-avgcheck').addEventListener('input', save);
    container.querySelector('#pl-txn').addEventListener('input', save);
    container.querySelector('#reset-demo').addEventListener('click', () => {
      const m = UI.modal('Reset demo data?', '<p>This replaces ALL data — stores, users, submissions, issues, actions, routing rules, AND any template edits made in this Admin builder — with a freshly seeded demo set. This cannot be undone.</p>', [
        { label: 'Cancel', cls: 'ghost' },
        { label: 'Reset', cls: 'danger', onClick: (close) => { Data.reseed(); close(); UI.toast('Demo data reset.'); render(rootEl); } },
      ]);
    });
  }

})();
