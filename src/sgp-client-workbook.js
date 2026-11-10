const key = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleUpperCase('pt-BR').replace(/\s+/g, ' ');

export function parseSgpClientRows(cells) {
  const required = ['CONTRATO ID','NOME/RAZAO SOCIAL','ENDERECO','BAIRRO','CIDADE','STATUS'];
  const headerIndex = cells.findIndex(row => required.every(name => row.some(value => key(value) === name)));
  if (headerIndex < 0) throw new Error('A planilha do SGP precisa das colunas Contrato ID, Nome/Razão Social, Endereço, Bairro, Cidade e Status.');
  const headers = cells[headerIndex].map(key);
  // The export also contains passwords. Only these allowlisted fields leave the parser.
  const at = (row, name) => String(row[headers.indexOf(name)] ?? '').trim();
  return cells.slice(headerIndex + 1).map(row => ({
    'CONTRATO ID': at(row,'CONTRATO ID'),
    'CLIENTE': at(row,'NOME/RAZAO SOCIAL'),
    'ENDEREÇO': at(row,'ENDERECO'),
    'NÚMERO': at(row,'NUMERO'),
    'BAIRRO': at(row,'BAIRRO'),
    'CIDADE': at(row,'CIDADE'),
    'CELULARES': at(row,'CELULARES'),
    'TELEFONES': at(row,'TELEFONES'),
    'STATUS': at(row,'STATUS'),
  })).filter(row => row['CONTRATO ID']);
}

