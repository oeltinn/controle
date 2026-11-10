import { supabase } from './supabase.js';
import { parseSgpClientRows } from './sgp-client-workbook.js';

function unwrap(result) {
  if (result.error) throw result.error;
  return result.data;
}

export async function listClients() {
  return listAll('clients', 'name');
}

// Supabase caps each response; dashboards must include every page.
async function listAll(table, sort, ascending = true) {
  const rows = [];
  for (let start = 0; ; start += 1000) {
    const page = unwrap(await supabase.from(table).select('*').order(sort, { ascending }).order('id').range(start, start + 999));
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}

export async function listProfiles() {
  return unwrap(await supabase.from('profiles').select('id,email,role,display_name,phone,created_at').order('display_name'));
}

export async function getMyProfile(userId) {
  return unwrap(await supabase.from('profiles').select('id,email,role,display_name,phone').eq('id', userId).single());
}

export async function updateMyProfile(userId, values) {
  return unwrap(await supabase.from('profiles').update({ display_name: values.display_name.trim(), phone: values.phone.trim() || null }).eq('id', userId).select('id,email,role,display_name,phone').single());
}

export async function updateProfileRole(id, role) {
  const profile = unwrap(await supabase.rpc('admin_update_profile_role', { p_user_id: id, p_role: role }));
  if (!profile) throw new Error('A permissão não foi alterada. Confirme que sua conta é administradora.');
  return profile;
}

export async function createClientRecord(values, userId) {
  const equipment = [values.onu && `ONU: ${values.onu}`, values.router && `Roteador: ${values.router}`].filter(Boolean).join(' · ');
  const today = new Date().toISOString().slice(0, 10);
  const row = {
    legacy_id: `web-${crypto.randomUUID()}`, name: values.name.trim(), contract: values.contract.trim(), phone: values.phone ?? null,
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

export function parseCsv(text, { sgpContracts = false, equipmentCatalog = false, clientCatalog = false } = {}) {
  const input = String(text).replace(/^\uFEFF/, '');
  const lines = input.split(/\r?\n/);
  const catalogHeader = cells => {
    const keys = cells.map(headerKey);
    return keys.some(key=>['CONTRATO','CONTRATO ID','ID CONTRATO'].includes(key)) &&
      keys.some(key=>['MODELO','MODELO ONU','EQUIPAMENTO'].includes(key));
  };
  const header = cells => sgpContracts ? ['CLIENTE ID','CONTRATO ID','CLIENTE','ENDERECO','STATUS'].every(key=>cells.some(cell=>headerKey(cell)===key)) : clientCatalog ? ['CONTRATO ID','CLIENTE','ENDERECO','BAIRRO','CIDADE'].every(key=>cells.some(cell=>headerKey(cell)===key)) : catalogHeader(cells);
  const hasPreamble = sgpContracts || equipmentCatalog || clientCatalog;
  const firstLine = (hasPreamble ? lines.find(line=>header(line.split(/[,;\t]/).map(cell=>cell.replaceAll('"','')))) : lines[0]) || '';
  if (hasPreamble && !firstLine) throw new Error(equipmentCatalog ? 'O catálogo precisa das colunas Contrato e Modelo.' : clientCatalog ? 'O catálogo precisa das colunas Contrato ID, Cliente, Endereço, Bairro e Cidade.' : 'Use o CSV do relatório Contrato → Status do SGP.');
  const delimiter = [',', ';', '\t'].map((candidate) => ({ candidate, count: firstLine.split(candidate).length - 1 })).sort((a, b) => b.count - a.count)[0].candidate;
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (quoted) {
      if (char === '"' && input[i + 1] === '"') { field += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === delimiter) { row.push(field); field = ''; }
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
  const headerRow = hasPreamble ? rows.findIndex(header) : 0;
  if (headerRow < 0) throw new Error('Não foi possível localizar o cabeçalho do CSV.');
  const headers = rows[headerRow].map((header, index) => header.trim() || `COLUNA_VAZIA_${index + 1}`);
  return rows.slice(headerRow + 1).map((values) => Object.fromEntries(headers.map((header, index) => [header, (values[index] || '').trim()])));
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

export function normalizeWithdrawalCity(value) {
  const city = String(value ?? '').trim().replace(/\s+/g,' ');
  const key = headerKey(city);
  return ['PIEDADE DE CARATINGA','PIEDADE DE CARTINGA','PIEDDE DE CARATINGA'].includes(key) ? 'PIEDADE DE CARATINGA' : city;
}

export function normalizeWithdrawalCsv(records, userId) {
  let skipped = 0;
  const rows = new Map();
  const pick = (row, names) => {
    for (const name of names) { const value = byHeader(row, name); if (value) return value; }
    return '';
  };
  for (const item of records) {
    const contract = byHeader(item, 'CONTRATO ID');
    const name = byHeader(item, 'CLIENTE');
    const street = byHeader(item, 'ENDEREÇO');
    if (!/^\d+$/.test(contract) || !name || !street || !/^SUSPENS[OA]$/.test(headerKey(byHeader(item,'STATUS'))) || rows.has(contract)) { skipped += 1; continue; }
    const address = [[street,byHeader(item,'NÚMERO')].filter(Boolean).join(', '),
      ...['COMPLEMENTO','PONTO DE REFERENCIA','BAIRRO','CIDADE','UF','CEP'].map(field=>byHeader(item,field))].filter(Boolean).join(' · ');
    rows.set(contract,{
      legacy_id: `csv-retirada-sgp-${contract}`, contract_id: contract, name,
      phone: pick(item, ['TELEFONE', 'CELULAR', 'CONTATO']) || null,
      address, city: normalizeWithdrawalCity(byHeader(item,'CIDADE')), district: byHeader(item,'BAIRRO'),
      equipment: 'A identificar', created_by: userId,
    });
  }
  return { rows: [...rows.values()], skipped };
}

export async function findContractEquipment(contract) {
  if (!/^\d+$/.test(contract)) return null;
  return unwrap(await supabase.from('sgp_contract_equipment').select('equipment').eq('contract_id',contract).maybeSingle())?.equipment ?? null;
}

export async function getClientCatalogState() {
  return unwrap(await supabase.from('sgp_client_catalog_state').select('imported_at,filename,row_count').eq('id',true).maybeSingle());
}

export async function findClientCatalogContract(contract) {
  if (!/^\d+$/.test(contract)) return null;
  return unwrap(await supabase.from('sgp_client_catalog').select('contract_id,name,phone,street,neighborhood,city,equipment,status').eq('contract_id',contract).maybeSingle());
}

export async function parseSgpClientWorkbook(file) {
  const { readSheet } = await import('read-excel-file/browser');
  return parseSgpClientRows(await readSheet(file));
}

export async function replaceClientCatalog(records, filename) {
  const rows = new Map();
  for (const record of records) {
    const contract_id = byHeader(record,'CONTRATO ID');
    const name = byHeader(record,'CLIENTE');
    const street = [byHeader(record,'ENDEREÇO'),byHeader(record,'NÚMERO')].filter(Boolean).join(', ');
    const neighborhood = byHeader(record,'BAIRRO');
    const city = normalizeWithdrawalCity(byHeader(record,'CIDADE'));
    if (!/^\d+$/.test(contract_id) || !name || !street || !neighborhood || !city) continue;
    const rawPhone = byHeader(record,'CELULARES') || byHeader(record,'TELEFONES') || byHeader(record,'TELEFONE') || byHeader(record,'CELULAR') ||
      Object.entries(record).find(([key,value])=>key.startsWith('COLUNA_VAZIA_') && /\(?\d{2}\)?\s*\d{4,5}[-\s]?\d{4}/.test(value))?.[1] || '';
    const phone = rawPhone.match(/\(?\d{2}\)?\s*\d{4,5}[-\s]?\d{4}/)?.[0] || '';
    const status = byHeader(record,'STATUS') || null;
    rows.set(contract_id,{contract_id,name,phone,street,neighborhood,city,equipment:byHeader(record,'EQUIPAMENTO') || null,status});
  }
  if (!rows.size) throw new Error('Use o CSV do SGP com Contrato ID, Cliente, Endereço, Bairro e Cidade.');
  return unwrap(await supabase.rpc('replace_sgp_client_catalog',{p_filename:filename,p_rows:[...rows.values()]}));
}

export async function listWithdrawalEquipmentModels() {
  const models = new Set();
  for (let start = 0; ; start += 1000) {
    const rows = unwrap(await supabase.from('sgp_contract_equipment').select('equipment').order('contract_id').range(start,start+999));
    for (const row of rows) for (const model of row.equipment.split(' · ')) {
      if (model.trim()) models.add(model.trim());
    }
    if (rows.length < 1000) return [...models].sort((a,b)=>a.localeCompare(b,'pt-BR'));
  }
}

export async function importContractEquipment(records) {
  const catalog = new Map();
  for (const record of records) {
    const contractCell = byHeader(record, 'Contrato ID') || byHeader(record, 'ID Contrato') || byHeader(record, 'Contrato');
    const contract = contractCell.match(/^(\d+)(?:\s+[-–]\s+.+)?$/)?.[1];
    const equipment = byHeader(record, 'Modelo') || byHeader(record, 'Equipamento') || byHeader(record, 'Modelo ONU');
    if (!contract || !equipment || /^[-–—]+$/.test(equipment)) continue;
    if (!catalog.has(contract)) catalog.set(contract, new Set());
    catalog.get(contract).add(equipment);
  }
  if (!catalog.size) throw new Error('O catálogo precisa conter as colunas Contrato ID e Modelo.');
  const importedAt = new Date().toISOString();
  const rows = [...catalog].map(([contract_id, models]) => ({
    contract_id, equipment: [...models].sort().join(' · '), imported_at: importedAt,
  }));
  for (let start = 0; start < rows.length; start += 100) {
    unwrap(await supabase.from('sgp_contract_equipment').upsert(rows.slice(start, start + 100), {onConflict:'contract_id'}));
  }
  return rows.length;
}

export async function listWithdrawals() {
  return listAll('onu_withdrawals', 'name');
}

export async function createWithdrawal(values, userId) {
  const row = { legacy_id: `retirada-${crypto.randomUUID()}`, contract_id: values.contract || null, name: values.name.trim(), phone: values.phone?.trim() || null, address: values.address.trim(), city: values.city.trim(), district: values.district.trim(), equipment: values.equipment.trim() || 'A identificar', created_by: userId };
  return unwrap(await supabase.from('onu_withdrawals').insert(row));
}

export async function importWithdrawalsCsv(records, filename) {
  const { rows, skipped } = normalizeWithdrawalCsv(records);
  if (!rows.length) throw new Error('Nenhum contrato suspenso com ID, cliente e endereço foi encontrado.');
  const result = unwrap(await supabase.rpc('import_onu_withdrawal_batch', {p_filename:filename, p_rows:rows}));
  return { ...result, skipped };
}

export const listWithdrawalImports = () => listAll('onu_withdrawal_imports', 'created_at', false);
export async function deleteWithdrawalImport(id) {
  return unwrap(await supabase.from('onu_withdrawal_imports').delete().eq('id',id).select('id').single());
}
export async function deleteWithdrawal(id) {
  return unwrap(await supabase.from('onu_withdrawals').delete().eq('id',id).select('id').single());
}

export async function listWithdrawalVisits() {
  return listAll('onu_withdrawal_visits', 'created_at', false);
}

export async function recordWithdrawalVisit(withdrawalId, result, observation) {
  const visit = unwrap(await supabase.rpc('record_onu_withdrawal_visit', { p_withdrawal_id: withdrawalId, p_result: result, p_observation: observation.trim() }));
  if (!visit) throw new Error('Sua conta não tem autorização para registrar essa visita.');
  return visit;
}

export async function updateWithdrawal(id, changes) {
  return unwrap(await supabase.from('onu_withdrawals').update(changes).eq('id', id).select().single());
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




