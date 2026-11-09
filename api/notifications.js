import { createClient } from '@supabase/supabase-js';
import webpush from 'web-push';

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const publishableKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const publicKey = process.env.VITE_VAPID_PUBLIC_KEY;
const privateKey = process.env.VAPID_PRIVATE_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Método não permitido.' }); }
  if (!supabaseUrl || !publishableKey || !publicKey || !privateKey || !serviceKey) {
    return res.status(503).json({ error: 'As notificações ainda não foram configuradas no servidor.' });
  }
  const token = /^Bearer (.+)$/.exec(req.headers.authorization || '')?.[1];
  if (!token) return res.status(401).json({ error: 'Entre na sua conta para enviar.' });
  const supabase = createClient(supabaseUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: auth, error: authError } = await supabase.auth.getUser(token);
  if (authError || !auth?.user) return res.status(401).json({ error: 'Sessão inválida.' });
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
  return res.status(200).json({ notificationId, recipients: ids.length, delivered });
}

