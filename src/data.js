import { supabase } from './supabase.js';

function unwrap(result) {
  if (result.error) throw result.error;
  return result.data;
}

export async function listClients() {
  return unwrap(await supabase.from('clients').select('*').order('name', { ascending: true }));
}

export async function listProfiles() {
  return unwrap(await supabase.from('profiles').select('id,email,role,created_at').order('email'));
}

export async function updateProfileRole(id, role) {
  return unwrap(await supabase.from('profiles').update({ role }).eq('id', id).select().single());
}

export async function createClientRecord(values, userId) {
  const equipment = [values.onu && `ONU: ${values.onu}`, values.router && `Roteador: ${values.router}`].filter(Boolean).join(' · ');
  const today = new Date().toISOString().slice(0, 10);
  const row = {
    legacy_id: `web-${crypto.randomUUID()}`, name: values.name.trim(), contract: values.contract.trim(),
    street: values.street.trim(), neighborhood: values.neighborhood.trim(), city: values.city.trim(),
    onu: values.onu || null, router: values.router || null, equipment: equipment || null,
    status: 'NEGATIVADO', negativado_status: 'SIM', negative_date: today, negativation_date: today,
    created_by: userId,
  };
  return unwrap(await supabase.from('clients').insert(row).select().single());
}

export async function updateClientRecord(id, changes) {
  return unwrap(await supabase.from('clients').update(changes).eq('id', id).select().single());
}

export async function deleteClientRecord(id) {
  return unwrap(await supabase.from('clients').delete().eq('id', id));
}

function dateToIso(value) {
  if (!value) return null;
  const text = String(value).trim();
  const br = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function headerKey(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleUpperCase('pt-BR').replace(/\s+/g, ' ');
}

export function parseCsv(text) {
  const input = String(text).replace(/^\uFEFF/, '');
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (quoted) {
      if (char === '"' && input[i + 1] === '"') { field += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(field); field = ''; }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && input[i + 1] === '\n') i += 1;
      row.push(field); field = '';
      if (row.some((cell) => cell.trim())) rows.push(row);
      row = [];
    } else field += char;
  }
  row.push(field);
  if (row.some((cell) => cell.trim())) rows.push(row);
  if (rows.length < 2) throw new Error('O CSV precisa ter cabeçalho e ao menos uma linha de dados.');
  const headers = rows[0].map((header, index) => header.trim() || `COLUNA_VAZIA_${index + 1}`);
  return rows.slice(1).map((values) => Object.fromEntries(headers.map((header, index) => [header, (values[index] || '').trim()])));
}

function byHeader(row, header) {
  const key = headerKey(header);
  const found = Object.entries(row).find(([name]) => headerKey(name) === key);
  return found?.[1] || '';
}

export function normalizeCsvRows(records, userId) {
  let skipped = 0;
  const rows = [];
  for (const [index, item] of records.entries()) {
    const name = byHeader(item, 'H1') || byHeader(item, 'COLUNA_VAZIA_3') || byHeader(item, 'NOME') || byHeader(item, 'CLIENTE');
    const contract = byHeader(item, 'CONTRATO - NOME/RAZÃO SOCIAL');
    const street = byHeader(item, 'Endereço');
    const neighborhood = byHeader(item, 'Bairro');
    const city = byHeader(item, 'Cidade');
    if (![name, contract, street, neighborhood, city].every((value) => value.trim())) { skipped += 1; continue; }
    const rawStatus = headerKey(byHeader(item, 'NEGATIVADO'));
    const statusMap = { SIM: 'SIM', NAO: 'NÃO', 'EM CONTATO': 'EM CONTATO', REGULARIZADO: 'REGULARIZADO' };
    const negativadoStatus = statusMap[rawStatus] || 'SIM';
    const negDate = dateToIso(byHeader(item, 'DATA NEGATIVAÇÃO'));
    const regDate = dateToIso(byHeader(item, 'DATA REGULARIZAÇÃO'));
    const sourceId = byHeader(item, 'ID OCORRÊNCIA');
    const source = Object.fromEntries(Object.entries(item).map(([key, value]) => [key, value || null]));
    const resolutionText = byHeader(item, 'OBSERVAÇÕES');
    const regularized = negativadoStatus === 'REGULARIZADO';
    const legacyId = sourceId ? `csv-${sourceId}` : `csv-row-${index + 1}`;
    rows.push({
      legacy_id: legacyId, occurrence_id: sourceId || null, name, contract, street, neighborhood, city,
      equipment: byHeader(item, 'TIPO EQUIPAMENTO') || null,
      status: regularized ? 'REGULARIZADO' : 'NEGATIVADO', negativado_status: negativadoStatus,
      negative_date: negDate || regDate || new Date().toISOString().slice(0, 10), negativation_date: negDate,
      regularized_date: regularized ? (regDate || new Date().toISOString().slice(0, 10)) : null,
      regularization_date: regDate, resolution: regularized ? (resolutionText || 'Importado da planilha de inadimplentes.') : null,
      source_data: source, created_by: userId,
    });
  }
  return { rows, skipped };
}

export async function importCsv(records, userId) {
  const { rows, skipped } = normalizeCsvRows(records, userId);
  if (!rows.length) throw new Error('Nenhuma linha completa foi encontrada. Confira nome, contrato e endereço, bairro e cidade.');
  for (let start = 0; start < rows.length; start += 100) {
    unwrap(await supabase.from('clients').upsert(rows.slice(start, start + 100), { onConflict: 'legacy_id' }));
  }
  return { imported: rows.length, skipped };
}

function backupStatus(item) {
  const raw = headerKey(item.negativado_status || item.status);
  return ({ NEGATIVADO: 'SIM', REGULARIZADO: 'REGULARIZADO', NAO: 'NÃO', SIM: 'SIM', 'EM CONTATO': 'EM CONTATO' })[raw] || 'SIM';
}

export async function importBackup(records, userId) {
  if (!Array.isArray(records)) throw new Error('O arquivo de backup precisa conter uma lista de clientes.');
  const today = new Date().toISOString().slice(0, 10);
  const rows = records.map((item) => {
    const current = backupStatus(item);
    const regularized = current === 'REGULARIZADO';
    return {
      legacy_id: item.legacy_id || `backup-${crypto.randomUUID()}`,
      name: String(item.name || '').trim(), contract: String(item.contract || '').trim(), street: String(item.street || '').trim(),
      neighborhood: String(item.neighborhood || '').trim(), city: String(item.city || '').trim(), equipment: item.equipment || null,
      onu: item.onu || null, router: item.router || null, status: regularized ? 'REGULARIZADO' : 'NEGATIVADO',
      negativado_status: current, negative_date: dateToIso(item.negative_date || item.negativeDate) || today,
      negativation_date: dateToIso(item.negativation_date || item.negative_date || item.negativeDate),
      regularized_date: regularized ? (dateToIso(item.regularized_date || item.regularizedDate) || today) : dateToIso(item.regularized_date || item.regularizedDate),
      regularization_date: dateToIso(item.regularization_date || item.regularized_date || item.regularizedDate),
      resolution: regularized ? String(item.resolution || 'Importado do backup anterior.').trim() : null,
      created_by: userId,
    };
  });
  for (const row of rows) for (const field of ['name', 'contract', 'street', 'neighborhood', 'city']) if (!row[field]) throw new Error(`Há um cliente no backup sem ${field}.`);
  for (let start = 0; start < rows.length; start += 100) unwrap(await supabase.from('clients').upsert(rows.slice(start, start + 100), { onConflict: 'legacy_id' }));
  return rows.length;
}
