// Loaded exclusively by the iPhone glass entry point. Original controls remain
// live DOM: the GPU draws an empty decorative pane, never form text or buttons.
import liquidGL from 'liquid-gl';

export function startRefraction() {
  const nav = document.querySelector('.header-nav');
  const shell = document.querySelector('#appShell');
  if (!nav || !shell) return;
  const preferences = ['(prefers-reduced-motion: reduce)',
    '(prefers-reduced-transparency: reduce)', '(prefers-contrast: more)'].map(query => matchMedia(query));
  const pane = document.createElement('span');
  pane.className = 'iphone-refraction-pane';
  pane.setAttribute('aria-hidden', 'true');
  nav.prepend(pane);
  let lens;
  let timer;
  let watchdog;
  let generation = 0;
  let unavailable = false;
  let failures = 0;

  const stop = () => {
    generation++;
    clearTimeout(watchdog);
    nav.removeAttribute('data-refraction-ready');
    lens?.destroy();
    lens = null;
  };
  const eligible = () => !unavailable && !document.hidden &&
    !preferences.some(query => query.matches) &&
    !document.documentElement.hasAttribute('data-iphone-keyboard') &&
    nav.getBoundingClientRect().width > 0 && !shell.hidden;

  const tint = () => {
    const liquid = Number(document.documentElement.style.getPropertyValue('--ios-liquid-level') || 55) / 100;
    return document.body.dataset.theme === 'dark'
      ? `rgba(22,22,24,${(.72 - liquid * .48).toFixed(2)})`
      : `rgba(245,255,250,${(.55 - liquid * .48).toFixed(2)})`;
  };
  const rebuild = () => {
    stop();
    if (!eligible()) return;
    const current = generation;
    const liquid = Number(document.documentElement.style.getPropertyValue('--ios-liquid-level') || 55) / 100;
    try {
      lens = liquidGL({
        target: '.iphone-refraction-pane', snapshot: 'body', content: false,
        engine: 'webgl2', resolution: 1, refraction: 0.004 + liquid * 0.026,
        bevelDepth: 0.045, bevelWidth: 0.2, aberration: 0.012,
        frost: 7 - liquid * 6.6, magnify: 1, shadow: false, specular: false,
        tilt: false, draggable: false, reveal: 'none',
        interaction: 'fluid', interactionStrength: .04 + liquid * .24,
        interactionRadius: 0.3, interactionViscosity: 0.8,
        tint: tint(),
        on: { init() {
          if (current !== generation) return;
          clearTimeout(watchdog);
          failures = 0;
          for (const canvas of nav.querySelectorAll('canvas')) {
            canvas.setAttribute('aria-hidden', 'true');
            canvas.addEventListener('webglcontextlost', () => {
              unavailable = true;
              stop();
            }, { once: true });
          }
          nav.setAttribute('data-refraction-ready', '');
        } },
      });
      // A failed asynchronous snapshot must leave the CSS surface usable.
      watchdog = setTimeout(() => {
        if (current === generation && !nav.hasAttribute('data-refraction-ready')) {
          stop();
          failures += 1;
          if (failures < 3 && eligible()) timer = setTimeout(rebuild, 2000 * failures);
        }
      }, 8000);
    } catch (error) {
      stop();
      failures += 1;
      if (failures < 3 && eligible()) timer = setTimeout(rebuild, 2000 * failures);
      console.warn('Refração desativada neste dispositivo:', error);
    }
  };
  const schedule = (force = false) => {
    clearTimeout(timer);
    if (!eligible()) { if (lens) stop(); return; }
    if (force) { timer = setTimeout(rebuild, 180); return; }
    if (!lens) timer = setTimeout(rebuild, 180);
  };
  // liquidGL already tracks changes to its body snapshot. Rebuilding on each
  // card or tab mutation destroys the WebGL context and can leave it inactive.
  new MutationObserver(() => schedule()).observe(shell, {
    attributes: true, attributeFilter: ['hidden'],
  });
  new MutationObserver(() => schedule()).observe(document.body, {
    attributes: true, attributeFilter: ['data-auth'],
  });
  new MutationObserver(() => schedule()).observe(document.documentElement, {
    attributes: true, attributeFilter: ['data-iphone-keyboard'],
  });
  if ('ResizeObserver' in window) new ResizeObserver(() => schedule()).observe(nav);
  for (const query of preferences) query.addEventListener('change', () => schedule());
  document.addEventListener('visibilitychange', () => schedule());
  document.addEventListener('kontroll-glass-change', () => schedule(true));
  new MutationObserver(() => {
    if (lens?.setTint) lens.setTint(tint());
    else schedule(true);
  }).observe(document.body, { attributes: true, attributeFilter: ['data-theme'] });
  window.addEventListener('pagehide', () => { clearTimeout(timer); stop(); });
  window.addEventListener('pageshow', () => schedule());
  window.addEventListener('beforeprint', () => { clearTimeout(timer); stop(); });
  window.addEventListener('afterprint', () => schedule());
  schedule();
}
