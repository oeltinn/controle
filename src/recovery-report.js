import { pulsoRows } from './pulso.js';
import { parseRows, between, summary, ranks, aging } from './recovery-metrics.js';

const escape = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const dateLabel = value => value ? value.split('-').reverse().join('/') : '';
const money = new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'});
const number = new Intl.NumberFormat('pt-BR');
const filters = {from:'',to:'',city:'',district:''};
const panel = (title,rows) => `<section class="panel"><div class="panel-head"><h3>${title}</h3></div>${rows.length ? `<table aria-label="${title}"><thead><tr><th>Categoria</th><th>Registros</th></tr></thead><tbody>${rows.map(([label,value])=>`<tr><th scope="row">${escape(label)}</th><td>${number.format(value)}</td></tr>`).join('')}</tbody></table>` : '<p class="empty">Nenhum registro neste recorte.</p>'}</section>`;
const card = (label,value) => `<div class="summary-card"><span>${label}</span><strong>${typeof value==='number'?number.format(value):escape(value)}</strong></div>`;

export function renderRecoveryReport(clients, root = document.getElementById('recoveryReport'), selection = filters) {
  const today = new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo'}).format(new Date());
  const {records} = parseRows(pulsoRows(clients),today);
  const options = values => [...new Set(values)].filter(Boolean).sort((a,b)=>a.localeCompare(b,'pt-BR')).map(v=>`<option value="${escape(v)}">${escape(v)}</option>`).join('');
  root.innerHTML = `<div class="recovery-filters" role="group" aria-label="Filtros dos indicadores">
    <label>Data inicial<input type="date" name="from"></label><label>Data final<input type="date" name="to"></label>
    <label>Cidade<select name="city"><option value="">Todas</option>${options(records.map(r=>r.city))}</select></label>
    <label>Bairro<select name="district"><option value="">Todos</option>${options(records.map(r=>r.district))}</select></label></div><div class="recovery-results"></div>`;
  const results = root.querySelector('.recovery-results');
  const controls = root.querySelectorAll('[name]');
  for (const el of controls) {
    el.value = selection[el.name];
    if (el.tagName === 'SELECT' && !el.value) selection[el.name] = '';
    el.addEventListener('change',()=>{ selection[el.name]=el.value; draw(); });
  }
  draw();
  function draw() {
    const {from,to,city,district} = selection;
    if (from && to && from > to) { results.innerHTML='<p role="alert">A data inicial deve vir antes da data final.</p>'; return; }
    const a=from||'2000-01-01', b=to||'2100-12-31';
    const scoped=records.filter(r=>(!city||r.city===city)&&(!district||r.district===district));
    const totals=summary(scoped,a,b,today);
    const events=scoped.filter(r=>between(r.negativeDate,a,b));
    const outcomes=scoped.filter(r=>between(r.regularDate,a,b)||(r.result.returned&&between(r.returnDate||r.regularDate,a,b))||(r.result.equipmentPaid&&between(r.paymentDate||r.regularDate,a,b)));
    const range = [from && 'Desde '+dateLabel(from),to && 'Até '+dateLabel(to),city,district].filter(Boolean).join(' · ');
    results.innerHTML = `<h2 class="section-heading">Indicadores de recuperação</h2><p class="chart-note">${escape(range||'Todo o histórico · todas as regiões')}</p>
      <div class="recovery-cards">${card('Negativações no período',totals.actions)}${card('Regularizações no período',totals.results)}${card('Devoluções registradas',totals.returned)}${card('Indenizações registradas',totals.equipmentPaid)}${card('Recebido por equipamento',totals.recordedReceipts?money.format(totals.receivedAmount):'Não informado')}${card('Mediana até regularização',totals.median==null?'Não informada':number.format(totals.median)+' dias')}</div>
      <div class="recovery-panels">${panel('Situação atual da carteira',[['Negativados',totals.negative],['Em contato',totals.contact],['Regularizados',totals.regular],['Não negativados',totals.notNegative],['Total',totals.total]])}
      ${panel('Negativações por cidade',ranks(events,r=>r.city))}${panel('Negativações por bairro',ranks(events,r=>r.district))}${panel('Resultado de equipamento',ranks(outcomes,r=>r.result.group))}
      ${panel('Tempo na carteira negativada',ranks(scoped.filter(r=>r.status==='negative'),r=>aging(r,today)))}${panel('Qualidade dos dados',ranks(scoped.flatMap(r=>r.issues),issue=>issue))}</div>
      <p class="chart-note">A carteira usa o estado atual dos cadastros. As ações e os resultados usam as respectivas datas. Valores recebidos exigem valor e data de recebimento.</p>`;
  }
}
