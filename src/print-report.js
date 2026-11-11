export function printReport(title, sections) {
  const report = document.createElement('article');
  report.className = 'pdf-report';
  const heading = document.createElement('h1');
  const date = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  heading.textContent = `${title} - ${date}`;
  report.append(heading, ...sections);
  report.querySelectorAll('button, .report-heading, .recovery-filters').forEach(element => element.remove());
  report.querySelectorAll('details').forEach(element => { element.open = true; });
  const footer = document.createElement('footer');
  footer.innerHTML = '<img src="/kontroll-mark.png" alt=""><div><strong>kontroll.</strong><br>Tudo sob controle. Tudo conectado.</div>';
  report.append(footer);
  const theme = document.body.dataset.theme;
  document.body.dataset.theme = 'light';
  document.body.classList.add('printing-report');
  document.body.append(report);
  const cleanup = () => {
    report.remove();
    document.body.classList.remove('printing-report');
    if (theme === undefined) delete document.body.dataset.theme;
    else document.body.dataset.theme = theme;
  };
  window.addEventListener('afterprint', cleanup, { once: true });
  window.print();
}
