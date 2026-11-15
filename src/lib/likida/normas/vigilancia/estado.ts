// EL ESTADO DE LA VIGILANCIA. Vive en `cron_latido.detalle.vigilancia` (sin tabla nueva): cada latido lo reescribe
// ENTERO, así que TODO camino de salida de la ruta lo arrastra desde el latido anterior. `leerEstado` es defensivo a
// propósito: un detalle de otra versión o a medio escribir se lee como «vacío» en ese campo, nunca lanza.

import { esIso } from './fechas';

/** Tope de codNota recordados para que un reintento no repita el aviso. */
export const TOPE_VISTOS = 200;
/** Tope de avisos que esperan salir (si el correo no está configurado, no crecen sin límite). */
export const TOPE_PENDIENTES = 50;

export interface Aviso {
  tipo: 'dof' | 'sat' | 'ley';
  /** Una línea ya redactada, lista para el correo. */
  linea: string;
  /** Solo `dof`: el codNota, para el dedup. */
  codNota?: number;
}

export interface EstadoVigilancia {
  /** Último día (AAAA-MM-DD) barrido con las tres ediciones y verificado contra `diarios`. */
  ultimoDiaBarrido: string | null;
  vistos: number[];
  pendientes: Aviso[];
  /** ETag y Last-Modified del minisitio del SAT, por variante (`2026`, `2027`). `null` = nunca respondió 200. */
  sat: Record<string, { etag: string | null; lastModified: string | null } | null>;
  /** Last-Modified de cada PDF de ley (`CFF`, `LISR`, `LIVA`, `LFPDPPP`). */
  leyes: Record<string, string | null>;
  ultimoSemanal: string | null;
  /** `AAAA-M` del último trimestre revisado (p. ej. `2026-10`). */
  ultimoTrimestral: string | null;
  /** Un día hábil sin notas que lleva varias corridas igual: ver `ejecutar.ts`. */
  retenido: { dia: string; intentos: number } | null;
  /** Días que se dieron por «sin edición» tras confirmarlo `diarios` varias corridas seguidas. */
  diasSinEdicion: string[];
  fallosSeguidos: number;
}

export const estadoVacio = (): EstadoVigilancia => ({
  ultimoDiaBarrido: null, vistos: [], pendientes: [], sat: {}, leyes: {}, ultimoSemanal: null, ultimoTrimestral: null,
  retenido: null, diasSinEdicion: [], fallosSeguidos: 0,
});

const esObjeto = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const cadenaONulo = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

export function leerEstado(detalle: unknown): EstadoVigilancia {
  const base = estadoVacio();
  const crudo = esObjeto(detalle) && esObjeto(detalle.vigilancia) ? detalle.vigilancia : null;
  if (!crudo) return base;
  const vistos = Array.isArray(crudo.vistos) ? crudo.vistos.filter((x): x is number => typeof x === 'number' && Number.isFinite(x)) : [];
  const pendientes = Array.isArray(crudo.pendientes)
    ? crudo.pendientes.filter((p): p is Aviso => esObjeto(p) && typeof p.linea === 'string' && (p.tipo === 'dof' || p.tipo === 'sat' || p.tipo === 'ley'))
    : [];
  const sat: EstadoVigilancia['sat'] = {};
  if (esObjeto(crudo.sat)) {
    for (const [k, v] of Object.entries(crudo.sat)) {
      sat[k] = esObjeto(v) ? { etag: cadenaONulo(v.etag), lastModified: cadenaONulo(v.lastModified) } : null;
    }
  }
  const leyes: Record<string, string | null> = {};
  if (esObjeto(crudo.leyes)) for (const [k, v] of Object.entries(crudo.leyes)) leyes[k] = cadenaONulo(v);
  const retenido = esObjeto(crudo.retenido) && esIso(crudo.retenido.dia) && typeof crudo.retenido.intentos === 'number'
    ? { dia: crudo.retenido.dia, intentos: crudo.retenido.intentos } : null;
  return {
    ultimoDiaBarrido: esIso(crudo.ultimoDiaBarrido) ? crudo.ultimoDiaBarrido : null,
    vistos: vistos.slice(-TOPE_VISTOS),
    pendientes: pendientes.slice(-TOPE_PENDIENTES),
    sat, leyes,
    ultimoSemanal: esIso(crudo.ultimoSemanal) ? crudo.ultimoSemanal : null,
    ultimoTrimestral: cadenaONulo(crudo.ultimoTrimestral),
    retenido,
    diasSinEdicion: Array.isArray(crudo.diasSinEdicion) ? crudo.diasSinEdicion.filter(esIso).slice(-10) : [],
    fallosSeguidos: typeof crudo.fallosSeguidos === 'number' && crudo.fallosSeguidos >= 0 ? Math.floor(crudo.fallosSeguidos) : 0,
  };
}
