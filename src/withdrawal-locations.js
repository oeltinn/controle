const header = value => String(value ?? '').trim().toUpperCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[_\s]+/g, ' ');

export function locationWorkbookRows(cells) {
  const index = cells.findIndex(row => row.some(value => ['CONTRATO ID', 'ID CONTRATO', 'CONTRATO'].includes(header(value))) &&
    row.some(value => ['LATITUDE', 'LAT'].includes(header(value))) &&
    row.some(value => ['LONGITUDE', 'LON', 'LNG'].includes(header(value))));
  if (index < 0) return [];
  const headers = cells[index].map(header);
  return cells.slice(index + 1).map(row => Object.fromEntries(headers.map((key, column) => [key, row[column]])));
}

export function parseLocations(rows) {
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
