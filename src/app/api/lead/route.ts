import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { rateLimit, bodyExcede, clientIp } from '@/lib/ratelimit';
import { logger } from '@/lib/logger';

// ═══════════════════════════════════════════════════════════════════════════
// EL LEAD DE `/getdemo` — lo que impide que un prospecto se pierda por no
// llegar al calendario.
//
// Hasta hoy el formulario de la landing capturaba empresa, unidades, whatsapp,
// nombre, apellido y correo, y al embed de Cal.com solo le pasaba los TRES
// últimos. `empresa`, `unidades` y `whatsapp` —los que califican— se tiraban, y
// quien cerraba la pestaña antes de agendar no dejaba rastro de haber existido.
//
// SE GUARDA ANTES DEL CALENDARIO, NO DESPUÉS. Es el punto entero: la mitad del
// valor está en el que NO agenda. Si esto corriera al confirmar la cita, se
// perdería exactamente al prospecto que se quiere recuperar.
//
// NUNCA ROMPE EL FLUJO DEL VISITANTE. Cualquier fallo aquí devuelve 200: el
// calendario tiene que aparecer aunque la base esté caída. Un lead perdido
// cuesta menos que un formulario que se traba y pierde al prospecto Y a la cita.
// Por eso el error se registra del lado del servidor y no viaja al navegador.
//
// LA LANDING VIVE EN OTRO DOMINIO (likida.ai) que la app (app.likida.ai), así
// que esto necesita CORS. La lista de orígenes es cerrada a propósito: un `*`
// en un endpoint que ESCRIBE en la base deja que cualquier página del mundo
// llene `prospecto` de basura desde el navegador de sus visitantes.
// ═══════════════════════════════════════════════════════════════════════════

export const runtime = 'nodejs';

/** Quién puede escribirle. Nada de `*`: esto inserta filas. */
const ORIGENES = new Set([
  'https://likida.ai',
  'https://www.likida.ai',
]);

/** Un lead son seis campos cortos. 8 KB es holgado y acota el abuso. */
const MAX_BODY = 8 * 1024;

function cors(origen: string | null): Record<string, string> {
  // Solo se refleja un origen de la lista. Reflejar el que venga es igual que
  // poner `*`, pero disfrazado.
  if (!origen || !ORIGENES.has(origen)) return {};
  return {
    'Access-Control-Allow-Origin': origen,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

export async function OPTIONS(req: Request) {
  return new NextResponse(null, { status: 204, headers: cors(req.headers.get('origin')) });
}

/** Texto de formulario: se recorta y se acota. `''` cuenta como ausente. */
function texto(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim().slice(0, max);
  return t.length ? t : null;
}

/**
 * Las unidades llegan como texto de un `<input>`: "40", "40 camiones", "".
 * Se saca el primer número y se descarta lo demás — pero un 0 o un negativo NO
 * se guardan como 0: se guardan como `null`. La columna distingue "no se sabe"
 * de una cifra, y un 0 diría "flota sin camiones".
 */
function unidades(v: unknown): number | null {
  const t = typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';
  const m = t.match(/\d{1,6}/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export async function POST(req: Request) {
  const cabeceras = cors(req.headers.get('origin'));
  const ok = () => NextResponse.json({ ok: true }, { headers: cabeceras });

  if (bodyExcede(req, MAX_BODY)) {
    return NextResponse.json({ error: 'payload muy grande' }, { status: 413, headers: cabeceras });
  }
  if (!(await rateLimit(`lead:${clientIp(req)}`, 10, 60_000))) {
    return NextResponse.json({ error: 'demasiadas peticiones' }, { status: 429, headers: cabeceras });
  }

  const crudo = await req.text();
  // `bodyExcede` solo mira `content-length`, que un POST `chunked` no declara.
  // Mismo motivo que en /api/demo: sin esta segunda medición el cuerpo entero
  // se materializa en memoria desde un endpoint sin sesión.
  if (crudo.length > MAX_BODY) {
    return NextResponse.json({ error: 'payload muy grande' }, { status: 413, headers: cabeceras });
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(crudo) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400, headers: cabeceras });
  }

  const empresa = texto(body.empresa, 200);
  // `empresa` es lo único que hace a un prospecto un prospecto: la tabla lo
  // exige no vacío y sin él la fila no sirve para llamar a nadie.
  if (!empresa) return ok();

  const nombre = [texto(body.nombre, 80), texto(body.apellido, 80)].filter(Boolean).join(' ') || null;
  const correo = texto(body.correo, 160);
  const telefono = texto(body.whatsapp, 40);
  const unis = unidades(body.unidades);

  try {
    const db = supabaseAdmin();

    // Un visitante que manda el formulario dos veces —o que vuelve otro día—
    // no es dos prospectos. Se busca por correo, que es lo único estable que
    // deja; sin correo se cae a la empresa.
    const filtro = correo
      ? db.from('prospecto').select('id, estado').eq('correo', correo)
      : db.from('prospecto').select('id, estado').eq('empresa', empresa);
    const { data: previos, error: eLeer } = await filtro.limit(1);
    if (eLeer) throw new Error(eLeer.message);

    const campos = {
      empresa,
      contacto_nombre: nombre,
      correo,
      telefono,
      unidades: unis,
      updated_at: new Date().toISOString(),
    };

    if (previos && previos.length > 0) {
      // NO se toca `estado` ni `fuente`: si este prospecto ya venía del censo y
      // ya estaba en 'negociacion', regresarlo a 'nuevo' borraría el avance del
      // vendedor. Lo que sí se hace es completarle los datos que trajo él mismo.
      //
      // Y SOLO SE PISA LO QUE TRAE VALOR. El censo del DENUE ya venía con
      // teléfono para muchos; si este formulario llega sin WhatsApp, mandar
      // `null` BORRARÍA ese teléfono. Un lead entrante solo puede agregar
      // información sobre un prospecto, nunca quitársela.
      const parche = Object.fromEntries(
        Object.entries(campos).filter(([, v]) => v !== null),
      );
      const { error } = await db.from('prospecto').update(parche).eq('id', previos[0].id);
      if (error) throw new Error(error.message);
      logger.info('lead.actualizado', { empresa, tenia: previos[0].estado });
      return ok();
    }

    const fila = { ...campos, fuente: 'landing', estado: 'nuevo' };
    const { error } = await db.from('prospecto').insert(fila);
    if (!error) {
      logger.info('lead.nuevo', { empresa, unidades: unis });
      return ok();
    }

    // LA RED DE SEGURIDAD DE LA 0137. Si este endpoint se despliega ANTES de
    // que la migración cree `prospecto.unidades`, el insert rebota por columna
    // desconocida y —con el catch de abajo— el lead se perdería EN SILENCIO,
    // que es exactamente lo que esta ruta existe para impedir. Se reintenta sin
    // el campo y el número se salva en `notas`, que siempre existió.
    if (/unidades/.test(error.message)) {
      const { unidades: _fuera, ...sinColumna } = fila;
      const { error: e2 } = await db.from('prospecto').insert({
        ...sinColumna,
        notas: unis === null ? null : `Unidades declaradas en /getdemo: ${unis}`,
      });
      if (e2) throw new Error(e2.message);
      logger.warn('lead.nuevo_sin_columna_unidades', { empresa, unidades: unis });
      return ok();
    }
    throw new Error(error.message);
  } catch (err) {
    // 200 a propósito: ver el encabezado. El visitante sigue a su calendario.
    logger.error('lead.fallo', { err: String(err) });
    return ok();
  }
}
