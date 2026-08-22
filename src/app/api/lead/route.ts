import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { rateLimit, bodyExcede, clientIp } from '@/lib/ratelimit';
import { logger } from '@/lib/logger';

// ═══════════════════════════════════════════════════════════════════════════
// EL LEAD DE `/getdemo` — lo que impide que un prospecto se pierda por no
// llegar al calendario, y lo que le pega la etiqueta de DÓNDE vino.
//
// Hasta hoy el formulario capturaba seis campos y al embed de Cal.com solo le
// pasaba tres (nombre, apellido, correo). `empresa`, `unidades` y `whatsapp`
// —los que califican— se tiraban, y quien cerraba la pestaña antes de agendar
// no dejaba rastro de haber existido.
//
// SE GUARDA ANTES DEL CALENDARIO, NO DESPUÉS. Es el punto entero: la mitad del
// valor está en el que NO agenda. Si esto corriera al confirmar la cita, se
// perdería exactamente al prospecto que se quiere recuperar.
//
// NUNCA ROMPE EL FLUJO DEL VISITANTE. Cualquier fallo aquí devuelve 200: el
// calendario tiene que aparecer aunque la base esté caída. Un lead perdido
// cuesta menos que un formulario que se traba y pierde al prospecto Y a la cita.
//
// LA LANDING VIVE EN OTRO DOMINIO (likida.ai) que la app (app.likida.ai), así
// que esto necesita CORS. La lista de orígenes es cerrada a propósito: un `*`
// en un endpoint que ESCRIBE en la base deja que cualquier página del mundo
// llene `prospecto` de basura desde el navegador de sus visitantes. (Contra
// `curl` no protege nada — eso lo acota el rate limit, no el CORS.)
// ═══════════════════════════════════════════════════════════════════════════

export const runtime = 'nodejs';

/** Quién puede escribirle. Nada de `*`: esto inserta filas. */
const ORIGENES = new Set(['https://likida.ai', 'https://www.likida.ai']);

/** Un lead son unos cuantos campos cortos. 8 KB es holgado y acota el abuso. */
const MAX_BODY = 8 * 1024;

/**
 * Los dos dominios cerrados, espejo de los `check` de la 0137.
 *
 * Se validan aquí ADEMÁS de en la base por una razón concreta: si llega un
 * valor fuera del dominio, la base rebotaría el INSERT ENTERO y se perdería el
 * lead completo por un campo secundario. Filtrando aquí, un `urgencia` raro se
 * cae solo y el prospecto se guarda igual — que es lo que importa.
 */
const UNIDADES = new Set(['5-30', '31-100', '101-250', '250+']);
const URGENCIAS = new Set(['inmediata', 'trimestre', 'explorando']);

/** Lo único que se guarda de la URL. Lo que no está aquí se descarta. */
const CLAVES_ATRIBUCION = [
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
  'fbclid', 'gclid', 'msclkid', 'referrer', 'ruta',
] as const;

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

function deDominio(v: unknown, dominio: Set<string>): string | null {
  const t = texto(v, 40);
  return t && dominio.has(t) ? t : null;
}

/** Se queda solo con las claves conocidas, ya recortadas. `{}` → null. */
function atribucion(v: unknown): Record<string, string> | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const src = v as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const k of CLAVES_ATRIBUCION) {
    const t = texto(src[k], 300);
    if (t) out[k] = t;
  }
  return Object.keys(out).length ? out : null;
}

/**
 * EL CANAL, que es lo que se agrupa en el tablero de adquisición.
 *
 * `fuente` se mantiene como un conjunto CHICO Y CERRADO a propósito: si cada
 * `utm_source` inventara su propio valor, la gráfica de adquisición se
 * fragmentaría en cincuenta rebanadas de una fila y dejaría de contestar "¿de
 * dónde vienen mis prospectos?". El detalle fino vive en `atribucion`.
 *
 * Un `fbclid`/`gclid` es prueba dura de clic pagado —lo pega la plataforma, no
 * el que armó la URL—, así que manda sobre el `utm_source`, que cualquiera
 * puede escribir a mano.
 */
function canal(atr: Record<string, string> | null): string {
  if (!atr) return 'landing';
  // Los click id PRIMERO, los dos, antes de mirar un solo utm_*. Mezclados en
  // el mismo `if` que el texto, un `gclid` que llegara con `utm_source=facebook`
  // —una URL mal armada, o armada a propósito— se contaría como Meta.
  if (atr.fbclid) return 'ads-meta';
  if (atr.gclid) return 'ads-google';
  const s = (atr.utm_source ?? '').toLowerCase();
  if (/facebook|instagram|meta|\bfb\b/.test(s)) return 'ads-meta';
  if (/google|youtube|adwords/.test(s)) return 'ads-google';
  // Trae marcas de campaña pero no se sabe de quién: 'campana', no 'ads'.
  // Decir "ads" de un correo etiquetado con utm sería inventar un gasto.
  if (atr.utm_source || atr.utm_campaign || atr.msclkid) return 'campana';
  return 'landing';
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

  const atr = atribucion(body.atribucion);

  // ── DOBLE CLIC (AUDITORÍA 18, B3) ──────────────────────────────────────
  // `prospecto` no tiene unique por correo ni por empresa (la 0139 explica por
  // qué: 1,227 grupos duplicados vivos), así que el "leer y luego escribir"
  // de abajo tiene una carrera: dos POST con 150 ms de diferencia leen `[]`
  // los dos e insertan dos filas — dos primeros toques generados, dos
  // mensajes al mismo decisor. Sin llave natural en la base, la llave vive
  // aquí: UNA escritura por (correo | empresa) cada 10 s. El segundo clic
  // contesta 200 igual (el visitante sigue a su calendario) y no escribe: el
  // primero ya lleva los mismos datos.
  const llaveNatural = texto(body.correo, 160) ?? empresa;
  if (!(await rateLimit(`lead:llave:${llaveNatural.toLowerCase()}`, 1, 10_000))) {
    logger.info('lead.duplicado_en_vuelo', { empresa, canal: canal(atr) });
    return ok();
  }

  const campos: Record<string, unknown> = {
    empresa,
    contacto_nombre: [texto(body.nombre, 80), texto(body.apellido, 80)].filter(Boolean).join(' ') || null,
    correo: texto(body.correo, 160),
    telefono: texto(body.whatsapp, 40),
    unidades: deDominio(body.unidades, UNIDADES),
    urgencia: deDominio(body.urgencia, URGENCIAS),
    atribucion: atr,
    updated_at: new Date().toISOString(),
  };

  try {
    const db = supabaseAdmin();

    // Un visitante que manda el formulario dos veces —o que vuelve otro día—
    // no es dos prospectos. Se busca por correo, que es lo único estable que
    // deja; sin correo se cae a la empresa.
    // `select('*')`, no una lista: en una base donde la 0137 aún no corriera,
    // pedir `unidades` por nombre haría fallar la LECTURA y —con el catch de
    // abajo— el lead se perdería en silencio, que es justo lo que esta ruta
    // existe para impedir. Con `*` viene lo que haya.
    const filtro = campos.correo
      ? db.from('prospecto').select('*').eq('correo', campos.correo as string)
      : db.from('prospecto').select('*').eq('empresa', empresa);
    const { data: previos, error: eLeer } = await filtro.limit(1);
    if (eLeer) throw new Error(eLeer.message);

    if (previos && previos.length > 0) {
      const previo = previos[0] as Record<string, unknown>;
      const { parche, pisados } = mezclaQueSoloRellena(previo, campos);
      if (pisados.length) {
        // Se anota QUÉ dijo el formulario y no se aplica. El vendedor decide.
        parche.notas = notaConLoNoAplicado(previo.notas, pisados);
        logger.warn('lead.no_pisa_datos', { empresa, campos: pisados.map((p) => p.split('=')[0]), canal: canal(atr) });
      }
      await escribir(db, 'update', parche, previo.id as string);
      logger.info('lead.actualizado', { empresa, tenia: previo.estado, canal: canal(atr) });
      return ok();
    }

    await escribir(db, 'insert', { ...campos, fuente: canal(atr), estado: 'nuevo' });
    logger.info('lead.nuevo', { empresa, canal: canal(atr), urgencia: campos.urgencia });
    return ok();
  } catch (err) {
    // 200 a propósito: ver el encabezado. El visitante sigue a su calendario.
    logger.error('lead.fallo', { err: String(err) });
    return ok();
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// LO QUE UN FORMULARIO PÚBLICO PUEDE Y NO PUEDE HACERLE A UN PROSPECTO.
//
// AUDITORÍA PROD (22-ago-2026) · SEG-2. Este endpoint no tiene sesión: basta
// con acertarle al correo de un prospecto —o a su nombre de empresa— para
// reescribirle `empresa`, `contacto_nombre`, `telefono`, `unidades`,
// `urgencia` y `atribucion`. El daño no es "spam en el CRM": el teléfono es
// AL QUE LLAMA EL VENDEDOR y la atribución es la que decide cuánto se cree
// que rinde cada canal. Cambiar el teléfono de un prospecto en negociación es
// desviar la llamada.
//
// La regla nueva, que es la que ya tenía el resto del archivo llevada hasta
// el final: **un lead entrante solo puede AGREGAR información, nunca
// sustituirla**. Lo que llega sobre un hueco lo rellena; lo que llega sobre
// un dato que ya existe y es distinto NO se aplica: se anota en `notas`, con
// fecha y marcado como "sin verificar", y una persona decide.
//
// `estado` y `fuente` siguen intocables por lo de siempre (regresar a 'nuevo'
// borra el avance del vendedor; repintar la fuente borra de dónde salió).
// ═══════════════════════════════════════════════════════════════════════════

/** Vacío = no hay dato: nulo, ausente o cadena en blanco. */
function sinDato(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
}

/**
 * El parche que SÍ se puede aplicar, y la lista de lo que llegó distinto.
 *
 * Exportada para que la prueba mida esta decisión sola, sin base de por medio.
 */
export function mezclaQueSoloRellena(
  previo: Record<string, unknown>,
  campos: Record<string, unknown>,
): { parche: Record<string, unknown>; pisados: string[] } {
  const parche: Record<string, unknown> = {};
  const pisados: string[] = [];
  for (const [k, v] of Object.entries(campos)) {
    // `updated_at` es del sistema, no del visitante.
    if (k === 'updated_at') { parche[k] = v; continue; }
    // El formulario no lo trae: nunca se manda `null` (borraría el teléfono
    // que el censo del DENUE sí traía).
    if (v === null || v === undefined) continue;
    // La columna no existe en esta base todavía (0137): que decida `escribir`.
    if (!(k in previo)) { parche[k] = v; continue; }
    if (sinDato(previo[k])) { parche[k] = v; continue; }      // hueco → se rellena
    if (String(previo[k]) === String(v)) continue;            // igual → nada que hacer
    pisados.push(`${k}=${String(v)}`);                        // distinto → a notas
  }
  return { parche, pisados };
}

/** Cuánto puede crecer `notas` por esta vía. Un endpoint público no puede
 *  hacer crecer una fila sin techo: se conserva lo más NUEVO. */
const TOPE_NOTAS = 4_000;

/**
 * La nota con lo que el formulario dijo y no se aplicó. Va ARRIBA (es lo
 * último que pasó) y la nota del vendedor se conserva completa debajo, que es
 * la razón por la que este archivo nunca escribía `notas` en un update.
 */
export function notaConLoNoAplicado(notasPrevias: unknown, pisados: string[]): string {
  const hoy = new Date().toISOString().slice(0, 10);
  const linea = `[${hoy}] /getdemo mandó datos DISTINTOS a los que ya había (sin verificar, no se aplicaron): ${pisados.join('; ')}`;
  const antes = typeof notasPrevias === 'string' && notasPrevias.trim() ? `\n${notasPrevias}` : '';
  return `${linea}${antes}`.slice(0, TOPE_NOTAS);
}

/** Las columnas que la 0137 agrega y que pueden no existir todavía. */
const DE_LA_0137 = new Set(['unidades', 'urgencia', 'atribucion']);

/**
 * LA RED DE SEGURIDAD DE LA 0137.
 *
 * Si este endpoint se despliega ANTES de que la migración corra, Postgres
 * rebota por columna desconocida y —con el catch de arriba— el lead se
 * perdería EN SILENCIO, que es exactamente lo que esta ruta existe para
 * impedir. Se reintenta sin la columna que faltó y lo que traía se anota en
 * `notas`, que siempre existió. Se repite porque faltan tres a la vez y
 * Postgres solo nombra UNA por intento.
 *
 * Solo se sacrifican columnas de la 0137: si lo que falta fuera `empresa`, eso
 * no es "todavía no migra", es que la tabla no es la que se cree, y ahí sí hay
 * que gritar en vez de guardar una fila coja.
 */
async function escribir(
  db: ReturnType<typeof supabaseAdmin>,
  op: 'insert' | 'update',
  fila: Record<string, unknown>,
  id?: string,
): Promise<void> {
  let actual = { ...fila };
  const perdidas: string[] = [];

  for (let intento = 0; intento <= DE_LA_0137.size; intento++) {
    const q = op === 'insert'
      ? db.from('prospecto').insert(actual)
      : db.from('prospecto').update(actual).eq('id', id as string);
    const { error } = await q;
    if (!error) {
      if (perdidas.length) logger.warn('lead.sin_columnas_de_0137', { perdidas });
      return;
    }

    // DOS REDACCIONES, DOS CAPAS DISTINTAS. Postgres dice «column
    // prospecto.unidades does not exist»; PostgREST, que es quien contesta el
    // INSERT, dice «Could not find the 'unidades' column of 'prospecto' in the
    // schema cache». Esta ruta se probó primero contra el texto de Postgres y
    // en producción se perdió un lead entero: el INSERT real nunca usa esa
    // redacción. Las dos van aquí, y las dos tienen prueba.
    const m = /column prospecto\.([a-z_]+) does not exist/.exec(error.message)
      ?? /column "?([a-z_]+)"? of relation/.exec(error.message)
      ?? /find the '([a-z_]+)' column/.exec(error.message);
    const falta = m?.[1];
    if (!falta || !DE_LA_0137.has(falta) || !(falta in actual)) throw new Error(error.message);

    const valor = actual[falta];
    if (valor !== null && valor !== undefined) {
      perdidas.push(`${falta}=${typeof valor === 'string' ? valor : JSON.stringify(valor)}`);
    }
    const { [falta]: _fuera, ...resto } = actual;
    actual = resto;
    // `notas` solo se rellena al INSERTAR. En un update pisaría la nota que el
    // vendedor escribió a mano, que vale más que este apunte de emergencia.
    if (op === 'insert' && perdidas.length) actual.notas = `De /getdemo: ${perdidas.join('; ')}`;
  }
  throw new Error('lead: demasiadas columnas ausentes');
}
