// Lee CUALQUIER archivo que el contralor adjunte al chat (12-ago-2026) y
// devuelve el EXTRACTO acotado que viajará con la conversación. No escribe
// nada: es lectura para analizar en el chat.
//
// Las IMÁGENES no entran aquí: van a /api/dashboard/ingesta (el OCR real de
// comprobantes, que entiende tickets mejor que un extracto de texto).
//
// Autorización calcada de ingesta/chat: sesión + área dinero — el archivo
// del contralor puede traer montos, y este endpoint es alcanzable por POST
// directo (el proxy no cubre /api).
import { NextResponse, type NextRequest } from 'next/server';
import { MAX_BASE64, MAX_CUERPO_BYTES, LECTURAS_POR_MINUTO } from './limites';
import { leerTextoAcotado } from '@/lib/http/cuerpo_acotado';
import { rateLimit } from '@/lib/ratelimit';
import { getSessionTenant } from '@/lib/auth/session';
import { rechazoMfaSuperadminApi } from '@/lib/auth/api-superadmin';
import { puedeVerArea } from '@/lib/auth/visibilidad';
import { leerArchivoUniversal, ArchivoNoSoportado, ArchivoDemasiadoGrande } from '@/lib/likida/intake/archivo';
import { logger } from '@/lib/logger';
import { vieneDeNuestroSitio } from '@/lib/auth/csrf';
import { respuestaSiPerfilNiegaApi } from '@/lib/auth/perfil_tenant';
import { getT } from '@/lib/i18n/servidor';

/** El traductor, pedido SOLO cuando hay un texto que decir. */
const T = () => getT('mensajes');

export const dynamic = 'force-dynamic';
export const maxDuration = 60;


export async function POST(req: NextRequest) {
  // Auditoría 21, BAJO-MEDIO: el chequeo CSRF explícito (SEG-9) solo cubría
  // /api/admin/palette y /v1/*. Autenticada solo por cookie de sesión.
  if (!vieneDeNuestroSitio(req)) {
    logger.warn('archivo.origen_ajeno', { origen: req.headers.get('origin'), sitio: req.headers.get('sec-fetch-site') });
    return NextResponse.json({ error: (await T()).t('dash.otro_sitio') }, { status: 403 });
  }

  const sesion = await getSessionTenant();
  if (!sesion) return NextResponse.json({ error: 'sin sesion' }, { status: 401 });
  const rechazoMfa = await rechazoMfaSuperadminApi(sesion);
  if (rechazoMfa) return rechazoMfa;
  if (!puedeVerArea(sesion.rol, 'dinero')) {
    return NextResponse.json({ error: 'sin acceso' }, { status: 403 });
  }
  const negadoPerfil = await respuestaSiPerfilNiegaApi(sesion.tenantId, req.url);
  if (negadoPerfil) return negadoPerfil;

  // Mismo freno que la sonda de ingesta (auditoría 21): el cuerpo ya tiene
  // tope de TAMAÑO, esto le pone el de FRECUENCIA — sin él, un bucle con un
  // xlsx de expansión adversarial repetía el parseo sin techo.
  if (!(await rateLimit(`archivo:${sesion.userId}`, LECTURAS_POR_MINUTO, 60_000))) {
    return NextResponse.json({ error: 'demasiadas lecturas seguidas; espera un minuto' }, { status: 429 });
  }

  const lectura = await leerTextoAcotado(req, MAX_CUERPO_BYTES);
  if (!lectura.ok) return NextResponse.json({ error: (await T()).t(lectura.motivo === 'demasiado_grande' ? 'dash.archivo.tamano' : 'dash.cuerpo_invalido') },
    { status: lectura.motivo === 'demasiado_grande' ? 413 : 400 });
  let cuerpo: { nombre?: unknown; contenido?: unknown } | null;
  try { cuerpo = JSON.parse(lectura.texto); } catch { return NextResponse.json({ error: (await T()).t('dash.cuerpo_invalido') }, { status: 400 }); }

  const nombre = typeof cuerpo?.nombre === 'string' ? cuerpo.nombre.trim().slice(0, 120) : '';
  const contenido = typeof cuerpo?.contenido === 'string' ? cuerpo.contenido : '';
  if (!nombre || !contenido) return NextResponse.json({ error: 'faltan nombre o contenido' }, { status: 400 });
  if (contenido.startsWith('data:image/')) {
    return NextResponse.json({ error: (await T()).t('dash.archivo.imagenes') }, { status: 400 });
  }
  const base64 = contenido.includes('base64,') ? contenido.slice(contenido.indexOf('base64,') + 7) : contenido;
  if (base64.length > MAX_BASE64) {
    return NextResponse.json({
      error: (await T()).t('dash.archivo.tamano'),
    }, { status: 413 });
  }

  try {
    const leido = await leerArchivoUniversal(nombre, Buffer.from(base64, 'base64'));
    logger.info('archivo.leido', { tenantId: sesion.tenantId, clase: leido.clase, chars: leido.extracto.length });
    return NextResponse.json(leido);
  } catch (err) {
    if (err instanceof ArchivoDemasiadoGrande) {
      return NextResponse.json({ error: (await T()).t('dash.archivo.libro_grande') }, { status: 413 });
    }
    if (err instanceof ArchivoNoSoportado) {
      return NextResponse.json({
        error: (await T()).t('dash.archivo.extension', { extension: err.extension }),
      }, { status: 415 });
    }
    logger.error('archivo.fallo', { err: err instanceof Error ? err.message : String(err) });
    return NextResponse.json({ error: (await T()).t('dash.archivo.ilegible') }, { status: 502 });
  }
}
