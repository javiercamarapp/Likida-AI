// ═══════════════════════════════════════════════════════════════════════════
// EL GUARDIA DE ALERTAS (A0) — la clasificación DETERMINISTA (Fase 2).
//
// El blueprint (agente-guardia-de-alertas.md) es explícito: las reglas
// deterministas CALCULAN la severidad; el LLM solo redacta. Este módulo es
// esa mitad determinista, cableada sobre la bandeja que ya existe
// (getBandejaEscalaciones): toma las 6 fuentes + las fuentes ciegas y
// devuelve cada item con su severidad del runbook (S1/S2/S3/no-incidente),
// su regla aplicada y el formato de escalación §4-paso-5 ya armado.
//
// Lo que este módulo NO hace, por diseño del propio blueprint:
//  · No apaga palancas solo (eso es del copiloto CON confirmación, o del
//    guardia FUTURO cableado como proceso — hoy no existe como proceso).
//  · No le habla a ningún cliente, no promete tiempos, no cierra S1.
//
// La matriz §3, aplicada a las fuentes reales de la bandeja:
//  · Una FUENTE CIEGA es S2 en sí misma (§6: "un guardia que no ve la
//    bandeja y se calla es peor que no tener guardia").
//  · corridasFallo → S2 (una función dejó de operar; nada miente).
//  · arco → S3, y S2 al acercarse el plazo legal (20 días hábiles, LFPDPPP
//    art. 31 — vencerlo es incumplimiento, no molestia).
//  · tickets → S3; vencidos de SLA → S2.
//  · talachas / facturasProveedor / liquidacionesRevisar → S3 (esperan
//    decisión humana; el sistema opera).
//  S1 (el sistema MIENTE o ejecuta de más) no se deriva de la bandeja: se
//  reporta por ALERTA_EMAIL/Sentry y lo clasifica un humano o el guardia
//  futuro — este módulo lo declara en vez de fingir detectarlo.
// ═══════════════════════════════════════════════════════════════════════════

import { createHash } from 'node:crypto';
import { getBandejaEscalaciones, type BandejaEscalaciones, type ItemEscalacion } from './escalaciones';

export type Severidad = 'S1' | 'S2' | 'S3' | 'no_incidente';

export interface ItemClasificado {
  severidad: Severidad;
  /** La regla de la matriz que aplicó — citable, no inventada. */
  regla: string;
  fuente: string;
  titulo: string;
  flota: string;
  desde: string;
  vence: string | null;
  /** Dónde se resuelve (de la bandeja misma). */
  href: string | null;
}

export interface ClasificacionGuardia {
  /** Fuentes que NO se pudieron leer — S2 por sí mismas (§6). */
  fuentesCiegas: Array<{ fuente: string; error: string | null }>;
  items: ItemClasificado[];
  /** Conteo por severidad, solo de lo MEDIDO. */
  porSeveridad: Record<Severidad, number>;
  /** El recordatorio honesto: qué NO puede ver esta clasificación. */
  limites: string[];
}

/** Milisegundos → días, para los plazos. */
const DIA_MS = 86_400_000;

function clasificarItem(i: ItemEscalacion, ahoraMs: number): ItemClasificado {
  const base = {
    fuente: i.fuente, titulo: i.titulo, flota: i.tenantNombre,
    desde: i.desde, vence: i.vence, href: i.href,
  };
  const vencido = i.vence !== null && new Date(i.vence).getTime() < ahoraMs;

  if (i.fuente === 'corridas') {
    return { ...base, severidad: 'S2', regla: 'Una corrida de agente quedó en fallo: una función dejó de operar, nada miente (matriz §3·S2).' };
  }
  if (i.fuente === 'arco') {
    const porVencer = i.vence !== null && new Date(i.vence).getTime() - ahoraMs < 5 * DIA_MS;
    if (vencido || porVencer) {
      return { ...base, severidad: 'S2', regla: vencido ? 'Solicitud ARCO con el plazo legal VENCIDO (LFPDPPP art. 31) — incumplimiento, no pendiente.' : 'Solicitud ARCO a menos de 5 días del plazo legal (LFPDPPP art. 31).' };
    }
    return { ...base, severidad: 'S3', regla: 'Solicitud ARCO dentro de plazo — se atiende en el día, no despierta a nadie.' };
  }
  if (i.fuente === 'tickets') {
    if (vencido) {
      return { ...base, severidad: 'S2', regla: 'Ticket con SLA vencido: lo pactado ya se incumplió — sube de la lista del día.' };
    }
    return { ...base, severidad: 'S3', regla: 'Ticket dentro de SLA: contexto y borrador de respuesta, a la lista del día (matriz §3·S3).' };
  }
  // talachas, facturasProveedor, liquidacionesRevisar: decisión humana
  // pendiente con el sistema operando.
  return { ...base, severidad: 'S3', regla: 'Espera decisión humana con el sistema operando (matriz §3·S3) — va a la lista del día.' };
}

/** Clasifica una bandeja YA LEÍDA — pura, probable sin base. */
export function clasificarBandeja(b: BandejaEscalaciones, ahoraMs: number): ClasificacionGuardia {
  const fuentesCiegas = Object.entries(b.fuentes)
    .filter(([, f]) => f.items === null)
    .map(([fuente, f]) => ({ fuente, error: f.error }));

  const items = b.cola.map((i) => clasificarItem(i, ahoraMs));
  const porSeveridad: Record<Severidad, number> = { S1: 0, S2: 0, S3: 0, no_incidente: 0 };
  for (const i of items) porSeveridad[i.severidad]++;
  // Cada fuente ciega cuenta como su propio S2 (§6): no ver no es no haber.
  porSeveridad.S2 += fuentesCiegas.length;

  return {
    fuentesCiegas,
    items,
    porSeveridad,
    limites: [
      'S1 (el sistema miente o ejecuta de más) NO se deriva de esta bandeja: llega por ALERTA_EMAIL/Sentry y lo clasifica un humano — esta clasificación no finge detectarlo.',
      'La matriz de no-incidentes (SAT sin responder, cron saltado por palanca, panel fallando cerrado) vive en el runbook y se aplica ANTES de escalar — un no-incidente no debe llegar a esta cola.',
    ],
  };
}

/** La lectura completa: bandeja real → clasificación. LANZA si la bandeja
 *  entera no se pudo armar (getBandejaEscalaciones ya degrada por fuente). */
export async function clasificacionDeGuardia(ahoraMs: number): Promise<ClasificacionGuardia> {
  const bandeja = await getBandejaEscalaciones(ahoraMs);
  return clasificarBandeja(bandeja, ahoraMs);
}

// ═══════════════════════════════════════════════════════════════════════════
// LA DECISIÓN DE AVISAR (E1-A, P0-8) — la mitad PURA del vigía de producción.
//
// Antes vivía dentro de `scripts/mejora-diaria/vigia-produccion.mts` (launchd,
// la Mac de Javier: una Mac apagada o dormida era una guardia ausente, punto
// único de falla). Ahora la misma decisión la comparten el cron del servidor
// (`/api/cron/guardia`) y ese script, que queda como herramienta manual. Pura:
// recibe la clasificación y lo ya visto, devuelve qué avisar y el estado nuevo;
// el llamador decide el canal. El dedup es por CAMBIO, no por estado: el mismo
// incidente no vuelve a sonar en cada pasada.
//
// El estado guarda HUELLAS (sha-1 truncado) y no las claves: la clave lleva el
// título del item y el nombre de la flota, y el estado del servidor vive en
// `cron_latido.detalle`, que no tiene por qué cargar texto de negocio.
// ═══════════════════════════════════════════════════════════════════════════

export interface EstadoGuardia {
  /** Huellas de lo urgente ya avisado (más las claves crudas que dejó el script de la Mac, que se siguen reconociendo). */
  vistos: string[];
  /** Desde cuándo la base está inalcanzable (aviso una vez por racha); `null` si no lo está. */
  baseCaidaDesde: string | null;
  /** A3 (ronda 19): sondeos de `/api/health` fallidos SEGUIDOS. Un fallo aislado (arranque en frío, timeout) no avisa ni marca caído. */
  rachaApp: number;
  /** Desde cuándo (primer sondeo fallido de la racha). Va en la huella del aviso: una caída nueva NO la silencia el piso de 1 h de la anterior. */
  appCaidaDesde: string | null;
  /** ¿Ya salió el aviso de esta caída? (M5: si no salió, se reintenta en la siguiente pasada.) */
  appAvisada: boolean;
  /** Pasadas seguidas en que la bandeja de escalaciones no se pudo armar con la base sana (M6). */
  rachaBandeja: number;
}

export const ESTADO_GUARDIA_INICIAL: EstadoGuardia = { vistos: [], baseCaidaDesde: null, rachaApp: 0, appCaidaDesde: null, appAvisada: false, rachaBandeja: 0 };

/** Sondeos fallidos seguidos que se exigen antes de avisar o marcar la app caída (histéresis). */
export const SONDEOS_FALLIDOS_PARA_CAIDA = 2;

/** Un tope al estado persistido: lo urgente no puede crecer sin límite dentro de un jsonb de latido. */
const TOPE_VISTOS = 200;

/** Qué incidente ES (no cuándo se miró). */
export function claveDeItem(i: { fuente: string; titulo: string; flota: string; desde: string }): string {
  return `${i.fuente}|${i.titulo}|${i.flota}|${i.desde}`;
}

/** La huella estable de una clave. */
export function huellaDeClave(clave: string): string {
  return createHash('sha1').update(clave, 'utf8').digest('hex').slice(0, 16);
}

/** Lee el estado de un `detalle` de latido sin confiar en su forma: lo que no cuadra se descarta, no revienta. */
export function estadoDeDetalle(detalle: unknown): EstadoGuardia {
  if (detalle === null || typeof detalle !== 'object') return { ...ESTADO_GUARDIA_INICIAL };
  const d = detalle as Record<string, unknown>;
  const vistos = Array.isArray(d.vistos) ? d.vistos.filter((v): v is string => typeof v === 'string').slice(0, TOPE_VISTOS) : [];
  const caida = typeof d.baseCaidaDesde === 'string' && !Number.isNaN(Date.parse(d.baseCaidaDesde)) ? d.baseCaidaDesde : null;
  const entero = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? Math.min(v, 1_000) : 0);
  const desde = typeof d.appCaidaDesde === 'string' && !Number.isNaN(Date.parse(d.appCaidaDesde)) ? d.appCaidaDesde : null;
  return { vistos, baseCaidaDesde: caida, rachaApp: entero(d.rachaApp), appCaidaDesde: desde, appAvisada: d.appAvisada === true, rachaBandeja: entero(d.rachaBandeja) };
}

/**
 * M4 (ronda 19): el estado de dedup vive en la MISMA base que puede caer. Si la base cae, no se puede leer el latido
 * previo ni escribir el nuevo: sin esto cada pasada creía partir de cero (un aviso por hora de «base inalcanzable»)
 * y «base volvió» no se emitía nunca. Esta memoria del PROCESO guarda el último estado y se usa cuando la lectura
 * falla, y su `baseCaidaDesde` completa el estado de la base al volver. LIMITACIÓN (declarada): es por instancia;
 * un arranque en frío o otra instancia la pierde (a lo más, un aviso repetido bajo el piso de 1 h; nunca silencio).
 */
let memoria: EstadoGuardia | null = null;
export const memoriaDeEstado = {
  leer: (): EstadoGuardia | null => memoria,
  guardar: (e: EstadoGuardia): void => { memoria = e; },
  /** Solo para pruebas. */
  olvidar: (): void => { memoria = null; },
};

export interface DecisionApp { racha: number; desde: string | null; caida: boolean; avisar: boolean }

/** A3: la histéresis de la app. `fallo` = el sondeo no obtuvo respuesta de la app. */
export function decidirApp(previo: EstadoGuardia, fallo: boolean, ahoraIso: string): DecisionApp {
  if (!fallo) return { racha: 0, desde: null, caida: false, avisar: false };
  const racha = previo.rachaApp + 1;
  const caida = racha >= SONDEOS_FALLIDOS_PARA_CAIDA;
  return { racha, desde: previo.appCaidaDesde ?? ahoraIso, caida, avisar: caida && !previo.appAvisada };
}

export interface DecisionGuardia {
  /** S1/S2 vigentes (nuevos o ya avisados). */
  urgentes: ItemClasificado[];
  /** Los que NO estaban en `previo.vistos`: lo que hay que avisar ahora. */
  nuevos: ItemClasificado[];
  ciegasNuevas: Array<{ fuente: string; error: string | null }>;
  /** `true` si la base estaba inalcanzable en la pasada anterior y ahora se leyó. */
  baseVolvio: boolean;
  estado: EstadoGuardia;
}

/** Decide qué avisar. TODO lo vigente queda como visto; lo resuelto sale solo (si reaparece, es incidente nuevo). */
export function decidirAvisos(c: ClasificacionGuardia, previo: EstadoGuardia): DecisionGuardia {
  const visto = (clave: string) => previo.vistos.includes(huellaDeClave(clave)) || previo.vistos.includes(clave);
  const urgentes = c.items.filter((i) => i.severidad === 'S1' || i.severidad === 'S2');
  const nuevos = urgentes.filter((i) => !visto(claveDeItem(i)));
  const ciegasNuevas = c.fuentesCiegas.filter((f) => !visto(`ciega|${f.fuente}`));
  return {
    urgentes, nuevos, ciegasNuevas,
    baseVolvio: previo.baseCaidaDesde !== null,
    estado: {
      ...previo,
      vistos: [...urgentes.map((i) => huellaDeClave(claveDeItem(i))), ...c.fuentesCiegas.map((f) => huellaDeClave(`ciega|${f.fuente}`))].slice(0, TOPE_VISTOS),
      baseCaidaDesde: null,
    },
  };
}

/**
 * M5 (ronda 19): el dedup anota «ya lo avisé» SOLO si el aviso salió. Sin canal configurado, con el piso de una hora o con
 * el envío rechazado, un S1 nuevo se quedaba en vistos y no volvía a sonar al arreglar el canal. Si no salió, lo nuevo
 * se quita de vistos (lo ya avisado antes se conserva) y la siguiente pasada vuelve a intentarlo.
 */
export function estadoTrasAviso(d: DecisionGuardia, avisoSalio: boolean): EstadoGuardia {
  if (avisoSalio || (d.nuevos.length === 0 && d.ciegasNuevas.length === 0)) return d.estado;
  const sinAvisar = new Set([
    ...d.nuevos.map((i) => huellaDeClave(claveDeItem(i))),
    ...d.ciegasNuevas.map((f) => huellaDeClave(`ciega|${f.fuente}`)),
  ]);
  return { ...d.estado, vistos: d.estado.vistos.filter((h) => !sinAvisar.has(h)) };
}

/** Una base inalcanzable avisa UNA vez por racha: devuelve si hay que avisar y el estado a guardar. */
export function decidirBaseCaida(previo: EstadoGuardia, ahoraIso: string): { avisar: boolean; estado: EstadoGuardia } {
  if (previo.baseCaidaDesde) return { avisar: false, estado: previo };
  return { avisar: true, estado: { ...previo, baseCaidaDesde: ahoraIso } };
}

/** Las líneas del aviso (sin canal): el script de la Mac las une para WhatsApp; el cron las manda como datos del correo. */
export function lineasDeAviso(d: Pick<DecisionGuardia, 'nuevos' | 'ciegasNuevas'>): string[] {
  return [
    ...d.nuevos.map((i) => `[${i.severidad}] ${i.titulo} — ${i.flota} (${i.fuente}, regla: ${i.regla})${i.vence ? ` · vence ${i.vence}` : ''}`),
    ...d.ciegasNuevas.map((f) => `[S2] Fuente CIEGA: ${f.fuente}${f.error ? ` — ${f.error.slice(0, 80)}` : ''}`),
  ];
}
