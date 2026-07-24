// Cliente service-role (SOLO servidor). Salta RLS — re-imponer scope por
// tenant a mano con .eq('tenant_id', ...). Usado por webhooks/pipeline sin
// sesión de usuario. NUNCA importar en código de cliente.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let _admin: SupabaseClient | null = null;

export function supabaseAdmin(): SupabaseClient {
  if (_admin) return _admin;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase service-role no configurado');
  _admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return _admin;
}
