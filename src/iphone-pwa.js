// Keep installation and updates scoped to iPhone Safari; the push worker is shared.
const iphone = /\biPhone\b/i.test(navigator.userAgent) || navigator.platform === 'iPhone';
const safari = /Safari\//i.test(navigator.userAgent) &&
  !/CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo|GSA/i.test(navigator.userAgent);

if (iphone && safari && 'serviceWorker' in navigator && window.isSecureContext) {
  let updateRequested = false;
  let banner;
  const showUpdate = registration => {
    if (!registration.waiting || !navigator.serviceWorker.controller || banner) return;
    banner = document.createElement('div');
    banner.setAttribute('role', 'status');
    banner.className = 'iphone-pwa-update';
    banner.innerHTML = '<span>Nova versão do Kontroll disponível.</span><button type="button">Atualizar</button><button type="button" aria-label="Mais tarde">×</button>';
    banner.querySelector('button').addEventListener('click', () => {
      updateRequested = true;
      registration.waiting?.postMessage({ type: 'SKIP_WAITING' });
    });
    banner.querySelector('[aria-label="Mais tarde"]').addEventListener('click', () => { banner.remove(); banner = null; });
    document.body.append(banner);
  };
  const style = document.createElement('style');
  style.textContent = '.iphone-pwa-update{position:fixed;z-index:3000;left:max(12px,env(safe-area-inset-left));right:max(12px,env(safe-area-inset-right));bottom:calc(88px + env(safe-area-inset-bottom));display:flex;align-items:center;gap:10px;padding:12px 14px;border-radius:18px;background:var(--paper,#fff);color:var(--ink,#182230);box-shadow:0 8px 32px #0003;font:600 13px -apple-system,system-ui,sans-serif}.iphone-pwa-update span{flex:1}.iphone-pwa-update button{border:0;border-radius:12px;padding:9px 11px;background:var(--greenbg,#eaf7ef);color:var(--ink,#182230);font:inherit}.iphone-pwa-update button:last-child{font-size:20px;line-height:1;padding:5px 10px}@media(prefers-reduced-motion:no-preference){.iphone-pwa-update{animation:pwa-appear .2s ease-out}}@keyframes pwa-appear{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}';
  document.head.append(style);
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (updateRequested) location.reload();
  });
  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register('/push-sw.js', { scope: '/', updateViaCache: 'none' });
      showUpdate(registration);
      registration.addEventListener('updatefound', () => {
        registration.installing?.addEventListener('statechange', () => showUpdate(registration));
      });
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden && navigator.onLine) void registration.update().then(() => showUpdate(registration)).catch(() => {});
      });
    } catch (error) { console.warn('Instalação offline indisponível:', error); }
  }, { once: true });
}
