import { supabase, isSupabaseConfigured } from './supabase.js';
import { renderRecoveryReport } from './recovery-report.js';
import { initializeClientPhone, readClientPhone } from './client-phone.js';
import { createClientRecord, createWithdrawal, deleteClientRecord, getMyProfile, importCsv, importWithdrawalsCsv, listClients, listProfiles, listWithdrawalVisits, listWithdrawals, parseCsv, recordWithdrawalVisit, updateClientRecord, updateMyProfile, updateProfileRole } from './data.js';

const $ = (id) => document.getElementById(id);
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
let withdrawalVisitResult = 'pending';
let appLoading = false;
let currentView = 'monthly';
let recoveryMode = false;
let authRevision = 0;

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
 
  for (const id of ['loginForm', 'signupForm', 'recoveryForm', 'newPasswordForm']) $(id).hidden = id !== `${view}Form`;
  const titles = { login: ['Entrar', ''], signup: ['Criar usuário', 'Novos usuários recebem acesso pendente.'], recovery: ['Recuperar senha', 'Enviaremos um link para o e-mail cadastrado.'], newPassword: ['Criar nova senha', 'Escolha uma nova senha para sua conta.'] };
  const [heading, subtitle] = titles[view] || titles.login;
  $('authHeading').textContent = heading; $('authSubtitle').textContent = subtitle; $('authMessage').textContent = message;
}
async function showApp(user) {
  if (user?.id === sessionUser?.id && (appLoading || !$('appShell').hidden)) { sessionUser = user; return; }
  if (!user) {
    authRevision++;
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
function openDetails(id) {
  const client = clients.find((item) => item.id === id); if (!client) return; selectedId = id;
  const state = currentStatus(client); $('detailName').textContent = client.name; $('detailContract').textContent = `Contrato ${client.contract}`;
  const equipment = client.onu || client.router ? [['ONU', client.onu || 'Não informado'], ['Roteador em comodato', client.router || 'Não informado']] : [['Equipamento', client.equipment || 'Não informado']];
  const fields = [
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
  $('clientTools').hidden = view !== 'clients'; $('withdrawalTools').hidden = view !== 'withdrawals' || role === 'technician';
  document.querySelector('label[for=withdrawalCsvFile]').hidden = !['admin','operator'].includes(role);
  document.querySelector('label[for=csvImportFile]').hidden = !['admin','operator'].includes(role);
  closeMenu();
  if (view === 'monthly') renderMonthly();
  if (view === 'withdrawals' && sessionUser) void refreshWithdrawals();
}
function closeMenu() { $('adminMenu').hidden=true; $('adminMenuToggle').setAttribute('aria-expanded','false'); }

document.querySelectorAll('[data-view]').forEach((button) => button.addEventListener('click', () => setView(button.dataset.view)));

function latestVisit(withdrawalId) { return withdrawalVisits.find((visit) => visit.withdrawal_id === withdrawalId) || null; }
function renderWithdrawals() {
  const term = $('withdrawalSearch').value.trim().toLocaleLowerCase('pt-BR');
  const filtered = withdrawals.filter((item) => `${item.name} ${item.address} ${item.equipment}`.toLocaleLowerCase('pt-BR').includes(term));
  $('withdrawalCount').textContent = withdrawals.length;
  $('summaryWithdrawals').textContent = withdrawals.filter((item) => latestVisit(item.id)?.result !== 'collected').length;
  $('withdrawalVisitsCount').textContent = withdrawalVisits.length;
  $('withdrawalList').innerHTML = filtered.length ? filtered.map((item) => {
    const visit = latestVisit(item.id);
    const label = visit?.result === 'collected' ? 'Equipamento retirado' : visit?.result === 'no_answer' ? 'Não encontrou ninguém' : visit?.result === 'visited' ? 'Visita realizada' : 'Ainda não foi';
    const tag = visit?.result === 'collected' ? 'collected' : visit?.result === 'no_answer' ? 'missed' : visit?.result === 'visited' ? 'visited' : 'pending';
    return `<button class="withdrawal-card" data-withdrawal="${escapeHtml(item.id)}"><span class="withdrawal-name">${escapeHtml(item.name)}</span><span class="withdrawal-address">${escapeHtml(item.address)}</span><span class="withdrawal-meta">${escapeHtml(item.equipment)}<i class="visit-tag ${tag}">${label}</i></span></button>`;
  }).join('') : `<div class="empty">${term ? 'Nenhum cliente encontrado.' : 'Ainda não há clientes na lista de retirada.'}</div>`;
}
function renderNoAnswerVisits() {
  const latest = withdrawals.map((item) => latestVisit(item.id)).filter(Boolean);
  const collected = latest.filter((visit) => visit.result === 'collected');
  $('summaryCollected').textContent = collected.length;
  const technicians = new Map();
  for (const visit of collected) {
    const key = visit.technician_id;
    const item = technicians.get(key) || { name: visit.technician_name, count: 0 };
    item.count++; technicians.set(key,item);
  }
  $('technicianStats').innerHTML = [...technicians.values()].sort((a,b)=>b.count-a.count).map((item)=>`<div class="technician-row"><span>${escapeHtml(item.name)}</span><strong>${item.count} retirada(s)</strong></div>`).join('') || '<div class="empty">Nenhuma retirada confirmada ainda.</div>';
  $('summaryNoAnswers').textContent = latest.filter((visit) => visit.result === 'no_answer').length;
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
    ['Telefone', item.phone || 'Não informado'], ['Endereço', item.address], ['Equipamento para recolher', item.equipment],
    ['Situação', visit?.result === 'collected' ? 'Equipamento retirado' : visit?.result === 'no_answer' ? 'Não encontrou ninguém' : visit?.result === 'visited' ? 'Visita realizada' : 'Ainda não foi'],
    ...(visit ? [['Último registro', `${visit.technician_name} · ${displayDate(String(visit.created_at).slice(0,10))}`], ['Observação', visit.observation || '—']] : []),
  ].map(([label, value]) => `<div class="field"><div class="label">${escapeHtml(label)}</div><div class="value">${escapeHtml(value)}</div></div>`).join('');
  $('withdrawalDetailOverlay').classList.add('open');
}
function openVisitForm(result) {
  withdrawalVisitResult = result;
  const labels = { collected: 'Confirmar equipamento retirado', pending: 'Marcar como ainda não foi', visited: 'Registrar visita realizada', no_answer: 'Registrar que não encontrou ninguém' };
  $('visitTitle').textContent = labels[result];
  $('visitObservation').value = '';
  $('visitObservation').required = result !== 'pending';
  $('visitObservationLabel').textContent = result === 'pending' ? 'Observação (opcional)' : 'O que aconteceu? *';
  $('visitObservation').placeholder = result === 'no_answer' ? 'Ex.: Ninguém atendeu; vizinho informou horário...' : 'Descreva brevemente o resultado da visita...';
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
  $('monthlyCards').innerHTML=`<div class="trend-scroll"><svg style="width:${width}px" viewBox="0 0 ${width} ${height}" role="img" aria-label="Evolução mensal de negativações e regularizações. Valores disponíveis na tabela abaixo.">${grid}${lines}${labels}</svg></div><div class="chart-legend"><span class="legend-item"><i class="legend-swatch" style="background:#df665f"></i>Negativações</span><span class="legend-item"><i class="legend-swatch" style="background:#138777"></i>Regularizações</span></div><details><summary class="panel-head">Ver totais por mês</summary><div class="table-scroll"><table class="overview-table"><thead><tr><th scope="col">Mês</th><th scope="col">Negativações</th><th scope="col">Regularizações</th></tr></thead><tbody>${months.map(key=>`<tr><th scope="row">${monthLabel(key)}</th><td>${counts.get(key)?.negative||0}</td><td>${counts.get(key)?.regular||0}</td></tr>`).join('')}</tbody></table></div></details>`;
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
$('printReport').addEventListener('click', () => window.print());
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
  $('loginForm').addEventListener('submit', async (event) => { event.preventDefault(); clearErrors(); const { error } = await supabase.auth.signInWithPassword({ email: $('loginEmail').value.trim(), password: $('loginPassword').value }); if (error) $('loginError').textContent = error.message; });
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
  $('logoutButton').addEventListener('click', async () => { closeOverlay('profileOverlay'); const { error } = await supabase.auth.signOut(); if (error) showToast(`Não foi possível sair: ${error.message}`); });
  supabase.auth.onAuthStateChange((event, session) => { window.setTimeout(() => {
    if (event === 'PASSWORD_RECOVERY') { recoveryMode = true; setAuthView('newPassword'); }
    else if (event === 'SIGNED_OUT') { recoveryMode = false; void showApp(null); }
    else if (!recoveryMode) void showApp(session?.user || null);
  }, 0); });
  supabase.auth.getSession().then(({ data, error }) => { if (error) { setAuthView('login', error.message); return; } if (new URLSearchParams(window.location.search).has('reset')) { recoveryMode = true; setAuthView('newPassword'); } else void showApp(data.session?.user || null); });
}

document.addEventListener('click', (event) => {
  const close = event.target.closest('[data-close]'); if (close) { closeOverlay(close.dataset.close); if (close.dataset.close === 'resolveOverlay') renderClients(); return; }
  const withdrawal = event.target.closest('[data-withdrawal]'); if (withdrawal) { openWithdrawalDetails(withdrawal.dataset.withdrawal); return; }
  const visitAction = event.target.closest('[data-visit-result]'); if (visitAction) { openVisitForm(visitAction.dataset.visitResult); return; }
  const open = event.target.closest('[data-open]'); if (open) openDetails(open.dataset.open);
});
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') { const resolving = $('resolveOverlay').classList.contains('open'); document.querySelectorAll('.overlay.open').forEach((overlay) => closeOverlay(overlay.id)); if (resolving) renderClients(); $('adminMenu').hidden = true; } });
document.querySelectorAll('.overlay').forEach((overlay) => overlay.addEventListener('click', (event) => { if (event.target === overlay) { closeOverlay(overlay.id); if (overlay.id === 'resolveOverlay') renderClients(); } }));

$('addBtn').addEventListener('click', () => { $('clientForm').reset(); void initializeClientPhone().catch(() => { $('phoneHint').textContent = 'Não foi possível carregar os países. O telefone pode ficar em branco.'; }); $('formError').textContent = ''; $('routerSelectWrap').hidden = true; $('routerModel').required = false; $('formOverlay').classList.add('open'); $('clientName').focus(); });
$('addWithdrawalBtn').addEventListener('click', () => { if (role === 'technician') return; $('withdrawalForm').reset(); $('withdrawalError').textContent = ''; $('withdrawalFormOverlay').classList.add('open'); $('withdrawalName').focus(); });
$('withdrawalSearch').addEventListener('input', renderWithdrawals);
$('withdrawalForm').addEventListener('submit', async (event) => {
  event.preventDefault(); $('withdrawalError').textContent = '';
  if (!$('withdrawalForm').reportValidity()) return;
  try { await createWithdrawal({ name: $('withdrawalName').value, phone: $('withdrawalPhone').value, address: $('withdrawalAddress').value, equipment: $('withdrawalEquipment').value }, sessionUser.id); closeOverlay('withdrawalFormOverlay'); await refreshWithdrawals(); showToast('Cliente adicionado à lista de retirada.'); }
  catch (error) { $('withdrawalError').textContent = error.message; }
});
$('visitSave').addEventListener('click', async () => {
  const observation = $('visitObservation').value.trim();
  if (withdrawalVisitResult !== 'pending' && !observation) { $('visitError').textContent = 'Descreva o resultado da visita.'; $('visitObservation').focus(); return; }
  try { await recordWithdrawalVisit(selectedWithdrawalId, withdrawalVisitResult, observation); closeOverlay('visitOverlay'); closeOverlay('withdrawalDetailOverlay'); await refreshWithdrawals(); showToast(withdrawalVisitResult === 'no_answer' ? 'Visita registrada e resumo atualizado.' : 'Acompanhamento atualizado.'); }
  catch (error) { $('visitError').textContent = `Não foi possível registrar: ${error.message}`; }
});
$('withdrawalCsvFile').addEventListener('change', async (event) => {
  if (!['admin','operator'].includes(role)) return;
  const file = event.target.files?.[0]; if (!file) return;
  if (!window.confirm(`Importar “${file.name}” para a lista de retirada? É necessário nome, endereço e equipamento.`)) { event.target.value = ''; return; }
  try { const records = parseCsv(await file.text()); const result = await importWithdrawalsCsv(records, sessionUser.id); await refreshWithdrawals(); showToast(`${result.imported} importados; ${result.skipped} linha(s) incompleta(s) ignorada(s).`); }
  catch (error) { showToast(`Falha ao importar a lista: ${error.message}`); } finally { event.target.value = ''; }
});
$('routerEnabled').addEventListener('change', () => { const enabled = $('routerEnabled').checked; $('routerSelectWrap').hidden = !enabled; $('routerModel').required = enabled; if (!enabled) $('routerModel').value = ''; });
$('clientForm').addEventListener('submit', async (event) => {
  event.preventDefault(); $('formError').textContent = ''; if (!$('clientForm').reportValidity()) return;
  try { const phone = await readClientPhone(); await createClientRecord({ phone, name: $('clientName').value, contract: $('contract').value, street: $('street').value, neighborhood: $('neighborhood').value, city: $('city').value, onu: $('onu').value, router: $('routerEnabled').checked ? $('routerModel').value : '' }, sessionUser.id); closeOverlay('formOverlay'); await refreshClients(); showToast('Cliente cadastrado como negativado.'); }
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


