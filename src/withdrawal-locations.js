const header = value => String(value ?? '').trim().toUpperCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[_\s]+/g, ' ');

export function locationWorkbookRows(cells) {
  const index = cells.findIndex(row => isSystemReport(row.map(header)) || (row.some(value => ['CONTRATO ID', 'ID CONTRATO', 'CONTRATO'].includes(header(value))) &&
    row.some(value => ['LATITUDE', 'LAT'].includes(header(value))) &&
    row.some(value => ['LONGITUDE', 'LON', 'LNG'].includes(header(value)))));
  if (index < 0) return [];
  const headers = cells[index].map(header);
  return cells.slice(index + 1).map(row => Object.fromEntries(headers.map((key, column) => [key, row[column]])));
}

function isSystemReport(headers) {
  return ['OBJETO', 'OBJETO RELACIONADO', 'HISTORICO', 'DATA'].every(key => headers.includes(key));
}

function parseSystemReport(rows) {
  const latest = new Map();
  for (const row of rows) {
    const message = [row['OBJETO RELACIONADO'], row.HISTORICO].filter(Boolean).join('\n');
    const contract = message.match(/\bContrato\s+ID\s*[:#]?\s*(\d+)\b/i)?.[1];
    const change = message.match(/Latitude\s*,\s*Longitude\s*:\s*Alterado de[^\r\n]*?\bpara([^\r\n]*)/i);
    const date = String(row.DATA ?? '').trim().match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}:\d{2}:\d{2})$/);
    if (!contract || !change || !date) continue;
    const [, day, month, year, time] = date;
    const source_changed_at = `${year}-${month}-${day}T${time}-03:00`;
    if (!Number.isFinite(Date.parse(source_changed_at))) continue;
    const destination = change[1].trim();
    const pair = destination.match(/^([-+]?\d+(?:\.\d+)?)\s*,\s*([-+]?\d+(?:\.\d+)?)$/);
    let latitude = null;
    let longitude = null;
    if (pair) {
      latitude = Number(pair[1]);
      longitude = Number(pair[2]);
      if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) continue;
      if (latitude === 0 && longitude === 0) latitude = longitude = null;
    } else if (destination) continue;
    const previous = latest.get(contract);
    if (previous && previous.source_changed_at >= source_changed_at) continue;
    latest.set(contract, { contract_id: contract, latitude, longitude, source_changed_at });
  }
  if (!latest.size) throw new Error('Nenhuma alteração de localização com ID do contrato e data foi encontrada no relatório.');
  return [...latest.values()];
}

export function parseLocations(rows) {
  const normalized = rows.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [header(key), value])));
  if (normalized[0] && isSystemReport(Object.keys(normalized[0]))) return parseSystemReport(normalized);
  const locations = new Map();
  for (const [index, row] of rows.entries()) {
    const fields = new Map(Object.entries(row).map(([key, value]) => [header(key), value]));
    const contract = String(fields.get('CONTRATO ID') ?? fields.get('ID CONTRATO') ?? fields.get('CONTRATO') ?? '').trim();
    const lat = String(fields.get('LATITUDE') ?? fields.get('LAT') ?? '').trim();
    const lon = String(fields.get('LONGITUDE') ?? fields.get('LON') ?? fields.get('LNG') ?? '').trim();
    if (!lat && !lon) continue;
    const latitude = Number(lat.replace(',', '.'));
    const longitude = Number(lon.replace(',', '.'));
    if (!/^\d+$/.test(contract) || !lat || !lon || !Number.isFinite(latitude) ||
        !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180 ||
        (latitude === 0 && longitude === 0)) {
      throw new Error(`Coordenadas ou contrato inválidos no registro ${index + 1}.`);
    }
    const previous = locations.get(contract);
    if (previous && (previous.latitude !== latitude || previous.longitude !== longitude)) {
      throw new Error(`O contrato ${contract} tem coordenadas divergentes.`);
    }
    locations.set(contract, { contract_id: contract, latitude, longitude });
  }
  if (!locations.size) throw new Error('O arquivo precisa conter Contrato ID, Latitude e Longitude preenchidos.');
  return [...locations.values()];
}
