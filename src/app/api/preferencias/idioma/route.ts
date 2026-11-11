import { NextResponse } from 'next/server';
import { getSessionTenant } from '@/lib/auth/session';
import { vieneDeNuestroSitio } from '@/lib/auth/csrf';
import { rateLimit, bodyExcede } from '@/lib/ratelimit';
import { leerTextoAcotado } from '@/lib/http/cuerpo_acotado';
import { supabaseServer } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';
import { CLAVE_PREFERENCIA, COOKIE_IDIOMA, VIGENCIA_COOKIE_IDIOMA_S, idiomaValido } from '@/lib/i18n/idioma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/preferencias/idioma — cambia el idioma de la interfaz de ESTA persona.
//
// SU PUERTA (proxy.ts excluye /api entero: esta ruta es su ÚNICA puerta):
//   1. cuerpo acotado (≤ 200 bytes: `{"idioma":"en"}`);
//   2. mismo sitio (`vieneDeNuestroSitio`, SEG-9): es una escritura por cookie;
//   3. SESIÓN obligatoria (`getSessionTenant`, la misma que el layout: una cuenta dada de baja es «sin sesión»). El conmutador
//      solo existe dentro de /dashboard y /admin; sin sesión no hay a quién guardarle nada;
//   4. límite por usuario (20/min): cambiar de idioma no es una acción que se repita;
//   5. lista CERRADA de idiomas (`idiomaValido`): lo demás es 400, nada del cuerpo se refleja ni se guarda.
//
// QUÉ ESCRIBE: la cookie `likida_lang` (httpOnly, 1 año) y, al mejor esfuerzo, `user_metadata.idioma` del usuario en Supabase Auth
// (sin migración) para que el idioma lo siga en otro navegador. Si lo segundo falla, la cookie ya vale y la respuesta dice
// `guardado: false`; nunca se finge. No toca tenant, rol ni app_metadata.
// ═══════════════════════════════════════════════════════════════════════════

const MAX_CUERPO = 200;

export async function POST(req: Request) {
  if (bodyExcede(req, MAX_CUERPO)) return NextResponse.json({ error: 'cuerpo_demasiado_grande' }, { status: 413 });
  if (!vieneDeNuestroSitio(req)) {
    logger.warn('preferencias.idioma_origen_ajeno', { origen: req.headers.get('origin'), sitio: req.headers.get('sec-fetch-site') });
    return NextResponse.json({ error: 'origen_no_permitido' }, { status: 403 });
  }

  const sesion = await getSessionTenant();
  if (!sesion) return NextResponse.json({ error: 'sin_sesion' }, { status: 401 });

  if (!(await rateLimit(`preferencias-idioma:${sesion.userId}`, 20, 60_000))) {
    return NextResponse.json({ error: 'demasiadas_peticiones' }, { status: 429 });
  }

  const lectura = await leerTextoAcotado(req, MAX_CUERPO);
  if (!lectura.ok) return NextResponse.json({ error: 'cuerpo_invalido' }, { status: 400 });
  let idioma: unknown;
  try {
    idioma = (JSON.parse(lectura.texto) as { idioma?: unknown } | null)?.idioma;
  } catch {
    return NextResponse.json({ error: 'cuerpo_invalido' }, { status: 400 });
  }
  if (!idiomaValido(idioma)) return NextResponse.json({ error: 'idioma_invalido' }, { status: 400 });

  let guardado = false;
  try {
    const sb = await supabaseServer();
    const { error } = await sb.auth.updateUser({ data: { [CLAVE_PREFERENCIA]: idioma } });
    guardado = !error;
    if (error) logger.warn('preferencias.idioma_metadata_fallo', { err: error.message });
  } catch (e) {
    logger.warn('preferencias.idioma_metadata_excepcion', { err: e instanceof Error ? e.message : 'desconocido' });
  }

  const res = NextResponse.json({ ok: true, idioma, guardado });
  res.cookies.set(COOKIE_IDIOMA, idioma, {
    httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: VIGENCIA_COOKIE_IDIOMA_S,
  });
  return res;
}
