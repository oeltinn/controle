import { supabase } from './supabase.js';

const key = import.meta.env.VITE_VAPID_PUBLIC_KEY?.trim();
let timer = null;

function unwrap(result) {
  if (result.error) throw result.error;
  return result.data;
}

function applicationServerKey(value) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='));
  return Uint8Array.from(raw, char => char.charCodeAt(0));
}

export async function getInbox(userId) {
  const rows = unwrap(await supabase.from('app_notification_recipients')
    .select('notification_id,read_at,app_notifications(title,body,created_at)')
    .eq('user_id', userId).limit(60)) || [];
  return rows.sort((a, b) => new Date(b.app_notifications?.created_at || 0) - new Date(a.app_notifications?.created_at || 0));
}

export async function markNotificationRead(id) {
  unwrap(await supabase.rpc('mark_app_notification_read', { p_notification_id: id }));
}

export async function getPushSubscription() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null;
  const registration = await navigator.serviceWorker.getRegistration('/');
  return registration?.pushManager.getSubscription() || null;
}

export async function syncExistingPushSubscription() {
  if (!('Notification' in window) || Notification.permission !== 'granted') return false;
  const subscription = await getPushSubscription();
  if (!subscription) return false;
  const json = subscription.toJSON();
  unwrap(await supabase.rpc('register_push_subscription', {
    p_endpoint: subscription.endpoint, p_p256dh: json.keys.p256dh, p_auth: json.keys.auth,
  }));
  return true;
}

export async function enablePush() {
  if (!key || !('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    throw new Error('As notificações do navegador não estão disponíveis neste dispositivo.');
  }
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Permita notificações nas configurações do navegador para ativar os avisos.');
  const registration = await navigator.serviceWorker.register('/push-sw.js');
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true, applicationServerKey: applicationServerKey(key),
  });
  const json = subscription.toJSON();
  unwrap(await supabase.rpc('register_push_subscription', {
    p_endpoint: subscription.endpoint, p_p256dh: json.keys.p256dh, p_auth: json.keys.auth,
  }));
  return true;
}

export async function disablePush() {
  const subscription = await getPushSubscription();
  if (!subscription) return;
  unwrap(await supabase.rpc('unregister_push_subscription', { p_endpoint: subscription.endpoint }));
  await subscription.unsubscribe();
}

export async function sendNotification(input) {
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error || !session?.access_token) {
    const expired = new Error('Sua sessão terminou. Entre novamente para enviar a notificação.');
    expired.code = 'SESSION_EXPIRED';
    throw expired;
  }
  const request = accessToken => fetch('/api/notifications', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(input),
  });
  let response = await request(session.access_token);
  if (response.status === 401) {
    const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();
    if (refreshError || !refreshed.session?.access_token) {
      if (refreshError && ![400, 401, 403].includes(refreshError.status)) {
        throw new Error('Não foi possível renovar a sessão agora. Tente novamente.');
      }
      const expired = new Error('Sua sessão terminou. Entre novamente para enviar a notificação.');
      expired.code = 'SESSION_EXPIRED';
      throw expired;
    }
    response = await request(refreshed.session.access_token);
  }
  let data;
  try { data = await response.json(); }
  catch { throw new Error('O servidor de notificações não respondeu corretamente. Tente novamente em instantes.'); }
  if (!response.ok) throw new Error(data.error || 'Não foi possível enviar a notificação.');
  return data;
}

export function watchInbox(userId, onChange) {
  if (timer) clearInterval(timer);
  const refresh = () => { if (document.visibilityState === 'visible') getInbox(userId).then(onChange).catch(() => {}); };
  refresh();
  timer = setInterval(refresh, 30000);
  document.addEventListener('visibilitychange', refresh);
  return () => { clearInterval(timer); timer = null; document.removeEventListener('visibilitychange', refresh); };
}
