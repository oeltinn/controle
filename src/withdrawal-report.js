const monthFormat = new Intl.DateTimeFormat('sv-SE', {
  year: 'numeric', month: '2-digit', timeZone: 'America/Sao_Paulo',
});
const monthLabel = month => month.split('-').reverse().join('/');
const escape = value => String(value).replace(/[&<>"']/g, char =>
  ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'})[char]);
const series = [
  ['attempts', 'Tentativas'],
  ['collected', 'Equipamentos recolhidos'],
  ['equipment_not_found', 'Equipamentos não encontrados'],
];
const number = new Intl.NumberFormat('pt-BR');
const percentage = new Intl.NumberFormat('pt-BR', {style:'percent', maximumFractionDigits:1});
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

function columns(groups) {
  if (!groups.length) return '<p class="empty">Nenhum registro no período.</p>';
  const max = groups.reduce((largest, [, row]) => Math.max(largest, row.collected), 1);
  return `<div class="withdrawal-chart-scroll" tabindex="0" role="region" aria-label="Gráfico de equipamentos recolhidos"><ul class="withdrawal-columns">
    ${groups.map(([label,{collected}])=>`<li>
      <div class="withdrawal-column-plot"><strong>${number.format(collected)}</strong>
        <span class="withdrawal-column" aria-hidden="true" style="--height:${100 * collected / max}%"></span>
      </div><span class="withdrawal-column-label">${escape(label)}</span>
    </li>`).join('')}</ul></div>`;
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
  root.innerHTML = panel('Retiradas concluídas por mês', columns(months.map(([month,row])=>[monthLabel(month),row])))
    + panel('Ranking de recolhimentos', columns(ranking(people,'collected')));
}

function resultTable(title, label, rows, totals) {
  const max = rows.reduce((largest, [,row])=>Math.max(largest, row.attempts), 1);
  const cells = (row, plot) => series.map(([key])=>`<td>${number.format(row[key])}${plot ?
    `<span class="withdrawal-data-bar" style="--width:${100 * row[key] / max}%" aria-hidden="true"></span>` : ''}</td>`).join('');
  return panel(title, rows.length ? `<table class="withdrawal-report-table" aria-label="${title}">
    <thead><tr><th scope="col">${label}</th>${series.map(([,name])=>`<th scope="col">${name}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(([name,row])=>`<tr><th scope="row">${escape(name)}</th>${cells(row,true)}</tr>`).join('')}</tbody>
    ${totals ? `<tfoot><tr><th scope="row">Total</th>${cells(totals)}</tr></tfoot>` : ''}
    </table>` : '<p class="empty">Nenhum registro no período.</p>');
}

export function renderWithdrawalReport(root, visits, from, to, city = '') {
  if (from && to && from > to) {
    root.innerHTML = '<p role="alert">O mês inicial deve vir antes do mês final.</p>';
    return;
  }
  const {months, people, totals} = withdrawalMetrics(visits, from, to);
  const period = [from && 'Desde '+monthLabel(from), to && 'Até '+monthLabel(to)].filter(Boolean).join(' · ');
  const rate = totals.attempts ? percentage.format(totals.collected / totals.attempts) : '—';
  const indicators = [...series.map(([key,label])=>[label,number.format(totals[key])]), ['Taxa de recolhimento',rate]];
  root.innerHTML = `<p class="withdrawal-report-meta"><strong>${escape(period || 'Todo o histórico')}</strong> · ${escape(city || 'Todas as cidades')}</p>
    ${panel('Retiradas concluídas por mês', columns(months.map(([month,row])=>[monthLabel(month),row])))}
    <div class="recovery-cards withdrawal-indicators">${indicators.map(([label,value])=>`<div class="summary-card"><span>${label}</span><strong>${value}</strong></div>`).join('')}</div>
    <p class="chart-note">O mês segue a data do registro no horário de Brasília. Os resultados contam registros de visita. A taxa divide os recolhimentos pelas tentativas. O ranking usa o responsável que registrou a visita.</p>
    ${resultTable('Tentativas e resultados por mês','Mês',months.map(([month,row])=>[monthLabel(month),row]),totals)}
    ${resultTable('Ranking de tentativas por responsável','Responsável',ranking(people,'attempts'))}`;
}
