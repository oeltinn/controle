import { supabase, isSupabaseConfigured } from './supabase.js';
import { createClientRecord, deleteClientRecord, importBackup, listClients, updateClientRecord } from './data.js';

const $ = (id) => document.getElementById(id);
let clients = [];
let sessionUser = null;
let role = 'pending';
let selectedId = null;
let pendingId = null;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function showToast(message) {
  $('toast').textContent = message;
  $('toast').classList.add('show');
  window.setTimeout(() => $('toast').classList.remove('show'), 2800);
}

function setAuthView(view, message = '') {
  $('authShell').hidden = false;
  $('appShell').hidden = true;
  $('userBadge').hidden = true;
  $('logoutButton').hidden = true;
  for (const id of ['loginForm', 'signupForm', 'recoveryForm', 'newPasswordForm']) $(id).hidden = id !== `${view}Form`;
  const titles = {
    login: ['Entrar', 'Acesse o controle compartilhado de clientes.'],
    signup: ['Criar usuário', 'Novos usuários recebem acesso de operação.'],
    recovery: ['Recuperar senha', 'Enviaremos um link para o e-mail cadastrado.'],
    newPassword: ['Criar nova senha', 'Escolha uma nova senha para sua conta.'],
  };
  const [heading, subtitle] = titles[view] || titles.login;
  $('authHeading').textContent = heading;
  $('authSubtitle').textContent = subtitle;
  $('authMessage').textContent = message;
}

async function showApp(user) {
  if (!user) {
    sessionUser = null;
    $('appShell').hidden = true;
    $('authShell').hidden = false;
    $('userBadge').hidden = true;
    $('logoutButton').hidden = true;
    setAuthView('login');
    return;
  }
  sessionUser = user;
  $('authShell').hidden = true;
  $('appShell').hidden = true;
  $('userBadge').textContent = user.email || 'Conta conectada';
  $('userBadge').hidden = false;
  $('logoutButton').hidden = false;
  role = 'pending';
  try {
    const { data, error } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle();
    if (error) throw error;
    role = data?.role || 'pending';
  } catch (error) {
    showToast(`Não foi possível consultar o perfil: ${error.message}`);
  }
  if (role !== 'admin' && role !== 'operator') {
    $('appShell').hidden = true;
    $('authShell').hidden = false;
    $('loginForm').hidden = true; $('signupForm').hidden = true; $('recoveryForm').hidden = true; $('newPasswordForm').hidden = true;
    $('authHeading').textContent = 'Acesso pendente';
    $('authSubtitle').textContent = 'Seu cadastro ainda não foi autorizado.';
    $('authMessage').textContent = 'Peça a um administrador do Controle FibraCenter para liberar seu acesso.';
    $('userBadge').textContent = user.email || 'Conta conectada'; $('userBadge').hidden = false; $('logoutButton').hidden = false;
    return;
  }
  $('deleteBtn').hidden = role !== 'admin';
  $('authShell').hidden = true;
  $('appShell').hidden = false;
  await refreshClients();
}

async function refreshClients() {
  if (!sessionUser) return;
  try {
    clients = await listClients();
    renderClients();
  } catch (error) {
    showToast(`Não foi possível carregar os clientes: ${error.message}`);
  }
}

function renderClients() {
  const negative = clients.filter((client) => client.status === 'NEGATIVADO').sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  const regularized = clients.filter((client) => client.status === 'REGULARIZADO').sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  $('countNeg').textContent = negative.length;
  $('countReg').textContent = regularized.length;
  drawList('listNeg', negative, $('searchNeg').value);
  drawList('listReg', regularized, $('searchReg').value);
}

function drawList(elementId, records, query) {
  const target = $(elementId);
  const term = query.trim().toLocaleLowerCase('pt-BR');
  const filtered = records.filter((client) => client.name.toLocaleLowerCase('pt-BR').includes(term));
  target.innerHTML = filtered.length
    ? filtered.map((client) => `<div class="row"><button class="name" data-open="${escapeHtml(client.id)}" title="Ver cadastro de ${escapeHtml(client.name)}">${escapeHtml(client.name)}</button><select class="status-select" data-status="${escapeHtml(client.id)}" aria-label="Situação de ${escapeHtml(client.name)}"><option value="NEGATIVADO" ${client.status === 'NEGATIVADO' ? 'selected' : ''}>NEGATIVADO</option><option value="REGULARIZADO" ${client.status === 'REGULARIZADO' ? 'selected' : ''}>REGULARIZADO</option></select></div>`).join('')
    : `<div class="empty">${term ? 'Nenhum cliente encontrado.' : 'Nenhum cliente nesta lista.'}</div>`;
}

function displayDate(value) {
  if (!value) return '—';
  const [year, month, day] = String(value).slice(0, 10).split('-');
  return year && month && day ? `${day}/${month}/${year}` : String(value);
}

function openDetails(id) {
  const client = clients.find((item) => item.id === id);
  if (!client) return;
  selectedId = id;
  $('detailName').textContent = client.name;
  $('detailContract').textContent = `Contrato ${client.contract}`;
  const equipment = client.onu || client.router
    ? [['ONU', client.onu || 'Não informado'], ['Roteador em comodato', client.router || 'Não informado']]
    : [['Equipamento', client.equipment || 'Não informado']];
  const fields = [
    ['Situação', `<span class="status-banner ${client.status === 'REGULARIZADO' ? 'green' : ''}">${escapeHtml(client.status)}</span>`],
    ...(client.status === 'NEGATIVADO' ? [['Data da negativação', escapeHtml(displayDate(client.negative_date))]] : [['Data da regularização', escapeHtml(displayDate(client.regularized_date))]]),
    ['Rua / endereço', escapeHtml(client.street)],
    ['Bairro', escapeHtml(client.neighborhood)],
    ['Cidade', escapeHtml(client.city)],
    ...equipment.map(([label, value]) => [label, escapeHtml(value)]),
  ];
  $('detailFields').innerHTML = fields.map(([label, value]) => `<div class="field"><div class="label">${label}</div><div class="value">${value}</div></div>`).join('');
  $('detailAction').innerHTML = client.status === 'REGULARIZADO'
    ? `<div class="action-box"><div class="label">O que foi feito para regularizar</div><div class="value">${escapeHtml(client.resolution || '—')}</div></div>`
    : '';
  $('deleteBtn').hidden = role !== 'admin';
  $('detailOverlay').classList.add('open');
}

function closeOverlay(id) { $(id).classList.remove('open'); }

function isoToday() { return new Date().toISOString().slice(0, 10); }

function fileDownload(fileName, payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

function clearErrors() {
  for (const id of ['loginError', 'signupError', 'recoveryError', 'newPasswordError', 'formError', 'resolveError']) $(id).textContent = '';
}

$('themeToggle').addEventListener('click', () => {
  const next = document.body.dataset.theme === 'dark' ? 'light' : 'dark';
  document.body.dataset.theme = next;
  localStorage.setItem('fibra_theme', next);
  $('themeIcon').textContent = next === 'dark' ? '☀' : '☾';
  $('themeLabel').textContent = next === 'dark' ? 'Modo claro' : 'Modo noturno';
  $('themeToggle').setAttribute('aria-label', next === 'dark' ? 'Ativar modo claro' : 'Ativar modo noturno');
});
const savedTheme = localStorage.getItem('fibra_theme') || 'light';
document.body.dataset.theme = savedTheme;
$('themeIcon').textContent = savedTheme === 'dark' ? '☀' : '☾';
$('themeLabel').textContent = savedTheme === 'dark' ? 'Modo claro' : 'Modo noturno';
$('themeToggle').setAttribute('aria-label', savedTheme === 'dark' ? 'Ativar modo claro' : 'Ativar modo noturno');

if (!isSupabaseConfigured) {
  setAuthView('login', 'Configure as variáveis VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY para conectar este site.');
  for (const form of document.querySelectorAll('#authShell form')) form.querySelectorAll('input,button[type="submit"]').forEach((control) => { control.disabled = true; });
} else {
  document.querySelectorAll('[data-auth-view]').forEach((button) => button.addEventListener('click', () => {
    clearErrors();
    $('signupForm').reset();
    $('loginForm').reset();
    $('recoveryForm').reset();
    setAuthView(button.dataset.authView);
  }));

  $('loginForm').addEventListener('submit', async (event) => {
    event.preventDefault(); clearErrors();
    const { error } = await supabase.auth.signInWithPassword({ email: $('loginEmail').value.trim(), password: $('loginPassword').value });
    if (error) $('loginError').textContent = error.message;
  });

  $('signupForm').addEventListener('submit', async (event) => {
    event.preventDefault(); clearErrors();
    const { data, error } = await supabase.auth.signUp({
      email: $('signupEmail').value.trim(),
      password: $('signupPassword').value,
      options: { emailRedirectTo: `${window.location.origin}/` },
    });
    if (error) { $('signupError').textContent = error.message; return; }
    if (data.session) await showApp(data.session.user);
    else setAuthView('login', 'Cadastro iniciado. Confira seu e-mail para confirmar a conta e depois entre.');
  });

  $('recoveryForm').addEventListener('submit', async (event) => {
    event.preventDefault(); clearErrors();
    const { error } = await supabase.auth.resetPasswordForEmail($('recoveryEmail').value.trim(), {
      redirectTo: `${window.location.origin}/?reset=1`,
    });
    if (error) { $('recoveryError').textContent = error.message; return; }
    setAuthView('login', 'Se o e-mail estiver cadastrado, você receberá um link para redefinir a senha.');
  });

  $('newPasswordForm').addEventListener('submit', async (event) => {
    event.preventDefault(); clearErrors();
    const { data, error } = await supabase.auth.updateUser({ password: $('newPassword').value });
    if (error) { $('newPasswordError').textContent = error.message; return; }
    await showApp(data.user);
    showToast('Senha atualizada.');
    history.replaceState({}, '', window.location.pathname);
  });

  $('logoutButton').addEventListener('click', async () => {
    const { error } = await supabase.auth.signOut();
    if (error) showToast(`Não foi possível sair: ${error.message}`);
  });

  supabase.auth.onAuthStateChange((event, session) => {
    window.setTimeout(() => {
      if (event === 'PASSWORD_RECOVERY') setAuthView('newPassword');
      else void showApp(session?.user || null);
    }, 0);
  });
  supabase.auth.getSession().then(({ data, error }) => {
    if (error) { setAuthView('login', error.message); return; }
    if (new URLSearchParams(window.location.search).has('reset')) setAuthView('newPassword');
    else void showApp(data.session?.user || null);
  });
}

document.addEventListener('click', (event) => {
  const close = event.target.closest('[data-close]');
  if (close) { closeOverlay(close.dataset.close); if (close.dataset.close === 'resolveOverlay') renderClients(); return; }
  const open = event.target.closest('[data-open]');
  if (open) openDetails(open.dataset.open);
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    const resolving = $('resolveOverlay').classList.contains('open');
    document.querySelectorAll('.overlay.open').forEach((overlay) => closeOverlay(overlay.id));
    if (resolving) renderClients();
  }
});
document.querySelectorAll('.overlay').forEach((overlay) => overlay.addEventListener('click', (event) => {
  if (event.target === overlay) { closeOverlay(overlay.id); if (overlay.id === 'resolveOverlay') renderClients(); }
}));

$('addBtn').addEventListener('click', () => {
  $('clientForm').reset(); $('formError').textContent = '';
  $('routerSelectWrap').hidden = true; $('routerModel').required = false;
  $('formOverlay').classList.add('open'); $('clientName').focus();
});
$('routerEnabled').addEventListener('change', () => {
  const enabled = $('routerEnabled').checked;
  $('routerSelectWrap').hidden = !enabled;
  $('routerModel').required = enabled;
  if (!enabled) $('routerModel').value = '';
});
$('clientForm').addEventListener('submit', async (event) => {
  event.preventDefault(); $('formError').textContent = '';
  if (!$('clientForm').reportValidity()) return;
  try {
    await createClientRecord({
      name: $('clientName').value, contract: $('contract').value, street: $('street').value,
      neighborhood: $('neighborhood').value, city: $('city').value, onu: $('onu').value,
      router: $('routerEnabled').checked ? $('routerModel').value : '',
    }, sessionUser.id);
    closeOverlay('formOverlay'); await refreshClients(); showToast('Cliente cadastrado como negativado.');
  } catch (error) { $('formError').textContent = error.message; }
});

document.addEventListener('change', async (event) => {
  const select = event.target.closest('[data-status]');
  if (!select) return;
  const client = clients.find((item) => item.id === select.dataset.status);
  if (!client) return;
  if (select.value === 'REGULARIZADO') {
    pendingId = client.id;
    $('resolutionText').value = ''; $('resolveError').textContent = '';
    $('resolveSubtitle').textContent = `Informe a ação realizada para regularizar ${client.name}.`;
    $('resolveOverlay').classList.add('open'); $('resolutionText').focus();
    return;
  }
  if (client.status === 'REGULARIZADO') {
    try {
      await updateClientRecord(client.id, { status: 'NEGATIVADO', negative_date: isoToday(), regularized_date: null, resolution: null });
      await refreshClients(); if (selectedId === client.id) openDetails(client.id);
      showToast('Cliente voltou para a lista de negativados.');
    } catch (error) { showToast(`Não foi possível atualizar: ${error.message}`); await refreshClients(); }
  }
});
$('resolveSave').addEventListener('click', async () => {
  const resolution = $('resolutionText').value.trim();
  if (!resolution) { $('resolveError').textContent = 'Descreva o que foi feito antes de confirmar.'; $('resolutionText').focus(); return; }
  const client = clients.find((item) => item.id === pendingId);
  if (!client) return;
  try {
    await updateClientRecord(client.id, { status: 'REGULARIZADO', resolution, regularized_date: isoToday() });
    closeOverlay('resolveOverlay'); pendingId = null; await refreshClients();
    if (selectedId === client.id) openDetails(client.id);
    showToast('Cliente movido para regularizados.');
  } catch (error) { $('resolveError').textContent = `Não foi possível salvar: ${error.message}`; }
});
$('searchNeg').addEventListener('input', renderClients);
$('searchReg').addEventListener('input', renderClients);
$('deleteBtn').addEventListener('click', async () => {
  const client = clients.find((item) => item.id === selectedId);
  if (!client || role !== 'admin') return;
  if (!window.confirm(`Excluir o cadastro de ${client.name}? Esta ação não pode ser desfeita.`)) return;
  try {
    await deleteClientRecord(client.id); closeOverlay('detailOverlay'); await refreshClients(); showToast('Cadastro excluído.');
  } catch (error) { showToast(`Não foi possível excluir: ${error.message}`); }
});
$('exportCloudBtn').addEventListener('click', async () => {
  try {
    const rows = await listClients();
    fileDownload(`backup-clientes-fibracenter-${isoToday()}.json`, { exportedAt: new Date().toISOString(), records: rows });
    showToast('Backup baixado.');
  } catch (error) { showToast(`Não foi possível exportar: ${error.message}`); }
});
$('importFile').addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const payload = JSON.parse(await file.text());
    const records = Array.isArray(payload) ? payload : payload.records;
    if (!Array.isArray(records)) throw new Error('O JSON não contém a lista records.');
    const count = await importBackup(records, sessionUser.id);
    await refreshClients(); showToast(`${count} registro(s) importado(s) ou atualizados.`);
  } catch (error) { showToast(`Falha na importação: ${error.message}`); }
  finally { event.target.value = ''; }
});





