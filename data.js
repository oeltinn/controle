import { supabase } from './supabase.js';

function unwrap(result) {
  if (result.error) throw result.error;
  return result.data;
}

export async function listClients() {
  return unwrap(await supabase.from('clients').select('*').order('name', { ascending: true }));
}

export async function createClientRecord(values, userId) {
  const equipment = [values.onu && `ONU: ${values.onu}`, values.router && `Roteador: ${values.router}`]
    .filter(Boolean)
    .join(' · ');
  const row = {
    legacy_id: `web-${crypto.randomUUID()}`,
    name: values.name.trim(),
    contract: values.contract.trim(),
    street: values.street.trim(),
    neighborhood: values.neighborhood.trim(),
    city: values.city.trim(),
    onu: values.onu || null,
    router: values.router || null,
    equipment: equipment || null,
    status: 'NEGATIVADO',
    negative_date: new Date().toISOString().slice(0, 10),
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

function dateToIso(value, fallback) {
  if (!value) return fallback;
  const text = String(value).trim();
  const br = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString().slice(0, 10);
}

export function normalizeBackup(records, userId) {
  if (!Array.isArray(records)) throw new Error('O arquivo de backup precisa conter uma lista de clientes.');
  const today = new Date().toISOString().slice(0, 10);
  return records.map((item, index) => {
    const status = item.status === 'REGULARIZADO' ? 'REGULARIZADO' : 'NEGATIVADO';
    const resolution = status === 'REGULARIZADO'
      ? String(item.resolution || 'Importado do sistema anterior sem descrição da regularização.').trim()
      : null;
    return {
    legacy_id: `web-${crypto.randomUUID()}`,
      name: String(item.name || '').trim(),
      contract: String(item.contract || '').trim(),
      street: String(item.street || '').trim(),
      neighborhood: String(item.neighborhood || '').trim(),
      city: String(item.city || '').trim(),
      equipment: item.equipment ? String(item.equipment) : null,
      onu: item.onu ? String(item.onu) : null,
      router: item.router ? String(item.router) : null,
      status,
      negative_date: dateToIso(item.negative_date ?? item.negativeDate, today),
      resolution,
      regularized_date: status === 'REGULARIZADO'
        ? dateToIso(item.regularized_date ?? item.regularizedDate, today)
        : null,
      created_by: userId,
    };
  }).map((row) => {
    for (const field of ['name', 'contract', 'street', 'neighborhood', 'city']) {
      if (!row[field]) throw new Error(`Há um cliente no backup sem ${field}. Confira o cadastro antes de importar.`);
    }
    return row;
  });
}

export async function importBackup(records, userId) {
  const rows = normalizeBackup(records, userId);
  if (!rows.length) return 0;
  // Split requests so a large local file does not exceed API request limits.
  for (let start = 0; start < rows.length; start += 100) {
    unwrap(await supabase.from('clients').upsert(rows.slice(start, start + 100), { onConflict: 'legacy_id' }));
  }
  return rows.length;
}

