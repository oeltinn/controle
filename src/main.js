import { printReport } from './print-report.js';
import { renderWithdrawalOverview, renderWithdrawalReport } from './withdrawal-report.js';
import { supabase, isSupabaseConfigured, setRememberSession } from './supabase.js';
import { renderRecoveryReport } from './recovery-report.js';
import { initializeClientPhone, readClientPhone } from './client-phone.js';
import { disablePush, enablePush, getInbox, getPushSubscription, markNotificationRead, sendNotification, syncExistingPushSubscription, watchInbox } from './notifications.js';
import { listWithdrawalEquipmentModels, normalizeWithdrawalCity } from './data.js';
import { createClientRecord, createWithdrawal, deleteClientRecord, deleteWithdrawal, deleteWithdrawalImport, findClientCatalogContract, getClientCatalogState, replaceClientCatalog, parseSgpClientWorkbook, findContractEquipment, getMyProfile, importContractEquipment, importCsv, importWithdrawalsCsv, listClients, listProfiles, listWithdrawalImports, listWithdrawalVisits, listWithdrawals, parseCsv, recordWithdrawalVisit, updateClientRecord, updateMyProfile, updateProfileRole, updateWithdrawal } from './data.js';

// SVG geometry keeps the close mark centered across fonts, browsers and themes.
for (const button of document.querySelectorAll('button.x')) {
  button.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round"><path d="M5 5l14 14M19 5 5 19"/></svg>';
}

const $ = (id) => document.getElementById(id);
const catalogAgeNotice = document.createElement('p');
catalogAgeNotice.id = 'catalogAgeNotice'; catalogAgeNotice.hidden = true;
document.querySelector('.heading').after(catalogAgeNotice);
$('openCatalog').textContent = 'Importar catálogo';
let clients = [];
let sessionUser = null;
let role = 'pending';
let selectedId = null;
let pendingId = null;
let profiles = [];
let withdrawals = [];
let withdrawalVisits = [];
let myProfile = null;
let selectedWithdrawalId = null;
let withdrawalVisitResult = null;
const canManageWithdrawals = () => ['admin','operator'].includes(role);
const withdrawalVisible = item => item.equipment !== 'A identificar' || item.include_without_equipment;
const withdrawalLabels = {collected:'Equipamento recolhido',equipment_not_found:'Equipamento não encontrado',no_answer:'Não encontrou ninguém',visited:'Visita realizada',pending:'Sem visita'};
let appLoading = false;
let currentView = 'monthly';
let withdrawalTab = 'list';
let recoveryMode = false;
let authRevision = 0;
let inbox = [];
let stopInboxWatch = null;
let clientCatalogState = null;
const catalogExpired = () => clientCatalogState && Date.now()-new Date(clientCatalogState.imported_at).getTime() >= 21*86400000;
async function refreshClientCatalogState() {
  clientCatalogState = await getClientCatalogState();
  const notice = $('catalogAgeNotice');
  const age = clientCatalogState ? (Date.now()-new Date(clientCatalogState.imported_at).getTime())/86400000 : 0;
  notice.hidden = currentView !== 'withdrawals' || role !== 'admin' || !clientCatalogState || age < 7;
  notice.className = `catalog-age-notice ${age >= 21 ? 'red' : 'yellow'}`;
  if (!notice.hidden) notice.textContent = age >= 21
    ? `O catálogo de clientes importado em ${displayDate(clientCatalogState.imported_at.slice(0,10))} está desatualizado. Importe uma nova planilha. Cadastros manuais estão bloqueados para todos.`
    : `O catálogo de clientes importado em ${displayDate(clientCatalogState.imported_at.slice(0,10))} pode estar desatualizado. Programe uma nova importação.`;
  $('addBtn').disabled = Boolean(catalogExpired());
  $('addWithdrawalBtn').disabled = Boolean(catalogExpired());
}
let authNotice = '';

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}
function showToast(message) {
  $('toast').textContent = message;
  $('toast').classList.add('show');
  window.setTimeout(() => $('toast').classList.remove('show'), 3200);
}
function showWelcome(user) {
  const sessionKey = `kontroll-welcome:${user.id}`;
  if (sessionStorage.getItem(sessionKey)) return;
  const hasVisited = localStorage.getItem(sessionKey) === '1';
  const name = myProfile?.display_name || 'usuário';
  showToast(`${hasVisited ? 'Bem-vindo de volta' : 'Bem-vindo'}, ${name}!`);
  sessionStorage.setItem(sessionKey, '1');
  localStorage.setItem(sessionKey, '1');
}
function setAuthView(view, message = '') {
  document.body.dataset.auth = 'true';
  $('authShell').hidden = false; $('appShell').hidden = true;
  $('logoutButton').hidden = true; $('adminMenuWrap').hidden = true;
  $('notificationBell').hidden = true;
 
  for (const id of ['loginForm', 'signupForm', 'recoveryForm', 'newPasswordForm']) $(id).hidden = id !== `${view}Form`;
  const titles = { login: ['Entrar', ''], signup: ['Criar usuário', 'Novos usuários recebem acesso pendente.'], recovery: ['Recuperar senha', 'Enviaremos um link para o e-mail cadastrado.'], newPassword: ['Criar nova senha', 'Escolha uma nova senha para sua conta.'] };
  const [heading, subtitle] = titles[view] || titles.login;
  $('authHeading').textContent = heading; $('authSubtitle').textContent = subtitle; $('authMessage').textContent = message;
}
async function showApp(user) {
  if (user) authNotice = '';
  if (user?.id === sessionUser?.id && (appLoading || !$('appShell').hidden)) { sessionUser = user; return; }
  if (!user) {
    authRevision++;
    stopInboxWatch?.(); stopInboxWatch = null; inbox = []; $('notificationBell').hidden = true;
    if (sessionUser) sessionStorage.removeItem(`kontroll-welcome:${sessionUser.id}`);
    appLoading = false; document.querySelectorAll('.overlay.open').forEach((el) => closeOverlay(el.id));
    sessionUser = null; document.querySelector('.header-nav').hidden = true; $('appShell').hidden = true; $('authShell').hidden = false;
    $('logoutButton').hidden = true; $('adminMenuWrap').hidden = true; setAuthView('login'); return;
  }
  const revision = ++authRevision;
  appLoading = true; document.body.dataset.auth = 'false';
  sessionUser = user; $('authShell').hidden = true; $('appShell').hidden = true;
  $('logoutButton').hidden = false; role = 'pending';
  try {
    const profile = await getMyProfile(user.id);
    if (revision !== authRevision) return;
    myProfile = profile; role = myProfile?.role || 'pending';
  } catch (error) { showToast(`Não foi possível consultar o perfil: ${error.message}`); }
  if (revision !== authRevision) return;
  appLoading = false; document.body.dataset.userRole = role;
  $('mobileProfileName').textContent = myProfile?.display_name || 'Minha conta';
  $('adminMenuWrap').hidden = false; $('manageUsersBtn').hidden = role !== 'admin';
  $('composeNotification').hidden = role !== 'admin';
  if (!['admin', 'operator', 'technician', 'attendant'].includes(role)) {
    document.querySelectorAll('[data-view]').forEach((button) => { button.hidden = true; });
    $('appShell').hidden = true; $('authShell').hidden = false;
    for (const id of ['loginForm', 'signupForm', 'recoveryForm', 'newPasswordForm']) $(id).hidden = true;
    $('authHeading').textContent = 'Acesso pendente'; $('authSubtitle').textContent = 'Seu cadastro ainda não foi autorizado.';
    document.querySelector('.header-nav').hidden = true; $('authMessage').textContent = 'Peça a um administrador do kontroll. para liberar seu acesso.';
    return;
  }
  document.querySelector('.header-nav').hidden = false; $('deleteBtn').hidden = role !== 'admin'; $('adminMenuWrap').hidden = false;
  document.querySelectorAll('[data-view]').forEach((button) => {
    const view = button.dataset.view;
    button.hidden = (view === 'monthly' && ['technician', 'attendant'].includes(role))
      || (view === 'clients' && role === 'technician')
      || (view === 'reports' && ['technician', 'attendant'].includes(role));
  });
  $('clientTools').hidden = role === 'technician';
  $('authShell').hidden = true; $('appShell').hidden = false;
  $('notificationBell').hidden = false;
  void refreshClientCatalogState().catch(() => {});
  stopInboxWatch?.();
  stopInboxWatch = watchInbox(user.id, rows => { if (sessionUser?.id === user.id) { inbox = rows; renderNotificationInbox(); } });
  void syncExistingPushSubscription().then(updatePushSetting).catch(() => updatePushSetting(false));
  if ('Notification' in window && 'PushManager' in window && localStorage.getItem('kontroll-push-choice') !== 'off') {
    if (Notification.permission === 'granted') void enablePush().then(() => updatePushSetting(true)).catch(() => {});
    else if (Notification.permission === 'default' && !sessionStorage.getItem('kontroll-push-prompt')) $('pushPermissionOverlay').classList.add('open');
  }
  setView(sessionStorage.getItem(`kontroll-view:${user.id}`) || 'monthly');
  await refreshClients();
  showWelcome(user);
}
async function refreshClients() {
  if (!sessionUser) return;
  if (role === 'technician') {
    try { clients = []; [withdrawals, withdrawalVisits] = await Promise.all([listWithdrawals(), listWithdrawalVisits()]); renderWithdrawals(); renderNoAnswerVisits(); }
    catch (error) { showToast(`Não foi possível carregar as retiradas: ${error.message}`); }
    return;
  }
  try { clients = await listClients(); renderClients(); renderMonthly(); renderReports(); [withdrawals, withdrawalVisits] = await Promise.all([listWithdrawals(), listWithdrawalVisits()]); renderWithdrawals(); renderNoAnswerVisits(); }
  catch (error) { showToast(`Não foi possível carregar os dados: ${error.message}`); }
}
function currentStatus(client) {
  return client.negativado_status || (client.status === 'REGULARIZADO' ? 'REGULARIZADO' : 'SIM');
}
function renderClients() {
  const active = clients.filter((client) => !['REGULARIZADO', 'EM CONTATO'].includes(currentStatus(client))).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  const regularized = clients.filter((client) => currentStatus(client) === 'REGULARIZADO').sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  const contacting = clients.filter((client) => currentStatus(client) === 'EM CONTATO').sort((a,b) => a.name.localeCompare(b.name,'pt-BR'));
  $('countContact').textContent = contacting.length;
  drawList('listContact', contacting, $('searchContact').value);
  $('summaryNeg').textContent = clients.filter((client) => currentStatus(client) === 'SIM').length;
  $('summaryReg').textContent = regularized.length;
  $('countNeg').textContent = active.length; $('countReg').textContent = regularized.length;
  $('summaryClients').textContent = clients.length;
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
function recordOrigin(record) {
  if (record.import_id || record.legacy_id?.startsWith('csv-') || (record.source_data && Object.keys(record.source_data).length)) return 'Importado de planilha';
  const name = record.created_by_name || (record.created_by === sessionUser?.id ? myProfile?.display_name : null);
  return name ? 'Adicionado por ' + name : 'Autor não informado';
}
function openDetails(id) {
  const client = clients.find((item) => item.id === id); if (!client) return; selectedId = id;
  const state = currentStatus(client); $('detailName').textContent = client.name; $('detailContract').textContent = `Contrato ${client.contract}`;
  const equipment = client.onu || client.router ? [['ONU', client.onu || 'Não informado'], ['Roteador em comodato', client.router || 'Não informado']] : [['Equipamento', client.equipment || 'Não informado']];
  const fields = [
    ['Origem', escapeHtml(recordOrigin(client))],
    ['Situação', `<span class="status-banner ${state === 'REGULARIZADO' ? 'green' : ''}">${escapeHtml(state)}</span>`],
    ['Data da negativação', escapeHtml(displayDate(negativeDate(client)))],
    ['Telefone', /^\+[1-9]\d{1,14}$/.test(client.phone ?? '') ? `<a href="tel:${client.phone}">${escapeHtml(client.phone)}</a>` : 'Não informado'],
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
function clearErrors() { for (const id of ['loginError', 'signupError', 'recoveryError', 'newPasswordError', 'formError', 'resolveError']) $(id).textContent = ''; }

function setTheme(theme) {
  document.body.dataset.theme = theme; localStorage.setItem('fibra_theme', theme);
  $('mobileThemeToggle').textContent = theme === 'dark' ? '☀ Modo claro' : '☾ Modo noturno';

}
setTheme(localStorage.getItem('fibra_theme') || 'light');

function setView(view) {
  const allowed = role === 'technician' ? ['withdrawals'] : role === 'attendant' ? ['clients','withdrawals'] : ['monthly','clients','reports','withdrawals'];
  if (!allowed.includes(view)) view = allowed[0];
  currentView = view;
  if (sessionUser) sessionStorage.setItem(`kontroll-view:${sessionUser.id}`, view);
  for (const key of ['monthly','clients','reports','withdrawals']) $(`${key}View`).hidden = key !== view;
  document.querySelectorAll('[data-view]').forEach((button) => {
    button.hidden = !allowed.includes(button.dataset.view);
    const active = button.dataset.view === view || (button.dataset.view === 'clients' && view === 'reports' && !button.closest('#negSubnav'));
    button.classList.toggle('active',active);
    if (active) button.setAttribute('aria-current','page'); else button.removeAttribute('aria-current');
  });
  $('negSubnav').hidden = !['clients','reports'].includes(view);
  const heading = { monthly:['Visão geral','Resultados da operação em um só lugar.'], clients:['Negativações','Pesquise cadastros e acompanhe cada situação.'], reports:['Negativações','Relatórios e indicadores dos clientes.'], withdrawals:['Retirada de ONU','Organize os contatos e as visitas dos técnicos.'] }[view];
  $('pageTitle').textContent=heading[0]; $('pageSubtitle').textContent=heading[1];
  $('clientTools').hidden = view !== 'clients';
  renderWithdrawalTab();
  document.querySelector('label[for=withdrawalCsvFile]').hidden = !['admin','operator'].includes(role);
  $('openCatalog').hidden = role !== 'admin';
  $('catalogAgeNotice').hidden = view !== 'withdrawals' || role !== 'admin' || !clientCatalogState || (Date.now()-new Date(clientCatalogState.imported_at).getTime()) < 7*86400000;
  $('openImports').hidden = !canManageWithdrawals();
  document.querySelector('label[for=csvImportFile]').hidden = !['admin','operator'].includes(role);
  closeMenu();
  if (view === 'monthly') renderMonthly();
  if (view === 'withdrawals' && sessionUser) void refreshWithdrawals();
}
function closeMenu() { $('adminMenu').hidden=true; $('adminMenuToggle').setAttribute('aria-expanded','false'); }

$('rememberSession').checked = localStorage.getItem('kontroll-remember') !== '0';
$('pushLater').addEventListener('click', () => { sessionStorage.setItem('kontroll-push-prompt','1'); closeOverlay('pushPermissionOverlay'); });
$('pushAllow').addEventListener('click', async () => {
  $('pushAllow').disabled = true;
  try { await enablePush(); localStorage.setItem('kontroll-push-choice','on'); updatePushSetting(true); closeOverlay('pushPermissionOverlay'); }
  catch (error) { $('pushPermissionError').textContent = error.message; }
  finally { $('pushAllow').disabled = false; }
});
function updatePushSetting(enabled) {
  $('notificationSettings').setAttribute('aria-checked', String(enabled));
}
function renderNotificationInbox() {
  const unread = inbox.filter(item => !item.read_at).length;
  $('notificationBadge').hidden = unread === 0;
  $('notificationBadge').textContent = unread > 99 ? '99+' : String(unread);
  $('notificationBell').setAttribute('aria-label', unread ? `Notificações, ${unread} não lidas` : 'Notificações');
  $('notificationList').innerHTML = inbox.length ? inbox.map(item => {
    const message = item.app_notifications || {};
    const date = message.created_at ? new Date(message.created_at).toLocaleString('pt-BR', { dateStyle:'short', timeStyle:'short' }) : '';
    return `<article class="notification-item ${item.read_at ? '' : 'unread'}"><div class="notification-item-head"><strong>${escapeHtml(message.title || 'Notificação')}</strong><time>${escapeHtml(date)}</time></div><p>${escapeHtml(message.body || '')}</p>${item.read_at ? '' : `<button type="button" data-notification-read="${escapeHtml(item.notification_id)}">Marcar como lida</button>`}</article>`;
  }).join('') : '<div class="empty">Nenhuma notificação por enquanto.</div>';
}
$('notificationBell').addEventListener('click', async () => {
  $('notificationsOverlay').classList.add('open');
  void getPushSubscription().then(subscription => updatePushSetting(Boolean(subscription))).catch(() => {});
  try { inbox = await getInbox(sessionUser.id); renderNotificationInbox(); }
  catch (error) { showToast(`Não foi possível carregar notificações: ${error.message}`); }
});
$('notificationList').addEventListener('click', async event => {
  const button = event.target.closest('[data-notification-read]'); if (!button) return;
  try { await markNotificationRead(button.dataset.notificationRead); inbox = await getInbox(sessionUser.id); renderNotificationInbox(); }
  catch (error) { showToast(`Não foi possível marcar como lida: ${error.message}`); }
});
$('notificationSettings').addEventListener('click', async () => {
  const toggle = $('notificationSettings');
  toggle.disabled = true;
  try {
    const existing = await getPushSubscription();
    if (existing) { await disablePush(); localStorage.setItem('kontroll-push-choice','off'); updatePushSetting(false); showToast('Notificações desativadas neste dispositivo.'); }
    else { await enablePush(); localStorage.setItem('kontroll-push-choice','on'); updatePushSetting(true); showToast('Notificações ativadas neste dispositivo.'); }
  } catch (error) { showToast(error.message); }
  finally { toggle.disabled = false; }
});
$('composeNotification').addEventListener('click', async () => {
  if (role !== 'admin') return;
  closeOverlay('notificationsOverlay'); $('notificationForm').reset(); $('notificationError').textContent = '';
  $('notificationTargetType').dispatchEvent(new Event('change'));
  $('composeNotificationOverlay').classList.add('open');
  try {
    const users = await listProfiles();
    $('notificationTargetUser').innerHTML = users.filter(user => user.role !== 'pending')
      .sort((a,b) => (a.display_name || '').localeCompare(b.display_name || '', 'pt-BR'))
      .map(user => `<option value="${escapeHtml(user.id)}">${escapeHtml(user.display_name || user.email)}</option>`).join('');
  } catch (error) { $('notificationError').textContent = `Não foi possível carregar usuários: ${error.message}`; }
});
$('notificationTargetType').addEventListener('change', () => {
  const direct = $('notificationTargetType').value === 'user';
  $('notificationRoleWrap').hidden = direct; $('notificationTargetRole').disabled = direct;
  $('notificationUserWrap').hidden = !direct; $('notificationTargetUser').disabled = !direct;
});
$('notificationForm').addEventListener('submit', async event => {
  event.preventDefault(); if (role !== 'admin') return;
  $('notificationError').textContent = '';
  const direct = $('notificationTargetType').value === 'user';
  if (direct && !$('notificationTargetUser').value) { $('notificationError').textContent = 'Escolha um usuário.'; return; }
  const button = $('sendNotification'); button.disabled = true;
  try {
    const result = await sendNotification({
      title: $('notificationTitle').value.trim(), body: $('notificationBody').value.trim(),
      targetRole: direct ? null : $('notificationTargetRole').value,
      targetUser: direct ? $('notificationTargetUser').value : null,
    });
    closeOverlay('composeNotificationOverlay');
    showToast(`Mensagem enviada a ${result.recipients} usuário(s); ${result.delivered} navegador(es) e ${result.androidDelivered || 0} Android avisado(s).`);
    if (result.androidError) showToast(`Não foi possível avisar aparelhos Android: ${result.androidError}`);
    inbox = await getInbox(sessionUser.id); renderNotificationInbox();
  } catch (error) {
    if (error.code === 'SESSION_EXPIRED') {
      authNotice = error.message;
      await supabase.auth.signOut({ scope: 'local' });
      await showApp(null);
      setAuthView('login', authNotice);
    } else $('notificationError').textContent = error.message;
  }
  finally { button.disabled = false; }
});
if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', event => {
  if (event.data?.type === 'open-notifications' && sessionUser) $('notificationBell').click();
});

document.querySelectorAll('[data-view]').forEach((button) => button.addEventListener('click', () => setView(button.dataset.view)));

function renderWithdrawalTab() {
  const active = currentView === 'withdrawals';
  if (role !== 'admin') withdrawalTab = 'list';
  const report = withdrawalTab === 'report';
  $('withdrawalSubnav').hidden = !active || role !== 'admin';
  $('withdrawalListPane').hidden = report;
  $('withdrawalReportPane').hidden = !report;
  $('withdrawalTools').hidden = !active || report || role === 'technician';
  for (const button of $('withdrawalSubnav').querySelectorAll('button')) {
    const selected = button.dataset.withdrawalTab === withdrawalTab;
    button.classList.toggle('active', selected);
    if (selected) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  }
  if (active && report) drawWithdrawalReport();
}
function drawWithdrawalReport() {
  const from = $('withdrawalFrom').value;
  const to = $('withdrawalTo').value;
  const cityFilter = $('withdrawalReportCity');
  const cityById = new Map(withdrawals.map(item=>[item.id, normalizeWithdrawalCity(item.city)]));
  const cities = [...new Set(cityById.values())].filter(Boolean).sort((a,b)=>a.localeCompare(b,'pt-BR'));
  const selectedCity = cityFilter.value;
  cityFilter.replaceChildren(new Option('Todas', ''), ...cities.map(city=>new Option(city, city)));
  if (cities.includes(selectedCity)) cityFilter.value = selectedCity;
  const city = cityFilter.value;
  const visits = city ? withdrawalVisits.filter(visit=>cityById.get(visit.withdrawal_id) === city) : withdrawalVisits;
  $('printWithdrawalReport').disabled = Boolean(from && to && from > to);
  renderWithdrawalReport($('withdrawalReport'), visits, from, to, city);
}
$('withdrawalSubnav').addEventListener('click', event => {
  const button = event.target.closest('[data-withdrawal-tab]');
  if (!button || role !== 'admin') return;
  withdrawalTab = button.dataset.withdrawalTab;
  renderWithdrawalTab();
});
for (const id of ['withdrawalFrom','withdrawalTo','withdrawalReportCity']) $(id).addEventListener('change', drawWithdrawalReport);
$('printWithdrawalReport').addEventListener('click', () => {
  if (role === 'admin' && currentView === 'withdrawals' && withdrawalTab === 'report') printReport('Relatório de retirada de ONU', [$('withdrawalReport').cloneNode(true)]);
});

function latestVisit(withdrawalId) { return withdrawalVisits.find((visit) => visit.withdrawal_id === withdrawalId) || null; }
function renderWithdrawals() {
  const list = $('withdrawalList');
  const term = $('withdrawalSearch').value.trim().toLocaleLowerCase('pt-BR');
  const open = new Set([...list.querySelectorAll('details[open]')].map(el=>el.dataset.group));
  const latest = new Map();
  for (const visit of withdrawalVisits) if (!latest.has(visit.withdrawal_id)) latest.set(visit.withdrawal_id, visit);
  const visible = withdrawals.filter(withdrawalVisible);
  $('withdrawalCount').textContent = visible.length;
  $('summaryWithdrawals').textContent = visible.filter(item => !latest.has(item.id) || latest.get(item.id).result === 'pending').length;
  $('withdrawalVisitsCount').textContent = withdrawalVisits.length;
  const groups = [new Map(),new Map()];
  for (const item of visible) {
    const city = normalizeWithdrawalCity(item.city) || 'Cidade não informada';
    if (![item.name,item.contract_id,item.address,item.equipment,city,item.city,item.district].join(' ').toLocaleLowerCase('pt-BR').includes(term)) continue;
    const visit = latest.get(item.id);
    const cities = groups[visit && visit.result !== 'pending' ? 1 : 0];
    const cityKey = city.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleUpperCase('pt-BR');
    if (!cities.has(cityKey)) cities.set(cityKey,{label:city,items:[]});
    cities.get(cityKey).items.push({item,visit});
  }
  const sorted = map => [...map].sort((a,b)=>a[1].label.localeCompare(b[1].label,'pt-BR'));
  const card = ({item,visit}) => {
    const status = visit?.result || 'pending';
    const tag = status==='collected'?'collected':status==='pending'?'pending':'missed';
    const author = visit && status!=='pending' ? `<span class="withdrawal-person">${escapeHtml(visit.technician_name)}</span>` : '';
    const remove = canManageWithdrawals() ? `<button type="button" class="withdrawal-delete" data-delete-withdrawal="${escapeHtml(item.id)}" aria-label="Excluir ${escapeHtml(item.name)}" title="Excluir cliente">×</button>` : '';
    return `<div class="withdrawal-card-row"><button class="withdrawal-card" data-withdrawal="${escapeHtml(item.id)}"><span class="withdrawal-name">${escapeHtml(item.name)}</span><span class="withdrawal-address">${escapeHtml(item.address)}</span><span class="withdrawal-meta">${escapeHtml(item.equipment)}<i class="visit-tag ${tag}">${withdrawalLabels[status]}</i>${author}</span></button>${remove}</div>`;
  };
  list.innerHTML = groups.map((cities,index) => {
    if (!cities.size) return '';
    const heading = index ? 'Com visita registrada' : 'Aguardando visita';
    const sections = sorted(cities).map(([city,group]) => {
      const key = JSON.stringify([index,city]);
      return `<details class="withdrawal-city" data-group="${escapeHtml(key)}" ${term || open.has(key) ? 'open' : ''}>
        <summary>${escapeHtml(group.label)} (${group.items.length})</summary>
        <div class="withdrawal-grid">${group.items.map(card).join('')}</div>
      </details>`;
    }).join('');
    return `<h2 class="section-heading">${heading}</h2>${sections}`;
  }).join('') || '<p class="empty">Nenhuma retirada encontrada.</p>';
}

function renderNoAnswerVisits() {
  const latest = withdrawals.map((item) => latestVisit(item.id)).filter(Boolean);
  const collected = latest.filter((visit) => visit.result === 'collected');
  $('summaryCollected').textContent = collected.length;
  if (['admin','operator'].includes(role)) renderWithdrawalOverview($('withdrawalOverview'), withdrawalVisits);
  if (role === 'admin' && withdrawalTab === 'report') drawWithdrawalReport();
  const missed = withdrawalVisits.filter((visit) => visit.result === 'no_answer');
  $('noAnswerCount').textContent = missed.length;
  $('noAnswerList').innerHTML = missed.length ? missed.map((visit) => {
    const client = withdrawals.find((item) => item.id === visit.withdrawal_id);
    return `<article class="incident-card"><div class="incident-title">${escapeHtml(client?.name || 'Cliente')} <span>${escapeHtml(displayDate(String(visit.created_at).slice(0,10)))}</span></div><div class="incident-copy"><strong>${escapeHtml(visit.technician_name)}</strong> foi até o endereço, mas não encontrou ninguém.</div><div class="incident-note">${escapeHtml(visit.observation)}</div></article>`;
  }).join('') : '<div class="empty">Nenhum registro de visita sem contato.</div>';
}
async function refreshWithdrawals() {
  if (!sessionUser || !['admin','operator','technician','attendant'].includes(role)) return;
  try { [withdrawals, withdrawalVisits] = await Promise.all([listWithdrawals(), listWithdrawalVisits()]); renderWithdrawals(); renderNoAnswerVisits(); }
  catch (error) { showToast(`Não foi possível carregar as retiradas: ${error.message}`); }
}
function openWithdrawalDetails(id) {
  const item = withdrawals.find((entry) => entry.id === id); if (!item) return;
  selectedWithdrawalId = id;
  const visit = latestVisit(id);
  $('withdrawalDetailName').textContent = item.name;
  $('withdrawalDetailFields').innerHTML = [
    ['Origem', recordOrigin(item)],
    ['Contrato SGP', item.contract_id || 'Não informado'], ['Telefone', item.phone || 'Não informado'], ['Endereço', item.address], ['Equipamento para recolher', item.equipment],
    ['Situação', withdrawalLabels[visit?.result || 'pending']],
    ...(visit ? [['Último registro', `${visit.technician_name} · ${displayDate(String(visit.created_at).slice(0,10))}`], ['Observação', visit.observation || '—']] : []),
  ].map(([label, value]) => `<div class="field"><div class="label">${escapeHtml(label)}</div><div class="value">${escapeHtml(value)}</div></div>`).join('');
  const actions = $('withdrawalVisitActions');
  actions.hidden = role === 'attendant' || !withdrawalVisible(item);
  for (const button of actions.querySelectorAll('[data-visit-result]')) {
    button.hidden = button.dataset.visitResult === visit?.result;
  }
  const earlier = withdrawalVisits.filter(entry=>entry.withdrawal_id === id && entry !== visit && entry.result !== 'pending');
  $('withdrawalHistory').innerHTML = earlier.length ? '<details><summary>Visitas anteriores</summary><ul>' + earlier.map(entry=>`<li><strong>${escapeHtml(entry.technician_name)} · ${escapeHtml(withdrawalLabels[entry.result])}</strong> · ${escapeHtml(displayDate(String(entry.created_at).slice(0,10)))}<p>${escapeHtml(entry.observation)}</p></li>`).join('')+'</ul></details>' : '';
  $('deleteWithdrawal').hidden = !canManageWithdrawals();
  $('withdrawalDetailOverlay').classList.add('open');
}
function canRecordResult(result) {
  return ['admin','operator','technician'].includes(role)
    && ['collected','equipment_not_found'].includes(result)
    && latestVisit(selectedWithdrawalId)?.result !== result;
}
function openVisitForm(result) {
  if (!canRecordResult(result)) return;
  withdrawalVisitResult = result;
  $('visitTitle').textContent = withdrawalLabels[result];
  $('visitObservation').value = '';
  $('visitObservation').required = true;
  $('visitObservationLabel').textContent = 'O que aconteceu? *';
  $('visitObservation').placeholder = 'Descreva brevemente o resultado da visita.';
  $('visitError').textContent = '';
  $('visitOverlay').classList.add('open');
}

function monthKey(value) { return value ? String(value).slice(0, 7) : ''; }
function monthLabel(key) { if (!key) return 'Sem data'; const [year, month] = key.split('-'); return new Date(Number(year), Number(month) - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }); }
function renderMonthly() {
  const counts = new Map();
  for (const client of clients) {
    for (const [value, type] of [[negativeDate(client),'negative'],[regularDate(client),'regular']]) {
      const month = monthKey(value); if (!/^\d{4}-\d{2}$/.test(month)) continue;
      const item = counts.get(month) || {negative:0,regular:0}; item[type]++; counts.set(month,item);
    }
  }
  const keys = [...counts.keys()].sort();
  if (!keys.length) { $('monthlyCards').innerHTML='<div class="empty">Ainda não há datas registradas para mostrar a evolução.</div>'; return; }
  const months = [];
  let [year,month] = keys[0].split('-').map(Number);
  const last = keys.at(-1);
  while (true) {
    const key = `${year}-${String(month).padStart(2,'0')}`;
    if (key > last) break; months.push(key);
    month++; if (month > 12) { month=1; year++; }
  }
  const width = Math.max(320,$('monthlyCards').clientWidth-40,months.length*75), height=280, left=42, top=25, plotH=190;
  const max=Math.ceil(Math.max(1,...[...counts.values()].flatMap(item=>[item.negative,item.regular]))/4)*4;
  const x=(i)=>left+(months.length===1 ? (width-left-25)/2 : i*(width-left-25)/(months.length-1));
  const y=(n)=>top+plotH-(n/max)*plotH;
  const grid=[0,.25,.5,.75,1].map(f=>`<line x1="${left}" y1="${y(max*f)}" x2="${width-12}" y2="${y(max*f)}" stroke="var(--line)"/><text x="30" y="${y(max*f)+4}" text-anchor="end" fill="var(--muted)" font-size="11">${Math.round(max*f)}</text>`).join('');
  const lines=[['negative','#df665f','Negativações'],['regular','#138777','Regularizações']].map(([type,color,label])=>{
    const points=months.map((key,i)=>`${x(i)},${y(counts.get(key)?.[type]||0)}`).join(' ');
    return `<polyline points="${points}" fill="none" stroke="${color}" stroke-width="3" stroke-linejoin="round"/>${months.map((key,i)=>`<circle cx="${x(i)}" cy="${y(counts.get(key)?.[type]||0)}" r="4" fill="${color}"><title>${monthLabel(key)} — ${label}: ${counts.get(key)?.[type]||0}</title></circle>`).join('')}`;
  }).join('');
  const labels=months.map((key,i)=>`<text x="${x(i)}" y="245" text-anchor="middle" fill="var(--muted)" font-size="11">${key.slice(5)}/${key.slice(2,4)}</text>`).join('');
  $('monthlyCards').innerHTML=`<div class="trend-scroll" tabindex="0" role="region" aria-label="Gráfico mensal de negativações e regularizações"><svg style="width:100%;min-width:${width}px" viewBox="0 0 ${width} ${height}" role="img" aria-label="Evolução mensal de negativações e regularizações. Valores disponíveis na tabela abaixo.">${grid}${lines}${labels}</svg></div><div class="chart-legend"><span class="legend-item"><i class="legend-swatch" style="background:#df665f"></i>Negativações</span><span class="legend-item"><i class="legend-swatch" style="background:#138777"></i>Regularizações</span></div><details><summary class="panel-head">Ver totais por mês</summary><div class="table-scroll"><table class="overview-table"><thead><tr><th scope="col">Mês</th><th scope="col">Negativações</th><th scope="col">Regularizações</th></tr></thead><tbody>${months.map(key=>`<tr><th scope="row">${monthLabel(key)}</th><td>${counts.get(key)?.negative||0}</td><td>${counts.get(key)?.regular||0}</td></tr>`).join('')}</tbody></table></div></details>`;
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
  if (['admin','operator'].includes(role)) renderRecoveryReport(clients);
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
$('mobileThemeToggle').addEventListener('click', () => setTheme(document.body.dataset.theme === 'dark' ? 'light' : 'dark'));
function negativeReportSection() {
  const section = $('reportsView').cloneNode(true);
  section.hidden = false;
  section.classList.remove('view-pane');
  const charts = section.querySelector('.charts-grid');
  charts.previousElementSibling.remove();
  section.prepend(charts);
  return section;
}
$('printReport').addEventListener('click', () => printReport('Relatório de negativações', [negativeReportSection()]));
$('printOverview').addEventListener('click', () => {
  const [negative, equipment] = $('monthlyView').querySelector('.overview-grid').children;
  const negativeSection = negative.cloneNode(true);
  const equipmentSection = equipment.cloneNode(true);
  for (const section of [negativeSection, equipmentSection]) {
    section.classList.add('pdf-section');
    section.append(section.querySelector('.dashboard-summary'));
  }
  const withdrawalDetails = document.createElement('div');
  renderWithdrawalReport(withdrawalDetails, withdrawalVisits, '', '');
  equipmentSection.append(withdrawalDetails);
  const negativeDetails = negativeReportSection();
  renderRecoveryReport(clients, negativeDetails.querySelector('#recoveryReport'), { from:'', to:'', city:'', district:'' });
  negativeSection.append(negativeDetails);
  printReport('Relatório geral', [negativeSection, equipmentSection]);
});
document.addEventListener('click', (event) => { if (!event.target.closest('#adminMenuWrap')) closeMenu(); });
$('mobileProfileButton').addEventListener('click', () => { closeMenu(); $('profileOverlay').classList.add('open'); $('profileName').value = myProfile?.display_name || ''; $('profilePhone').value = myProfile?.phone || ''; $('profileEmail').value = sessionUser?.email || ''; $('profileError').textContent = ''; $('passwordChangeForm').reset(); $('passwordChangeError').textContent = ''; });
$('profileForm').addEventListener('submit', async (event) => {
  event.preventDefault(); $('profileError').textContent = '';
  const displayName = $('profileName').value.trim(); if (!displayName) { $('profileError').textContent = 'O nome é obrigatório.'; return; }
  try { myProfile = await updateMyProfile(sessionUser.id, { display_name: displayName, phone: $('profilePhone').value }); $('mobileProfileName').textContent = myProfile.display_name; closeOverlay('profileOverlay'); showToast('Dados da conta atualizados.'); }
  catch (error) { $('profileError').textContent = `Não foi possível salvar: ${error.message}`; }
});
$('passwordChangeForm').addEventListener('submit', async (event) => {
  event.preventDefault(); $('passwordChangeError').textContent = '';
  const currentPassword = $('currentPassword').value;
  const newPassword = $('accountNewPassword').value;
  if (newPassword.length < 8) { $('passwordChangeError').textContent = 'A nova senha precisa ter pelo menos 8 caracteres.'; return; }
  if (newPassword !== $('accountConfirmPassword').value) { $('passwordChangeError').textContent = 'As senhas novas não coincidem.'; return; }
  const { error } = await supabase.auth.updateUser({ password: newPassword, current_password: currentPassword });
  if (error) { $('passwordChangeError').textContent = error.message; return; }
  $('passwordChangeForm').reset(); showToast('Senha alterada com sucesso.');
});
$('manageUsersBtn').addEventListener('click', async () => {
  $('adminMenu').hidden = true;
  try { profiles = await listProfiles(); renderProfiles(); $('usersOverlay').classList.add('open'); }
  catch (error) { showToast(`Não foi possível carregar usuários: ${error.message}`); }
});
function renderProfiles() {
  $('usersList').innerHTML = profiles.map((profile) => `<div class="user-row"><div><div class="user-email">${escapeHtml(profile.display_name || 'Sem nome')}</div><div class="user-created">${escapeHtml(profile.email || 'Conta sem e-mail')}${profile.phone ? ` · ${escapeHtml(profile.phone)}` : ''}</div></div><select data-role="${escapeHtml(profile.id)}" aria-label="Permissão de ${escapeHtml(profile.email)}"><option value="pending" ${profile.role === 'pending' ? 'selected' : ''}>Pendente</option><option value="technician" ${profile.role === 'technician' ? 'selected' : ''}>Técnico</option><option value="attendant" ${profile.role === 'attendant' ? 'selected' : ''}>Atendente</option><option value="operator" ${profile.role === 'operator' ? 'selected' : ''}>Operador</option><option value="admin" ${profile.role === 'admin' ? 'selected' : ''}>Administrador</option></select></div>`).join('') || '<div class="empty">Nenhum usuário encontrado.</div>';
}
document.addEventListener('change', async (event) => {
  const roleSelect = event.target.closest('select[data-role]');
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
  $('loginForm').addEventListener('submit', async (event) => { event.preventDefault(); clearErrors(); setRememberSession($('rememberSession').checked); const { error } = await supabase.auth.signInWithPassword({ email: $('loginEmail').value.trim(), password: $('loginPassword').value }); if (error) $('loginError').textContent = error.message; });
  $('signupForm').addEventListener('submit', async (event) => {
    event.preventDefault(); clearErrors(); const { data, error } = await supabase.auth.signUp({ email: $('signupEmail').value.trim(), password: $('signupPassword').value, options: { data: { full_name: $('signupName').value.trim() }, emailRedirectTo: `${window.location.origin}/` } });
    if (error) { $('signupError').textContent = error.message; return; } if (data.session) await showApp(data.session.user); else setAuthView('login', 'Cadastro iniciado. Confira seu e-mail para confirmar a conta e depois entre.');
  });
  $('recoveryForm').addEventListener('submit', async (event) => {
    event.preventDefault(); clearErrors(); const { error } = await supabase.auth.resetPasswordForEmail($('recoveryEmail').value.trim(), { redirectTo: `${window.location.origin}/?reset=1` });
    if (error) { $('recoveryError').textContent = error.message; return; } setAuthView('login', 'Se o e-mail estiver cadastrado, você receberá um link para redefinir a senha.');
  });
  $('newPasswordForm').addEventListener('submit', async (event) => {
    event.preventDefault(); clearErrors(); const { data, error } = await supabase.auth.updateUser({ password: $('newPassword').value });
    if (error) { $('newPasswordError').textContent = error.message; return; } recoveryMode = false; await showApp(data.user); showToast('Senha atualizada.'); history.replaceState({}, '', window.location.pathname);
  });
  $('logoutButton').addEventListener('click', async () => { closeOverlay('profileOverlay'); try { await disablePush(); } catch {} const { error } = await supabase.auth.signOut(); if (error) showToast(`Não foi possível sair: ${error.message}`); });
  supabase.auth.onAuthStateChange((event, session) => { window.setTimeout(() => {
    if (event === 'PASSWORD_RECOVERY') { recoveryMode = true; setAuthView('newPassword'); }
    else if (event === 'SIGNED_OUT') { recoveryMode = false; void showApp(null); if (authNotice) setAuthView('login', authNotice); }
    else if (event !== 'INITIAL_SESSION' && !recoveryMode) void showApp(session?.user || null);
  }, 0); });
  supabase.auth.getSession().then(async ({ data, error }) => {
    if (error) { setAuthView('login', error.message); return; }
    if (new URLSearchParams(window.location.search).has('reset')) { recoveryMode = true; setAuthView('newPassword'); return; }
    if (!data.session) { void showApp(null); return; }
    const { data: verified, error: verifyError } = await supabase.auth.getUser(data.session.access_token);
    if (verifyError && [400, 401, 403].includes(verifyError.status)) {
      authNotice = 'Sua sessão terminou. Entre novamente para continuar.';
      await supabase.auth.signOut({ scope: 'local' });
      void showApp(null); setAuthView('login', authNotice);
      return;
    }
    if (verifyError) { setAuthView('login', 'Não foi possível validar a sessão agora. Atualize a página para tentar novamente.'); return; }
    void showApp(verified.user);
  });
}

document.addEventListener('click', (event) => {
  const close = event.target.closest('[data-close]'); if (close) { closeOverlay(close.dataset.close); if (close.dataset.close === 'resolveOverlay') renderClients(); return; }
  const withdrawal = event.target.closest('[data-withdrawal]'); if (withdrawal) { openWithdrawalDetails(withdrawal.dataset.withdrawal); return; }
  const visitAction = event.target.closest('[data-visit-result]'); if (visitAction) { openVisitForm(visitAction.dataset.visitResult); return; }
  const open = event.target.closest('[data-open]'); if (open) openDetails(open.dataset.open);
});
document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !document.getElementById('deleteBatchDialog').open) { const resolving = $('resolveOverlay').classList.contains('open'); document.querySelectorAll('.overlay.open').forEach((overlay) => closeOverlay(overlay.id)); if (resolving) renderClients(); $('adminMenu').hidden = true; } });
document.querySelectorAll('.overlay').forEach((overlay) => overlay.addEventListener('click', (event) => { if (event.target === overlay) { closeOverlay(overlay.id); if (overlay.id === 'resolveOverlay') renderClients(); } }));

$('addBtn').addEventListener('click', () => { $('clientForm').reset(); void initializeClientPhone().catch(() => { $('phoneHint').textContent = 'Não foi possível carregar os países. O telefone pode ficar em branco.'; }); $('formError').textContent = ''; $('routerSelectWrap').hidden = true; $('routerModel').required = false; $('formOverlay').classList.add('open'); $('contract').focus(); });
$('addWithdrawalBtn').addEventListener('click', async () => {
  if (role === 'technician') return;
  $('withdrawalForm').reset();
  $('withdrawalError').textContent = '';
  $('withdrawalEquipmentHint').textContent = 'Deixe em branco para usar o equipamento vinculado ao contrato.';
  const equipment = $('withdrawalEquipment');
  equipment.options.length = 1;
  equipment.disabled = true;
  $('withdrawalFormOverlay').classList.add('open');
  $('withdrawalContract').focus();
  void initializeClientPhone('withdrawalPhone').catch(()=>{ $('withdrawalPhoneHint').textContent='Não foi possível carregar os países. O telefone pode ficar em branco.'; });
  try {
    for (const model of await listWithdrawalEquipmentModels()) equipment.add(new Option(model,model));
  } catch {
    $('withdrawalEquipmentHint').textContent = 'Não foi possível carregar os modelos. O vínculo por contrato será consultado ao salvar.';
  } finally { equipment.disabled = false; }
});
$('withdrawalSearch').addEventListener('input', renderWithdrawals);
$('withdrawalForm').addEventListener('submit', async (event) => {
  event.preventDefault(); $('withdrawalError').textContent = '';
  if (catalogExpired()) { $('withdrawalError').textContent='Catálogo vencido. Peça ao administrador uma nova planilha.'; return; }
  if (!$('withdrawalForm').reportValidity()) return;
  const name = $('withdrawalName').value.trim();
  const address = $('withdrawalAddress').value.trim();
  const city = normalizeWithdrawalCity($('withdrawalCity').value);
  const district = $('withdrawalDistrict').value.trim();
  if (!name || !address || !city || !district) {
    $('withdrawalError').textContent = 'Preencha nome, endereço, cidade e bairro.';
    return;
  }
  const submit = event.submitter;
  if (submit) submit.disabled = true;
  try {
    if (!await confirmCatalogContractStatus($('withdrawalContract').value.trim())) return;
    const phone = await readClientPhone('withdrawalPhone');
    await createWithdrawal({contract:$('withdrawalContract').value.trim(), name, phone, address, city, district, equipment:$('withdrawalEquipment').value}, sessionUser.id);
    closeOverlay('withdrawalFormOverlay');
    await refreshWithdrawals();
    showToast('Retirada cadastrada.');
  }
  catch (error) { $('withdrawalError').textContent = error.message; }
  finally { if (submit) submit.disabled = false; }
});
$('visitSave').addEventListener('click', async () => {
  const observation = $('visitObservation').value.trim();
  if (!canRecordResult(withdrawalVisitResult) || $('visitSave').disabled) return;
  if (!observation) { $('visitError').textContent = 'Descreva o resultado da visita.'; $('visitObservation').focus(); return; }
  $('visitSave').disabled = true;
  try { await recordWithdrawalVisit(selectedWithdrawalId, withdrawalVisitResult, observation); closeOverlay('visitOverlay'); closeOverlay('withdrawalDetailOverlay'); await refreshWithdrawals(); showToast('Resultado da visita registrado.'); }
  catch (error) { $('visitError').textContent = `Não foi possível registrar: ${error.message}`; }
  finally { $('visitSave').disabled = false; }
});
$('withdrawalCsvFile').addEventListener('change', async (event) => {
  if (!['admin','operator'].includes(role)) return;
  const file = event.target.files?.[0]; if (!file) return;
  if (!window.confirm(`Importar os contratos suspensos de “${file.name}” para a lista de retirada?`)) { event.target.value = ''; return; }
  try {
    const bytes = await file.arrayBuffer();
    let content;
    try { content = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch { content = new TextDecoder('windows-1252').decode(bytes); }
    const result = await importWithdrawalsCsv(parseCsv(content, {sgpContracts:true}), file.name);
    await refreshWithdrawals();
    if (result.imported) await showWithdrawalImports();
    showToast(`${result.imported} importado(s), ${result.duplicates} já existente(s), ${result.skipped} linha(s) ignorada(s).`);
  }
  catch (error) { showToast(`Falha ao importar a lista: ${error.message}`); } finally { event.target.value = ''; }
});
$('withdrawalContract').addEventListener('change', async (event) => {
  const field = event.target;
  const contract = field.value.trim();
  const hint = $('withdrawalEquipmentHint');
  hint.textContent = 'Deixe em branco para usar o equipamento vinculado ao contrato.';
  if (!/^\d+$/.test(contract)) { error.textContent='Informe um ID de contrato numérico para consultar o catálogo.'; return; }
  try {
    const equipment = await findContractEquipment(contract);
    if (field.value.trim() === contract) hint.textContent = equipment ? `Equipamento encontrado no catálogo: ${equipment}` : 'Equipamento ainda não identificado para este contrato.';
  } catch {
    if (field.value.trim() === contract) hint.textContent = 'Não foi possível consultar o catálogo agora.';
  }
});
async function showWithdrawalImports(keepId) {
  if(!canManageWithdrawals()) return;
  const list=$('withdrawalImportsList');
  const expanded=new Set([...list.querySelectorAll('details[open]')].map(el=>el.dataset.batch));
  const keepItem=withdrawals.find(item=>item.id===keepId);
  if(keepItem) expanded.add(keepItem.import_id || 'manual');
  const row=item=>`<div class="batch-entry"><span><strong>${escapeHtml(item.name)}</strong><br><small>${escapeHtml(item.address || 'Endereço não informado')}</small><br><small>Contrato ${escapeHtml(item.contract_id || '—')} · ${item.include_without_equipment?'Incluído por exceção':'Fora da fila'}</small></span><div class="batch-actions"><button class="secondary" type="button" data-import-action="${item.include_without_equipment?'hide':'allow'}" data-id="${escapeHtml(item.id)}">${item.include_without_equipment?'Retirar da fila':'Incluir na fila'}</button><button class="danger" type="button" data-import-action="delete-item" data-id="${escapeHtml(item.id)}">Excluir</button></div></div>`;
  try {
    const batches=await listWithdrawalImports();
    const pending=withdrawals.filter(item=>item.equipment==='A identificar');
    const block=(id,title,body)=>`<details class="withdrawal-batch" data-batch="${escapeHtml(id)}" ${expanded.has(id)?'open':''}><summary>${escapeHtml(title)}</summary>${body}</details>`;
    list.innerHTML=batches.map(batch=>{
      const missing=pending.filter(item=>item.import_id===batch.id);
      const current=withdrawals.filter(item=>item.import_id===batch.id).length;
      const title=`${batch.filename} · ${batch.imported_count} importado(s)`;
      return block(batch.id,title,`<p>${current} cadastro(s) no lote · ${missing.length} sem ONU identificada</p>${missing.map(row).join('')}<button class="danger" type="button" data-import-action="delete-batch" data-id="${escapeHtml(batch.id)}" data-filename="${escapeHtml(batch.filename)}">Excluir CSV e seus cadastros</button>`);
    }).join('');
    const manual=pending.filter(item=>!item.import_id);
    if(manual.length) list.innerHTML+=block('manual','Cadastros manuais sem ONU',manual.map(row).join(''));
    if(!list.innerHTML) list.innerHTML='<p>Nenhum CSV importado.</p>';
    $('withdrawalImportsOverlay').classList.add('open');
  } catch(error) { showToast(`Não foi possível carregar os CSVs: ${error.message}`); }
}

async function removeWithdrawal(id,fromReview=false) {
  if(!id || !canManageWithdrawals()) return;
  if(!window.confirm('Excluir este cliente da fila e apagar o histórico de visitas dele?')) return;
  try {
    await deleteWithdrawal(id);
    closeOverlay('withdrawalDetailOverlay');
    await refreshWithdrawals();
    if(fromReview) await showWithdrawalImports();
    showToast('Cliente excluído da fila.');
  } catch(error) { showToast(error.message); }
}

function bindWithdrawalReview() {
  $('openImports').addEventListener('click',async()=>{
    if(!canManageWithdrawals()) return;
    closeMenu();
    await refreshWithdrawals();
    await showWithdrawalImports();
  });
  $('withdrawalList').addEventListener('click',event=>{
    const button=event.target.closest('[data-delete-withdrawal]');
    if(button) void removeWithdrawal(button.dataset.deleteWithdrawal);
  });
  $('deleteWithdrawal').addEventListener('click',()=>removeWithdrawal(selectedWithdrawalId));
  const deleteDialog=$('deleteBatchDialog');
  const deleteConfirm=$('confirmDeleteBatch');
  let batchToDelete=null;
  deleteDialog.addEventListener('close',()=>{ batchToDelete=null; });
  deleteDialog.addEventListener('cancel',event=>{
    event.stopPropagation();
    if(deleteConfirm.disabled) event.preventDefault();
  });
  $('cancelDeleteBatch').addEventListener('click',()=>deleteDialog.close());
  deleteConfirm.addEventListener('click',async()=>{
    if(!deleteDialog.open || !batchToDelete || !canManageWithdrawals() || deleteConfirm.disabled) return;
    deleteConfirm.disabled=true;
    $('cancelDeleteBatch').disabled=true;
    $('deleteBatchError').textContent='';
    try {
      await deleteWithdrawalImport(batchToDelete);
      deleteDialog.close();
      await refreshWithdrawals();
      await showWithdrawalImports();
      showToast('CSV e cadastros excluídos.');
    } catch(error) { $('deleteBatchError').textContent=error.message; }
    finally {
      deleteConfirm.disabled=false;
      $('cancelDeleteBatch').disabled=false;
    }
  });
  $('withdrawalImportsList').addEventListener('click',async event=>{
    const button=event.target.closest('button[data-import-action]');
    if(!button || !canManageWithdrawals()) return;
    const {importAction,id}=button.dataset;
    if(importAction==='delete-item') return removeWithdrawal(id,true);
    if(importAction==='delete-batch') {
      if(deleteDialog.open) return;
      batchToDelete=id;
      $('deleteBatchFilename').textContent=button.dataset.filename;
      $('deleteBatchError').textContent='';
      deleteDialog.showModal();
      return;
    }
    button.disabled=true;
    try {
      await updateWithdrawal(id,{include_without_equipment:importAction==='allow'});
      await refreshWithdrawals();
      await showWithdrawalImports(id);
    } catch(error) { showToast(error.message); }
    finally { button.disabled=false; }
  });
  let catalogFile=null;
  let catalogType='onu';
  const selectCatalogType=type=>{
    catalogType=type; $('catalogTitle').textContent=`Importar catálogo de ${type==='onu'?'ONU':'clientes'}`;
    $('catalogOnu').classList.toggle('active',type==='onu'); $('catalogClients').classList.toggle('active',type==='clients');
    $('catalogOnuHelp').hidden=type!=='onu'; $('catalogClientsHelp').hidden=type!=='clients';
    $('equipmentCsvFile').accept=type==='onu'?'text/csv,.csv':'.xlsx,.csv,text/csv';
    $('catalogDropPrompt').textContent=type==='onu'?'Arraste o CSV do catálogo para cá':'Arraste o XLSX do SGP ou um CSV para cá';
    $('equipmentCsvFile').value=''; choose(null);
  };
  const drop=$('catalogDrop');
  const confirm=$('confirmCatalog');
  const choose=file=>{
    catalogFile=file && (catalogType==='onu' ? /\.csv$/i : /\.(xlsx|csv)$/i).test(file.name) ? file : null;
    $('catalogSelection').textContent=catalogFile?.name || '';
    $('catalogError').textContent=file && !catalogFile ? (catalogType==='onu'?'Selecione um arquivo CSV.':'Selecione um arquivo XLSX ou CSV.') : '';
    confirm.disabled=!catalogFile;
  };
  $('catalogOnu').addEventListener('click',()=>selectCatalogType('onu'));
  $('catalogClients').addEventListener('click',()=>selectCatalogType('clients'));
  $('openCatalog').addEventListener('click',()=>{
    if(role!=='admin') return;
    closeMenu();
    selectCatalogType(currentView === 'withdrawals' ? 'onu' : 'clients');
    choose(null);
    $('catalogOverlay').classList.add('open');
  });
  $('equipmentCsvFile').addEventListener('change',event=>choose(event.target.files?.[0]));
  drop.addEventListener('dragover',event=>{event.preventDefault();drop.classList.add('is-dragover');});
  drop.addEventListener('dragleave',()=>drop.classList.remove('is-dragover'));
  drop.addEventListener('drop',event=>{
    event.preventDefault();
    drop.classList.remove('is-dragover');
    if(!confirm.dataset.busy) choose(event.dataTransfer.files?.[0]);
  });
  confirm.addEventListener('click',async()=>{
    if(role!=='admin' || !catalogFile || confirm.dataset.busy) return;
    const file=catalogFile;
    confirm.dataset.busy='true';
    confirm.disabled=true;
    $('equipmentCsvFile').disabled=true;
    $('catalogError').textContent='';
    try {
      let content;
      if (/\.csv$/i.test(file.name)) {
        const bytes=await file.arrayBuffer();
        try {content=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}
        catch {content=new TextDecoder('windows-1252').decode(bytes);}
      }
      const count=catalogType==='onu'
        ? await importContractEquipment(parseCsv(content,{equipmentCatalog:true}))
        : await replaceClientCatalog(/\.xlsx$/i.test(file.name) ? await parseSgpClientWorkbook(file) : parseCsv(content,{clientCatalog:true}),file.name);
      closeOverlay('catalogOverlay');
      choose(null);
      await refreshWithdrawals();
      if(catalogType==='clients') await refreshClientCatalogState();
      showToast(`${count} contrato(s) atualizados no catálogo.`);
    } catch(error) { $('catalogError').textContent=error.message; }
    finally {
      delete confirm.dataset.busy;
      $('equipmentCsvFile').disabled=false;
      confirm.disabled=!catalogFile;
    }
  });
}
bindWithdrawalReview();


$('routerEnabled').addEventListener('change', () => { const enabled = $('routerEnabled').checked; $('routerSelectWrap').hidden = !enabled; $('routerModel').required = enabled; if (!enabled) $('routerModel').value = ''; });
async function suggestClientCatalog(contract, type) {
  const error = $(type === 'client' ? 'formError' : 'withdrawalError');
  if (!/^\d+$/.test(contract)) return;
  try {
    const row = await findClientCatalogContract(contract);
    if ($(type === 'client' ? 'contract' : 'withdrawalContract').value.trim() !== contract) return;
    if (!row) { error.textContent = `Contrato ${contract} não encontrado no catálogo de clientes.`; return; }
    error.textContent = row.status && !['ATIVO','SUSPENSO'].includes(row.status.normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toUpperCase()) ? `Atenção: este contrato consta como ${row.status}. Você precisará confirmar antes de salvar.` : '';
    if (!window.confirm(`Contrato ${contract} encontrado para ${row.name}. Preencher os dados deste cliente?`)) return;
    const equipment = row.equipment || await findContractEquipment(contract).catch(()=>null);
    if (type === 'client') {
      $('clientName').value=row.name; $('street').value=row.street;
      $('neighborhood').value=row.neighborhood; $('city').value=row.city;
      if (equipment) {
        if (![...$('onu').options].some(o=>o.value===equipment)) $('onu').add(new Option(equipment,equipment));
        $('onu').value=equipment;
      }
    } else {
      $('withdrawalName').value=row.name; $('withdrawalAddress').value=row.street;
      $('withdrawalDistrict').value=row.neighborhood; $('withdrawalCity').value=row.city;
      if (equipment) {
        if (![...$('withdrawalEquipment').options].some(o=>o.value===equipment)) $('withdrawalEquipment').add(new Option(equipment,equipment));
        $('withdrawalEquipment').value=equipment;
      }
    }
    if (row.phone && row.phone.replace(/\D/g,'').length >= 10) {
      $(type === 'client' ? 'clientPhone' : 'withdrawalPhone').value=row.phone;
    }
  } catch { error.textContent='Não foi possível consultar o catálogo de clientes agora.'; }
}
$('contract').addEventListener('change',event=>void suggestClientCatalog(event.target.value.trim(),'client'));
$('withdrawalContract').addEventListener('change',event=>void suggestClientCatalog(event.target.value.trim(),'withdrawal'));
async function confirmCatalogContractStatus(contract) {
  if (!/^\d+$/.test(contract)) return true;
  const row = await findClientCatalogContract(contract);
  if (!row?.status) return true;
  const normalized = row.status.normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toUpperCase();
  return ['ATIVO','SUSPENSO'].includes(normalized) || window.confirm(`Tem certeza? Esse contrato consta como ${row.status}.`);
}
$('clientForm').addEventListener('submit', async (event) => {
  event.preventDefault(); $('formError').textContent = ''; if (!$('clientForm').reportValidity()) return;
  if (catalogExpired()) { $('formError').textContent='Catálogo vencido. Peça ao administrador uma nova planilha.'; return; }
  try { if (!await confirmCatalogContractStatus($('contract').value.trim())) return; const phone = await readClientPhone(); await createClientRecord({ phone, name: $('clientName').value, contract: $('contract').value, street: $('street').value, neighborhood: $('neighborhood').value, city: $('city').value, onu: $('onu').value, router: $('routerEnabled').checked ? $('routerModel').value : '' }, sessionUser.id); closeOverlay('formOverlay'); await refreshClients(); showToast('Cliente cadastrado como negativado.'); }
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
$('searchContact').addEventListener('input', renderClients);
$('searchNeg').addEventListener('input', renderClients); $('searchReg').addEventListener('input', renderClients);
$('deleteBtn').addEventListener('click', async () => {
  const client = clients.find((item) => item.id === selectedId); if (!client || role !== 'admin') return;
  if (!window.confirm(`Excluir o cadastro de ${client.name}? Esta ação não pode ser desfeita.`)) return;
  try { await deleteClientRecord(client.id); closeOverlay('detailOverlay'); await refreshClients(); showToast('Cadastro excluído.'); } catch (error) { showToast(`Não foi possível excluir: ${error.message}`); }
});
$('csvImportFile').addEventListener('change', async (event) => {
  if (!['admin','operator'].includes(role)) { event.target.value = ''; return; }
  const file = event.target.files?.[0]; if (!file) return;
  if (!window.confirm(`Importar os registros do arquivo “${file.name}”? Linhas sem nome, contrato e endereço completo serão ignoradas.`)) { event.target.value = ''; return; }
  try { const records = parseCsv(await file.text()); const result = await importCsv(records, sessionUser.id); await refreshClients(); showToast(`${result.imported} importados/atualizados; ${result.skipped} linha(s) incompleta(s) ignorada(s).`); }
  catch (error) { showToast(`Falha na importação CSV: ${error.message}`); } finally { event.target.value = ''; }
});





