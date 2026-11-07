const monthFormat = new Intl.DateTimeFormat('sv-SE', {
  year: 'numeric', month: '2-digit', timeZone: 'America/Sao_Paulo',
});
const monthLabel = month => month.split('-').reverse().join('/');
const escape = value => String(value).replace(/[&<>"']/g, char =>
  ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'})[char]);
const series = [
  ['attempts', 'Tentativas', 'attempts'],
  ['collected', 'Equipamentos recolhidos', 'collected'],
  ['equipment_not_found', 'Equipamentos não encontrados', 'missing'],
];
const counts = () => ({attempts:0, collected:0, equipment_not_found:0});

export function withdrawalMetrics(visits, from = '', to = '') {
  const months = new Map();
  const people = new Map();
  const totals = counts();
  for (const visit of visits) {
    if (visit.result === 'pending') continue;
    const date = new Date(visit.created_at);
    if (!visit.created_at || Number.isNaN(date.getTime())) continue;
    const month = monthFormat.format(date);
    if ((from && month < from) || (to && month > to)) continue;
    const monthly = months.get(month) || counts();
    const name = visit.technician_name || 'Responsável não informado';
    const key = visit.technician_id || name;
    const person = people.get(key) || {name, ...counts()};
    for (const group of [totals, monthly, person]) {
      group.attempts++;
      if (visit.result === 'collected' || visit.result === 'equipment_not_found') group[visit.result]++;
    }
    months.set(month, monthly);
    people.set(key, person);
  }
  return {months:[...months].sort(([a],[b])=>a.localeCompare(b)), people:[...people.values()], totals};
}

function bars(groups, fields) {
  if (!groups.length) return '<p class="empty">Nenhum registro no período.</p>';
  const max = Math.max(1, ...groups.flatMap(([,row])=>fields.map(([key])=>row[key])));
  return `<ul class="withdrawal-bars">${groups.map(([label,row])=>`
    <li><strong>${escape(label)}</strong>${fields.map(([key,caption,color])=>`
      <div class="withdrawal-bar-row"><span>${caption}</span>
      <meter class="${color}" min="0" max="${max}" value="${row[key]}" aria-label="${caption}"></meter>
      <b>${row[key]}</b></div>`).join('')}</li>`).join('')}</ul>`;
}

function ranking(people, key) {
  return people.filter(person=>person[key]).sort((a,b)=>b[key]-a[key] || a.name.localeCompare(b.name,'pt-BR'))
    .map(person=>[person.name,person]);
}

function panel(title, content) {
  return `<section class="panel withdrawal-metric"><div class="panel-head"><h3>${title}</h3></div>${content}</section>`;
}

export function renderWithdrawalOverview(root, visits) {
  const {months, people} = withdrawalMetrics(visits);
  root.innerHTML = panel('Retiradas concluídas por mês', bars(months.map(([month,row])=>[monthLabel(month),row]), [series[1]]))
    + panel('Ranking de recolhimentos', bars(ranking(people,'collected'), [series[1]]));
}

export function renderWithdrawalReport(root, visits, from, to) {
  if (from && to && from > to) {
    root.innerHTML = '<p role="alert">O mês inicial deve vir antes do mês final.</p>';
    return;
  }
  const {months, people, totals} = withdrawalMetrics(visits, from, to);
  const period = [from && 'Desde '+monthLabel(from), to && 'Até '+monthLabel(to)].filter(Boolean).join(' · ');
  root.innerHTML = `<p class="chart-note">${period || 'Todo o histórico'}</p>
    <div class="recovery-cards">${series.map(([key,label])=>`<div class="summary-card"><span>${label}</span><strong>${totals[key]}</strong></div>`).join('')}</div>
    ${panel('Tentativas e resultados por mês',bars(months.map(([month,row])=>[monthLabel(month),row]),series))}
    ${panel('Ranking de tentativas por responsável',bars(ranking(people,'attempts'),[series[0]]))}
    <p class="chart-note">Cada visita registrada conta como uma tentativa, agrupada pelo mês do registro no horário de Brasília. Os resultados contam registros de visita. O ranking usa o responsável que registrou a visita.</p>`;
}
