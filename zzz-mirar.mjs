import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync('/Users/javiercamaraportepetit/javiercamarapp/cuadra/.env.local', 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);

const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const t = env.DEMO_TENANT_ID;
console.log('tenant demo:', t);

const { data: ops, error: e1 } = await sb.from('operador').select('id, nombre, tenant_id, activo').limit(10);
console.log('operadores:', e1?.message ?? ops);

const { data: viajes, error: e2 } = await sb
  .from('viaje')
  .select('id, tenant_id, operador_id, folio, origen, destino, anticipo, fecha_inicio, estatus, avisado_en, aceptado_en, unidad_id')
  .order('created_at', { ascending: false })
  .limit(12);
console.log('viajes:', e2?.message ?? viajes);

const { data: gastos, error: e3 } = await sb
  .from('gasto')
  .select('id, viaje_id, concepto, monto, fecha, ocr_confianza, imagen_url')
  .order('created_at', { ascending: false })
  .limit(15);
console.log('gastos:', e3?.message ?? gastos);

const { data: liq, error: e4 } = await sb
  .from('liquidacion')
  .select('id, viaje_id, total_comprobado, total_anticipo, diferencia, estatus, pdf_url')
  .limit(10);
console.log('liquidaciones:', e4?.message ?? liq);

const { data: us, error: e5 } = await sb.from('app_user').select('id, rol, operador_id, tenant_id, nombre').limit(20);
console.log('app_user:', e5?.message ?? us);

const { data: un, error: e6 } = await sb.from('unidad').select('id, numero_economico, placas, tenant_id').limit(10);
console.log('unidades:', e6?.message ?? un);
