import { createClient } from '@supabase/supabase-js';

const ownerId = '332c4a59-47ea-44d6-9c5d-1538faa4ee5a';
const supabaseUrl = process.env.VITE_SUPABASE_URL?.trim();
const publishableKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
const sgpPassword = process.env.SGP_ONU_ELTON_PASSWORD;
const sgpUrl = 'https://sgpcn.centralnet.net.br/api/estoque/lancamento/list/';

export const config = { maxDuration: 20 };

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Método não permitido.' });
  }
  if (!supabaseUrl || !publishableKey) return res.status(503).json({ error: 'Acesso ainda não configurado.' });

  const accessToken = /^Bearer (.+)$/.exec(req.headers.authorization || '')?.[1];
  if (!accessToken) return res.status(401).json({ error: 'Entre na sua conta.' });
  const verifier = createClient(supabaseUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: auth, error: authError } = await verifier.auth.getUser(accessToken);
  if (authError || !auth?.user) return res.status(401).json({ error: 'Sessão inválida.' });
  if (auth.user.id !== ownerId) return res.status(403).json({ error: 'Acesso restrito.' });

  const userClient = createClient(supabaseUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
  const { data: profile, error: profileError } = await userClient.from('profiles')
    .select('role').eq('id', auth.user.id).single();
  if (profileError || profile?.role !== 'admin') return res.status(403).json({ error: 'Acesso restrito.' });

  const day = req.body?.day;
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)
    || Number.isNaN(Date.parse(`${day}T00:00:00Z`))
    || new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) !== day
    || day > new Date().toISOString().slice(0, 10)) {
    return res.status(400).json({ error: 'Informe uma data válida até hoje.' });
  }
  if (!sgpPassword) return res.status(503).json({ error: 'Consulta de estoque ainda não configurada.' });

  const url = new URL(sgpUrl);
  url.searchParams.set('data_cadastro_ini', day);
  url.searchParams.set('data_cadastro_fim', day);
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Basic ${Buffer.from(`elton:${sgpPassword}`).toString('base64')}`,
      },
      signal: AbortSignal.timeout(10000),
      redirect: 'error',
      cache: 'no-store',
    });
    if (!response.ok) {
      console.error('SGP stock check failed', { status: response.status });
      return res.status(502).json({ error: 'O SGP recusou a consulta de estoque.' });
    }
    const movements = await response.json();
    if (!Array.isArray(movements)) throw new Error('Unexpected SGP stock response');
    const byType = {};
    for (const movement of movements) {
      const type = String(movement?.tipo ?? 'não informado');
      byType[type] = (byType[type] || 0) + 1;
    }
    return res.status(200).json({ day, total: movements.length, byType, note: 'Diagnóstico de lançamentos de todos os produtos; ainda não é a contagem de ONUs.' });
  } catch (error) {
    console.error('SGP stock check failed', { message: error?.message });
    return res.status(502).json({ error: 'Não foi possível consultar o estoque no SGP agora.' });
  }
}
