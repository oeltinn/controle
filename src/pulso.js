const fields = [
  'CONTRATO', 'CLIENTE', 'ENDEREÇO', 'BAIRRO', 'CIDADE', 'NEGATIVADO',
  'CONTRATO ASSINADO', 'DATA NEGATIVAÇÃO', 'DATA REGULARIZAÇÃO', 'OBSERVAÇÕES',
  'ID OCORRÊNCIA', 'RESULTADO EQUIPAMENTO', 'TIPO EQUIPAMENTO', 'SERIE / MAC',
  'QTD EM COMODATO', 'QTD DEVOLVIDA', 'DATA DEVOLUÇÃO', 'CONDIÇÃO DEVOLUÇÃO',
  'MOTIVO INDENIZAÇÃO', 'VALOR ATUAL EQUIPAMENTO', 'VALOR RECEBIDO EQUIPAMENTO',
  'DATA RECEBIMENTO', 'COMPROVANTE / REFERÊNCIA', 'RESPONSÁVEL', 'DATA ÚLTIMO CONTATO',
  'PRÓXIMO RETORNO', 'PRÓXIMA AÇÃO', 'DATA SUSPENSÃO', 'OBS EQUIPAMENTO', 'DIFERENÇA DE VALOR (REF.)'
];
const key = value => value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().replace(/\s+/g,' ').toUpperCase();
const date = value => /^\d{4}-\d{2}-\d{2}$/.test(value ?? '') ? value.split('-').reverse().join('/') : '';

export function pulsoRows(clients) {
  return [fields, ...clients.map(client => {
    const raw = new Map(Object.entries(client.source_data ?? {}).map(([k,v]) => [key(k), v]));
    const row = fields.map(field => raw.get(key(field)) ?? '');
    row[0]=client.contract; row[1]=client.name; row[2]=client.street;
    row[3]=client.neighborhood; row[4]=client.city;
    row[5]=client.negativado_status || (client.status==='REGULARIZADO'?'REGULARIZADO':'SIM');
    row[7]=date(client.negativation_date || (!client.negativado_status ? client.negative_date : null)) || row[7];
    row[8]=date(client.regularization_date) || row[8];
    row[9]=client.resolution || row[9];
    row[10]=client.occurrence_id || row[10];
    row[12]=client.equipment || row[12];
    return row;
  })];
}
