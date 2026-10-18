/* Extension UI: connection is established before profile actions are enabled. */
'use strict';
const api = globalThis.browser || globalThis.chrome;
const $ = id => document.getElementById(id);
let busy = false;
let current = {};
let connectedServer = null;
function lastBinding() {
  return current.lastSyncedBinding || (current.server && current.name ? {server: current.server, profile: current.name} : null);
}
function profileForServer(server) {
  const remembered = lastBinding();
  if (current.server === server && current.name) return current.name;
  return remembered?.server === server ? remembered.profile : '';
}
async function message(action, fields = {}) {
  const response = await api.runtime.sendMessage({action, ...fields});
  if (!response || response.ok !== true) {
    const error = new Error(response?.error || 'Background did not respond. Reload the extension.');
    error.status = response?.status || 0;
    throw error;
  }
  return response.value;
}
function url() {
  const parsed = new URL($('server').value.trim());
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error('Use an HTTP(S) server URL without credentials, query, or fragment.');
  return parsed.href.replace(/\/$/, '');
}
function profileName() {
  const value = $('name').value.trim();
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(value)) throw new Error('Use 1–64 letters, numbers, underscores, or hyphens.');
  return value;
}
async function permission(server) {
  const parsed = new URL(server);
  const origin = parsed.protocol + '//' + parsed.hostname + '/*';
  if (!await api.permissions.request({origins: [origin]})) throw new Error('Server access permission was denied.');
}
function render(state) {
  current = state || {};
  $('auto').checked = Boolean(current.auto);
  const remembered = lastBinding();
  $('binding').textContent = remembered ? `Last synced profile: ${remembered.profile}\nServer: ${remembered.server}` : 'No profile synced yet.';
  $('status').textContent = current.status || 'Connect to your server to begin.';
  $('error').textContent = current.error || '';
  const date = value => value ? new Date(value).toLocaleString() : 'Never';
  $('times').textContent = `Last sync: ${date(current.lastSync)} · Server revision: ${current.last_seen_server_updated_at ?? '—'}`;
  $('rename').hidden = !current.name || !connectedServer;
  const selected = $('snapshots').value;
  $('snapshots').replaceChildren();
  for (const backup of current.backups || []) $('snapshots').add(new Option(`${date(backup.created_at)} — ${backup.label}`, backup.id));
  if (selected && [...$('snapshots').options].some(option => option.value === selected)) $('snapshots').value = selected;
  updateVisibility();
}
function updateVisibility() {
  let sameServer = false;
  try { sameServer = !!connectedServer && url() === connectedServer; } catch (_) {}
  $('profileSection').hidden = !sameServer;
  $('syncControls').hidden = !sameServer || !current.name || current.server !== connectedServer;
  $('rename').hidden = !current.name || !sameServer;
  const remembered = lastBinding();
  if (sameServer && current.name && current.server === connectedServer) $('binding').textContent = `Syncing profile: ${current.name}\nServer: ${current.server}`;
  else if (remembered) $('binding').textContent = `Last synced profile: ${remembered.profile}\nServer: ${remembered.server}`;
  else if (sameServer) $('binding').textContent = 'Connected. Enter a profile name to begin syncing.';
  else $('binding').textContent = 'Connect to your server to choose a profile.';
}
async function refresh() { render(await message('status')); }
async function run(task) {
  if (busy) return;
  busy = true;
  document.querySelectorAll('button').forEach(button => button.disabled = true);
  $('error').textContent = '';
  try { await task(); await refresh(); }
  catch (error) { $('error').textContent = error.message; }
  finally { busy = false; document.querySelectorAll('button').forEach(button => button.disabled = false); }
}
async function list(server) {
  const response = await message('list', {server});
  if (url() !== server) throw new Error('Server address changed while connecting. Connect again to continue.');
  connectedServer = server;
  $('profiles').replaceChildren();
  for (const profile of response.profiles || []) $('profiles').append(new Option(profile.name, profile.name));
  $('name').value = profileForServer(server);
  updateVisibility();
}
$('connection').addEventListener('submit', event => {
  event.preventDefault();
  let server; let grant;
  try { server = url(); grant = permission(server); } catch (error) { $('error').textContent = error.message; return; }
  connectedServer = null; updateVisibility();
  run(async () => { await grant; await list(server); });
});
$('server').addEventListener('input', () => { connectedServer = null; updateVisibility(); });
$('bind').onclick = () => run(async () => {
  const server = url(), selected = profileName();
  if (server !== connectedServer) throw new Error('Connect to this server before selecting a profile.');
  const result = await message('selectProfile', {server, name: selected});
  if (result.created) {
    await refresh();
    await list(server);
    return;
  }
  if (!confirm(`Replace this browser's ${result.localCount} bookmarks with ${result.serverCount} bookmarks from “${selected}”? A local recovery snapshot will be saved first.`)) return;
  await message('bind', {server, name: selected, profile: result.profile});
});
$('rename').onclick = () => run(async () => {
  const selected = profileName();
  if (url() !== connectedServer) throw new Error('Connect to this server before renaming a profile.');
  if (!current.name) throw new Error('Bind a profile first.');
  if (!confirm(`Rename server profile “${current.name}” to “${selected}”? Other browsers using the old name must select the new name.`)) return;
  await message('rename', {name: selected}); await refresh(); await list(current.server);
});
$('sync').onclick = () => run(() => message('sync'));
$('auto').onchange = () => { const enabled = $('auto').checked; run(() => message('auto', {enabled})); };
$('recover').onclick = () => run(async () => {
  if (!confirm('Replace local bookmarks with the most recent recovery snapshot and pause automatic sync? Export snapshots first if you want to keep a separate copy.')) return;
  await message('recover');
});
function download(data) {
  const blob = new Blob([JSON.stringify(data)], {type: 'application/json'});
  const objectURL = URL.createObjectURL(blob);
  const anchor = document.createElement('a'); anchor.href = objectURL;
  anchor.download = `bookmarksman-recovery-${Date.now()}.json`; anchor.click();
  globalThis.setTimeout(() => URL.revokeObjectURL(objectURL), 10000);
}
$('export').onclick = () => run(async () => {
  const backups = await message('backups');
  const backup = backups.find(entry => entry.id === $('snapshots').value) || backups[0];
  if (!backup) throw new Error('No saved snapshots yet.');
  download(backup);
});
$('backupFile').onchange = () => run(async () => {
  const file = $('backupFile').files[0]; if (!file) return;
  if (file.size > 6 * 1024 * 1024) throw new Error('Snapshot file is too large.');
  const data = JSON.parse(await file.text());
  const entries = Array.isArray(data) ? data : data.backups;
  const tree = entries?.[0]?.tree || data.tree;
  if (!tree) throw new Error('No recovery tree found in file.');
  if (!confirm('Replace local bookmarks with the first snapshot in this file and pause automatic sync?')) return;
  await message('importBackup', {tree});
});
(async () => {
  try {
    await refresh();
    const remembered = lastBinding();
    const savedServer = current.serverSetting || current.server || remembered?.server || '';
    $('server').value = savedServer;
    $('name').value = profileForServer(savedServer);
    if (savedServer) await list(savedServer);
  } catch (error) {
    connectedServer = null;
    $('error').textContent = error.message;
    updateVisibility();
  }
})();
