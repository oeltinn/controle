const icons = {
  monthly: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  clients: '<rect x="5" y="3" width="14" height="18" rx="3"/><path d="M9 8h6m-6 4h6m-6 4h4"/>',
  withdrawals: '<path d="m12 3 9 5v8l-9 5-9-5V8l9-5Zm-9 5 9 5 9-5m-9 5v8m-4.5-15.5 9 5"/>',
};

function iphoneMaterial() {
  // Local visual QA only; Vite removes this override from preview builds.
  if (import.meta.env.DEV && new URLSearchParams(location.search).has('iphoneGlassTest')) return 'glass';
  const { userAgent, platform, maxTouchPoints } = navigator;
  const iphone = /\biPhone\b/i.test(userAgent) || platform === 'iPhone';
  if (!iphone || maxTouchPoints < 1 || /\biPad\b|Android|Windows/i.test(userAgent)) return null;

  const systemVersion = Number(userAgent.match(/iPhone OS (\d+)/)?.[1]);
  const safariVersion = Number(userAgent.match(/Version\/(\d+)/)?.[1]);
  const blur = CSS.supports('backdrop-filter', 'blur(1px)') ||
    CSS.supports('-webkit-backdrop-filter', 'blur(1px)');
  // Safari 26 can freeze the OS token at 18.6. Use Safari's version or a
  // WebKit capability introduced in that generation for standalone web apps.
  const modern = systemVersion >= 26 || safariVersion >= 26 ||
    CSS.supports('text-wrap', 'pretty');
  return blur && modern ? 'glass' : 'solid';
}

function prepareNavigation() {
  for (const button of document.querySelectorAll('.header-nav [data-view]')) {
    const icon = icons[button.dataset.view];
    if (!icon) continue;
    const label = document.createElement('span');
    label.textContent = button.textContent;
    button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${icon}</svg>`;
    button.append(label);
  }
}

function addNavigationLens() {
  const nav = document.querySelector('.header-nav');
  if (!nav) return;
  const lens = document.createElement('span');
  lens.className = 'iphone-nav-lens';
  lens.setAttribute('aria-hidden', 'true');
  nav.prepend(lens);

  const align = () => {
    const selected = nav.querySelector('[aria-current="page"]:not([hidden])');
    const visible = selected && selected.offsetWidth > 0;
    if (lens.hidden === visible) lens.hidden = !visible;
    if (!visible) return;
    lens.style.setProperty('--lens-x', `${selected.offsetLeft}px`);
    lens.style.setProperty('--lens-width', `${selected.offsetWidth}px`);
  };
  let frame = 0;
  const schedule = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      align();
    });
  };
  new MutationObserver(schedule).observe(nav, {
    subtree: true,
    attributes: true,
    attributeFilter: ['aria-current', 'hidden'],
  });
  if ('ResizeObserver' in window) new ResizeObserver(schedule).observe(nav);
  window.addEventListener('resize', schedule, { passive: true });
  schedule();
}

function addGlassControl() {
  const menu = document.querySelector('#adminMenu');
  const themeButton = document.querySelector('#mobileThemeToggle');
  if (!menu || !themeButton) return;
  const setting = document.createElement('label');
  setting.className = 'iphone-glass-setting';
  setting.innerHTML = '<span>Aparência do vidro</span><input type="range" min="0" max="100" step="1" aria-label="Aparência do vidro: fosco a líquido"><span class="iphone-glass-ends"><span>Fosco</span><span>Líquido</span></span>';
  themeButton.before(setting);
  const slider = setting.querySelector('input');
  let saved = 55;
  try {
    const stored = localStorage.getItem('kontroll.iphoneGlass');
    if (stored !== null) saved = Number(stored);
  } catch { /* Private browsing */ }
  slider.value = String(Math.max(0, Math.min(100, saved)));
  const apply = () => {
    const liquid = Number(slider.value) / 100;
    const dark = document.body.dataset.theme === 'dark';
    const opacity = (dark ? .82 : .84) - liquid * (dark ? .65 : .76);
    document.body.style.setProperty('--ios-glass', `rgba(${dark ? '16, 43, 34' : '244, 255, 249'}, ${opacity.toFixed(2)})`);
    document.body.style.setProperty('--ios-sheet', `rgba(${dark ? '20, 42, 35' : '247, 255, 251'}, ${(.94 - liquid * .35).toFixed(2)})`);
    document.documentElement.style.setProperty('--ios-liquid-level', slider.value);
    document.dispatchEvent(new Event('kontroll-glass-change'));
  };
  slider.addEventListener('input', apply);
  slider.addEventListener('change', () => {
    try { localStorage.setItem('kontroll.iphoneGlass', slider.value); } catch { /* Private browsing */ }
  });
  new MutationObserver(apply).observe(document.body, { attributes: true, attributeFilter: ['data-theme'] });
  apply();
}

function observeKeyboard(root) {
  const viewport = window.visualViewport;
  if (!viewport) return;

  const update = () => {
    const field = document.activeElement;
    const editing = field?.matches('textarea, input:not([type="checkbox"]):not([type="file"]):not([type="radio"]), [contenteditable="true"]');
    const occluded = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
    const keyboard = editing && viewport.scale === 1 && occluded > 100;
    root.toggleAttribute('data-iphone-keyboard', Boolean(keyboard));
    root.style.setProperty('--iphone-keyboard-inset', keyboard ? `${occluded}px` : '0px');
  };
  viewport.addEventListener('resize', update, { passive: true });
  viewport.addEventListener('scroll', update, { passive: true });
  document.addEventListener('focusin', update);
  document.addEventListener('focusout', () => requestAnimationFrame(update));
}

const material = iphoneMaterial();
if (material) {
  import('./iphone-interface.css').then(() => {
    const root = document.documentElement;
    prepareNavigation();
    const viewport = document.querySelector('meta[name="viewport"]');
    if (viewport) viewport.content += ', viewport-fit=cover';
    root.dataset.kontrollIphone = material;
    if (material === 'glass') {
      addNavigationLens();
      addGlassControl();
      import('./iphone-refraction.js').then(({ startRefraction }) => startRefraction())
        .catch(error => console.warn('Refração indisponível; usando transparência CSS.', error));
    }
    observeKeyboard(root);
  }).catch(error => console.warn('Interface do iPhone indisponível:', error));
}
