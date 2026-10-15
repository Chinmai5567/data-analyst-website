const $ = selector => document.querySelector(selector);
const state = { selectedCells: new Set(), dragSelecting: false, dragCompleted: false, dragStart: null, headers: [], rows: [], sourceName: '', viewRows: null, result: null, sort: null, page: 0, pageSize: 25, chart: null, chartFields: [], chartDimension: '', chartAggregation: 'sum', undoRows: null, editorPage: 0, issueFilter: 'all', solvedIssues: new Set(), selectedIssue: null, selectedFix: null, cellFormats: {}, tableStyle: 'plain', selectedCell: null, selectionAnchor: null, selectionRange: null };
const APP_PAGE_LABELS = { overview: 'Overview', workspace: 'Data workspace', editData: 'Edit', changeDataset: 'Change the dataset', dashboard: 'Dashboard', askData: 'Ask your data', tools: 'Toolbox', savedProjects: 'Recent projects' };
const APP_PAGE_HASHES = Object.fromEntries(Object.keys(APP_PAGE_LABELS).map(key => [key, key]));
function pageFromHash(hash) { const key = (hash || '#overview').slice(1); return APP_PAGE_LABELS[key] ? key : 'overview'; }
function showAppPage(key, updateHash = true) {
  if (!APP_PAGE_LABELS[key]) key = 'overview';
  document.querySelectorAll('[data-app-page]').forEach(page => { page.hidden = page.dataset.appPage !== key; });
  document.querySelectorAll('.nav-item').forEach(link => link.classList.remove('active'));
  document.querySelectorAll('[data-app-nav]').forEach(link => link.classList.toggle('active', link.dataset.appNav === key));
  const legacyLink = document.querySelector(`.nav-item[href="#${key}"]`);
  if (legacyLink && !legacyLink.classList.contains('tool-launch')) legacyLink.classList.add('active');
  const crumb = document.querySelector('.breadcrumbs b'); if (crumb) crumb.textContent = APP_PAGE_LABELS[key];
  if (updateHash && location.hash !== `#${APP_PAGE_HASHES[key]}`) history.pushState({ view: key }, '', `#${APP_PAGE_HASHES[key]}`);
  if (key === 'dashboard') requestAnimationFrame(() => state.chart?.resize());
  window.scrollTo({ top: 0, behavior: 'auto' });
}
function selectedCellCoords() {
  if (state.selectedCells?.size) return [...state.selectedCells].map(key => key.split(':').map(Number)).map(([row, column]) => ({ row, column })).filter(cell => state.rows[cell.row] && cell.column < state.headers.length);
  const range = state.selectionRange || (state.selectedCell ? { start: state.selectedCell, end: state.selectedCell } : null);
  if (!range) return [];
  const cells = [];
  for (let row = Math.min(range.start.row, range.end.row); row <= Math.max(range.start.row, range.end.row); row++) for (let column = Math.min(range.start.column, range.end.column); column <= Math.max(range.start.column, range.end.column); column++) cells.push({ row, column });
  return cells;
}

let currentUser = null;
let authMode = 'login';
let profileImage = '';
let profileImageAtOpen = '';
let profileOriginal = null;
let workspaceList = [];
let activeWorkspaceId = '';
const workspaceMemory = new Map();
const FREE_WORKSPACE_LIMIT = 2;
let pendingDatasetChange = null;
let datasetChangeUndo = null;
const fileInput = $('#fileInput');
const dropzone = $('#dropzone');
const notice = $('#notice');

function message(text) { notice.textContent = text; notice.classList.add('show'); clearTimeout(message.timer); message.timer = setTimeout(() => notice.classList.remove('show'), 6000); }
function toast(text) { const el = $('#toast'); el.textContent = text; el.classList.add('show'); clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove('show'), 3200); }
function escapeHTML(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

function workspaceListKey() { return `analyticsHub.workspaces.${currentUser?.id || 'guest'}`; }
function workspaceActiveKey() { return `analyticsHub.activeWorkspace.${currentUser?.id || 'guest'}`; }
function workspaceDataKey(id) { return `analyticsHub.workspaceData.${currentUser?.id || 'guest'}.${id}`; }
function workspaceMemoryKey(id) { return `${currentUser?.id || 'guest'}:${id}`; }
function initWorkspaces() {
  try { workspaceList = JSON.parse(localStorage.getItem(workspaceListKey()) || '[]'); } catch { workspaceList = []; }
  if (!Array.isArray(workspaceList) || !workspaceList.length) workspaceList = [{ id: 'main', name: 'My workspace' }];
  workspaceList = workspaceList.slice(0, FREE_WORKSPACE_LIMIT);
  if (!workspaceList.some(item => item.id === 'main')) workspaceList.unshift({ id: 'main', name: 'My workspace' });
  workspaceList = workspaceList.slice(0, FREE_WORKSPACE_LIMIT);
  activeWorkspaceId = localStorage.getItem(workspaceActiveKey()) || workspaceList[0].id;
  if (!workspaceList.some(item => item.id === activeWorkspaceId)) activeWorkspaceId = workspaceList[0].id;
  saveWorkspaceList();
  renderWorkspaceMenu();
}
function saveWorkspaceList() {
  try { localStorage.setItem(workspaceListKey(), JSON.stringify(workspaceList)); } catch { /* current session still works from memory */ }
}
function workspaceSnapshot() {
  return { headers: state.headers, rows: state.rows, sourceName: state.sourceName, chartFields: state.chartFields, chartDimension: state.chartDimension, chartAggregation: state.chartAggregation, solvedIssues: [...state.solvedIssues], cellFormats: state.cellFormats, tableStyle: state.tableStyle };
}
function persistActiveWorkspace() {
  if (!currentUser || !activeWorkspaceId) return;
  const snapshot = workspaceSnapshot();
  workspaceMemory.set(workspaceMemoryKey(activeWorkspaceId), snapshot);
  try { localStorage.setItem(workspaceDataKey(activeWorkspaceId), JSON.stringify(snapshot)); }
  catch { toast('Workspace data is kept until this tab closes, but this file is too large for browser storage.'); }
}
function scheduleWorkspaceSave() {
  if (!currentUser || !activeWorkspaceId) return;
  clearTimeout(scheduleWorkspaceSave.timer);
  scheduleWorkspaceSave.timer = setTimeout(persistActiveWorkspace, 400);
}
function renderWorkspaceMenu() {
  const active = workspaceList.find(item => item.id === activeWorkspaceId) || workspaceList[0];
  if (!active) return;
  $('#workspaceName').textContent = active.name;
  $('#workspaceIcon').textContent = active.name.trim().slice(0, 1).toUpperCase() || 'W';
  $('#workspaceCount').textContent = `${workspaceList.length} of ${FREE_WORKSPACE_LIMIT}`;
  $('#workspaceMenu').innerHTML = `<div class="workspace-menu-heading">SWITCH WORKSPACE</div>${workspaceList.map(item => `<button type="button" class="workspace-option${item.id === activeWorkspaceId ? ' active' : ''}" data-workspace-id="${escapeHTML(item.id)}"><span class="workspace-option-icon">${escapeHTML(item.name.trim().slice(0, 1).toUpperCase() || 'W')}</span><span>${escapeHTML(item.name)}</span><span class="workspace-check">${item.id === activeWorkspaceId ? '✓' : ''}</span></button>`).join('')}<div class="workspace-menu-divider"></div><button type="button" class="workspace-add" id="addWorkspaceButton"><span>＋</span> Add workspace</button><small class="workspace-limit-note">Free plan · up to 2 workspaces</small>`;
  $('#workspaceMenu').querySelectorAll('[data-workspace-id]').forEach(button => button.onclick = () => switchWorkspace(button.dataset.workspaceId));
  $('#addWorkspaceButton').onclick = () => {
    $('#workspaceMenu').hidden = true;
    $('#workspaceSwitcher').setAttribute('aria-expanded', 'false');
    if (workspaceList.length >= FREE_WORKSPACE_LIMIT) $('#upgradeWorkspaceDialog').showModal();
    else { $('#newWorkspaceName').value = ''; $('#createWorkspaceDialog').showModal(); $('#newWorkspaceName').focus(); }
  };
}
function restoreWorkspace(id) {
  let snapshot = workspaceMemory.get(workspaceMemoryKey(id));
  if (!snapshot) { try { snapshot = JSON.parse(localStorage.getItem(workspaceDataKey(id)) || 'null'); } catch { snapshot = null; } }
  clearChart();
  state.headers = Array.isArray(snapshot?.headers) ? snapshot.headers : [];
  state.rows = Array.isArray(snapshot?.rows) ? snapshot.rows : [];
  state.sourceName = snapshot?.sourceName || '';
  state.viewRows = null; state.result = null; state.sort = null; state.page = 0;
  state.chartFields = Array.isArray(snapshot?.chartFields) ? snapshot.chartFields : [];
  state.chartDimension = snapshot?.chartDimension ?? '';
  state.chartAggregation = snapshot?.chartAggregation || 'sum';
  state.solvedIssues = new Set(snapshot?.solvedIssues || []);
  state.cellFormats = snapshot?.cellFormats && typeof snapshot.cellFormats === 'object' ? snapshot.cellFormats : {}; state.tableStyle = snapshot?.tableStyle || 'plain'; state.selectedCell = null; state.selectionAnchor = null; state.selectionRange = null; state.selectedCells?.clear();
  state.undoRows = null; state.editorPage = 0; state.issueFilter = 'all'; state.selectedIssue = null; state.selectedFix = null;
  pendingDatasetChange = null; datasetChangeUndo = null; $('#datasetChangeResult').hidden = true; $('#datasetChangeResult').innerHTML = '';
  $('#issueFilter').value = 'all'; fileInput.value = ''; $('#tableSearch').value = ''; $('#askInput').value = ''; $('#askAnswer').hidden = true;
  renderWorkspaceMenu(); render();
  if (state.headers.length && (state.chartFields.length || state.chartDimension !== '')) makeChart();
}
function switchWorkspace(id) {
  if (id === activeWorkspaceId || !workspaceList.some(item => item.id === id)) return;
  clearTimeout(scheduleWorkspaceSave.timer);
  persistActiveWorkspace();
  activeWorkspaceId = id;
  try { localStorage.setItem(workspaceActiveKey(), id); } catch { /* keep selection for this session */ }
  $('#workspaceMenu').hidden = true; $('#workspaceSwitcher').setAttribute('aria-expanded', 'false');
  restoreWorkspace(id);
  toast(`Switched to ${workspaceList.find(item => item.id === id)?.name || 'workspace'}.`);
}

function parseCSV(text) {
  const out = []; let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') quoted = false; else cell += c; }
    else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); if (row.some(v => v.trim())) out.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); out.push(row); }
  return out;
}
function readMatrix(file) {
  return new Promise((resolve, reject) => {
    const ext = file.name.split('.').pop().toLowerCase();
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
    reader.onload = event => {
      try {
        if (ext === 'csv') resolve(parseCSV(event.target.result));
        else if (window.XLSX) {
          const workbook = XLSX.read(event.target.result, { type: 'array', cellDates: true });
          resolve(XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1, defval: '', raw: false }));
        } else reject(new Error('Excel support needs an internet connection. You can use CSV files without it.'));
      } catch (error) { reject(error); }
    };
    if (ext === 'csv') reader.readAsText(file); else reader.readAsArrayBuffer(file);
  });
}
function ingest(name, matrix) {
  matrix = (matrix || []).filter(row => row && row.some(value => value !== null && value !== undefined && String(value).trim() !== ''));
  if (!matrix.length) { message('This file looks empty. Choose a spreadsheet with a header row and data.'); return; }
  state.headers = matrix[0].map((v, i) => String(v ?? '').trim() || `Column ${i + 1}`); state.cellFormats = {}; state.tableStyle = 'plain'; state.selectedCell = null; state.selectionAnchor = null; state.selectionRange = null; state.selectedCells.clear(); pendingDatasetChange = null; datasetChangeUndo = null; $('#datasetChangeResult').hidden = true; $('#datasetChangeResult').innerHTML = ''; $('#tableStyle').value = 'plain';
  state.rows = matrix.slice(1).map(row => state.headers.map((_, i) => row?.[i] ?? '')); state.chartFields = []; state.chartDimension = ''; state.chartAggregation = 'sum'; state.undoRows = null; state.editorPage = 0; state.issueFilter = 'all'; state.solvedIssues.clear(); state.selectedIssue = null; state.selectedFix = null; $('#issueFilter').value = 'all';
  state.sourceName = name; state.viewRows = null; state.result = null; state.page = 0; state.sort = null;
  clearChart(); $('#askAnswer').hidden = true; $('#tableSearch').value = ''; $('#askInput').value = ''; render(); message(`Loaded ${name} — ${state.rows.length.toLocaleString()} rows are ready.`);
}
async function openFile(file) {
  if (!file) return;
  if (!/\.(csv|xlsx|xls)$/i.test(file.name)) { message('Choose a CSV, XLSX, or XLS file.'); return; }
  try { ingest(file.name, await readMatrix(file)); } catch (error) { message(error.message); }
}
function currentRows() {
  let data = state.result ? state.result.rows : state.viewRows || state.rows;
  const term = $('#tableSearch').value.trim().toLowerCase();
  if (term) data = data.filter(row => row.some(value => String(value ?? '').toLowerCase().includes(term)));
  if (state.sort) {
    const { index, direction } = state.sort;
    data = [...data].sort((a, b) => {
      const av = String(a[index] ?? '').trim(), bv = String(b[index] ?? '').trim();
      const an = Number(av.replace(/[%,$]/g, '')), bn = Number(bv.replace(/[%,$]/g, ''));
      const order = av && bv && Number.isFinite(an) && Number.isFinite(bn) ? an - bn : av.localeCompare(bv, undefined, { numeric: true, sensitivity: 'base' });
      return order * direction;
    });
  }
  return data;
}
function quality() {
  let missing = 0;
  state.rows.forEach(row => row.forEach(value => { if (value === null || String(value).trim() === '') missing++; }));
  const total = state.rows.length * state.headers.length;
  return { missing, score: total ? Math.round(100 * (1 - missing / total)) : 0, total };
}
function duplicateKey(row) {
  const identifierColumns = state.headers.map((header, index) => ({ header, index })).filter(item => /(^|[\s_-])(id|identifier|uuid|record number|row number|key)$/i.test(item.header)).map(item => item.index);
  const comparedColumns = state.headers.map((_, index) => index).filter(index => !identifierColumns.includes(index));
  const columns = comparedColumns.length ? comparedColumns : state.headers.map((_, index) => index);
  return JSON.stringify(columns.map(index => String(row[index] ?? '').trim().replace(/\s+/g, ' ').toLowerCase()));
}
function recordResolvedIssues(before, after) {
  const afterKeys = new Set(after.map(issue => issue.key));
  before.forEach(issue => { if (!afterKeys.has(issue.key)) state.solvedIssues.add(issue.key); });
}
function render() {
  const data = currentRows();
  const q = quality();
  $('#rowsStat').textContent = state.rows.length.toLocaleString();
  $('#colsStat').textContent = state.headers.length.toLocaleString();
  $('#qualityStat').textContent = state.headers.length ? `${q.score}%` : '—';
  $('#qualityNote').textContent = q.missing ? `${q.missing.toLocaleString()} empty cells found` : state.headers.length ? 'No empty cells found' : 'Upload a file to get a score';
  $('#missingStat').textContent = state.headers.length ? q.missing.toLocaleString() : '—';
  $('#missingNote').textContent = state.headers.length ? `of ${q.total.toLocaleString()} total cells` : 'we’ll find gaps for you';
  $('#datasetName').textContent = state.sourceName || 'No dataset yet';
  $('#filePill').textContent = state.sourceName ? `${state.sourceName.split('.').pop().toUpperCase()} · ${state.rows.length.toLocaleString()} rows` : 'Waiting for a file';
  $('#downloadBtn').disabled = !state.headers.length;
  const pages = Math.max(1, Math.ceil(data.length / state.pageSize)); state.page = Math.min(state.page, pages - 1);
  const start = state.page * state.pageSize, visible = data.slice(start, start + state.pageSize);
  $('#tableCaption').textContent = state.headers.length ? `Rows ${data.length ? start + 1 : 0}–${Math.min(start + state.pageSize, data.length)} of ${data.length}${state.viewRows ? ' · filtered result' : ''}` : 'Upload a spreadsheet to begin';
  const table = $('#dataTable'); const shownHeaders = state.result?.headers || state.headers;
  if (!state.headers.length) table.innerHTML = '<thead><tr><th>Preview</th></tr></thead><tbody><tr><td class="empty-cell">Your data preview will show up here after upload.</td></tr></tbody>';
  else table.innerHTML = `<thead><tr>${shownHeaders.map((h, i) => `<th><button class="sort-button" data-sort="${i}">${escapeHTML(h)}${state.sort?.index === i ? (state.sort.direction === 1 ? ' ↑' : ' ↓') : ' ↕'}</button></th>`).join('')}</tr></thead><tbody>${visible.map(row => `<tr>${shownHeaders.map((_, i) => `<td title="${escapeHTML(row[i])}">${escapeHTML(row[i]) || '—'}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${shownHeaders.length}" class="empty-cell">No rows match this view.</td></tr>`}</tbody>`;
  if (state.result) $('#tableCaption').textContent = state.result.summary;
  $('#pageLabel').textContent = `Page ${state.page + 1} of ${pages}`;
  $('#prevPage').disabled = state.page === 0; $('#nextPage').disabled = state.page >= pages - 1;
  const chartHeaders = state.result?.headers || state.headers;
  const allFields = chartHeaders.map((_, index) => index);
  state.chartFields = state.chartFields.filter(index => allFields.includes(index));
  $('#chartFields').innerHTML = allFields.map(index => `<label class="field-choice"><input type="checkbox" data-chart-field="${index}" ${state.chartFields.includes(index) ? 'checked' : ''}><span>${escapeHTML(chartHeaders[index])}</span></label>`).join('') || '<span class="field-empty">No fields in this view</span>';
  $('#chartFieldSummary').textContent = state.chartFields.length ? `FIELDS · ${state.chartFields.length} selected` : 'FIELDS · choose measures';
  const dimension = $('#chartDimension'), previous = state.chartDimension;
  dimension.innerHTML = '<option value="">Row order</option>' + chartHeaders.map((header, index) => `<option value="${index}">${escapeHTML(header)}</option>`).join('');
  if (chartHeaders[previous]) dimension.value = previous; else { dimension.value = ''; state.chartDimension = ''; }
  $('#chartAggregation').value = state.chartAggregation;
  if (!state.headers.length) clearChart();
  renderEditor();
  scheduleWorkspaceSave();
}
function scanIssues() {
  const issues = [];
  if (!state.headers.length) return issues;
  const add = (row, column, code, text, severity = 'error') => issues.push({ row, column, code, text, severity, key: `${row}:${column}:${code}` });
  const types = state.headers.map((_, index) => detectType(index));
  const boundedColumns = state.headers.map((header, index) => ({ header: header.toLowerCase(), index })).filter(item => /attendance|percent|percentage|score|mark\s*\(%?\)|\(%\)/.test(item.header));
  const duplicates = new Set(); const seen = new Set();
  state.rows.forEach((row, rowIndex) => {
    row.forEach((value, column) => {
      const raw = String(value ?? ''); const trimmed = raw.trim(); const header = state.headers[column];
      if (!trimmed) { add(rowIndex, column, 'missing', `${header} is blank`); return; }
      if (raw !== trimmed || /\s{2,}/.test(trimmed)) add(rowIndex, column, 'spacing', `${header} has extra spaces`, 'warning');
      if (types[column] === 'Number' && !parseNumericCell(trimmed)) add(rowIndex, column, 'type', `${header} should contain a number`);
      if (types[column] === 'Date' && Number.isNaN(Date.parse(trimmed))) add(rowIndex, column, 'date', `${header} is not a valid date`);
      if (boundedColumns.some(item => item.index === column)) {
        const parsed = parseNumericCell(trimmed);
        if (parsed && (parsed.number < 0 || parsed.number > 100)) add(rowIndex, column, 'range', `${header} should be between 0 and 100`);
      }
    });
    const key = duplicateKey(row);
    if (seen.has(key)) duplicates.add(rowIndex); else seen.add(key);
  });
  const textColumns = state.headers.map((_, index) => index).filter(index => types[index] === 'Text');
  textColumns.forEach(column => {
    const firstForm = new Map();
    state.rows.forEach((row, rowIndex) => {
      const value = String(row[column] ?? '').trim(); if (!value) return;
      const normalized = value.replace(/\s+/g, ' ').toLocaleLowerCase();
      if (firstForm.has(normalized) && firstForm.get(normalized) !== value) add(rowIndex, column, 'case', `${state.headers[column]} has inconsistent capitalization`, 'warning');
      else if (!firstForm.has(normalized)) firstForm.set(normalized, value);
    });
  });
  duplicates.forEach(row => add(row, -1, 'duplicate', 'Possible duplicate profile (ID columns ignored)', 'warning'));
  return issues;
}
function renderEditor() {
  const table = $('#editorTable');
  if (!table) return;
  $('#tableStyle').value = state.tableStyle;
  const selectedCoords = selectedCellCoords();
  $('#selectedCellLabel').textContent = selectedCoords.length > 1 ? `${selectedCoords.length} cells selected` : state.selectedCell ? `Row ${state.selectedCell.row + 2} · ${state.headers[state.selectedCell.column] || 'cell'}` : 'Choose cells below';
  $('#fillRangeButton').disabled = !state.selectedCell;
  ['cellFill', 'cellColor', 'cellAlign', 'clearFormatButton'].forEach(id => { $(`#${id}`).disabled = !state.selectedCell; });
  document.querySelectorAll('.format-toggle').forEach(button => { button.disabled = !state.selectedCell; });
  const issues = scanIssues();
  const issueMap = new Map(); issues.forEach(issue => { const key = `${issue.row}:${issue.column}`; issueMap.set(key, [...(issueMap.get(key) || []), issue]); });
  const activeKeys = new Set(issues.map(issue => issue.key));
  state.solvedIssues.forEach(key => { if (activeKeys.has(key)) state.solvedIssues.delete(key); });
  const fixedCount = state.solvedIssues.size;
  $('#issueCount').textContent = state.headers.length ? `${issues.length} open` : 'Upload a file';
  $('#issueCount').className = `issue-count${issues.length ? ' has-issues' : state.headers.length ? ' all-clear' : ''}`;
  $('#issueSummary').textContent = !state.headers.length ? 'Add a CSV or Excel file to scan for missing values, type mismatches, invalid dates, formatting issues, and duplicate profiles.' : issues.length ? `${issues.filter(item => item.severity === 'error').length} data errors and ${issues.filter(item => item.severity === 'warning').length} review suggestions found. ${fixedCount} issue${fixedCount === 1 ? '' : 's'} fixed in this session.` : `No open checks found. ${fixedCount ? `${fixedCount} issue${fixedCount === 1 ? '' : 's'} fixed in this session.` : 'Your data passed the current checks.'}`;
  const issueList = $('#issueList');
  issueList.innerHTML = issues.slice(0, 40).map(issue => `<button type="button" class="issue-item ${issue.severity}" data-issue-key="${escapeHTML(issue.key)}" data-jump-row="${issue.row}" data-jump-col="${issue.column}"><span class="issue-status">${issue.severity === 'error' ? '!' : '↗'}</span><span><b>${escapeHTML(issue.text)}</b><small>Row ${issue.row + 2}${issue.column >= 0 ? ` · ${escapeHTML(state.headers[issue.column])}` : ' · review this record'}</small></span><span class="issue-arrow">›</span></button>`).join('') || (state.headers.length ? '<div class="issue-empty">No active issues. Your checks are clear. ✓</div>' : '');
  if (issues.length > 40) issueList.insertAdjacentHTML('beforeend', `<div class="issue-more">Showing 40 of ${issues.length} issues. Use “Rows with issues” to edit the rest.</div>`);
  const issueRows = new Set(issues.map(issue => issue.row));
  const fixedRows = new Set([...state.solvedIssues].map(key => Number(key.split(':')[0])));
  let rowIndices = state.rows.map((_, index) => index);
  if (state.issueFilter === 'issues') rowIndices = rowIndices.filter(index => issueRows.has(index));
  if (state.issueFilter === 'fixed') rowIndices = rowIndices.filter(index => fixedRows.has(index));
  const pages = Math.max(1, Math.ceil(rowIndices.length / state.pageSize)); state.editorPage = Math.min(state.editorPage, pages - 1);
  const start = state.editorPage * state.pageSize; const visible = rowIndices.slice(start, start + state.pageSize);
  if (!state.headers.length) table.innerHTML = '<thead><tr><th>Upload a spreadsheet to begin</th></tr></thead><tbody><tr><td class="empty-cell">Your editable spreadsheet will appear here.</td></tr></tbody>';
  else { table.className = `editable-data-table style-${state.tableStyle}`; table.innerHTML = `<thead><tr><th class="row-number">#</th>${state.headers.map((header, column) => `<th><button type="button" class="editor-header-button" data-rename-col="${column}" title="Click to rename column">${escapeHTML(header)} <span>✎</span></button></th>`).join('')}</tr></thead><tbody>${visible.map(rowIndex => `<tr><th class="row-number">${rowIndex + 2}</th>${state.headers.map((header, column) => { const cellIssues = issueMap.get(`${rowIndex}:${column}`) || []; const issue = cellIssues.find(item => item.severity === 'error') || cellIssues[0]; const solved = !issue && [...state.solvedIssues].some(key => key.startsWith(`${rowIndex}:${column}:`)); const fmt = state.cellFormats[`${rowIndex}:${column}`] || {}; const selected = state.selectedCells?.size ? state.selectedCells.has(`${rowIndex}:${column}`) : state.selectionRange && rowIndex >= Math.min(state.selectionRange.start.row, state.selectionRange.end.row) && rowIndex <= Math.max(state.selectionRange.start.row, state.selectionRange.end.row) && column >= Math.min(state.selectionRange.start.column, state.selectionRange.end.column) && column <= Math.max(state.selectionRange.start.column, state.selectionRange.end.column); const style = [fmt.fill ? `background-color:${fmt.fill}` : '', fmt.color ? `color:${fmt.color}` : '', `text-align:${fmt.align || 'left'}`, fmt.bold ? 'font-weight:700' : '', fmt.italic ? 'font-style:italic' : ''].filter(Boolean).join(';'); return `<td class="${issue ? (issue.severity === 'error' ? 'cell-error' : 'cell-warning') : solved ? 'cell-fixed' : ''}${selected ? ' selected-range' : ''}" style="${style}"><input class="editor-cell" data-row="${rowIndex}" data-col="${column}" value="${escapeHTML(state.rows[rowIndex][column])}" aria-label="Row ${rowIndex + 2}, ${escapeHTML(header)}${issue ? `, ${escapeHTML(issue.text)}` : ''}" title="${escapeHTML(issue?.text || (solved ? 'Fixed in this session' : `Edit ${header}`))}" /></td>`; }).join('')}</tr>`).join('') || `<tr><td colspan="${state.headers.length + 1}" class="empty-cell">No rows in this view.</td></tr>`}</tbody>`; }
  $('#editorCaption').textContent = state.headers.length ? `Rows ${rowIndices.length ? start + 1 : 0}–${Math.min(start + state.pageSize, rowIndices.length)} of ${rowIndices.length}${state.issueFilter === 'issues' ? ' · rows with issues' : state.issueFilter === 'fixed' ? ' · rows fixed here' : ''}` : 'No data loaded';
  $('#editorPageLabel').textContent = `Page ${state.editorPage + 1} of ${pages}`;
  $('#editorPrev').disabled = state.editorPage === 0; $('#editorNext').disabled = state.editorPage >= pages - 1;
  renderAutoFix();
}
function autoFixPlan(issue) {
  if (!issue || issue.column < 0) return null;
  const { row, column, code } = issue; const current = state.rows[row]?.[column];
  if (code === 'spacing') return { value: String(current ?? '').trim().replace(/\s{2,}/g, ' '), method: 'Trim leading/trailing spaces and collapse repeated spaces.' };
  if (code === 'case') {
    const normalized = String(current ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
    const canonical = state.rows.find((candidate, index) => index !== row && String(candidate[column] ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase() === normalized)?.[column];
    return canonical === undefined ? null : { value: String(canonical).trim(), method: 'Use the existing capitalization used by the matching values in this column.' };
  }
  if (code === 'range') {
    const parsed = parseNumericCell(current); if (!parsed) return null;
    const value = Math.min(100, Math.max(0, parsed.number));
    return { value: `${value}${parsed.percent ? '%' : ''}`, method: 'Clamp this percentage to the allowed 0–100 range.' };
  }
  if (code === 'missing') {
    if (detectType(column) === 'Date') return null;
    if (detectType(column) === 'Number') {
      const values = state.rows.map(candidate => parseNumericCell(candidate[column])?.number).filter(Number.isFinite).sort((a, b) => a - b);
      if (!values.length) return null;
      const middle = Math.floor(values.length / 2); const median = values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
      const hasPercent = state.rows.filter(candidate => /%\s*$/.test(String(candidate[column] ?? '').trim())).length > values.length / 2;
      const currency = String(state.rows.find(candidate => String(candidate[column] ?? '').trim())?.[column] ?? '').trim().match(/^[$€£]/)?.[0] || '';
      return { value: `${currency}${median}${hasPercent ? '%' : ''}`, method: `Fill from the column median (${median}${hasPercent ? '%' : ''})${currency ? `, keeping the ${currency} currency symbol` : ''}.` };
    }
    const values = state.rows.map(candidate => String(candidate[column] ?? '').trim()).filter(Boolean);
    const counts = new Map();
    values.forEach(value => { const key = value.toLocaleLowerCase(); const entry = counts.get(key) || { count: 0, value }; entry.count++; counts.set(key, entry); });
    const mode = [...counts.values()].sort((a, b) => b.count - a.count)[0];
    return mode?.count > 1 ? { value: mode.value, method: `Fill with the most common value in this column (“${mode.value}”, ${mode.count} occurrences).` } : null;
  }
  return null;
}
function renderAutoFix() {
  const panel = $('#autoFixPanel');
  if (!panel) return;
  const issue = state.selectedIssue ? scanIssues().find(item => item.key === state.selectedIssue) : null;
  if (!issue) { panel.hidden = true; state.selectedIssue = null; state.selectedFix = null; return; }
  const plan = autoFixPlan(issue); state.selectedFix = plan;
  panel.hidden = false;
  $('#autoFixTitle').textContent = `Row ${issue.row + 2}: ${issue.text}`;
  $('#autoFixDescription').textContent = plan ? plan.method : issue.code === 'duplicate' ? 'This is only a possible duplicate. Compare both records before removing either one.' : 'There is no clear correction to infer safely. Edit the highlighted cell above, or leave it as-is.';
  $('#autoFixPreview').textContent = plan ? `Current: ${String(state.rows[issue.row][issue.column] ?? '') || '(blank)'}  →  Suggested: ${plan.value}` : '';
  $('#autoFixButton').disabled = !plan;
}
function clearChart() { if (state.chart) { state.chart.destroy(); state.chart = null; } $('#chartArea .chart-empty').hidden = false; $('#dataChart').hidden = true; state.chartFields = []; state.chartDimension = ''; if ($('#chartFields')) $('#chartFields').querySelectorAll('[data-chart-field]').forEach(input => { input.checked = false; }); if ($('#chartFieldSummary')) $('#chartFieldSummary').textContent = 'FIELDS · choose measures'; if ($('#chartDimension')) $('#chartDimension').value = ''; }

function clean(action) {
  if (!state.headers.length) { message('Upload a spreadsheet first to use cleanup tools.'); return; }
  if (action === 'trim') { state.rows = state.rows.map(row => row.map(value => typeof value === 'string' ? value.trim() : value)); state.viewRows = null; state.result = null; render(); toast('Trimmed spaces from every text cell.'); }
  if (action === 'duplicates') { const before = state.rows.length; const seen = new Set(); state.rows = state.rows.filter(row => { const key = duplicateKey(row); if (seen.has(key)) return false; seen.add(key); return true; }); state.solvedIssues.clear(); state.viewRows = null; state.result = null; render(); toast(`Removed ${before - state.rows.length} duplicate record candidates, comparing all non-ID columns.`); }
  if (action === 'missing') { const { missing } = quality(); toast(missing ? `${missing} empty cells across ${state.rows.filter(row => row.some(v => String(v).trim() === '')).length} rows. Use Ask Data to view those rows.` : 'No missing values found.'); }
  if (action === 'types') { const types = state.headers.map((name, i) => `${name}: ${detectType(i)}`); showNoticeList('Detected column types', types); }
}
function detectType(index) {
  const values = state.rows.map(row => String(row[index] ?? '').trim()).filter(Boolean).slice(0, 300);
  if (!values.length) return 'Empty';
  const numeric = values.filter(value => Number.isFinite(Number(value.replace(/[%,$]/g, '')))).length;
  const dates = values.filter(value => /[-/]/.test(value) && !Number.isNaN(Date.parse(value))).length;
  if (dates > values.length * .7) return 'Date';
  if (numeric > values.length * .7) return 'Number';
  return 'Text';
}
function showNoticeList(title, items) { $('#toolDialogContent').innerHTML = `<div class="section-kicker">DATA PROFILE</div><h2>${escapeHTML(title)}</h2><ul class="result-list">${items.map(item => `<li>${escapeHTML(item)}</li>`).join('')}</ul><button class="primary-button dialog-done">Done</button>`; $('#toolDialog').showModal(); $('.dialog-done').onclick = () => $('#toolDialog').close(); }

function findColumn(question, preferNumeric = false) {
  const q = question.toLowerCase();
  const exact = state.headers.findIndex(header => q.includes(header.toLowerCase()));
  if (exact >= 0) return exact;
  const fragment = state.headers.findIndex(header => header.toLowerCase().startsWith(q) && q.length >= 3);
  if (fragment >= 0) return fragment;
  const likely = state.headers.findIndex(header => /percent|score|grade|mark|result|average|gpa|rate|sales|revenue|amount|price|total/i.test(header));
  if (likely >= 0) return likely;
  return preferNumeric ? state.headers.findIndex((_, index) => detectType(index) === 'Number') : -1;
}
function findNamedColumn(question) {
  const q = question.toLowerCase();
  return state.headers.findIndex(header => q.includes(header.toLowerCase()));
}
function parseNumericCell(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const cleaned = raw.replace(/[%,$\s]/g, '').replace(/^\((.*)\)$/, '-$1');
  const number = Number(cleaned);
  return Number.isFinite(number) ? { number, percent: /%\s*$/.test(raw), original: raw } : null;
}
function applyRangeRule(question) {
  const q = question.toLowerCase().replace(/[’]/g, "'").replace(/shouldn't/g, 'should not').replace(/can't/g, 'cannot');
  if (!/\b(should|must|cannot|cap|limit|clamp|clean|fix|ensure|keep|correct|set)\b|not exceed|no more than|not (?:fall|go|drop) below/.test(q)) return null;
  const between = q.match(/\bbetween\s*(-?\d+(?:\.\d+)?)\s*%?\s*(?:and|to|-)\s*(-?\d+(?:\.\d+)?)\s*%?/);
  const upper = q.match(/(?:not exceed|should not exceed|must not exceed|cannot exceed|no more than|at most|maximum(?: of)?|cap(?: at)?|<=|less than or equal to)\s*(-?\d+(?:\.\d+)?)\s*%?/);
  const lower = q.match(/(?:not (?:fall|go|drop) below|should not be below|must not be below|cannot be below|at least|minimum(?: of)?|no less than|>=|greater than or equal to)\s*(-?\d+(?:\.\d+)?)\s*%?/);
  if (!between && !upper && !lower) return null;
  const column = findNamedColumn(q);
  if (column < 0) return { error: `Name the column to clean. Available columns: ${state.headers.join(', ')}.` };
  const min = between ? Number(between[1]) : lower ? Number(lower[1]) : -Infinity;
  const max = between ? Number(between[2]) : upper ? Number(upper[1]) : Infinity;
  if (min > max) return { error: 'The lower limit is greater than the upper limit. Check the range and try again.' };
  let changed = 0, skipped = 0;
  const changedRows = [];
  const examples = [];
  const nextRows = state.rows.map((row, rowIndex) => {
    const parsed = parseNumericCell(row[column]);
    if (!parsed) { if (String(row[column] ?? '').trim()) skipped++; return row; }
    const fixed = Math.min(max, Math.max(min, parsed.number));
    if (fixed === parsed.number) return row;
    changed++;
    changedRows.push(rowIndex);
    if (examples.length < 4) examples.push(`Row ${rowIndex + 2}: ${parsed.original} → ${fixed}${parsed.percent ? '%' : ''}`);
    const next = [...row];
    next[column] = `${fixed}${parsed.percent ? '%' : ''}`;
    return next;
  });
  if (!changed) return { summary: `Checked ${state.rows.length} rows: every numeric value in ${state.headers[column]} already meets the rule. No cells changed.` };
  const previousIssues = scanIssues();
  state.undoRows = state.rows.map(row => [...row]);
  state.rows = nextRows; state.viewRows = null; state.result = null; state.sort = null; state.page = 0;
  recordResolvedIssues(previousIssues, scanIssues());
  render();
  const rule = Number.isFinite(min) && Number.isFinite(max) ? `between ${min} and ${max}` : Number.isFinite(max) ? `no greater than ${max}` : `at least ${min}`;
  const summary = `Fixed ${changed} value${changed === 1 ? '' : 's'} in ${state.headers[column]} to keep them ${rule}.${skipped ? ` Skipped ${skipped} nonnumeric value${skipped === 1 ? '' : 's'}.` : ''}`;
  return { summary, changed, changedRows, column, examples };
}
function showCleaningResult(result) {
  const display = $('#askAnswer'); display.hidden = false;
  if (result.error) display.innerHTML = `<b>Let’s try that another way</b><span>${escapeHTML(result.error)}</span>`;
  else {
    display.innerHTML = `<b>${escapeHTML(result.summary)}</b>${result.examples?.length ? `<span>${result.examples.map(escapeHTML).join('<br>')}</span>` : ''}<span>${result.changed ? 'Corrected rows are shown in the preview. You can undo this cleanup.' : 'Your data was left unchanged.'}</span>${result.changed ? '<button type="button" class="undo-clean">Undo</button>' : ''}`;
    if (result.changedRows?.length) {
      state.result = { headers: state.headers, rows: result.changedRows.map(index => state.rows[index]), summary: `Showing ${result.changedRows.length} corrected row${result.changedRows.length === 1 ? '' : 's'}.` };
      render();
    }
  }
  $('.undo-clean')?.addEventListener('click', () => {
    if (!state.undoRows) return;
    state.rows = state.undoRows; state.undoRows = null; state.result = null; state.viewRows = null; render();
    display.innerHTML = '<b>Cleanup undone.</b><span>Your original values have been restored.</span>';
  });
}
function analyzeQuestion(question) {
  const q = question.toLowerCase().trim();
  const headers = state.headers; let resultRows = [...state.rows];
  if (/\b(duplicate|duplicated)\b/.test(q)) {
    const counts = new Map(); state.rows.forEach(row => counts.set(duplicateKey(row), (counts.get(duplicateKey(row)) || 0) + 1));
    resultRows = state.rows.filter(row => counts.get(duplicateKey(row)) > 1);
    const ids = headers.filter(header => /(^|[\s_-])(id|identifier|uuid|record number|row number|key)$/i.test(header));
    return { headers, rows: resultRows, summary: `Found ${resultRows.length} rows in matching record groups${ids.length ? ` (compared every column except ${ids.join(', ')})` : ''}. Review them before removing.` };
  }
  if (/\b(unique|distinct)\b/.test(q)) {
    const index = findColumn(q);
    if (index < 0) return { error: 'Name a column for unique values, such as “Show unique values for City”.' };
    const seen = new Set(); resultRows = state.rows.filter(row => { const key = String(row[index] ?? ''); if (seen.has(key)) return false; seen.add(key); return true; });
    return { headers, rows: resultRows, summary: `${resultRows.length} unique values in ${headers[index]}.` };
  }
  if (/\b(missing|empty|blank|null)\b/.test(q)) {
    resultRows = resultRows.filter(row => row.some(value => String(value ?? '').trim() === ''));
    return { headers, rows: resultRows, summary: `Found ${resultRows.length} rows with at least one empty cell.` };
  }
  const aggregation = q.match(/\b(average|avg|mean|sum|total|count|minimum|min|maximum|max)\b/);
  const groupPhrase = q.match(/\bby\s+(.+?)(?:\s+(?:and|where|for)\b|$)/);
  if (aggregation) {
    const operation = aggregation[1]; const groupIndex = groupPhrase ? findColumn(groupPhrase[1]) : -1;
    if (groupPhrase && groupIndex < 0) return { error: `I couldn’t find a “${groupPhrase[1]}” column. Available columns: ${headers.join(', ')}.` };
    const countCondition = operation === 'count' && q.match(/(?:\b(above|over|greater than|more than|at least|below|under|less than|at most|equal to|equals?|is)\s*|\s*(>=|<=|>|<|=)\s*)(-?\d+(?:\.\d+)?)\s*%?/);
    if (countCondition) {
      const index = findColumn(q, true); if (index < 0) return { error: 'Name a numeric column to count, for example “How many students scored above 90 percent?”.' };
      const phrase = countCondition[1] || countCondition[2], threshold = Number(countCondition[3]);
      const operator = ['below', 'under', 'less than', '<'].includes(phrase) ? '<' : ['at most', '<='].includes(phrase) ? '<=' : ['equal', 'equals', 'equal to', '=', 'is'].includes(phrase) ? '=' : ['at least', '>='].includes(phrase) ? '>=' : '>';
      const matches = state.rows.filter(row => { const raw = String(row[index] ?? '').replace(/[%,$]/g, '').trim(); const value = Number(raw); return raw !== '' && Number.isFinite(value) && (operator === '<' ? value < threshold : operator === '<=' ? value <= threshold : operator === '=' ? value === threshold : operator === '>=' ? value >= threshold : value > threshold); });
      if (groupIndex < 0) return { headers: ['Count'], rows: [[matches.length]], summary: `${matches.length} rows match the condition for ${headers[index]}.` };
      const counts = new Map(); matches.forEach(row => { const key = String(row[groupIndex] ?? '').trim() || '(blank)'; counts.set(key, (counts.get(key) || 0) + 1); });
      return { headers: [headers[groupIndex], 'Count'], rows: [...counts].map(([key, count]) => [key, count]), summary: `Rows matching the ${headers[index]} condition, counted by ${headers[groupIndex]}.` };
    }
    const numericMatches = headers.map((header, index) => ({ header, index })).filter(item => item.index !== groupIndex && q.includes(item.header.toLowerCase()) && detectType(item.index) === 'Number');
    const valueIndex = operation === 'count' ? -1 : numericMatches[0]?.index ?? headers.findIndex((_, index) => index !== groupIndex && detectType(index) === 'Number');
    if (operation !== 'count' && valueIndex < 0) return { error: 'Name a numeric column to summarize, such as “Average score” or “Sum of sales by region”.' };
    const group = row => groupIndex < 0 ? 'All rows' : String(row[groupIndex] ?? '').trim() || '(blank)';
    const groups = new Map();
    state.rows.forEach(row => { const key = group(row); const item = groups.get(key) || []; if (valueIndex < 0) item.push(1); else { const value = Number(String(row[valueIndex] ?? '').replace(/[%,$]/g, '').trim()); if (Number.isFinite(value)) item.push(value); } groups.set(key, item); });
    const reduce = values => operation === 'count' ? values.length : operation === 'sum' || operation === 'total' ? values.reduce((a, b) => a + b, 0) : operation === 'minimum' || operation === 'min' ? Math.min(...values) : operation === 'maximum' || operation === 'max' ? Math.max(...values) : values.length ? values.reduce((a, b) => a + b, 0) / values.length : '';
    const label = ({ average: 'Average', avg: 'Average', mean: 'Average', sum: 'Sum', total: 'Total', count: 'Count', minimum: 'Minimum', min: 'Minimum', maximum: 'Maximum', max: 'Maximum' })[operation];
    const resultHeaders = groupIndex < 0 ? [label] : [headers[groupIndex], label];
    const output = [...groups].map(([key, values]) => groupIndex < 0 ? [reduce(values)] : [key, reduce(values)]);
    return { headers: resultHeaders, rows: output, summary: `${label}${valueIndex >= 0 ? ` of ${headers[valueIndex]}` : ' of rows'}${groupIndex >= 0 ? ` by ${headers[groupIndex]}` : ''}.` };
  }
  const index = findColumn(q, true);
  const topMatch = q.match(/\b(top|bottom|highest|lowest)\s*(\d+)?\b/);
  const isSort = /\b(sort|order|rank)\b/.test(q);
  if (topMatch || isSort) {
    if (index < 0) return { error: 'Tell me which column to sort or rank, for example “Sort by score, highest to lowest”.' };
    const descending = /\b(descending|desc|highest to lowest|largest to smallest|high to low|top|highest)\b/.test(q);
    const sorted = [...state.rows].sort((a, b) => {
      const av = String(a[index] ?? ''), bv = String(b[index] ?? '');
      const an = Number(av.replace(/[%,$]/g, '')), bn = Number(bv.replace(/[%,$]/g, ''));
      const cmp = av && bv && Number.isFinite(an) && Number.isFinite(bn) ? an - bn : av.localeCompare(bv, undefined, { numeric: true, sensitivity: 'base' });
      return descending ? -cmp : cmp;
    });
    const limit = topMatch && !isSort ? Number(topMatch[2] || (/\b(highest|lowest)\b/.test(q) ? 1 : 10)) : sorted.length;
    resultRows = sorted.slice(0, Math.min(limit, 1000));
    return { headers, rows: resultRows, summary: `${topMatch ? `Showing the ${Math.min(limit, resultRows.length)} ${descending ? 'highest' : 'lowest'} rows` : `Sorted ${resultRows.length} rows`} by ${headers[index]}${descending ? ' (high to low)' : ' (low to high)'}.` };
  }
  const comparison = q.match(/(?:\b(above|over|greater than|more than|at least|below|under|less than|at most|equal to|equals?|is)\s*|\s*(>=|<=|>|<|=)\s*)(-?\d+(?:\.\d+)?)\s*%?/);
  if (comparison) {
    if (index < 0) return { error: 'I couldn’t find a numeric column. Include its name, for example “Show rows where Score is above 90”.' };
    const phrase = comparison[1] || comparison[2], threshold = Number(comparison[3]);
    const operator = ['below', 'under', 'less than', '<'].includes(phrase) ? '<' : ['at most', '<='].includes(phrase) ? '<=' : ['equal', 'equals', 'equal to', '=', 'is'].includes(phrase) ? '=' : ['at least', '>='].includes(phrase) ? '>=' : '>';
    resultRows = state.rows.filter(row => { const raw = String(row[index] ?? '').replace(/[%,$]/g, '').trim(); const value = Number(raw); return raw !== '' && Number.isFinite(value) && (operator === '<' ? value < threshold : operator === '<=' ? value <= threshold : operator === '=' ? value === threshold : operator === '>=' ? value >= threshold : value > threshold); });
    const label = { '>': 'above', '<': 'below', '>=': 'at least', '<=': 'at most', '=': 'equal to' }[operator];
    return { headers, rows: resultRows, summary: `${resultRows.length} rows where ${headers[index]} is ${label} ${threshold}${/%|percent/.test(q) ? '%' : ''}.` };
  }
  const contains = q.match(/\b(?:contains?|including|matching)\s+["']?(.+?)["']?$/);
  const equality = q.match(/\b(?:is|equals?)\s+["']?([^"']+?)["']?$/);
  if (contains || equality) {
    const columnIndex = findColumn(q);
    if (columnIndex < 0) return { error: 'Name a column for the text match, such as “Show rows where City contains Mumbai”.' };
    const wanted = (contains?.[1] || equality?.[1] || '').trim().replace(/[?.!]+$/, '');
    if (!wanted) return { error: 'Add the value to match, such as “City is Mumbai”.' };
    resultRows = state.rows.filter(row => contains ? String(row[columnIndex] ?? '').toLowerCase().includes(wanted.toLowerCase()) : String(row[columnIndex] ?? '').trim().toLowerCase() === wanted.toLowerCase());
    return { headers, rows: resultRows, summary: `Found ${resultRows.length} rows where ${headers[columnIndex]} ${contains ? 'contains' : 'is'} “${wanted}”.` };
  }
  if (/\b(count|how many|number of rows)\b/.test(q)) return { headers: ['Rows'], rows: [[state.rows.length]], summary: `Your dataset has ${state.rows.length.toLocaleString()} rows.` };
  return { error: 'Try a request like “Show students above 90 percent”, “Sort by score highest to lowest”, “Average score by class”, or “City contains Mumbai”.' };
}
function ask(question) {
  if (!state.headers.length) { message('Upload a spreadsheet before asking a question.'); return null; }
  if (/\b(update this|change (?:the )?dataset|add (?:a )?column|create (?:a )?(?:new )?column|make (?:a )?column|is pass|is fail|then\s+(?:pass|fail|eligible|approved|yes|no)|otherwise|should(?:n't| not) exceed|must not exceed|cannot exceed|cap (?:at|attendance)|fill (?:in )?(?:the )?(?:blanks|missing)|replace blanks)\b/i.test(question)) {
    $('#changeDatasetInput').value = question; showAppPage('changeDataset'); showDatasetChangePreview(makeDatasetChange(question)); return null;
  }
  state.result = null; state.viewRows = null;
  const cleaning = applyRangeRule(question);
  if (cleaning) { showCleaningResult(cleaning); return cleaning; }
  const answer = analyzeQuestion(question);
  const display = $('#askAnswer'); display.hidden = false;
  if (answer.error) { display.innerHTML = `<b>Let’s try that another way</b><span>${escapeHTML(answer.error)}</span>`; render(); return null; }
  state.result = answer; state.sort = null; state.page = 0; $('#tableSearch').value = ''; render();
  if (state.chartFields.length || $('#chartDimension').value) makeChart();
  display.innerHTML = `<b>${escapeHTML(answer.summary)}</b><span>Showing the result in the data preview.</span>`;
  return answer;
}

function normalizedName(value) { return String(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
function findDatasetHeader(text) {
  const normalized = normalizedName(text);
  return state.headers.map((header, index) => ({ index, name: normalizedName(header) })).filter(item => item.name && normalized.includes(item.name)).sort((a, b) => b.name.length - a.name.length)[0]?.index ?? findNamedColumn(String(text).toLowerCase());
}
function conditionOperator(word) { return ({ above: '>', over: '>', 'greater than': '>', 'more than': '>', 'at least': '>=', below: '<', under: '<', 'less than': '<', 'at most': '<=', '>': '>', '<': '<', '>=': '>=', '<=': '<=' })[word] || '>'; }
function makeDatasetChange(question) {
  const q = question.trim();
  const lower = q.toLowerCase().replace(/shouldn't/g, 'should not').replace(/can't/g, 'cannot');
  const fill = q.match(/\b(?:fill(?: in)?|replace)\s+(?:the\s+)?(?:missing|blank|empty)(?:\s+values?)?\s+(?:in|for)\s+(.+?)\s+(?:with|to)\s+["']?(.+?)["']?\s*$/i);
  if (fill) {
    const sourceIndex = findDatasetHeader(fill[1]);
    if (sourceIndex < 0) return { error: `Name the column whose blanks to fill. Available columns: ${state.headers.join(', ')}.` };
    const fillValue = fill[2].trim().replace(/[.!?]+$/, '');
    const values = state.rows.map(row => String(row[sourceIndex] ?? '').trim() ? row[sourceIndex] : fillValue);
    const changed = values.filter((value, index) => String(value) !== String(state.rows[index][sourceIndex] ?? '')).length;
    return { kind: 'fill', sourceIndex, sourceName: state.headers[sourceIndex], targetIndex: sourceIndex, targetName: state.headers[sourceIndex], values, changed, fillValue };
  }
  const between = lower.match(/\bbetween\s*(-?\d+(?:\.\d+)?)\s*%?\s*(?:and|to|-)\s*(-?\d+(?:\.\d+)?)\s*%?/);
  const upper = lower.match(/(?:not exceed|should not exceed|must not exceed|cannot exceed|no more than|at most|maximum(?: of)?|cap(?: at)?|<=|less than or equal to)\s*(-?\d+(?:\.\d+)?)\s*%?/);
  const lowerLimit = lower.match(/(?:not (?:fall|go|drop) below|should not be below|must not be below|cannot be below|at least|minimum(?: of)?|no less than|>=|greater than or equal to)\s*(-?\d+(?:\.\d+)?)\s*%?/);
  if (between || upper || lowerLimit) {
    const sourceIndex = findDatasetHeader(lower);
    if (sourceIndex < 0) return { error: `Name the column to change. Available columns: ${state.headers.join(', ')}.` };
    const min = between ? Number(between[1]) : lowerLimit ? Number(lowerLimit[1]) : -Infinity; const max = between ? Number(between[2]) : upper ? Number(upper[1]) : Infinity;
    if (min > max) return { error: 'The lower limit is greater than the upper limit. Check the range and try again.' };
    const values = state.rows.map(row => { const parsed = parseNumericCell(row[sourceIndex]); if (!parsed) return row[sourceIndex] ?? ''; const fixed = Math.min(max, Math.max(min, parsed.number)); return `${fixed}${parsed.percent ? '%' : ''}`; });
    const changed = values.filter((value, index) => String(value) !== String(state.rows[index][sourceIndex] ?? '')).length;
    return { kind: 'range', sourceIndex, sourceName: state.headers[sourceIndex], targetIndex: sourceIndex, targetName: state.headers[sourceIndex], values, changed, min, max };
  }
  const normalized = normalizedName(q);
  const sourceIndex = state.headers.map((header, index) => ({ index, name: normalizedName(header) })).filter(item => item.name && normalized.includes(item.name)).sort((a, b) => b.name.length - a.name.length)[0]?.index ?? state.headers.findIndex((_, index) => detectType(index) === 'Number');
  const condition = q.match(/\b(above|over|greater than|more than|at least|below|under|less than|at most|>=|<=|>|<)\s*(-?\d+(?:\.\d+)?)\s*%?/i);
  if (sourceIndex < 0 || !condition) return { error: 'I can apply conditional labels right now. Try “Score above 80 is Pass” or “If Score is at least 80 then Pass otherwise Fail”.' };
  const operator = conditionOperator(condition[1].toLowerCase()), threshold = Number(condition[2]);
  const labelMatch = q.match(/\b(?:is|means|becomes?|should be|then|set to|to)\s+(?:a|an)?\s*([a-z][a-z0-9_-]*)(?=\s+(?:otherwise|else|update|apply|into|in column)\b|[.!?]|$)/i);
  const positive = (labelMatch?.[1] || q.match(/\b(pass|eligible|approved|yes|true|complete|qualified)\b/i)?.[1] || 'Pass').replace(/^./, char => char.toUpperCase());
  const elseMatch = q.match(/\b(?:otherwise|else)\s+(?:a|an)?\s*([a-z][a-z0-9_-]*)/i);
  const negative = (elseMatch?.[1] || ({ Pass: 'Fail', Eligible: 'Ineligible', Approved: 'Rejected', Yes: 'No', True: 'False', Complete: 'Incomplete', Qualified: 'Not qualified' }[positive] || `Not ${positive}`)).replace(/^./, char => char.toUpperCase());
  const namedTarget = q.match(/\b(?:column|field)\s+(?:named|called)\s+["']?([^"'.,]+?)["']?(?=\s+(?:where|when|if)\b|$)/i)?.[1]?.trim();
  const mentionedTargets = state.headers.map((header, index) => ({ header, index })).filter(item => item.index !== sourceIndex && normalized.includes(normalizedName(item.header)));
  const outcomeIndex = state.headers.findIndex((header, index) => index !== sourceIndex && /pass|status|outcome|result|eligib|approved|grade/i.test(header));
  const valueMatchIndex = state.headers.findIndex((header, index) => index !== sourceIndex && state.rows.some(row => /^(pass|fail|yes|no|eligible|ineligible)$/i.test(String(row[index] ?? '').trim())));
  let targetIndex = namedTarget ? state.headers.findIndex(header => normalizedName(header) === normalizedName(namedTarget)) : -1;
  if (targetIndex < 0) targetIndex = mentionedTargets.find(item => /pass|status|outcome|result|eligib|approved|grade/i.test(item.header))?.index ?? valueMatchIndex;
  if (targetIndex < 0) targetIndex = outcomeIndex;
  const targetName = targetIndex >= 0 ? state.headers[targetIndex] : namedTarget || (/pass|fail/i.test(positive) ? 'Pass Status' : `${positive} Status`);
  const targetValue = targetIndex >= 0 ? state.rows[0]?.[targetIndex] ?? '' : '';
  const values = state.rows.map(row => {
    const parsed = parseNumericCell(row[sourceIndex]); if (!parsed) return '';
    const n = parsed.number; const matched = operator === '>' ? n > threshold : operator === '>=' ? n >= threshold : operator === '<' ? n < threshold : n <= threshold;
    return matched ? positive : negative;
  });
  const changed = values.filter((value, row) => String(targetIndex >= 0 ? state.rows[row][targetIndex] ?? '' : '') !== value).length;
  return { sourceIndex, sourceName: state.headers[sourceIndex], operator, threshold, positive, negative, targetIndex, targetName, targetValue, values, changed };
}
function showDatasetChangePreview(plan) {
  const box = $('#datasetChangeResult'); box.hidden = false;
  pendingDatasetChange = null;
  if (plan.error) { box.innerHTML = `<div class="change-error">${escapeHTML(plan.error)}</div>`; return; }
  pendingDatasetChange = plan;
  const samples = state.rows.slice(0, 6).map((row, index) => `<tr><td>${escapeHTML(row[plan.sourceIndex]) || '—'}</td><td>${escapeHTML(plan.targetIndex >= 0 ? row[plan.targetIndex] : '') || '—'}</td><td>${escapeHTML(plan.values[index]) || '—'}</td></tr>`).join('');
  const passCount = plan.kind === 'range' ? 0 : plan.values.filter(value => value === plan.positive).length;
  const failCount = plan.kind === 'range' ? 0 : plan.values.filter(value => value === plan.negative).length;
  const summary = plan.kind === 'range' ? `${plan.changed} cell values will be corrected to the requested range.` : plan.kind === 'fill' ? `Fill ${plan.changed} empty cells with “${escapeHTML(plan.fillValue)}”.` : `${plan.changed} row values will change · ${escapeHTML(plan.positive)}: ${passCount} · ${escapeHTML(plan.negative)}: ${failCount}`;
  box.innerHTML = `<div class="change-preview-head"><div><b>Ready to update ${escapeHTML(plan.targetName)}</b><span>${summary}</span></div><button class="primary-button" type="button" data-apply-dataset-change>Apply changes</button></div><div class="change-preview-table"><table><thead><tr><th>${escapeHTML(plan.sourceName)}</th><th>Current ${escapeHTML(plan.targetName)}</th><th>New value</th></tr></thead><tbody>${samples || '<tr><td colspan="3">No rows to preview</td></tr>'}</tbody></table></div><small>Previewing the first ${Math.min(6, state.rows.length)} of ${state.rows.length} rows. Missing or nonnumeric values will be left unchanged.</small>`;
}
function applyDatasetChange() {
  const plan = pendingDatasetChange; if (!plan) return;
  datasetChangeUndo = { headers: [...state.headers], rows: state.rows.map(row => [...row]) };
  const targetIndex = plan.targetIndex >= 0 ? plan.targetIndex : state.headers.length;
  if (plan.targetIndex < 0) state.headers.push(plan.targetName);
  state.rows = state.rows.map((row, index) => { const next = [...row]; if (plan.targetIndex < 0) next.push(plan.values[index]); else next[targetIndex] = plan.values[index]; return next; });
  state.viewRows = null; state.result = null; state.sort = null; state.page = 0; state.editorPage = 0; state.issueFilter = 'all'; $('#issueFilter').value = 'all'; $('#tableSearch').value = '';
  pendingDatasetChange = null; render();
  $('#datasetChangeResult').innerHTML = `<div class="change-applied"><b>Changes applied to ${escapeHTML(plan.targetName)}.</b><span>The working dataset is updated and the change is included in your next download.</span><button type="button" class="secondary-button" data-undo-dataset-change>Undo change</button></div>`;
}
$('#changeDatasetForm').onsubmit = event => { event.preventDefault(); if (!state.headers.length) { $('#datasetChangeResult').hidden = false; $('#datasetChangeResult').innerHTML = '<div class="change-error">Upload a spreadsheet before changing the dataset.</div>'; return; } const question = $('#changeDatasetInput').value.trim(); if (!question) return; showDatasetChangePreview(makeDatasetChange(question)); };
document.querySelectorAll('[data-change-example]').forEach(button => button.onclick = () => { $('#changeDatasetInput').value = button.dataset.changeExample; $('#changeDatasetInput').focus(); });
$('#datasetChangeResult').addEventListener('click', event => {
  if (event.target.closest('[data-apply-dataset-change]')) applyDatasetChange();
  if (event.target.closest('[data-undo-dataset-change]') && datasetChangeUndo) { state.headers = datasetChangeUndo.headers; state.rows = datasetChangeUndo.rows; datasetChangeUndo = null; render(); $('#datasetChangeResult').innerHTML = '<div class="change-applied"><b>Change undone.</b><span>Your previous dataset is restored.</span></div>'; }
});

function chartData(fields, dimension, aggregation, selectedType) {
  const chartRows = state.result?.rows || state.viewRows || state.rows;
  const headers = state.result?.headers || state.headers;
  const numericFields = fields.filter(field => {
    const values = chartRows.map(row => String(row[field] ?? '').trim()).filter(Boolean);
    return values.length > 0 && values.filter(value => parseNumericCell(value)).length / values.length >= .7;
  });
  const categoryFields = fields.filter(field => !numericFields.includes(field));
  const groupFields = dimension !== '' && dimension !== null && dimension !== undefined ? [dimension] : categoryFields;
  const grouped = groupFields.length > 0;
  const labelsForRows = chartRows.slice(0, 250).map((_, index) => `Row ${index + 1}`);
  let labels = labelsForRows, datasets = [], type = selectedType, notice = '';
  const circular = ['pie', 'doughnut', 'polarArea'].includes(type);
  if (grouped) {
    const groups = new Map();
    chartRows.forEach(row => {
      const label = groupFields.map(field => `${headers[field]}: ${String(row[field] ?? '').trim() || '(blank)'}`).join(' · ');
      if (!groups.has(label)) groups.set(label, new Map());
      const metrics = groups.get(label);
      const rowCount = metrics.get('__row_count__') || { count: 0 }; rowCount.count++; metrics.set('__row_count__', rowCount);
      numericFields.forEach(field => {
        const parsed = parseNumericCell(row[field]);
        const current = metrics.get(field) || { sum: 0, count: 0 };
        if (parsed) { current.sum += parsed.number; current.count++; }
        metrics.set(field, current);
      });
    });
    labels = [...groups.keys()].slice(0, 40);
    if (circular) {
      const field = numericFields[0];
      const data = field === undefined ? labels.map(label => groups.get(label).get('__row_count__')?.count || 0) : labels.map(label => {
        const value = groups.get(label).get(field) || { sum: 0, count: 0 };
        return aggregation === 'count' ? value.count : aggregation === 'average' ? (value.count ? value.sum / value.count : 0) : value.sum;
      });
      datasets = [{ label: field === undefined ? 'Rows' : headers[field], data }];
      if (numericFields.length > 1) notice = 'Pie-style charts show one measure at a time; showing the first selected field.';
    } else if (numericFields.length) {
      datasets = numericFields.map(field => ({ label: headers[field], data: labels.map(label => {
        const value = groups.get(label).get(field) || { sum: 0, count: 0 };
        return aggregation === 'count' ? value.count : aggregation === 'average' ? (value.count ? value.sum / value.count : null) : value.sum;
      }) }));
    } else {
      datasets = [{ label: 'Rows', data: labels.map(label => groups.get(label).get('__row_count__')?.count || 0) }];
    }
  } else if (circular) {
    const field = numericFields[0];
    if (field === undefined) return { error: 'Select at least one numeric field or choose a Group by field.' };
    const counts = new Map(); chartRows.forEach(row => { const value = String(row[field] ?? '').trim() || '(blank)'; counts.set(value, (counts.get(value) || 0) + 1); });
    const entries = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 12); labels = entries.map(item => item[0]);
    datasets = [{ label: 'Rows', data: entries.map(item => item[1]) }];
    if (numericFields.length > 1) notice = 'Without a Group by field, pie-style charts show the first selected field’s distribution.';
  } else if (type === 'scatter') {
    if (!numericFields.length) return { error: 'Select at least one numeric field for a scatter plot.' };
    const pairs = numericFields.length > 1 ? numericFields.slice(1) : numericFields;
    datasets = pairs.map(field => ({ label: numericFields.length > 1 ? `${headers[field]} vs ${headers[numericFields[0]]}` : headers[field], data: chartRows.slice(0, 250).map((row, rowIndex) => {
      const x = numericFields.length > 1 ? parseNumericCell(row[numericFields[0]])?.number : rowIndex + 1;
      const y = parseNumericCell(row[field])?.number;
      return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
    }).filter(Boolean) }));
  } else if (numericFields.length) {
    datasets = numericFields.map(field => ({ label: headers[field], data: chartRows.slice(0, 250).map(row => parseNumericCell(row[field])?.number ?? null) }));
  } else return { error: 'Select one or more numeric fields, or choose a Group by field to chart row counts.' };
  if (!numericFields.length && !['bar', 'horizontalBar', 'pie', 'doughnut', 'polarArea'].includes(type)) { type = 'bar'; notice = 'Category counts use a bar chart; select numeric fields for this chart type.'; }
  return { labels, datasets, type, notice };
}
function makeChart() {
  if (!state.headers.length) { clearChart(); return; }
  if (!window.Chart) { toast('Charts need an internet connection to load the chart library.'); return; }
  const dimensionValue = $('#chartDimension').value;
  const dimension = dimensionValue === '' ? '' : Number(dimensionValue);
  const result = chartData(state.chartFields, dimension, $('#chartAggregation').value, $('#chartType').value);
  if (result.error) { clearChart(); if (state.chartFields.length || dimension !== '') toast(result.error); return; }
  if (result.notice) toast(result.notice);
  const canvas = $('#dataChart'); $('#chartArea .chart-empty').hidden = true; canvas.hidden = false;
  if (state.chart) state.chart.destroy();
  const colors = ['#816be0', '#78a8dc', '#78c3a0', '#f2bd75', '#ee9b8a', '#a995ec', '#c99ccf', '#a0c58e', '#e3a7c0', '#92b8bd', '#f0a65f', '#88a6d6'];
  const circular = ['pie', 'doughnut', 'polarArea'].includes(result.type);
  const radial = ['radar', 'polarArea'].includes(result.type);
  const kind = result.type === 'area' ? 'line' : result.type === 'horizontalBar' ? 'bar' : result.type;
  const datasets = result.datasets.map((dataset, index) => ({
    ...dataset,
    backgroundColor: circular ? result.labels.map((_, i) => colors[i % colors.length]) : result.type === 'area' ? `${colors[index % colors.length]}30` : colors[index % colors.length],
    borderColor: colors[index % colors.length],
    borderWidth: ['line', 'area', 'radar', 'scatter'].includes(result.type) ? 2 : 0,
    borderRadius: kind === 'bar' ? 4 : 0,
    pointRadius: result.type === 'scatter' ? 3 : 2,
    tension: .3,
    ...(result.type === 'area' ? { fill: true } : {})
  }));
  const light = document.documentElement.dataset.theme === 'light';
  const chartText = light ? '#697589' : '#c3ccda';
  state.chart = new Chart(canvas, { type: kind, data: { labels: result.type === 'scatter' ? undefined : result.labels, datasets }, options: { indexAxis: result.type === 'horizontalBar' ? 'y' : 'x', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: circular || radial || datasets.length > 1, position: 'right', labels: { boxWidth: 8, font: { size: 9 }, color: chartText } } }, scales: circular || radial ? {} : { x: { type: result.type === 'scatter' ? 'linear' : 'category', grid: { display: false }, ticks: { color: chartText, font: { size: 9 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 10 } }, y: { type: 'linear', beginAtZero: !['line', 'area'].includes(result.type), grid: { color: light ? '#e4e8ef' : '#28364a' }, ticks: { color: light ? '#697589' : '#8796ab', font: { size: 9 } } } } } });
}

function rowsToObjects(rows = state.rows, headers = state.headers) { return rows.map(row => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? '']))); }
function downloadBlob(content, type, filename) { const url = URL.createObjectURL(new Blob([content], { type })); const link = document.createElement('a'); link.href = url; link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
function csvText(rows = state.rows, headers = state.headers) { return [headers, ...rows].map(row => row.map(value => `"${String(value ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n'); }
async function downloadData(format = $('#exportFormat').value, data = currentRows()) {
  if (!state.headers.length) { message('Upload a spreadsheet before exporting.'); return; }
  const exportHeaders = state.result?.headers || state.headers;
  const base = (state.sourceName || 'analytics-hub-data').replace(/\.[^.]+$/, '') + (state.viewRows || state.result ? '-result' : '');
  if (format === 'xlsx') {
    if (!window.ExcelJS) { message('Styled Excel export needs an internet connection to load the workbook library.'); return; }
    try {
      const workbook = new ExcelJS.Workbook(); workbook.creator = 'Analytics Hub'; workbook.subject = 'Edited spreadsheet';
      const sheet = workbook.addWorksheet('Data', { views: [{ state: 'frozen', ySplit: 1 }] });
      sheet.addRow(exportHeaders);
      const headerRow = sheet.getRow(1); headerRow.height = 25;
      headerRow.eachCell(cell => { cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF5647A8' } }; cell.alignment = { vertical: 'middle' }; });
      data.forEach((row, outputIndex) => {
        const excelRow = sheet.addRow(exportHeaders.map((_, column) => row?.[column] ?? ''));
        const sourceRow = state.rows.indexOf(row);
        if (state.tableStyle === 'compact') excelRow.height = 17;
        excelRow.eachCell({ includeEmpty: true }, (cell, columnNumber) => {
          const columnIndex = columnNumber - 1;
          const sourceColumn = state.headers.indexOf(exportHeaders[columnIndex]);
          const fmt = sourceRow >= 0 && sourceColumn >= 0 ? state.cellFormats[`${sourceRow}:${sourceColumn}`] || {} : {};
          const stripe = state.tableStyle === 'striped' && outputIndex % 2 === 1;
          if (fmt.fill || stripe) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${(fmt.fill || (stripe ? '#F1EFF8' : '')).replace('#', '')}` } };
          const defaultFontColor = fmt.fill ? ({ '#3b315f': 'FFFFFFFF', '#1f493d': 'FFFFFFFF', '#4b3820': 'FFFFFFFF', '#4b2930': 'FFFFFFFF', '#263a55': 'FFFFFFFF' }[fmt.fill] || 'FF25283A') : 'FF25283A';
          cell.font = { name: 'Aptos', size: 10, ...(fmt.bold ? { bold: true } : {}), ...(fmt.italic ? { italic: true } : {}), color: { argb: (fmt.color || defaultFontColor).replace('#', 'FF') } };
          cell.alignment = { vertical: 'middle', horizontal: fmt.align || 'left' };
        });
      });
      sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, sheet.rowCount), column: Math.max(1, exportHeaders.length) } };
      exportHeaders.forEach((header, index) => {
        const values = [header, ...data.slice(0, 250).map(row => row?.[index] ?? '')];
        const width = Math.min(38, Math.max(12, ...values.map(value => String(value).length + 2)));
        sheet.getColumn(index + 1).width = width;
      });
      const buffer = await workbook.xlsx.writeBuffer();
      downloadBlob(buffer, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', `${base}.xlsx`);
    } catch (error) { message(`Could not create the Excel workbook: ${error.message}`); }
  } else if (format === 'json') downloadBlob(JSON.stringify(rowsToObjects(data, exportHeaders), null, 2), 'application/json', `${base}.json`);
  else downloadBlob(csvText(data, exportHeaders), 'text/csv;charset=utf-8', `${base}.csv`);
}

async function mergeFiles(files) {
  if (files.length < 2) { message('Choose at least two files to merge.'); return; }
  try {
    const matrices = await Promise.all([...files].map(readMatrix));
    const parsed = matrices.map(matrix => {
      const names = matrix[0].map((name, i) => String(name ?? '').trim() || `Column ${i + 1}`);
      return { names, rows: matrix.slice(1).filter(row => row?.some(value => String(value ?? '').trim() !== '')) };
    });
    const mergedHeaders = [...new Set(parsed.flatMap(table => table.names))];
    const mergedRows = parsed.flatMap(table => table.rows.map(row => mergedHeaders.map(name => { const index = table.names.indexOf(name); return index < 0 ? '' : row[index] ?? ''; })));
    state.headers = mergedHeaders; state.rows = mergedRows; pendingDatasetChange = null; datasetChangeUndo = null; $('#datasetChangeResult').hidden = true; $('#datasetChangeResult').innerHTML = ''; state.solvedIssues.clear(); state.undoRows = null; state.sourceName = 'merged-files.csv'; state.viewRows = null; state.result = null; state.page = 0; clearChart(); $('#askAnswer').hidden = true; $('#tableSearch').value = ''; $('#askInput').value = ''; render();
    message(`Merged ${files.length} files into ${mergedRows.length.toLocaleString()} rows. Matching column names were combined.`);
  } catch (error) { message(`Could not merge files: ${error.message}`); }
}
function projectStorageKey() { return `analyticsHub.projects.${currentUser?.id || 'guest'}`; }
function getProjects() { try { return JSON.parse(localStorage.getItem(projectStorageKey()) || '[]'); } catch { return []; } }
function saveProject() {
  if (!state.headers.length) { message('Upload data before saving a project.'); return; }
  try {
    const projects = getProjects(); const project = { id: Date.now(), name: state.sourceName.replace(/\.[^.]+$/, '') || 'Untitled dataset', sourceName: state.sourceName, headers: state.headers, rows: state.rows, cellFormats: state.cellFormats, tableStyle: state.tableStyle, savedAt: new Date().toISOString() };
    projects.unshift(project); localStorage.setItem(projectStorageKey(), JSON.stringify(projects.slice(0, 5))); renderRecentProjects(); toast('Project saved in this browser for your account.');
  } catch { message('This dataset is too large for browser storage. You can still export it to your computer.'); }
}
function renderRecentProjects() {
  const container = $('#recentProjects'); if (!container) return;
  const projects = getProjects();
  container.innerHTML = projects.length ? projects.slice(0, 5).map(project => `<button class="recent-project" data-project="${project.id}"><span class="recent-project-icon">▤</span><span><b>${escapeHTML(project.name)}</b><small>${new Date(project.savedAt).toLocaleDateString()} · ${project.rows.length.toLocaleString()} rows</small></span><span>↗</span></button>`).join('') : '<div class="recent-empty">Saved projects in this browser will appear here.</div>';
  container.querySelectorAll('[data-project]').forEach(button => button.onclick = () => {
    const project = getProjects().find(item => item.id === Number(button.dataset.project)); if (!project) return;
    state.headers = project.headers; state.rows = project.rows; state.cellFormats = project.cellFormats || {}; state.tableStyle = project.tableStyle || 'plain'; state.selectionAnchor = null; state.selectionRange = null; state.selectedCell = null; state.selectedCells.clear(); pendingDatasetChange = null; datasetChangeUndo = null; $('#datasetChangeResult').hidden = true; $('#datasetChangeResult').innerHTML = ''; state.solvedIssues.clear(); state.undoRows = null; state.sourceName = project.sourceName; state.viewRows = null; state.result = null; state.page = 0; clearChart(); $('#askAnswer').hidden = true; $('#tableSearch').value = ''; $('#askInput').value = ''; render(); showAppPage('workspace'); toast(`Opened ${project.name}.`);
  });
}

function queryTable(answer) {
  if (!answer?.rows?.length) return '<p class="no-result-rows">No matching rows.</p>';
  return `<div class="query-scroll"><table><thead><tr>${answer.headers.map(header => `<th>${escapeHTML(header)}</th>`).join('')}</tr></thead><tbody>${answer.rows.slice(0, 12).map(row => `<tr>${answer.headers.map((_, index) => `<td>${escapeHTML(row[index]) || '—'}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
function showQueryTool(name) {
  if (!state.headers.length) { message('Upload a dataset before asking for an analysis.'); return; }
  const labels = { excel: ['EXCEL-STYLE ANALYSIS', 'Describe the spreadsheet result you want', 'Ask for sorting, filtering, top values, or calculations. Analytics Hub will do the operation and show the result.'], sql: ['SQL-STYLE ANALYSIS', 'Ask for the answer you need', 'Describe the query in plain language. Query steps stay behind the scenes; the result is what you see.'], python: ['PYTHON-STYLE ANALYSIS', 'Describe the calculation or analysis', 'Ask for a calculation, comparison, or filtered result. No code editor or coding syntax needed.'] }[name];
  $('#toolDialogContent').innerHTML = `<div class="section-kicker">${labels[0]}</div><h2>${labels[1]}</h2><p>${labels[2]}</p><form id="toolAskForm" class="tool-ask-form"><input id="toolAskInput" placeholder="For example: average score by class" aria-label="Describe the result you need"><button class="primary-button">Show result</button></form><div class="tool-examples"><button data-example="Show students above 90 percent">Above 90%</button><button data-example="Average score by class">Average by class</button><button data-example="Sort by score highest to lowest">Sort scores</button></div><div id="toolAnswer" class="tool-answer" aria-live="polite"></div>`;
  $('#toolDialog').showModal();
  const run = question => { const answer = ask(question); $('#toolAskInput').value = question; $('#toolAnswer').innerHTML = answer ? `<div class="answer-summary">${escapeHTML(answer.summary)}</div>${queryTable(answer)}` : $('#askAnswer').innerHTML; };
  $('#toolAskForm').onsubmit = event => { event.preventDefault(); const question = $('#toolAskInput').value.trim(); if (question) run(question); };
  document.querySelectorAll('#toolDialogContent [data-example]').forEach(button => button.onclick = () => run(button.dataset.example));
}
function showDashboardBuilder(name) {
  if (!state.headers.length) { message('Upload a dataset before creating a dashboard.'); return; }
  const label = name === 'powerbi' ? 'Power BI-style dashboard' : 'Tableau-style visual';
  const headers = state.result?.headers || state.headers;
  $('#toolDialogContent').innerHTML = `<div class="section-kicker">BUILT INTO ANALYTICS HUB · NO INSTALL NEEDED</div><h2>Create a ${label}</h2><p>Tick the fields to include. Numeric fields become measures; text and category fields are used to group the chart. This visualization is created in Analytics Hub.</p><div class="builder-controls builder-controls-multi"><fieldset class="builder-fieldset"><legend>Fields · select one or more</legend><div class="builder-field-list">${headers.map((header, index) => `<label class="builder-field-choice"><input type="checkbox" data-builder-field="${index}" ${state.chartFields.includes(index) ? 'checked' : ''}><span>${escapeHTML(header)}</span></label>`).join('') || '<span class="field-empty">No fields found</span>'}</div></fieldset><label>Group by (optional)<select id="builderDimension"><option value="">Use selected category fields / row order</option>${headers.map((header, index) => `<option value="${index}" ${String(state.chartDimension) === String(index) ? 'selected' : ''}>${escapeHTML(header)}</option>`).join('')}</select></label><label>Calculation<select id="builderAggregation"><option value="sum">Sum</option><option value="average">Average</option><option value="count">Count</option></select></label><label>Chart type<select id="builderType"><option value="bar">Bar</option><option value="line">Line</option><option value="area">Area</option><option value="horizontalBar">Horizontal bar</option><option value="pie">Pie</option><option value="doughnut">Doughnut</option><option value="polarArea">Polar area</option><option value="radar">Radar</option><option value="scatter">Scatter plot</option></select></label></div><button class="primary-button" id="createDashboard">Create visualization</button>`;
  $('#builderAggregation').value = state.chartAggregation;
  $('#toolDialog').showModal();
  $('#createDashboard').onclick = () => {
    state.chartFields = [...$('#toolDialogContent').querySelectorAll('[data-builder-field]:checked')].map(input => Number(input.dataset.builderField));
    state.chartDimension = $('#builderDimension').value;
    state.chartAggregation = $('#builderAggregation').value;
    $('#chartType').value = $('#builderType').value;
    if (!state.chartFields.length && !state.chartDimension) { toast('Choose one or more measure fields, or select a Group by field to chart row counts.'); return; }
    $('#toolDialog').close(); render(); makeChart(); document.querySelector('#projects').scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
}
function showTool(name) {
  if (name === 'powerbi' || name === 'tableau') return showDashboardBuilder(name);
  showQueryTool(name);
}

$('#browseBtn').onclick = () => fileInput.click();
$('#uploadBtn').onclick = () => fileInput.click();
fileInput.onchange = event => openFile(event.target.files[0]);
$('#mergeInput').onchange = event => mergeFiles(event.target.files);
['dragenter', 'dragover'].forEach(type => dropzone.addEventListener(type, event => { event.preventDefault(); dropzone.classList.add('drag'); }));
['dragleave', 'drop'].forEach(type => dropzone.addEventListener(type, event => { event.preventDefault(); dropzone.classList.remove('drag'); }));
dropzone.addEventListener('drop', event => openFile(event.dataTransfer.files[0]));
document.querySelectorAll('.action-row').forEach(button => button.onclick = () => clean(button.dataset.action));
$('#chartFields').onchange = () => { state.chartFields = [...$('#chartFields').querySelectorAll('[data-chart-field]:checked')].map(input => Number(input.dataset.chartField)); $('#chartFieldSummary').textContent = state.chartFields.length ? `FIELDS · ${state.chartFields.length} selected` : 'FIELDS · choose measures'; makeChart(); };
$('#chartDimension').onchange = () => { state.chartDimension = $('#chartDimension').value; makeChart(); };
$('#chartType').onchange = makeChart; $('#chartAggregation').onchange = () => { state.chartAggregation = $('#chartAggregation').value; makeChart(); };
$('#downloadBtn').onclick = () => downloadData();
$('#tableSearch').oninput = () => { state.page = 0; render(); };
$('#clearFilterBtn').onclick = () => { state.viewRows = null; state.result = null; state.page = 0; $('#tableSearch').value = ''; $('#askAnswer').hidden = true; render(); if (state.chartFields.length || $('#chartDimension').value) makeChart(); toast('Search and question filters cleared.'); };
$('#dataTable').onclick = event => { const button = event.target.closest('[data-sort]'); if (!button) return; const index = Number(button.dataset.sort); state.sort = { index, direction: state.sort?.index === index ? -state.sort.direction : 1 }; render(); };
$('#editorTable').addEventListener('change', event => {
  const input = event.target.closest('.editor-cell'); if (!input) return;
  const row = Number(input.dataset.row), column = Number(input.dataset.col);
  const before = scanIssues();
  state.rows[row][column] = input.value;
  state.result = null; state.viewRows = null; state.undoRows = null; $('#askAnswer').hidden = true;
  const after = scanIssues(); recordResolvedIssues(before, after);
  render();
});
$('#editorTable').addEventListener('focusin', event => {
  const input = event.target.closest('.editor-cell'); if (!input) return;
  state.selectedCell = { row: Number(input.dataset.row), column: Number(input.dataset.col) };
  const range = state.selectionRange; const count = range ? (Math.abs(range.end.row - range.start.row) + 1) * (Math.abs(range.end.column - range.start.column) + 1) : 0;
  $('#selectedCellLabel').textContent = count > 1 ? `${count} cells selected` : `Row ${state.selectedCell.row + 2} · ${state.headers[state.selectedCell.column] || 'cell'}`;
  $('#fillRangeButton').disabled = false;
  ['cellFill', 'cellColor', 'cellAlign', 'clearFormatButton'].forEach(id => { $(`#${id}`).disabled = false; });
  document.querySelectorAll('.format-toggle').forEach(button => { button.disabled = false; });
  const fmt = state.cellFormats[`${state.selectedCell.row}:${state.selectedCell.column}`] || {};
  $('#cellFill').value = fmt.fill || ''; $('#cellColor').value = fmt.color || ''; $('#cellAlign').value = fmt.align || 'left';
});
$('#editorTable').addEventListener('pointerdown', event => {
  state.dragCompleted = false; const input = event.target.closest('.editor-cell'); if (!input || event.shiftKey || event.ctrlKey || event.metaKey || event.button !== 0) return;
  const cell = { row: Number(input.dataset.row), column: Number(input.dataset.col) }; state.dragStart = cell; state.dragSelecting = true; state.dragCompleted = false;
  state.selectedCell = cell; state.selectionAnchor = cell; state.selectionRange = { start: cell, end: cell }; state.selectedCells.clear();
});
$('#editorTable').addEventListener('pointerover', event => {
  if (!state.dragSelecting || !(event.buttons & 1)) return;
  const input = event.target.closest('.editor-cell'); if (!input) return;
  const end = { row: Number(input.dataset.row), column: Number(input.dataset.col) }; state.selectedCell = end; state.selectionRange = { start: state.dragStart, end };
  const coords = selectedCellCoords(); const selected = new Set(coords.map(cell => `${cell.row}:${cell.column}`));
  $('#editorTable').querySelectorAll('.editor-cell').forEach(cellInput => cellInput.closest('td')?.classList.toggle('selected-range', selected.has(`${cellInput.dataset.row}:${cellInput.dataset.col}`)));
  $('#selectedCellLabel').textContent = `${coords.length} cells selected`;
});
document.addEventListener('pointerup', () => { if (state.dragSelecting) { state.dragSelecting = false; state.dragCompleted = true; } });
$('#editorTable').addEventListener('click', event => {
  const rename = event.target.closest('[data-rename-col]');
  if (!rename) {
    const input = event.target.closest('.editor-cell'); if (!input) return;
    const target = { row: Number(input.dataset.row), column: Number(input.dataset.col) }; const caret = input.selectionStart;
    if (state.dragCompleted) { state.dragCompleted = false; }
    else if (event.ctrlKey || event.metaKey) { const key = `${target.row}:${target.column}`; if (state.selectedCells.has(key)) state.selectedCells.delete(key); else state.selectedCells.add(key); state.selectionRange = null; }
    else if (event.shiftKey && state.selectionAnchor) { state.selectedCells.clear(); state.selectionRange = { start: { ...state.selectionAnchor }, end: target }; }
    else { state.selectedCells.clear(); state.selectionAnchor = target; state.selectionRange = { start: target, end: target }; }
    state.selectedCell = target; renderEditor(); const replacement = $(`#editorTable .editor-cell[data-row="${target.row}"][data-col="${target.column}"]`); replacement?.focus(); if (Number.isInteger(caret)) replacement?.setSelectionRange(caret, caret); return;
  }
  const column = Number(rename.dataset.renameCol); const next = prompt('Column name', state.headers[column]);
  if (next === null) return; const name = next.trim();
  if (!name) { toast('Column name cannot be blank.'); return; }
  if (state.headers.some((header, index) => index !== column && header.toLowerCase() === name.toLowerCase())) { toast('Column names must be unique.'); return; }
  state.headers[column] = name; render(); toast('Column renamed.');
});
function selectedFormat() {
  if (!state.selectedCell || !state.headers.length) { toast('Select a cell in the table first.'); return null; }
  const { row, column } = state.selectedCell;
  if (!state.rows[row] || column >= state.headers.length) { toast('That cell is no longer available. Select a cell again.'); return null; }
  const key = `${row}:${column}`; return state.cellFormats[key] ||= {};
}
function applySelectedFormat(key, value) {
  if (!selectedFormat()) return;
  for (const { row, column } of selectedCellCoords()) { const format = state.cellFormats[`${row}:${column}`] ||= {}; if (value === '' || value === 'left') delete format[key]; else format[key] = value; }
  renderEditor(); scheduleWorkspaceSave();
}
$('#cellFill').onchange = event => applySelectedFormat('fill', event.target.value);
$('#cellColor').onchange = event => applySelectedFormat('color', event.target.value);
$('#cellAlign').onchange = event => applySelectedFormat('align', event.target.value);
document.querySelectorAll('.format-toggle').forEach(button => button.onclick = () => {
  if (!selectedFormat()) return;
  const cells = selectedCellCoords(); const key = button.dataset.format; const first = state.cellFormats[`${cells[0].row}:${cells[0].column}`] || {}; const next = !first[key];
  for (const { row, column } of cells) { const fmt = state.cellFormats[`${row}:${column}`] ||= {}; fmt[key] = next; }
  renderEditor(); scheduleWorkspaceSave();
});
$('#clearFormatButton').onclick = () => { if (!state.selectedCell) { toast('Select cells in the table first.'); return; } for (const { row, column } of selectedCellCoords()) delete state.cellFormats[`${row}:${column}`]; renderEditor(); scheduleWorkspaceSave(); };
$('#fillRangeButton').onclick = () => {
  const cells = selectedCellCoords(); if (!cells.length) { toast('Select cells in the table first.'); return; }
  const value = $('#rangeFillValue').value; const before = scanIssues();
  for (const { row, column } of cells) state.rows[row][column] = value;
  state.result = null; state.viewRows = null; state.undoRows = null; $('#askAnswer').hidden = true; recordResolvedIssues(before, scanIssues()); render(); toast(`Updated ${cells.length} selected cell${cells.length === 1 ? '' : 's'}.`);
};
$('#editorTable').addEventListener('paste', event => {
  const input = event.target.closest('.editor-cell'); if (!input) return;
  const text = event.clipboardData?.getData('text/plain') || '';
  if (!/[\t\r\n]/.test(text)) return;
  event.preventDefault();
  const matrix = text.replace(/\r/g, '').split('\n'); if (matrix.at(-1) === '') matrix.pop();
  const values = matrix.map(line => line.split('\t')); if (!values.length) return;
  const startRow = Number(input.dataset.row), startColumn = Number(input.dataset.col);
  while (state.headers.length < startColumn + Math.max(...values.map(row => row.length))) { const name = `Column ${state.headers.length + 1}`; state.headers.push(name); state.rows.forEach(row => row.push('')); }
  while (state.rows.length < startRow + values.length) state.rows.push(state.headers.map(() => ''));
  const before = scanIssues();
  values.forEach((row, rowOffset) => row.forEach((value, columnOffset) => { state.rows[startRow + rowOffset][startColumn + columnOffset] = value; }));
  state.selectedCells.clear(); state.selectionAnchor = { row: startRow, column: startColumn }; state.selectionRange = { start: { row: startRow, column: startColumn }, end: { row: startRow + values.length - 1, column: startColumn + Math.max(...values.map(row => row.length)) - 1 } }; state.selectedCell = { ...state.selectionAnchor };
  state.issueFilter = 'all'; $('#issueFilter').value = 'all'; state.editorPage = Math.floor(startRow / state.pageSize); state.result = null; state.viewRows = null; state.undoRows = null; $('#askAnswer').hidden = true; recordResolvedIssues(before, scanIssues()); render(); toast(`Pasted ${values.length} row${values.length === 1 ? '' : 's'} into the sheet.`);
});
$('#tableStyle').onchange = event => { state.tableStyle = event.target.value; renderEditor(); scheduleWorkspaceSave(); };
$('#addRowButton').onclick = () => {
  if (!state.headers.length) { toast('Upload a spreadsheet before adding rows.'); return; }
  state.rows.push(state.headers.map(() => '')); state.viewRows = null; state.result = null; state.issueFilter = 'all'; $('#issueFilter').value = 'all'; state.editorPage = Math.floor((state.rows.length - 1) / state.pageSize); render(); toast('Blank row added.');
};
$('#addColumnButton').onclick = () => {
  if (!state.headers.length) { toast('Upload a spreadsheet before adding columns.'); return; }
  const suggested = `Column ${state.headers.length + 1}`; const name = prompt('New column name', suggested);
  if (name === null) return; const header = name.trim();
  if (!header) { toast('Column name cannot be blank.'); return; }
  if (state.headers.some(value => value.toLowerCase() === header.toLowerCase())) { toast('Column names must be unique.'); return; }
  state.headers.push(header); state.rows.forEach(row => row.push('')); state.chartFields = []; state.viewRows = null; state.result = null; state.issueFilter = 'all'; $('#issueFilter').value = 'all'; render(); toast(`Added column “${header}”.`);
};
$('#issueList').addEventListener('click', event => {
  const item = event.target.closest('[data-jump-row]'); if (!item) return;
  state.selectedIssue = item.dataset.issueKey;
  state.issueFilter = 'issues'; $('#issueFilter').value = 'issues';
  const row = Number(item.dataset.jumpRow);
  const issueRows = [...new Set(scanIssues().map(issue => issue.row))];
  state.editorPage = Math.max(0, Math.floor(issueRows.indexOf(row) / state.pageSize)); renderEditor();
  const cell = item.dataset.jumpCol; const input = $(`#editorTable .editor-cell[data-row="${row}"][data-col="${cell >= 0 ? cell : 0}"]`);
  input?.focus(); input?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
});
$('#autoFixButton').onclick = () => {
  const issue = state.selectedIssue ? scanIssues().find(item => item.key === state.selectedIssue) : null;
  const plan = issue && autoFixPlan(issue); if (!issue || !plan) return;
  const before = scanIssues();
  state.rows[issue.row][issue.column] = plan.value;
  recordResolvedIssues(before, scanIssues());
  state.selectedIssue = null; state.selectedFix = null; state.result = null; state.viewRows = null; state.undoRows = null;
  render(); toast(`Fixed ${state.headers[issue.column]} in row ${issue.row + 2}.`);
};
$('#issueFilter').onchange = event => { state.issueFilter = event.target.value; state.editorPage = 0; renderEditor(); };
$('#editorPrev').onclick = () => { state.editorPage = Math.max(0, state.editorPage - 1); renderEditor(); };
$('#editorNext').onclick = () => { state.editorPage++; renderEditor(); };
$('#prevPage').onclick = () => { state.page = Math.max(0, state.page - 1); render(); };
$('#nextPage').onclick = () => { state.page++; render(); };
$('#saveProjectBtn').onclick = saveProject;
$('#askForm').onsubmit = event => { event.preventDefault(); const input = $('#askInput'); if (input.value.trim()) ask(input.value.trim()); };
document.querySelectorAll('.prompt-chip').forEach(button => button.onclick = () => { $('#askInput').value = button.dataset.prompt; ask(button.dataset.prompt); });
$('#resetBtn').onclick = () => { state.headers = []; state.rows = []; state.sourceName = ''; state.viewRows = null; state.result = null; state.undoRows = null; state.cellFormats = {}; state.tableStyle = 'plain'; state.selectedCell = null; state.selectionAnchor = null; state.selectionRange = null; state.selectedCells.clear(); pendingDatasetChange = null; datasetChangeUndo = null; $('#datasetChangeResult').hidden = true; $('#datasetChangeResult').innerHTML = ''; state.solvedIssues.clear(); state.editorPage = 0; state.page = 0; state.sort = null; fileInput.value = ''; $('#tableSearch').value = ''; $('#askAnswer').hidden = true; clearChart(); render(); message('Workspace reset. Upload a file to start again.'); };
document.querySelectorAll('.tool-launch').forEach(button => button.addEventListener('click', event => { event.preventDefault(); showTool(button.dataset.tool); }));
$('#toolDialog').querySelector('.dialog-close').onclick = () => $('#toolDialog').close();
const guide = $('#guideDialog'); $('#guideBtn').onclick = () => guide.showModal(); $('#closeGuide').onclick = () => guide.close(); $('#gotIt').onclick = () => guide.close();
$('#helpLink').onclick = event => { event.preventDefault(); guide.showModal(); };
$('#notificationsBtn').onclick = () => toast('You’re all caught up.');
document.querySelectorAll('.nav-item[href^="#"]:not(.tool-launch)').forEach(link => link.addEventListener('click', event => { const key = link.getAttribute('href').slice(1); if (!APP_PAGE_LABELS[key]) return; event.preventDefault(); showAppPage(key); }));
$('#exportFormat').onchange = event => { if (event.target.value === 'csv') $('#downloadBtn').textContent = 'Download ↓'; else $('#downloadBtn').textContent = `Download ${event.target.value.toUpperCase()} ↓`; };

function setAuthMode(mode) {
  authMode = mode;
  const signup = mode === 'signup';
  $('#authTitle').textContent = signup ? 'Create your account' : 'Welcome back';
  $('#authSubtitle').textContent = signup ? 'Choose a username and password to get started.' : 'Sign in to open your workspace.';
  $('#authSubmit').innerHTML = signup ? 'Create account <span>↗</span>' : 'Sign in <span>↗</span>';
  $('#authPassword').autocomplete = signup ? 'new-password' : 'current-password';
  $('#confirmPasswordWrap').hidden = !signup;
  $('#authConfirmPassword').required = signup;
  $('#authSwitchText').innerHTML = signup
    ? 'Already have an account? <button type="button" id="authSwitch">Sign in</button>'
    : 'New to Analytics Hub? <button type="button" id="authSwitch">Create an account</button>';
  $('#authError').hidden = true;
  $('#authSwitch').onclick = () => setAuthMode(signup ? 'login' : 'signup');
}
function enterWorkspace(user) {
  const changedAccount = currentUser?.id !== user.id;
  currentUser = user;
  if (Object.hasOwn(user, 'profile_image')) profileImage = user.profile_image || '';
  $('#authGate').hidden = true;
  const first = String(user.username || 'A').slice(0, 1).toUpperCase();
  $('#sidebarUsername').textContent = user.username;
  $('#sidebarAvatar').textContent = first;
  paintProfileImage(profileImage);
  if (changedAccount) { initWorkspaces(); restoreWorkspace(activeWorkspaceId); }
  renderRecentProjects();
}
function paintProfileImage(image) {
  profileImage = image || '';
  for (const avatar of [$('#sidebarAvatar'), $('#topAvatar'), $('#profilePhotoPreview')]) {
    if (!avatar) continue;
    const initial = String(currentUser?.username || 'A').slice(0, 1).toUpperCase();
    avatar.innerHTML = profileImage ? `<img src="${profileImage}" alt="">` : initial;
    avatar.classList.toggle('has-profile-image', Boolean(profileImage));
  }
}
function applyTheme(theme) {
  const value = theme === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = value;
  localStorage.setItem('analyticsHub.theme', value);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = value === 'dark' ? '#0b1119' : '#f5f7fb';
  const select = $('#themeSelect');
  if (select) select.value = value;
  if (state.headers.length && (state.chartFields.length || $('#chartDimension')?.value)) makeChart();
}
async function openProfile() {
  $('#profileError').hidden = true;
  $('#profileSuccess').hidden = true;
  $('#profileCurrentPassword').value = '';
  $('#profileNewPassword').value = '';
  $('#profileConfirmPassword').value = '';
  try {
    const response = await fetch('/api/profile');
    const result = await readApiJson(response);
    if (!response.ok) throw new Error(result.error || 'Could not load profile.');
    const profile = result.profile;
    $('#profileUsername').value = profile.username || '';
    $('#profileEmail').value = profile.email || '';
    $('#profileRecoveryId').value = profile.recovery_id || '';
    paintProfileImage(profile.profile_image || '');
    profileImageAtOpen = profileImage;
    profileOriginal = { username: profile.username || '', email: profile.email || '', recovery_id: profile.recovery_id || '', profile_image: profile.profile_image || '' };
    $('#profileDialog').showModal();
  } catch (error) { toast(error.message); }
}
async function readApiJson(response) {
  if (!response.headers.get('content-type')?.includes('application/json')) {
    throw new Error('The server is still using the older version. In its terminal press Ctrl+C, run “python3 server.py”, then refresh this page. Your account data is safe.');
  }
  return response.json();
}
$('#authSwitch').onclick = () => setAuthMode('signup');
$('#authForm').onsubmit = async event => {
  event.preventDefault();
  const username = $('#authUsername').value.trim();
  const password = $('#authPassword').value;
  const error = $('#authError');
  error.hidden = true;
  if (authMode === 'signup' && password !== $('#authConfirmPassword').value) {
    error.textContent = 'The passwords do not match.'; error.hidden = false; return;
  }
  const button = $('#authSubmit'); button.disabled = true;
  button.textContent = authMode === 'signup' ? 'Creating account…' : 'Signing in…';
  try {
    const response = await fetch(`/api/${authMode === 'signup' ? 'signup' : 'login'}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const result = await readApiJson(response);
    if (!response.ok) throw new Error(result.error || 'Could not sign in.');
    $('#authForm').reset();
    enterWorkspace(result.user);
  } catch (err) {
    error.textContent = err instanceof TypeError ? 'The local server is unavailable. Start it with “python3 server.py” and reload this page.' : err.message;
    error.hidden = false;
  } finally {
    button.disabled = false;
    button.innerHTML = authMode === 'signup' ? 'Create account <span>↗</span>' : 'Sign in <span>↗</span>';
  }
};
$('#logoutButton').onclick = async () => {
  clearTimeout(scheduleWorkspaceSave.timer);
  persistActiveWorkspace();
  try { await fetch('/api/logout', { method: 'POST' }); } finally {
    currentUser = null;
    activeWorkspaceId = '';
    profileImage = '';
    $('#authGate').hidden = false;
    $('#authUsername').value = '';
    $('#authPassword').value = '';
    setAuthMode('login');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
};
function showUpgradeWorkspacePrompt() {
  $('#workspaceMenu').hidden = true;
  $('#workspaceSwitcher').setAttribute('aria-expanded', 'false');
  $('#upgradeWorkspaceDialog').showModal();
}
function setUpgradePage(show) {
  $('#overview').classList.toggle('upgrade-view', show);
  $('#upgradePage').hidden = !show;
  $('#upgradeNav').classList.toggle('active', show);
  if (show) document.querySelectorAll('.nav-item').forEach(item => { if (item !== $('#upgradeNav')) item.classList.remove('active'); });
  else document.querySelector('.nav-item[href="#overview"]')?.classList.add('active');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function navigateToUpgrade() {
  if ($('#upgradeWorkspaceDialog').open) $('#upgradeWorkspaceDialog').close();
  if ($('#createWorkspaceDialog').open) $('#createWorkspaceDialog').close();
  if (location.hash !== '#upgrade') history.pushState({ view: 'upgrade' }, '', '#upgrade');
  setUpgradePage(true);
}
$('#upgradeNav').onclick = event => { event.preventDefault(); navigateToUpgrade(); };
$('#upgradeBackButton').onclick = () => {
  if (location.hash === '#upgrade') history.back();
  else setUpgradePage(false);
};
window.addEventListener('hashchange', () => {
  if (location.hash === '#upgrade') setUpgradePage(true);
  else { if ($('#overview').classList.contains('upgrade-view')) setUpgradePage(false); showAppPage(pageFromHash(location.hash), false); }
});
window.addEventListener('popstate', () => {
  if (location.hash === '#upgrade') setUpgradePage(true);
  else { if ($('#overview').classList.contains('upgrade-view')) setUpgradePage(false); showAppPage(pageFromHash(location.hash), false); }
});
$('#proCheckoutButton').onclick = () => { $('#paymentStatus').hidden = false; };
$('#workspaceSwitcher').onclick = () => {
  const menu = $('#workspaceMenu');
  menu.hidden = !menu.hidden;
  $('#workspaceSwitcher').setAttribute('aria-expanded', String(!menu.hidden));
};
document.addEventListener('click', event => {
  if (!event.target.closest('.workspace-picker')) {
    $('#workspaceMenu').hidden = true;
    $('#workspaceSwitcher').setAttribute('aria-expanded', 'false');
  }
});
$('#createWorkspaceForm').onsubmit = event => {
  event.preventDefault();
  const name = $('#newWorkspaceName').value.trim();
  if (!name) return;
  if (workspaceList.length >= FREE_WORKSPACE_LIMIT) { $('#createWorkspaceDialog').close(); showUpgradeWorkspacePrompt(); return; }
  clearTimeout(scheduleWorkspaceSave.timer);
  persistActiveWorkspace();
  const id = `workspace-${Date.now()}`;
  workspaceList.push({ id, name });
  saveWorkspaceList();
  activeWorkspaceId = id;
  try { localStorage.setItem(workspaceActiveKey(), id); } catch { /* retain selection in memory */ }
  $('#createWorkspaceDialog').close();
  restoreWorkspace(id);
  toast(`${name} is ready. Your other workspace data is saved.`);
};
document.querySelectorAll('.workspace-close').forEach(button => button.onclick = () => button.closest('dialog').close());
$('#upgradeWorkspaceButton').onclick = navigateToUpgrade;
$('#sidebarProfileButton').onclick = openProfile;
$('#topAvatar').onclick = openProfile;
function closeProfileWithoutSaving() { paintProfileImage(profileImageAtOpen); $('#profileDialog').close(); }
$('#profileDialog').querySelectorAll('.profile-close').forEach(button => button.onclick = closeProfileWithoutSaving);
$('#profileDialog').onkeydown = event => { if (event.key === 'Escape') paintProfileImage(profileImageAtOpen); };
$('#profilePhotoPreview').onclick = () => $('#profilePhotoInput').click();
$('#profilePhotoInput').onchange = event => {
  const file = event.target.files?.[0];
  if (!file) return;
  if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(file.type) || file.size > 1_500_000) {
    $('#profileError').textContent = 'Choose a PNG, JPG, GIF, or WebP image under 1.5 MB.'; $('#profileError').hidden = false; event.target.value = ''; return;
  }
  const reader = new FileReader();
  reader.onload = () => paintProfileImage(String(reader.result));
  reader.readAsDataURL(file);
};
$('#removeProfilePhoto').onclick = () => { paintProfileImage(''); $('#profilePhotoInput').value = ''; };
$('#themeSelect').onchange = event => applyTheme(event.target.value);
$('#profileForm').onsubmit = async event => {
  event.preventDefault();
  const error = $('#profileError'); const success = $('#profileSuccess');
  error.hidden = true; success.hidden = true;
  const currentPassword = $('#profileCurrentPassword').value;
  const newPassword = $('#profileNewPassword').value;
  const confirmPassword = $('#profileConfirmPassword').value;
  if ((currentPassword || newPassword || confirmPassword) && (!currentPassword || !newPassword || !confirmPassword)) {
    error.textContent = 'To change your password, enter your current password and both new-password fields.'; error.hidden = false; return;
  }
  if (newPassword && newPassword !== confirmPassword) {
    error.textContent = 'The new passwords do not match.'; error.hidden = false; return;
  }
  const button = $('#saveProfileButton'); button.disabled = true; button.textContent = 'Saving…';
  try {
    const username = $('#profileUsername').value.trim();
    const email = $('#profileEmail').value.trim();
    const recoveryId = $('#profileRecoveryId').value.trim();
    const response = await fetch('/api/profile', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      username: username || profileOriginal?.username || currentUser.username,
      email, recovery_id: recoveryId, profile_image: profileImage,
      current_password: newPassword ? currentPassword : '', new_password: newPassword
    }) });
    const result = await readApiJson(response);
    if (!response.ok) throw new Error(result.error || 'Could not save profile.');
    enterWorkspace(result.user);
    profileImageAtOpen = profileImage;
    profileOriginal = { username: result.profile.username, email: result.profile.email, recovery_id: result.profile.recovery_id, profile_image: result.profile.profile_image };
    $('#profileUsername').value = result.profile.username;
    $('#profileEmail').value = result.profile.email;
    $('#profileRecoveryId').value = result.profile.recovery_id;
    $('#profileCurrentPassword').value = ''; $('#profileNewPassword').value = ''; $('#profileConfirmPassword').value = '';
    success.textContent = 'Profile saved.'; success.hidden = false;
  } catch (err) { error.textContent = err.message; error.hidden = false; }
  finally { button.disabled = false; button.textContent = 'Save profile'; }
};
setAuthMode('login');
applyTheme(localStorage.getItem('analyticsHub.theme') || 'dark');
fetch('/api/me').then(async response => {
  if (!response.ok) return;
  const result = await response.json();
  if (result.user) enterWorkspace(result.user);
}).catch(() => {
  $('#authError').textContent = 'Start Analytics Hub using “python3 server.py”, then reload this page.';
  $('#authError').hidden = false;
});
render(); renderRecentProjects();
if (location.hash === '#upgrade') setUpgradePage(true); else showAppPage(pageFromHash(location.hash), false);
