export function previewData() {
  const month = new Date();
  const date = offset => {
    const value = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + offset, 8));
    return value.toISOString().slice(0, 10);
  };
  const clients = ['SIM', 'REGULARIZADO', 'EM CONTATO', 'SIM', 'SIM', 'REGULARIZADO'].map((status, index) => ({
    id: `demo-client-${index}`,
    name: `Cliente de demonstração ${index + 1}`,
    contract: String(10001 + index),
    street: 'Rua de Exemplo, 100',
    neighborhood: index % 2 ? 'Centro' : 'Vila Modelo',
    city: 'Cidade Exemplo',
    equipment: 'ZTE F670L',
    negativado_status: status,
    negativation_date: date(-index % 4),
    regularization_date: status === 'REGULARIZADO' ? date(0) : null,
    resolution: status === 'REGULARIZADO' ? 'Acordo de demonstração concluído.' : null,
  }));
  const withdrawals = Array.from({ length: 4 }, (_, index) => ({
    id: `demo-withdrawal-${index}`,
    name: `Retirada de demonstração ${index + 1}`,
    contract_id: String(20001 + index),
    address: `Rua de Exemplo, ${20 + index}`,
    district: 'Centro',
    city: index < 3 ? 'Cidade Exemplo' : 'Cidade Modelo',
    equipment: 'ZTE F601 V7.1',
  }));
  const visits = ['collected', 'no_answer', 'collected'].map((result, index) => ({
    withdrawal_id: withdrawals[index].id,
    result,
    created_at: `${date(-index)}T15:00:00Z`,
    technician_name: 'Técnico de demonstração',
    observation: 'Registro fictício para verificar a interface.',
  }));
  return { clients, withdrawals, visits };
}
