import type { EstadoGuia, InvitacionGuia, ParcheEstadoGuia, RecorridoGuardado } from './tipos';

// Estado de la guía en servidor: forma, normalización y fusión. PURO (sin base): el repositorio solo lee y escribe lo que esto devuelve.
// «Lo derivable no se guarda»: el avance medido (PEM/Arranque) se recalcula desde las señales; aquí vive solo lo cosmético y el avance
// de los recorridos. Un `hecho` guardado de un paso con señal no se cree si la señal hoy dice `no` (lo decide el motor, no este módulo).

export const TOPE_ESTADO_BYTES = 16_384;
const MAX_RECORRIDOS = 40;
const MAX_IDS = 200;
const MAX_TAREAS = 80;
const MAX_PISTAS = 60;
const MAX_DECLARACIONES = 40;
const MAX_CELEBRADOS = 40;
const INVITACIONES: readonly InvitacionGuia[] = ['pendiente', 'vista', 'ahora_no', 'descartada'];

export function estadoVacio(): EstadoGuia {
  return { v: 1, invitacion: 'pendiente', ofertas: 0, modo: null, recorridos: {}, tareas: {}, pistas: [], declaraciones: {}, prefs: { reducirMovimiento: null }, celebrados: [] };
}

const esObjeto = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const texto = (x: unknown, max: number): string | null => (typeof x === 'string' && x.length > 0 && x.length <= max ? x : null);
const iso = (x: unknown): string | null => (typeof x === 'string' && x.length <= 40 && !Number.isNaN(Date.parse(x)) ? x : null);
const ids = (x: unknown): string[] => (Array.isArray(x) ? x.map((i) => texto(i, 40)).filter((i): i is string => i !== null).slice(0, MAX_IDS) : []);

function recorrido(x: unknown): RecorridoGuardado | null {
  if (!esObjeto(x)) return null;
  const paso = texto(x.paso, 40);
  const inicio = iso(x.inicio);
  if (!paso || !inicio) return null;
  return {
    paso, hechos: ids(x.hechos), omitidos: ids(x.omitidos), confirmados: ids(x.confirmados), inicio,
    fin: iso(x.fin), version: Number.isInteger(x.version) && (x.version as number) >= 1 ? (x.version as number) : 1,
  };
}

/** Acepta cualquier cosa y devuelve un estado válido y acotado: lo que no encaja se descarta. Nunca lanza. */
export function normalizarEstado(crudo: unknown): EstadoGuia {
  const base = estadoVacio();
  if (!esObjeto(crudo)) return base;
  const recorridos: Record<string, RecorridoGuardado> = {};
  if (esObjeto(crudo.recorridos)) {
    for (const [k, v] of Object.entries(crudo.recorridos).slice(0, MAX_RECORRIDOS)) {
      const id = texto(k, 80);
      const r = recorrido(v);
      if (id && r) recorridos[id] = r;
    }
  }
  const tareas: Record<string, string> = {};
  if (esObjeto(crudo.tareas)) for (const [k, v] of Object.entries(crudo.tareas).slice(0, MAX_TAREAS)) { const id = texto(k, 40); const f = iso(v); if (id && f) tareas[id] = f; }
  const declaraciones: EstadoGuia['declaraciones'] = {};
  if (esObjeto(crudo.declaraciones)) {
    for (const [k, v] of Object.entries(crudo.declaraciones).slice(0, MAX_DECLARACIONES)) {
      const id = texto(k, 40);
      if (id && esObjeto(v) && typeof v.valor === 'boolean' && iso(v.en)) declaraciones[id] = { valor: v.valor, en: v.en as string };
    }
  }
  const pistas = Array.isArray(crudo.pistas) ? crudo.pistas.filter((p): p is string => typeof p === 'string' && p.startsWith('/dashboard') && p.length <= 120).slice(0, MAX_PISTAS) : [];
  const prefs = esObjeto(crudo.prefs) && typeof crudo.prefs.reducirMovimiento === 'boolean' ? { reducirMovimiento: crudo.prefs.reducirMovimiento } : base.prefs;
  const out: EstadoGuia = {
    v: 1,
    invitacion: INVITACIONES.includes(crudo.invitacion as InvitacionGuia) ? (crudo.invitacion as InvitacionGuia) : 'pendiente',
    ofertas: Number.isInteger(crudo.ofertas) && (crudo.ofertas as number) >= 0 ? Math.min(crudo.ofertas as number, 99) : 0,
    modo: crudo.modo === 'corto' || crudo.modo === 'completo' ? crudo.modo : null,
    recorridos, tareas, pistas, declaraciones, prefs,
    celebrados: ids(crudo.celebrados).slice(0, MAX_CELEBRADOS),
  };
  if (crudo.importado === true) out.importado = true;
  return out;
}

/** Fusiona un parche sobre el estado: `recorridos`, `tareas` y `declaraciones` por clave; lo demás se reemplaza. El resultado siempre está normalizado. */
export function fusionarEstado(actual: EstadoGuia, parche: ParcheEstadoGuia): EstadoGuia {
  const p = esObjeto(parche) ? (parche as Record<string, unknown>) : {};
  const combinado: Record<string, unknown> = { ...actual };
  for (const k of ['invitacion', 'ofertas', 'modo', 'pistas', 'prefs', 'celebrados', 'importado'] as const) if (k in p) combinado[k] = p[k];
  for (const k of ['recorridos', 'tareas', 'declaraciones'] as const) {
    if (esObjeto(p[k])) combinado[k] = { ...(actual[k] as Record<string, unknown>), ...(p[k] as Record<string, unknown>) };
  }
  return normalizarEstado(combinado);
}

export const bytesDeEstado = (e: EstadoGuia): number => new TextEncoder().encode(JSON.stringify(e)).length;
export const cabeEnTope = (e: EstadoGuia): boolean => bytesDeEstado(e) <= TOPE_ESTADO_BYTES;

/** La invitación se muestra si la flota la encendió (o el interruptor global) y esta persona sigue en `pendiente`, o dijo «ahora no» hace >= 3 días con menos de 2 ofertas. */
export function invitacionVigente(e: EstadoGuia, ahoraMs: number, ultimaOfertaMs: number | null): boolean {
  if (e.invitacion === 'pendiente') return true;
  if (e.invitacion !== 'ahora_no') return false;
  return e.ofertas < 2 && ultimaOfertaMs !== null && ahoraMs - ultimaOfertaMs >= 3 * 86_400_000;
}
