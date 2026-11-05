import { supabase, isSupabaseConfigured } from './supabase.js';
import { createClientRecord, deleteClientRecord, importBackup, importCsv, listClients, listProfiles, parseCsv, updateClientRecord, updateProfileRole } from './data.js';

const $ = (id) => document.getElementById(id);
let clients = [];
let sessionUser = null;
let role = 'pending';
let selectedId = null;
let pendingId = null;
let profiles = [];

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}
function showToast(message) {
  $('toast').textContent = message;
  $('toast').classList.add('show');
  window.setTimeout(() => $('toast').classList.remove('show'), 3200);
}
function setAuthView(view, message = '') {
  $('authShell').hidden = false; $('appShell').hidden = true; $('userBadge').hidden = true;
  $('logoutButton').hidden = true; $('adminMenuWrap').hidden = true;
  for (const id of ['loginForm', 'signupForm', 'recoveryForm', 'newPasswordForm']) $(id).hidden = id !== `${view}Form`;
  const titles = { login: ['Entrar', 'Acesse o controle compartilhado de clientes.'], signup: ['Criar usuário', 'Novos usuários recebem acesso pendente.'], recovery: ['Recuperar senha', 'Enviaremos um link para o e-mail cadastrado.'], newPassword: ['Criar nova senha', 'Escolha uma nova senha para sua conta.'] };
  const [heading, subtitle] = titles[view] || titles.login;
  $('authHeading').textContent = heading; $('authSubtitle').textContent = subtitle; $('authMessage').textContent = message;
}
async function showApp(user) {
  if (!user) {
    sessionUser = null; $('appShell').hidden = true; $('authShell').hidden = false;
    $('userBadge').hidden = true; $('logoutButton').hidden = true; $('adminMenuWrap').hidden = true; setAuthView('login'); return;
  }
  sessionUser = user; $('authShell').hidden = true; $('appShell').hidden = true;
  $('userBadge').textContent = user.email || 'Conta conectada'; $('userBadge').hidden = false; $('logoutButton').hidden = false; role = 'pending';
  try {
    const { data, error } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle();
    if (error) throw error; role = data?.role || 'pending';
  } catch (error) { showToast(`Não foi possível consultar o perfil: ${error.message}`); }
  if (!['admin', 'operator'].includes(role)) {
    $('appShell').hidden = true; $('authShell').hidden = false;
    for (const id of ['loginForm', 'signupForm', 'recoveryForm', 'newPasswordForm']) $(id).hidden = true;
    $('authHeading').textContent = 'Acesso pendente'; $('authSubtitle').textContent = 'Seu cadastro ainda não foi autorizado.';
    $('authMessage').textContent = 'Peça a um administrador do Controle FibraCenter para liberar seu acesso.';
    $('userBadge').textContent = user.email || 'Conta conectada'; $('userBadge').hidden = false; $('logoutButton').hidden = false; return;
  }
  $('deleteBtn').hidden = role !== 'admin'; $('adminMenuWrap').hidden = role !== 'admin';
  $('authShell').hidden = true; $('appShell').hidden = false; await refreshClients();
}
async function refreshClients() {
  if (!sessionUser) return;
  try { clients = await listClients(); renderClients(); renderMonthly(); renderReports(); }
  catch (error) { showToast(`Não foi possível carregar os clientes: ${error.message}`); }
}
function currentStatus(client) {
  return client.negativado_status || (client.status === 'REGULARIZADO' ? 'REGULARIZADO' : 'SIM');
}
function renderClients() {
  const active = clients.filter((client) => currentStatus(client) !== 'REGULARIZADO').sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  const regularized = clients.filter((client) => currentStatus(client) === 'REGULARIZADO').sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  $('countNeg').textContent = active.length; $('countReg').textContent = regularized.length;
  drawList('listNeg', active, $('searchNeg').value); drawList('listReg', regularized, $('searchReg').value);
}
function drawList(elementId, records, query) {
  const target = $(elementId), term = query.trim().toLocaleLowerCase('pt-BR');
  const filtered = records.filter((client) => client.name.toLocaleLowerCase('pt-BR').includes(term));
  const options = ['SIM', 'NÃO', 'EM CONTATO', 'REGULARIZADO'];
  target.innerHTML = filtered.length ? filtered.map((client) => {
    const state = currentStatus(client);
    return `<div class="row"><button class="name" data-open="${escapeHtml(client.id)}" title="Ver cadastro de ${escapeHtml(client.name)}">${escapeHtml(client.name)}</button><select class="status-select" data-status="${escapeHtml(client.id)}" aria-label="Situação de ${escapeHtml(client.name)}">${options.map((option) => `<option value="${option}" ${state === option ? 'selected' : ''}>${option}</option>`).join('')}</select></div>`;
  }).join('') : `<div class="empty">${term ? 'Nenhum cliente encontrado.' : 'Nenhum cliente nesta lista.'}</div>`;
}
function displayDate(value) {
  if (!value) return '—'; const [year, month, day] = String(value).slice(0, 10).split('-');
  return year && month && day ? `${day}/${month}/${year}` : String(value);
}
function negativeDate(client) { return client.negativado_status ? (client.negativation_date || null) : (client.negative_date || null); }
function regularDate(client) { return client.regularization_date || client.regularized_date || null; }
function openDetails(id) {
  const client = clients.find((item) => item.id === id); if (!client) return; selectedId = id;
  const state = currentStatus(client); $('detailName').textContent = client.name; $('detailContract').textContent = `Contrato ${client.contract}`;
  const equipment = client.onu || client.router ? [['ONU', client.onu || 'Não informado'], ['Roteador em comodato', client.router || 'Não informado']] : [['Equipamento', client.equipment || 'Não informado']];
  const fields = [
    ['Situação', `<span class="status-banner ${state === 'REGULARIZADO' ? 'green' : ''}">${escapeHtml(state)}</span>`],
    ['Data da negativação', escapeHtml(displayDate(negativeDate(client)))],
    ['Data da regularização', escapeHtml(displayDate(regularDate(client)))],
    ['Rua / endereço', escapeHtml(client.street)], ['Bairro', escapeHtml(client.neighborhood)], ['Cidade', escapeHtml(client.city)],
    ...(client.occurrence_id ? [['ID ocorrência', escapeHtml(client.occurrence_id)]] : []),
    ...equipment.map(([label, value]) => [label, escapeHtml(value)]),
  ];
  $('detailFields').innerHTML = fields.map(([label, value]) => `<div class="field"><div class="label">${label}</div><div class="value">${value}</div></div>`).join('');
  $('detailAction').innerHTML = state === 'REGULARIZADO' ? `<div class="action-box"><div class="label">O que foi feito para regularizar</div><div class="value">${escapeHtml(client.resolution || '—')}</div></div>` : '';
  $('deleteBtn').hidden = role !== 'admin'; $('detailOverlay').classList.add('open');
}
function closeOverlay(id) { $(id).classList.remove('open'); }
function isoToday() { return new Date().toISOString().slice(0, 10); }
function fileDownload(fileName, payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = fileName; link.click(); URL.revokeObjectURL(url);
}
function clearErrors() { for (const id of ['loginError', 'signupError', 'recoveryError', 'newPasswordError', 'formError', 'resolveError']) $(id).textContent = ''; }

function setTheme(theme) {
  document.body.dataset.theme = theme; localStorage.setItem('fibra_theme', theme);
  $('themeIcon').textContent = theme === 'dark' ? '☀' : '☾';
  $('themeToggle').setAttribute('aria-label', theme === 'dark' ? 'Ativar modo claro' : 'Ativar modo noturno');
  $('themeToggle').title = theme === 'dark' ? 'Ativar modo claro' : 'Ativar modo noturno';
}
$('themeToggle').addEventListener('click', () => setTheme(document.body.dataset.theme === 'dark' ? 'light' : 'dark'));
setTheme(localStorage.getItem('fibra_theme') || 'light');

function setView(view) {
  for (const key of ['monthly', 'clients', 'reports']) {
    $(`${key}View`).hidden = key !== view;
    document.querySelector(`[data-view="${key}"]`).classList.toggle('active', key === view);
  }
  const heading = { monthly: ['Visão mensal', 'Acompanhe negativados e regularizações mês a mês.'], clients: ['Clientes', 'Pesquise cadastros e atualize a situação de cada cliente.'], reports: ['Relatórios', 'Gráficos resumidos para apresentar os resultados.'] }[view];
  $('pageTitle').textContent = heading[0]; $('pageSubtitle').textContent = heading[1];
}
document.querySelectorAll('[data-view]').forEach((button) => button.addEventListener('click', () => setView(button.dataset.view)));

function monthKey(value) { return value ? String(value).slice(0, 7) : ''; }
function monthLabel(key) { if (!key) return 'Sem data'; const [year, month] = key.split('-'); return new Date(Number(year), Number(month) - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }); }
function renderMonthly() {
  const months = new Set();
  clients.forEach((client) => { if (negativeDate(client)) months.add(monthKey(negativeDate(client))); if (regularDate(client)) months.add(monthKey(regularDate(client))); });
  const sorted = [...months].filter(Boolean).sort().reverse();
  if (!sorted.length) { $('monthlyCards').innerHTML = '<section class="panel"><div class="empty">Ainda não há datas de negativação ou regularização cadastradas.</div></section>'; return; }
  $('monthlyCards').innerHTML = sorted.map((month) => {
    const negs = clients.filter((client) => monthKey(negativeDate(client)) === month);
    const regs = clients.filter((client) => monthKey(regularDate(client)) === month);
    const renderEventList = (list, dateFn) => list.length ? `<ul class="month-list">${list.sort((a,b)=>a.name.localeCompare(b.name,'pt-BR')).map((client) => `<li><button data-open="${escapeHtml(client.id)}">${escapeHtml(client.name)}</button><small>${escapeHtml(displayDate(dateFn(client)))}</small></li>`).join('')}</ul>` : '<div class="empty">Nenhum registro neste mês.</div>';
    return `<article class="month-card"><div class="month-head"><h2>${escapeHtml(monthLabel(month))}</h2><div class="month-counts">${negs.length} negativado(s) · ${regs.length} regularizado(s)</div></div><div class="month-body"><h3>Negativados no mês (${negs.length})</h3>${renderEventList(negs, negativeDate)}<h3>Regularizados no mês (${regs.length})</h3>${renderEventList(regs, regularDate)}</div></article>`;
  }).join('');
}
const chartColors = ['#138777', '#df665f', '#e5ae45', '#4987c7', '#9168c4', '#3b9c71', '#db7ea1', '#667085', '#50a9b2', '#ba7b45'];
function pieSvg(data) {
  const total = data.reduce((sum, item) => sum + item.value, 0);
  if (!total) return '<div class="empty">Não há dados para exibir.</div>';
  const circumference = 2 * Math.PI * 72; let offset = 0;
  const circles = data.filter((item) => item.value > 0).map((item) => {
    const length = circumference * item.value / total, dash = `${length} ${circumference - length}`, circle = `<circle cx="110" cy="110" r="72" fill="none" stroke="${item.color}" stroke-width="32" stroke-dasharray="${dash}" stroke-dashoffset="-${offset}" transform="rotate(-90 110 110)"/>`;
    offset += length; return circle;
  }).join('');
  const legend = data.map((item) => `<span class="legend-item"><i class="legend-swatch" style="background:${item.color}"></i>${escapeHtml(item.label)}: ${item.value}</span>`).join('');
  return `<svg viewBox="0 0 220 220" role="img" aria-label="Gráfico de pizza, total ${total}"><circle cx="110" cy="110" r="72" fill="none" stroke="var(--line)" stroke-width="32"/>${circles}<text x="110" y="106" text-anchor="middle" fill="var(--ink)" font-size="30" font-weight="700">${total}</text><text x="110" y="128" text-anchor="middle" fill="var(--muted)" font-size="11">registros</text></svg><div class="chart-legend">${legend || 'Sem registros'}</div>`;
}
function renderReports() {
  const negCounts = new Map(); const regCounts = new Map(); const currentSimCounts = new Map();
  clients.forEach((client) => {
    const negKey = monthKey(negativeDate(client));
    if (negKey) negCounts.set(negKey, (negCounts.get(negKey) || 0) + 1);
    const regKey = monthKey(regularDate(client));
    if (regKey) regCounts.set(regKey, (regCounts.get(regKey) || 0) + 1);
    if (currentStatus(client) === 'SIM' && negKey) currentSimCounts.set(negKey, (currentSimCounts.get(negKey) || 0) + 1);
  });
  const monthData = [...negCounts.keys()].sort();
  $('negativePie').innerHTML = pieSvg(monthData.map((month, index) => ({ label: monthLabel(month), value: negCounts.get(month), color: chartColors[index % chartColors.length] })));
  const states = ['REGULARIZADO', 'SIM', 'NÃO', 'EM CONTATO'];
  $('statusPie').innerHTML = pieSvg(states.map((state, index) => ({ label: state, value: clients.filter((client) => currentStatus(client) === state).length, color: chartColors[index] })));
  const barMonths = [...new Set([...regCounts.keys(), ...currentSimCounts.keys()])].sort();
  if (!barMonths.length) { $('monthlyBars').innerHTML = '<div class="empty">Não há dados para exibir.</div>'; return; }
  const maxValue = Math.max(1, ...barMonths.flatMap((month) => [regCounts.get(month) || 0, currentSimCounts.get(month) || 0]));
  const width = Math.max(620, barMonths.length * 90 + 80), height = 290, plotH = 205, baseY = 225, groupW = (width - 70) / barMonths.length;
  const bars = barMonths.map((month, index) => {
    const x = 45 + groupW * index, reg = regCounts.get(month) || 0, neg = currentSimCounts.get(month) || 0;
    const rh = plotH * reg / maxValue, nh = plotH * neg / maxValue;
    const label = monthLabel(month).replace(' de ', ' ');
    return `<rect x="${x + groupW*.18}" y="${baseY-rh}" width="${groupW*.25}" height="${rh}" rx="4" fill="#138777"><title>${escapeHtml(label)}: ${reg} regularizados</title></rect><text x="${x+groupW*.305}" y="${baseY-rh-5}" text-anchor="middle" fill="var(--ink)" font-size="11">${reg}</text><rect x="${x+groupW*.55}" y="${baseY-nh}" width="${groupW*.25}" height="${nh}" rx="4" fill="#df665f"><title>${escapeHtml(label)}: ${neg} atualmente SIM</title></rect><text x="${x+groupW*.675}" y="${baseY-nh-5}" text-anchor="middle" fill="var(--ink)" font-size="11">${neg}</text><text x="${x+groupW*.5}" y="${baseY+20}" text-anchor="middle" fill="var(--muted)" font-size="10">${escapeHtml(label)}</text>`;
  }).join('');
  $('monthlyBars').innerHTML = `<div style="width:100%;overflow:auto"><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Colunas mensais de regularização e negativados atualmente"><line x1="35" y1="${baseY}" x2="${width-20}" y2="${baseY}" stroke="var(--line)"/>${bars}</svg><div class="chart-legend"><span class="legend-item"><i class="legend-swatch" style="background:#138777"></i>Regularizados no mês</span><span class="legend-item"><i class="legend-swatch" style="background:#df665f"></i>Negativados atualmente (SIM)</span></div></div>`;
}

$('adminMenuToggle').addEventListener('click', () => {
  const menu = $('adminMenu'); menu.hidden = !menu.hidden; $('adminMenuToggle').setAttribute('aria-expanded', String(!menu.hidden));
});
$('manageUsersBtn').addEventListener('click', async () => {
  $('adminMenu').hidden = true;
  try { profiles = await listProfiles(); renderProfiles(); $('usersOverlay').classList.add('open'); }
  catch (error) { showToast(`Não foi possível carregar usuários: ${error.message}`); }
});
function renderProfiles() {
  $('usersList').innerHTML = profiles.map((profile) => `<div class="user-row"><div><div class="user-email">${escapeHtml(profile.email || 'Conta sem e-mail')}</div><div class="user-created">Cadastro: ${escapeHtml(displayDate(String(profile.created_at || '').slice(0, 10)))}</div></div><select data-role="${escapeHtml(profile.id)}" aria-label="Permissão de ${escapeHtml(profile.email)}"><option value="pending" ${profile.role === 'pending' ? 'selected' : ''}>Pendente</option><option value="operator" ${profile.role === 'operator' ? 'selected' : ''}>Operador</option><option value="admin" ${profile.role === 'admin' ? 'selected' : ''}>Administrador</option></select></div>`).join('') || '<div class="empty">Nenhum usuário encontrado.</div>';
}
document.addEventListener('change', async (event) => {
  const roleSelect = event.target.closest('[data-role]');
  if (roleSelect) {
    try { const updated = await updateProfileRole(roleSelect.dataset.role, roleSelect.value); profiles = profiles.map((profile) => profile.id === updated.id ? { ...profile, role: updated.role } : profile); showToast('Permissão atualizada.'); }
    catch (error) { showToast(`Não foi possível alterar a permissão: ${error.message}`); renderProfiles(); }
    return;
  }
  const select = event.target.closest('[data-status]'); if (!select) return;
  const client = clients.find((item) => item.id === select.dataset.status); if (!client) return;
  if (select.value === 'REGULARIZADO') {
    pendingId = client.id; $('resolutionText').value = ''; $('resolveError').textContent = '';
    $('resolveSubtitle').textContent = `Informe a ação realizada para regularizar ${client.name}.`;
    $('resolveOverlay').classList.add('open'); $('resolutionText').focus(); return;
  }
  if (select.value === 'SIM' && !negativeDate(client)) {
    const today = isoToday();
    try { await updateClientRecord(client.id, { negativado_status: 'SIM', status: 'NEGATIVADO', negative_date: today, negativation_date: today, regularized_date: null, regularization_date: null, resolution: null }); await refreshClients(); showToast('Cliente marcado como negativado.'); }
    catch (error) { showToast(`Não foi possível atualizar: ${error.message}`); await refreshClients(); }
  } else {
    try {
      await updateClientRecord(client.id, { negativado_status: select.value, status: 'NEGATIVADO', resolution: null, regularized_date: null });
      await refreshClients(); if (selectedId === client.id) openDetails(client.id); showToast('Situação atualizada.');
    } catch (error) { showToast(`Não foi possível atualizar: ${error.message}`); await refreshClients(); }
  }
});

if (!isSupabaseConfigured) {
  setAuthView('login', 'Configure VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY para conectar este site.');
  for (const form of document.querySelectorAll('#authShell form')) form.querySelectorAll('input,button[type="submit"]').forEach((control) => { control.disabled = true; });
} else {
  document.querySelectorAll('[data-auth-view]').forEach((button) => button.addEventListener('click', () => {
    clearErrors(); $('signupForm').reset(); $('loginForm').reset(); $('recoveryForm').reset(); setAuthView(button.dataset.authView);
  }));
  $('loginForm').addEventListener('submit', async (event) => { event.preventDefault(); clearErrors(); const { error } = await supabase.auth.signInWithPassword({ email: $('loginEmail').value.trim(), password: $('loginPassword').value }); if (error) $('loginError').textContent = error.message; });
  $('signupForm').addEventListener('submit', async (event) => {
    event.preventDefault(); clearErrors(); const { data, error } = await supabase.auth.signUp({ email: $('signupEmail').value.trim(), password: $('signupPassword').value, options: { emailRedirectTo: `${window.location.origin}/` } });
    if (error) { $('signupError').textContent = error.message; return; } if (data.session) await showApp(data.session.user); else setAuthView('login', 'Cadastro iniciado. Confira seu e-mail para confirmar a conta e depois entre.');
  });
  $('recoveryForm').addEventListener('submit', async (event) => {
    event.preventDefault(); clearErrors(); const { error } = await supabase.auth.resetPasswordForEmail($('recoveryEmail').value.trim(), { redirectTo: `${window.location.origin}/?reset=1` });
    if (error) { $('recoveryError').textContent = error.message; return; } setAuthView('login', 'Se o e-mail estiver cadastrado, você receberá um link para redefinir a senha.');
  });
  $('newPasswordForm').addEventListener('submit', async (event) => {
    event.preventDefault(); clearErrors(); const { data, error } = await supabase.auth.updateUser({ password: $('newPassword').value });
    if (error) { $('newPasswordError').textContent = error.message; return; } await showApp(data.user); showToast('Senha atualizada.'); history.replaceState({}, '', window.location.pathname);
  });
  $('logoutButton').addEventListener('click', async () => { const { error } = await supabase.auth.signOut(); if (error) showToast(`Não foi possível sair: ${error.message}`); });
  supabase.auth.onAuthStateChange((event, session) => { window.setTimeout(() => { if (event === 'PASSWORD_RECOVERY') setAuthView('newPassword'); else void showApp(session?.user || null); }, 0); });
  supabase.auth.getSession().then(({ data, error }) => { if (error) { setAuthView('login', error.message); return; } if (new URLSearchParams(window.location.search).has('reset')) setAuthView('newPassword'); else void showApp(data.session?.user || null); });
}

document.addEventListener('click', (event) => {
  const close = event.target.closest('[data-close]'); if (close) { closeOverlay(close.dataset.close); if (close.dataset.close === 'resolveOverlay') renderClients(); return; }
  const open = event.target.closest('[data-open]'); if (open) openDetails(open.dataset.open);
});
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') { const resolving = $('resolveOverlay').classList.contains('open'); document.querySelectorAll('.overlay.open').forEach((overlay) => closeOverlay(overlay.id)); if (resolving) renderClients(); $('adminMenu').hidden = true; } });
document.querySelectorAll('.overlay').forEach((overlay) => overlay.addEventListener('click', (event) => { if (event.target === overlay) { closeOverlay(overlay.id); if (overlay.id === 'resolveOverlay') renderClients(); } }));

$('addBtn').addEventListener('click', () => { $('clientForm').reset(); $('formError').textContent = ''; $('routerSelectWrap').hidden = true; $('routerModel').required = false; $('formOverlay').classList.add('open'); $('clientName').focus(); });
$('routerEnabled').addEventListener('change', () => { const enabled = $('routerEnabled').checked; $('routerSelectWrap').hidden = !enabled; $('routerModel').required = enabled; if (!enabled) $('routerModel').value = ''; });
$('clientForm').addEventListener('submit', async (event) => {
  event.preventDefault(); $('formError').textContent = ''; if (!$('clientForm').reportValidity()) return;
  try { await createClientRecord({ name: $('clientName').value, contract: $('contract').value, street: $('street').value, neighborhood: $('neighborhood').value, city: $('city').value, onu: $('onu').value, router: $('routerEnabled').checked ? $('routerModel').value : '' }, sessionUser.id); closeOverlay('formOverlay'); await refreshClients(); showToast('Cliente cadastrado como negativado.'); }
  catch (error) { $('formError').textContent = error.message; }
});
$('resolveSave').addEventListener('click', async () => {
  const resolution = $('resolutionText').value.trim(); if (!resolution) { $('resolveError').textContent = 'Descreva o que foi feito antes de confirmar.'; $('resolutionText').focus(); return; }
  const client = clients.find((item) => item.id === pendingId); if (!client) return;
  try {
    const today = isoToday(); await updateClientRecord(client.id, { status: 'REGULARIZADO', negativado_status: 'REGULARIZADO', resolution, regularized_date: today, regularization_date: today });
    closeOverlay('resolveOverlay'); pendingId = null; await refreshClients(); if (selectedId === client.id) openDetails(client.id); showToast('Cliente movido para regularizados.');
  } catch (error) { $('resolveError').textContent = `Não foi possível salvar: ${error.message}`; }
});
$('searchNeg').addEventListener('input', renderClients); $('searchReg').addEventListener('input', renderClients);
$('deleteBtn').addEventListener('click', async () => {
  const client = clients.find((item) => item.id === selectedId); if (!client || role !== 'admin') return;
  if (!window.confirm(`Excluir o cadastro de ${client.name}? Esta ação não pode ser desfeita.`)) return;
  try { await deleteClientRecord(client.id); closeOverlay('detailOverlay'); await refreshClients(); showToast('Cadastro excluído.'); } catch (error) { showToast(`Não foi possível excluir: ${error.message}`); }
});
$('exportCloudBtn').addEventListener('click', async () => {
  try { const rows = await listClients(); fileDownload(`backup-clientes-fibracenter-${isoToday()}.json`, { exportedAt: new Date().toISOString(), records: rows }); showToast('Backup baixado.'); }
  catch (error) { showToast(`Não foi possível exportar: ${error.message}`); }
});
$('importFile').addEventListener('change', async (event) => {
  const file = event.target.files?.[0]; if (!file) return;
  try { const payload = JSON.parse(await file.text()); const records = Array.isArray(payload) ? payload : payload.records; if (!Array.isArray(records)) throw new Error('O JSON não contém a lista records.'); const count = await importBackup(records, sessionUser.id); await refreshClients(); showToast(`${count} registro(s) importado(s) ou atualizados.`); }
  catch (error) { showToast(`Falha na importação: ${error.message}`); } finally { event.target.value = ''; }
});
$('csvImportFile').addEventListener('change', async (event) => {
  const file = event.target.files?.[0]; if (!file) return;
  if (!window.confirm(`Importar os registros do arquivo “${file.name}”? Linhas sem nome, contrato e endereço completo serão ignoradas.`)) { event.target.value = ''; return; }
  try { const records = parseCsv(await file.text()); const result = await importCsv(records, sessionUser.id); await refreshClients(); showToast(`${result.imported} importados/atualizados; ${result.skipped} linha(s) incompleta(s) ignorada(s).`); }
  catch (error) { showToast(`Falha na importação CSV: ${error.message}`); } finally { event.target.value = ''; }
});
