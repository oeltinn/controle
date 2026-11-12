import { createClient } from '@supabase/supabase-js';
import webpush from 'web-push';

const supabaseUrl = process.env.VITE_SUPABASE_URL?.trim();
const publishableKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
const publicKey = process.env.VITE_VAPID_PUBLIC_KEY?.trim();
const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
const firebaseCredentials = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
export const config = { maxDuration: 30 };

async function androidMessaging() {
  if (!firebaseCredentials) return null;
  const [{ cert, getApps, initializeApp }, { getMessaging }] = await Promise.all([
    import('firebase-admin/app'), import('firebase-admin/messaging'),
  ]);
  const app = getApps().find(item => item.name === 'kontroll-fcm') || initializeApp({
    credential: cert(JSON.parse(firebaseCredentials)),
  }, 'kontroll-fcm');
  return getMessaging(app);
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Método não permitido.' }); }
  if (!supabaseUrl || !publishableKey || !publicKey || !privateKey || !serviceKey) {
    return res.status(503).json({ error: 'As notificações ainda não foram configuradas no servidor.' });
  }
  const token = /^Bearer (.+)$/.exec(req.headers.authorization || '')?.[1];
  if (!token) return res.status(401).json({ error: 'Entre na sua conta para enviar.' });
  const verifier = createClient(supabaseUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: auth, error: authError } = await verifier.auth.getUser(token);
  if (authError || !auth?.user) {
    if (authError && ![400, 401, 403].includes(authError.status)) {
      console.error('Notification auth verification failed', { status: authError.status, code: authError.code });
      return res.status(503).json({ error: 'Não foi possível validar a sessão agora. Tente novamente.' });
    }
    return res.status(401).json({ error: 'Sessão inválida.' });
  }
  const supabase = createClient(supabaseUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: profile, error: profileError } = await supabase.from('profiles').select('role').eq('id', auth.user.id).single();
  if (profileError || profile?.role !== 'admin') return res.status(403).json({ error: 'Somente administradores podem enviar notificações.' });
  const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
  const body = typeof req.body?.body === 'string' ? req.body.body.trim() : '';
  const targetRole = typeof req.body?.targetRole === 'string' ? req.body.targetRole : null;
  const targetUser = typeof req.body?.targetUser === 'string' ? req.body.targetUser : null;
  if (!title || title.length > 100 || !body || body.length > 500) {
    return res.status(400).json({ error: 'Preencha título e mensagem dentro do limite indicado.' });
  }
  const { data: notificationId, error: createError } = await supabase.rpc('create_app_notification', {
    p_title: title, p_body: body, p_target_role: targetRole, p_target_user: targetUser,
  });
  if (createError) return res.status(400).json({ error: createError.message });
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: recipients, error: recipientsError } = await admin.from('app_notification_recipients')
    .select('user_id').eq('notification_id', notificationId);
  if (recipientsError) return res.status(500).json({ error: 'Mensagem salva, mas não foi possível consultar os destinatários.' });
  const ids = recipients.map(row => row.user_id);
  const { data: subscriptions, error: subscriptionsError } = await admin.from('push_subscriptions')
    .select('endpoint,p256dh,auth_secret').in('user_id', ids);
  if (subscriptionsError) return res.status(500).json({ error: 'Mensagem salva, mas não foi possível consultar os dispositivos.' });
  webpush.setVapidDetails('https://controle-elton-208b.vercel.app', publicKey, privateKey);
  let delivered = 0;
  const payload = JSON.stringify({ title, body, notificationId, url: '/' });
  for (let i = 0; i < subscriptions.length; i += 20) {
    await Promise.all(subscriptions.slice(i, i + 20).map(async item => {
      try {
        await webpush.sendNotification({
          endpoint: item.endpoint,
          keys: { p256dh: item.p256dh, auth: item.auth_secret },
        }, payload, { TTL: 3600 });
        delivered += 1;
      } catch {
        // The inbox message remains available if an endpoint is expired or offline.
      }
    }));
  }
  let androidDelivered = 0;
  let androidError = null;
  try {
    const messaging = await androidMessaging();
    if (messaging) {
      const { data: tokens, error: tokenError } = await admin.from('android_push_tokens')
        .select('token,user_id').in('user_id', ids);
      if (tokenError) throw tokenError;
      for (let i = 0; i < tokens.length; i += 20) {
        await Promise.all(tokens.slice(i, i + 20).map(async item => {
          try {
            await messaging.send({
              token: item.token, notification: { title, body },
              data: { notificationId, userId: item.user_id },
              android: { priority: 'high', ttl: 3600_000 },
            });
            androidDelivered += 1;
          } catch (error) {
            if (['messaging/registration-token-not-registered', 'messaging/invalid-registration-token'].includes(error.code)) {
              await admin.from('android_push_tokens').delete().eq('token', item.token);
            } else {
              console.error('Android push delivery failed', { code: error.code });
            }
          }
        }));
      }
    }
  } catch (error) {
    androidError = 'Os avisos Android não foram enviados. A mensagem permanece na caixa de entrada.';
    console.error('Android push setup failed', { message: error.message });
  }
  return res.status(200).json({ notificationId, recipients: ids.length, delivered, androidDelivered, androidError });
}

