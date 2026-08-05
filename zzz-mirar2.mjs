import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync('/Users/javiercamaraportepetit/javiercamarapp/cuadra/.env.local', 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const { data: g } = await sb.from('gasto').select('viaje_id, monto, ocr_confianza, imagen_url');
const porViaje = {};
for (const x of g ?? []) {
  porViaje[x.viaje_id] ??= { n: 0, total: 0, bajos: 0, conFoto: 0 };
  porViaje[x.viaje_id].n++;
  porViaje[x.viaje_id].total += Number(x.monto);
  if (x.ocr_confianza !== null && Number(x.ocr_confianza) < 0.7) porViaje[x.viaje_id].bajos++;
  if (x.imagen_url) porViaje[x.viaje_id].conFoto++;
}
console.log('gastos por viaje:', porViaje);
console.log('minima confianza:', Math.min(...(g ?? []).map((x) => (x.ocr_confianza === null ? 9 : Number(x.ocr_confianza)))));

// ¿existe un objeto real en el bucket de comprobantes?
const { data: firma, error } = await sb.storage.from('comprobantes').createSignedUrl(
  (g ?? []).find((x) => x.imagen_url)?.imagen_url ?? 'nada', 60);
console.log('firma comprobante:', error?.message ?? (firma?.signedUrl ? 'OK' : 'sin url'));
if (firma?.signedUrl) {
  const r = await fetch(firma.signedUrl, { method: 'HEAD' });
  console.log('HEAD foto:', r.status, r.headers.get('content-type'), r.headers.get('content-length'));
}
