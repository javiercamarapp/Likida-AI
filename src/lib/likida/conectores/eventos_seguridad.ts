// ═══════════════════════════════════════════════════════════════════════════
// LEER LOS EVENTOS DE SEGURIDAD DE LAS CÁMARAS DEL CLIENTE — sin construir
// cámaras propias.
//
// La decisión de producto (26-ago-2026, pedido explícito de Javier): el
// monitoreo con cámaras NO se construye — compite con Samsara y es otra
// categoría de producto. Lo que SÍ se construye es leer los eventos que las
// cámaras del CLIENTE ya detectan (GAL trae Samsara desde hace 10 años) y
// montar el circuito de asistencia encima: una colisión detectada por la
// cámara abre el expediente y avisa al jefe ANTES de que el chofer pueda
// escribir — que es exactamente el momento en el que no puede.
//
// Mismo patrón que `posiciones.ts`: solo LECTURA con el token del cliente,
// mapeo defensivo, y un registro extensible para cuando Motive/Geotab tengan
// su lector.
//
// ── LO VERIFICADO Y LO SUPUESTO (el contrato de honestidad de gps.ts) ─────
// Verificado contra https://developers.samsara.com/reference/getsafetyeventsv2stream
// el 26-ago-2026:
//   · GET https://api.samsara.com/safety-events/stream — `startTime` (RFC
//     3339) requerido; paginación por `after`/`pagination.endCursor`+
//     `hasNextPage`; `queryByTimeField=createdAtTime` para pedir por fecha de
//     creación; `includeAsset=true` expande el nombre del vehículo.
//   · Scope del token: «Read Safety Events & Scores» (Safety & Cameras). Sin
//     él, 403 — y eso se REPORTA como sin_permiso, no como silencio.
//   · El evento trae: `id`, `startMs` (RFC 3339 pese al nombre), `asset.id`,
//     `driver.id`, `location.latitude/longitude`, `behaviorLabels[].label`,
//     `eventState`, `maxAccelerationGForce`, `inboxEventUrl`.
//   · Los labels documentados incluyen `Crash`, `RolloverProtection`,
//     `HarshImpact` (los graves) y ~60 más (frenados, distracción, celular…).
// SUPUESTO defensivo: la doc muestra los labels en PascalCase y el endpoint
// legacy los muestra en camelCase — se compara SIN distinguir mayúsculas. Y
// `asset.id` se asume el mismo espacio de ids que `/fleet/vehicles/stats`
// (el que `unidad.gps_device_id` guarda); si no lo fuera, el evento cae como
// huérfano y se reporta — nunca se inventa la unidad.
// ═══════════════════════════════════════════════════════════════════════════
import type { Http, ValoresCredencial } from './tipos';

/** Un evento de seguridad del proveedor, ya normalizado. */
export interface EventoSeguridadLeido {
  /** Id del evento EN EL SISTEMA DEL PROVEEDOR — la llave de idempotencia. */
  eventoId: string;
  /** Id del vehículo en el sistema del proveedor. Se liga vía unidad.gps_device_id. */
  assetId: string | null;
  lat: number | null;
  lng: number | null;
  /** ISO. La hora del evento según el proveedor. */
  ocurridoEn: string;
  /** Los behavior labels tal cual los mandó el proveedor (sin normalizar el
   *  caso: la clasificación de gravedad compara case-insensitive). */
  etiquetas: string[];
  /** Liga al evento en el inbox del proveedor (el video vive allá — no se
   *  descarga: el media URL de Samsara exige otro scope y caduca). */
  urlEvento: string | null;
  /** Fuerza G máxima del evento, si vino. */
  maxG: number | null;
}

export type ResultadoEventos =
  | { ok: true; eventos: EventoSeguridadLeido[] }
  /** `sinPermiso` distingue el 403 de scopes del resto: la credencial SIRVE
   *  para posiciones pero no para eventos — el panel debe poder decirlo. */
  | { ok: false; motivo: string; sinPermiso?: boolean };

/**
 * Las etiquetas que abren incidencia de siniestro. CERRADA a propósito: un
 * frenado brusco o una distracción son señal de coaching (se registran, no
 * despiertan a nadie); una colisión, un impacto o una volcadura son el
 * circuito de asistencia. La asimetría aquí es la INVERSA del reconocedor de
 * texto: el chofer que escribe "chocamos" ya pidió ayuda (falso negativo
 * carísimo); una cámara que cree ver un choque cada frenado convertiría el
 * 🚨 en ruido que el jefe aprende a ignorar — y ese hábito mata al 🚨 real.
 */
const ETIQUETAS_GRAVES = new Set(['crash', 'harshimpact', 'rolloverprotection']);

export function esEventoGrave(etiquetas: string[]): boolean {
  return etiquetas.some((e) => ETIQUETAS_GRAVES.has(e.toLowerCase().replace(/[^a-z]/g, '')));
}

function coordenada(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * Samsara: `GET /safety-events/stream` (la v2 — la legacy `/fleet/safety-events`
 * exige endTime y está marcada legacy). Se pide por `createdAtTime` desde
 * `desdeIso`: el poller corre cada 5 min con una ventana traslapada y la
 * idempotencia por evento absorbe las repeticiones.
 */
export async function leerEventosSeguridadSamsara(
  valores: ValoresCredencial,
  http: Http,
  desdeIso: string,
): Promise<ResultadoEventos> {
  const token = (valores.token ?? '').trim();
  if (!token) return { ok: false, motivo: 'falta el token de Samsara' };

  const eventos: EventoSeguridadLeido[] = [];
  let cursor: string | null = null;
  for (let pagina = 0; pagina < 10; pagina++) {
    let r;
    try {
      const url = new URL('https://api.samsara.com/safety-events/stream');
      url.searchParams.set('startTime', desdeIso);
      // Por fecha de CREACIÓN: queremos eventos nuevos, no re-entregas por
      // cambios de estado de coaching (el default `updatedAtTime` re-manda un
      // evento cada vez que alguien lo revisa en el inbox de Samsara).
      url.searchParams.set('queryByTimeField', 'createdAtTime');
      // Acotar la ventana: sin endTime el stream se queda en modo "sigue
      // preguntando"; este poller es de lotes, no un stream vivo.
      url.searchParams.set('endTime', new Date().toISOString());
      if (cursor) url.searchParams.set('after', cursor);
      r = await http({
        url: url.toString(), metodo: 'GET',
        encabezados: { Authorization: `Bearer ${token}`, accept: 'application/json' },
      });
    } catch (e) {
      return { ok: false, motivo: `no se pudo llamar a Samsara: ${e instanceof Error ? e.message : String(e)}` };
    }
    if (r.estado === 401) return { ok: false, motivo: 'Samsara rechazó el token (401). Hay que regenerarlo.' };
    if (r.estado === 403) {
      // El token sirve (posiciones entran) pero no trae el scope de eventos.
      // Se dice con nombre: la flota tiene que marcar «Read Safety Events &
      // Scores» al regenerar su token — silencio aquí sería fingir que las
      // cámaras no detectan nada.
      return { ok: false, sinPermiso: true, motivo: 'El token no tiene el scope «Read Safety Events & Scores» (403). Los eventos de cámara no entran hasta regenerarlo con ese permiso.' };
    }
    if (r.estado !== 200) return { ok: false, motivo: `Samsara contestó ${r.estado}.` };

    let json: {
      data?: Array<{
        id?: string;
        startMs?: string;
        createdAtTime?: string;
        asset?: { id?: string };
        location?: { latitude?: number; longitude?: number };
        behaviorLabels?: Array<{ label?: string }>;
        inboxEventUrl?: string;
        maxAccelerationGForce?: number;
      }>;
      pagination?: { hasNextPage?: boolean; endCursor?: string | null };
    };
    try { json = JSON.parse(r.cuerpo); } catch { return { ok: false, motivo: 'Samsara contestó 200 con un cuerpo que no es JSON.' }; }

    for (const e of json.data ?? []) {
      // Sin id no hay idempotencia; sin fecha no hay reloj. Un evento así se
      // descarta — un payload malformado no puede abrir un expediente.
      const ocurrido = e.startMs || e.createdAtTime;
      if (!e.id || !ocurrido || !Number.isFinite(Date.parse(ocurrido))) continue;
      eventos.push({
        eventoId: String(e.id),
        assetId: e.asset?.id ? String(e.asset.id) : null,
        lat: coordenada(e.location?.latitude),
        lng: coordenada(e.location?.longitude),
        ocurridoEn: new Date(Date.parse(ocurrido)).toISOString(),
        // Un label desconocido NO revienta: se guarda tal cual y la
        // clasificación de gravedad simplemente no lo reconoce como grave.
        etiquetas: (e.behaviorLabels ?? []).map((b) => String(b.label ?? '')).filter(Boolean),
        urlEvento: e.inboxEventUrl ? String(e.inboxEventUrl) : null,
        maxG: typeof e.maxAccelerationGForce === 'number' && Number.isFinite(e.maxAccelerationGForce) ? e.maxAccelerationGForce : null,
      });
    }
    const siguiente = json.pagination?.hasNextPage ? json.pagination.endCursor : null;
    if (!siguiente || siguiente === cursor) break;
    cursor = siguiente;
  }

  return { ok: true, eventos };
}

/** Los lectores que existen HOY — mismo diseño que LECTORES_POSICION. Motive
 *  y Geotab entran aquí cuando haya cuenta contra la cual verificarlos. */
export const LECTORES_EVENTOS: Record<
  string,
  (v: ValoresCredencial, http: Http, desdeIso: string) => Promise<ResultadoEventos>
> = {
  samsara: leerEventosSeguridadSamsara,
};

/** `null` si ese proveedor todavía no tiene lector de eventos. */
export function lectorEventosDe(proveedor: string) {
  return LECTORES_EVENTOS[proveedor] ?? null;
}
