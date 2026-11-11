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
  const safari = /Safari\//i.test(userAgent) &&
    (/Version\/\d+/i.test(userAgent) || navigator.standalone === true) &&
    !/CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo|GSA|YaBrowser|Mercury/i.test(userAgent);
  if (!safari) return null;

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
  const profile = document.querySelector('#profileOverlay .dialog');
  if (!menu || !profile) return;
  const setting = document.createElement('label');
  setting.className = 'iphone-glass-setting';
  setting.innerHTML = '<span>Aparência do vidro</span><input type="range" min="0" max="100" step="1" aria-label="Aparência do vidro: fosco a líquido"><span class="iphone-glass-ends"><span>Fosco</span><span>Líquido</span></span>';
  profile.querySelector('#profileForm').before(setting);
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
    document.body.style.setProperty('--ios-glass', `rgba(${dark ? '28, 28, 30' : '244, 255, 249'}, ${opacity.toFixed(2)})`);
    document.body.style.setProperty('--ios-sheet', `rgba(${dark ? '36, 36, 38' : '247, 255, 251'}, ${(.94 - liquid * .35).toFixed(2)})`);
    document.documentElement.style.setProperty('--ios-liquid-level', slider.value);
  };
  slider.addEventListener('input', apply);
  slider.addEventListener('change', () => {
    try { localStorage.setItem('kontroll.iphoneGlass', slider.value); } catch { /* Private browsing */ }
    document.dispatchEvent(new Event('kontroll-glass-change'));
  });
  new MutationObserver(apply).observe(document.body, { attributes: true, attributeFilter: ['data-theme'] });
  apply();
}

function prepareProfileSheet() {
  const menu = document.querySelector('#adminMenu');
  const toggle = document.querySelector('#adminMenuToggle');
  const bell = document.querySelector('#notificationBell');
  if (!menu || !toggle || !bell) return;
  const heading = document.createElement('div');
  heading.className = 'iphone-profile-heading';
  heading.innerHTML = '<img src="/kontroll-mark.png" alt=""><span>Minha conta</span><button type="button" aria-label="Fechar perfil"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round"><path d="M5 5l14 14M19 5 5 19"/></svg></button>';
  heading.querySelector('button').addEventListener('click', () => toggle.click());
  menu.prepend(heading);
  const account = menu.querySelector('.mobile-account');
  const settingsButton = account.querySelector('#mobileProfileButton');
  const logoutButton = account.querySelector('#logoutButton');
  settingsButton.hidden = true;
  account.setAttribute('role', 'button');
  account.setAttribute('tabindex', '0');
  account.setAttribute('aria-label', 'Configurar conta e senha');
  account.addEventListener('click', () => settingsButton.click());
  account.addEventListener('keydown', event => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    settingsButton.click();
  });
  const chevron = document.createElement('span');
  chevron.className = 'iphone-account-chevron';
  chevron.setAttribute('aria-hidden', 'true');
  chevron.textContent = '›';
  account.append(chevron);
  toggle.innerHTML = '<svg viewBox="0 0 24 24" width="23" height="23" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="8" r="3.5"/><path d="M4.5 20c.4-4 3-6 7.5-6s7.1 2 7.5 6"/></svg><span class="iphone-profile-badge" hidden></span>';
  toggle.setAttribute('aria-label', 'Abrir perfil');
  toggle.title = 'Perfil';
  const notifications = document.createElement('button');
  notifications.type = 'button';
  notifications.className = 'iphone-notifications-link';
  notifications.innerHTML = '<span>Notificações</span><span class="iphone-notifications-count" hidden></span><span aria-hidden="true">›</span>';
  notifications.addEventListener('click', () => {
    toggle.click();
    bell.click();
  });
  menu.querySelector('.mobile-account').after(notifications);
  const options = document.createElement('div');
  options.className = 'iphone-profile-options';
  notifications.before(options);
  options.append(notifications, menu.querySelector('#openCatalog'),
    menu.querySelector('#openImports'), menu.querySelector('#manageUsersBtn'));
  const badge = document.querySelector('#notificationBadge');
  const updateCount = () => {
    const count = badge.hidden ? '' : badge.textContent;
    for (const element of [toggle.querySelector('.iphone-profile-badge'), notifications.querySelector('.iphone-notifications-count')]) {
      element.hidden = !count;
      element.textContent = count;
    }
    notifications.setAttribute('aria-label', count ? `Notificações, ${count} não lidas` : 'Notificações');
  };
  new MutationObserver(updateCount).observe(badge, { attributes: true, childList: true, characterData: true });
  updateCount();
  menu.append(document.querySelector('#mobileThemeToggle'));
  const logoutLabel = document.createElement('span');
  logoutLabel.textContent = 'Sair da conta';
  logoutButton.append(logoutLabel);
  menu.append(logoutButton);
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
    if (viewport && !viewport.content.includes('viewport-fit=cover')) viewport.content += ', viewport-fit=cover';
    root.dataset.kontrollIphone = material;
    prepareProfileSheet();
    if (material === 'glass') {
      addNavigationLens();
      addGlassControl();
      import('./iphone-refraction.js').then(({ startRefraction }) => startRefraction())
        .catch(error => console.warn('Refração indisponível; usando transparência CSS.', error));
    }
    observeKeyboard(root);
  }).catch(error => console.warn('Interface do iPhone indisponível:', error));
}
