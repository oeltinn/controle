// Keep installation and updates scoped to iPhone Safari; the push worker is shared.
const visualPreview = import.meta.env.DEV && new URLSearchParams(location.search).has('iphoneGlassTest');
const iphone = /\biPhone\b/i.test(navigator.userAgent) || navigator.platform === 'iPhone' || visualPreview;
const safari = /Safari\//i.test(navigator.userAgent) &&
  !/CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo|GSA/i.test(navigator.userAgent) || visualPreview;
const installed = navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;

if (iphone && safari && !installed) {
  const dismissed = Number(sessionStorage.getItem('kontroll-install-dismissed') || 0);
  if (!dismissed) {
    const banner = document.createElement('aside');
    banner.className = 'iphone-install-banner';
    banner.setAttribute('aria-label', 'Instalar Kontroll');
    banner.innerHTML = '<img src="/kontroll-mark.png" alt=""><span>Adicione kontroll. como app no seu iPhone!</span><button type="button" class="iphone-install-add">Adicionar</button><button type="button" class="iphone-install-dismiss" aria-label="Dispensar aviso">×</button>';
    document.querySelector('.topbar')?.after(banner);
    banner.querySelector('.iphone-install-dismiss').addEventListener('click', () => {
      sessionStorage.setItem('kontroll-install-dismissed', '1');
      banner.remove();
    });
    banner.querySelector('.iphone-install-add').addEventListener('click', () => {
      const overlay = document.createElement('div');
      overlay.className = 'iphone-install-overlay';
      overlay.innerHTML = '<section class="iphone-install-sheet" role="dialog" aria-modal="true" aria-labelledby="iphone-install-title"><button type="button" class="iphone-install-close" aria-label="Fechar">×</button><img src="/kontroll-mark.png" alt=""><h2 id="iphone-install-title">Kontroll na Tela de Início</h2><p>Para instalar como aplicativo:</p><ol><li>No Safari, toque em <strong>Compartilhar</strong> (ícone de quadrado com seta para cima).</li><li>Escolha <strong>Adicionar à Tela de Início</strong>.</li><li>Ative <strong>Abrir como App</strong>, se aparecer, e toque em <strong>Adicionar</strong>.</li></ol><p class="iphone-install-note">A instalação é concluída pelo próprio iPhone.</p></section>';
      document.body.append(overlay);
      const close = () => { overlay.remove(); banner.querySelector('.iphone-install-add').focus(); };
      overlay.querySelector('.iphone-install-close').addEventListener('click', close);
      overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
      overlay.addEventListener('keydown', event => { if (event.key === 'Escape') close(); });
      overlay.querySelector('.iphone-install-close').focus();
    });
    const installStyle = document.createElement('style');
    installStyle.textContent = 'body[data-auth="true"] .iphone-install-banner{display:none}.iphone-install-banner{display:flex;align-items:center;gap:10px;margin:12px max(16px,env(safe-area-inset-right)) 0 max(16px,env(safe-area-inset-left));padding:10px 11px;border-radius:19px;background:var(--paper,#fff);color:var(--ink,#182230);box-shadow:0 5px 20px #0002;font:600 12px/1.35 "Plus Jakarta Sans Kontroll",-apple-system,system-ui,sans-serif}.iphone-install-banner img{width:30px;height:30px;border-radius:9px;flex:none}.iphone-install-banner span{flex:1}.iphone-install-banner button,.iphone-install-sheet button{border:0;cursor:pointer}.iphone-install-add{padding:9px 12px;border-radius:12px;background:var(--greenbg,#eaf7ef);color:var(--ink,#182230);font-family:inherit;font-size:12px;font-weight:700}.iphone-install-dismiss{padding:5px;color:var(--muted,#697586);background:none;font-size:21px;line-height:1}.iphone-install-overlay{position:fixed;inset:0;z-index:4000;display:flex;align-items:end;background:#0008;padding:12px max(10px,env(safe-area-inset-right)) calc(12px + env(safe-area-inset-bottom)) max(10px,env(safe-area-inset-left))}.iphone-install-sheet{position:relative;width:100%;padding:25px 24px 20px;border-radius:30px;background:var(--paper,#fff);color:var(--ink,#182230);box-shadow:0 18px 60px #0004;font:15px/1.5 "Plus Jakarta Sans Kontroll",-apple-system,system-ui,sans-serif}.iphone-install-sheet>img{width:54px;height:54px;border-radius:15px}.iphone-install-sheet h2{font-size:22px;margin:12px 0 8px}.iphone-install-sheet p{margin:8px 0;color:var(--muted,#697586)}.iphone-install-sheet ol{padding-left:22px}.iphone-install-sheet li{padding:5px 0}.iphone-install-sheet .iphone-install-note{font-size:12px}.iphone-install-close{position:absolute;right:18px;top:18px;width:36px;height:36px;border-radius:50%;background:var(--greenbg,#eaf7ef);color:var(--ink,#182230);font-size:23px}@media(max-width:380px){.iphone-install-banner{gap:7px}.iphone-install-banner img{width:26px;height:26px}.iphone-install-add{padding:8px}}@media(prefers-reduced-motion:no-preference){.iphone-install-overlay{animation:pwa-appear .2s ease-out}}';
    document.head.append(installStyle);
  }
}

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
