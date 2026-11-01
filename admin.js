const $ = selector => document.querySelector(selector);
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
async function api(path, options = {}) {
  const response = await fetch(path, { credentials: 'same-origin', ...options, headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) } });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'The request could not be completed.');
  return result;
}
function showConsole(admin) {
  $('#adminLogin').hidden = true;
  $('#adminConsole').hidden = false;
  $('#adminIdentity').textContent = `Signed in as ${admin.username}`;
  loadUsers();
}
async function loadUsers() {
  const body = $('#usersBody');
  body.innerHTML = '<tr><td colspan="6">Loading accounts…</td></tr>';
  try {
    const { users } = await api('/api/admin/users');
    body.innerHTML = users.length ? users.map(user => {
      const access = user.access_type === 'paid' ? '<span class="tag paid">Paid Pro</span>' : user.access_type === 'complimentary' ? '<span class="tag complimentary">Complimentary Pro</span>' : '<span class="tag">Free</span>';
      const session = user.has_session ? '<span class="tag session-active">Valid session</span>' : '<span class="tag">No session</span>';
      const joined = new Date(user.created_at * 1000).toLocaleDateString();
      const control = user.is_admin ? '<span class="tag complimentary">Admin account</span>' : user.complimentary
        ? `<div class="grant-actions"><span class="tag complimentary" title="${escapeHTML(user.grant_reason || '')}">Enabled</span><button class="secondary revoke" data-action="revoke" data-user-id="${user.id}">Remove grant</button></div>`
        : `<div class="grant-actions"><input class="admin-reason" data-reason-for="${user.id}" maxlength="160" placeholder="Reason (optional)" aria-label="Reason for complimentary Pro"><button class="secondary" data-action="grant" data-user-id="${user.id}">Enable free Pro</button></div>`;
      return `<tr><td>${escapeHTML(user.username)}</td><td>${escapeHTML(user.email || '—')}</td><td>${joined}</td><td>${session}</td><td>${access}</td><td>${control}</td></tr>`;
    }).join('') : '<tr><td colspan="6">No user accounts yet.</td></tr>';
    $('#consoleStatus').textContent = `${users.length} account${users.length === 1 ? '' : 's'} found.`;
  } catch (error) {
    body.innerHTML = `<tr><td colspan="6">${escapeHTML(error.message)}</td></tr>`;
    if (error.message.includes('Admin access')) showLogin();
  }
}
function showLogin() {
  $('#adminConsole').hidden = true;
  $('#adminLogin').hidden = false;
}
$('#adminLoginForm').addEventListener('submit', async event => {
  event.preventDefault();
  const button = $('#loginButton'); const errorBox = $('#loginError');
  button.disabled = true; button.textContent = 'Signing in…'; errorBox.hidden = true;
  try {
    const result = await api('/api/admin/login', { method: 'POST', body: JSON.stringify({ username: $('#adminUsername').value.trim(), password: $('#adminPassword').value }) });
    $('#adminPassword').value = '';
    showConsole(result.admin);
  } catch (error) { errorBox.textContent = error.message; errorBox.hidden = false; }
  finally { button.disabled = false; button.textContent = 'Sign in'; }
});
$('#refreshButton').addEventListener('click', loadUsers);
$('#usersBody').addEventListener('click', async event => {
  const button = event.target.closest('[data-action]'); if (!button) return;
  const { action, userId } = button.dataset;
  const reason = document.querySelector(`[data-reason-for="${userId}"]`)?.value || '';
  button.disabled = true; $('#consoleStatus').textContent = 'Updating account access…';
  try {
    await api(`/api/admin/users/${userId}/pro-grant`, { method: 'POST', body: JSON.stringify({ action, reason }) });
    $('#consoleStatus').textContent = action === 'grant' ? 'Complimentary Pro enabled.' : 'Complimentary Pro grant removed.';
    await loadUsers();
  } catch (error) { $('#consoleStatus').textContent = error.message; button.disabled = false; }
});
$('#logoutButton').addEventListener('click', async () => {
  try { await api('/api/admin/logout', { method: 'POST', body: '{}' }); } finally { showLogin(); }
});
api('/api/admin/me').then(result => { if (result.admin) showConsole(result.admin); }).catch(() => showLogin());
