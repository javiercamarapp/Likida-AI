import { calcularAlertas } from './calcular-alertas';
import { alertasExtra, leerEntradaAlertasExtra, type AlertaExtra } from '@/lib/admin/fuentes-alerta-extra';
import { conteoDeFuente, getBandejaEscalaciones, type BandejaEscalaciones, type FuenteEscalacion } from '@/lib/admin/escalaciones';
import { leerResumenBandeja, type ResumenBandejaCola } from '@/lib/admin/cola-aprobacion';

/**
 * Lo que la campana de la cabecera de /admin necesita saber: cuántas cosas esperan a un humano y si alguna es urgente.
 *
 * `pendientes === null` significa «lectura caída» (no se pudo saber) y la cabecera lo dice como «sin dato»: NUNCA se convierte en 0,
 * porque una campana callada sobre una fuente ciega afirmaría «no hay nada».
 */
export interface RequiereAccion {
  pendientes: number | null;
  hayUrgente: boolean;
}

export const SIN_DATO: RequiereAccion = { pendientes: null, hayUrgente: false };

/** Caché corta (30 a 60 s del plan): la campana vive en el layout y se evalúa en cada navegación. */
export const TTL_REQUIERE_ACCION_MS = 45_000;

const FUENTES: FuenteEscalacion[] = ['arco', 'corridas', 'talachas', 'facturas_proveedor', 'tickets', 'liquidaciones'];

/**
 * Pura. Suma los conteos reales de la bandeja (los MISMOS que pinta /admin/escalaciones, vía `conteoDeFuente`). Si alguna fuente no se
 * pudo leer y lo legible suma 0, el resultado es `null` (no 0). Si hay pendientes legibles y otra fuente cayó, se informa lo legible:
 * es un mínimo verdadero y la campana de /admin/notificaciones ya avisa cuál fuente está ciega.
 * `hayUrgente` sale de `calcularAlertas` (no se reimplementa): hay alguna alerta de atención con pendientes reales; el aviso de
 * «no se pudo leer» no cuenta como urgencia.
 */
export function resumirRequiereAccion(b: Pick<BandejaEscalaciones, 'conteos'>, extras: ReadonlyArray<AlertaExtra> = []): RequiereAccion {
  let suma = 0;
  let ciegas = 0;
  for (const f of FUENTES) {
    const c = conteoDeFuente(f, b.conteos);
    if (c === null) ciegas += 1; else suma += c;
  }
  const alertas = calcularAlertas(null, [], b.conteos, null);
  const hayUrgente = alertas.some((a) => a.tipo === 'atencion' && !a.texto.startsWith('No se pudo leer'));
  // Fuentes extra (crons caídos o no sanos, crédito de IA agotado): cada alerta suma 1. «No se pudo leer el latido» es ceguera, no
  // un pendiente: no suma ni es urgente (igual que el aviso de lectura caída de la bandeja).
  const reales = extras.filter((a) => a.id !== 'crons_ilegibles');
  const urgente = hayUrgente || reales.length > 0;
  const total = suma + reales.length;
  if (ciegas > 0 && total === 0) return { pendientes: null, hayUrgente: urgente };
  return { pendientes: total, hayUrgente: urgente };
}

type Lector = (ahoraMs: number) => Promise<BandejaEscalaciones>;
type LectorExtras = () => Promise<ReadonlyArray<AlertaExtra>>;

/** Nunca lanza: si las fuentes extra no se pueden leer, la campana sigue con la bandeja sola. */
const leerExtras: LectorExtras = async () => alertasExtra(await leerEntradaAlertasExtra());
type LectorCola = (ahoraMs: number) => Promise<ResumenBandejaCola | null>;
/** `cola` = el estado de la bandeja de aprobación (`null` = no se pudo leer: «sin dato», nunca 0). Alimenta los números de las pestañas Tu turno y Aprobaciones. */
export interface PanoramaAccion { resumen: RequiereAccion; bandeja: BandejaEscalaciones | null; cola: ResumenBandejaCola | null }
let cache: { valor: PanoramaAccion; vence: number } | null = null;

/** Solo para pruebas. */
export function vaciarCacheRequiereAccion(): void { cache = null; }

/**
 * La lectura única de la bandeja con su resumen, en caché corta. La campana (`obtenerRequiereAccion`) y los conteos de las pestañas
 * (`conteos-pestanas.ts`) salen de AQUÍ: una sola lectura por ventana, nunca dos. NUNCA lanza: si la bandeja entera falla devuelve
 * `{ resumen: SIN_DATO, bandeja: null }` (y no lo cachea, para reintentar en la siguiente navegación). Lector y reloj inyectables.
 */
export async function obtenerPanoramaAccion(
  ahoraMs: number = Date.now(),
  leer: Lector = getBandejaEscalaciones,
  leerAlertasExtra: LectorExtras = leerExtras,
  leerCola: LectorCola = leerResumenBandeja,
): Promise<PanoramaAccion> {
  if (cache && ahoraMs < cache.vence) return cache.valor;
  try {
    const [bandeja, extras, cola] = await Promise.all([
      leer(ahoraMs),
      leerAlertasExtra().catch((): ReadonlyArray<AlertaExtra> => []),
      leerCola(ahoraMs).catch((): ResumenBandejaCola | null => null),
    ]);
    const valor = { resumen: resumirRequiereAccion(bandeja, extras), bandeja, cola };
    cache = { valor, vence: ahoraMs + TTL_REQUIERE_ACCION_MS };
    return valor;
  } catch {
    return { resumen: SIN_DATO, bandeja: null, cola: null };
  }
}

/** Lo que consume el layout para la campana. Ver `obtenerPanoramaAccion`. */
export async function obtenerRequiereAccion(
  ahoraMs: number = Date.now(),
  leer: Lector = getBandejaEscalaciones,
  leerAlertasExtra: LectorExtras = leerExtras,
): Promise<RequiereAccion> {
  return (await obtenerPanoramaAccion(ahoraMs, leer, leerAlertasExtra)).resumen;
}
