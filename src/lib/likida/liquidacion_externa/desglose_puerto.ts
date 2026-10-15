// ═══════════════════════════════════════════════════════════════════════════
// PUERTO DE LECTURA DE DESGLOSES (T-A1-03) — lo que el conector del sistema de transporte debe cumplir.
//
// Likida es CONSUMIDOR: define aquí la firma, el cursor y los errores; el cliente HTTP lo construye el conector
// (otro frente) cuando exista la API. Este módulo NO habla HTTP, NO importa base de datos y NO guarda credenciales
// (esas viven en el cofre cifrado del conector).
//
// ── CURSOR Y TRASLAPE ───────────────────────────────────────────────────────
// Orden ascendente por `(desde, id)`. `desde` es el instante de modificación (o la fecha de póliza) y `id` el
// identificador estable de la bitácora. Como la póliza puede llegar tarde, el consumidor re-lee una ventana de
// traslape (`reLeerDesde`, por defecto 24 h antes del cursor, ver `reLeerDesdeDeCursor`): las filas repetidas se
// absorben por la idempotencia de `claveExterna`. `items` incluye bitácoras SIN póliza (`poliza: null`) para poder
// contarlas.
// ═══════════════════════════════════════════════════════════════════════════

import type { DesgloseBitacora } from './desglose_contrato';
import { claveDeBitacora } from './desglose_contrato';

export interface CursorDesglose {
  /** Instante ISO de modificación (o fecha de póliza) de la última fila leída. */
  desde: string;
  /** Id estable de la última bitácora leída (desempata filas con el mismo `desde`). */
  despuesDe: string;
}

export interface ListarDesglosesParams {
  tenantId: string;
  cursor: CursorDesglose | null;
  /** Máximo de filas por página; entero ≥ 1. */
  limite: number;
  /** Instante ISO desde el cual re-leer (traslape); tiene prioridad sobre el cursor como cota inferior. */
  reLeerDesde?: string;
}

export interface PaginaDesgloses {
  items: DesgloseBitacora[];
  /** Cursor de la última fila devuelta (o el recibido si la página vino vacía). */
  siguiente: CursorDesglose | null;
  hayMas: boolean;
}

export interface ResultadoMarcado {
  ok: string[];
  fallidas: Array<{ clave: string; motivo: string }>;
}

export interface LectorDesglosesPuerto {
  listar(p: ListarDesglosesParams): Promise<PaginaDesgloses>;
  /** OPCIONAL: si el sistema origen no ofrece escritura, manda el cursor propio. */
  marcarEnviadas?(claves: string[]): Promise<ResultadoMarcado>;
}

// ── Errores tipados (el reintento con backoff lo hace el conector) ──────────
export class TmsNoDisponible extends Error {
  constructor(mensaje = 'El sistema de transporte no está disponible') {
    super(mensaje);
    this.name = 'TmsNoDisponible';
  }
}
export class TmsCredenciales extends Error {
  constructor(mensaje = 'Credenciales del sistema de transporte rechazadas') {
    super(mensaje);
    this.name = 'TmsCredenciales';
  }
}
export class TmsLimite extends Error {
  constructor(mensaje = 'Límite de peticiones del sistema de transporte', readonly reintentarEnSegundos?: number) {
    super(mensaje);
    this.name = 'TmsLimite';
  }
}

export const VENTANA_TRASLAPE_HORAS = 24;

/** Instante desde el cual re-leer: el `desde` del cursor menos la ventana de traslape (null sin cursor). */
export function reLeerDesdeDeCursor(c: CursorDesglose | null, horas = VENTANA_TRASLAPE_HORAS): string | undefined {
  if (!c) return undefined;
  const t = Date.parse(c.desde);
  if (Number.isNaN(t)) return undefined;
  return new Date(t - horas * 3_600_000).toISOString();
}

/** Identificador estable de una bitácora en el cursor (el mismo que la clave de idempotencia). */
export function idDeDesglose(d: DesgloseBitacora): string {
  return claveDeBitacora(d.terminal, d.bitacora);
}

// ── Doble en memoria (pruebas del consumidor y desarrollo sin API) ──────────
export interface FilaEnMemoria {
  /** Instante ISO de modificación de la fila. */
  modificadoEn: string;
  desglose: DesgloseBitacora;
}

export interface OpcionesLectorEnMemoria {
  /** Con `true` expone `marcarEnviadas`; por defecto el doble NO lo ofrece. */
  conMarcar?: boolean;
}

function comparar(a: { desde: string; id: string }, b: { desde: string; id: string }): number {
  const ta = Date.parse(a.desde);
  const tb = Date.parse(b.desde);
  if (ta !== tb) return ta - tb;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function lectorEnMemoria(
  filas: FilaEnMemoria[],
  opciones: OpcionesLectorEnMemoria = {},
): LectorDesglosesPuerto & { enviadas: ReadonlySet<string> } {
  const ordenadas = filas
    .map((f) => ({ desde: f.modificadoEn, id: idDeDesglose(f.desglose), desglose: f.desglose }))
    .sort(comparar);
  const enviadas = new Set<string>();

  const lector: LectorDesglosesPuerto & { enviadas: ReadonlySet<string> } = {
    enviadas,
    async listar(p) {
      if (!Number.isInteger(p.limite) || p.limite < 1) throw new RangeError('limite debe ser un entero >= 1');
      let candidatas = ordenadas;
      if (p.reLeerDesde !== undefined) {
        const t = Date.parse(p.reLeerDesde);
        if (Number.isNaN(t)) throw new RangeError('reLeerDesde no es un instante ISO válido');
        candidatas = ordenadas.filter((f) => Date.parse(f.desde) >= t);
      } else if (p.cursor) {
        const c = { desde: p.cursor.desde, id: p.cursor.despuesDe };
        candidatas = ordenadas.filter((f) => comparar(f, c) > 0);
      }
      const pagina = candidatas.slice(0, p.limite);
      const ultima = pagina[pagina.length - 1];
      return {
        items: pagina.map((f) => f.desglose),
        siguiente: ultima ? { desde: ultima.desde, despuesDe: ultima.id } : p.cursor,
        hayMas: candidatas.length > pagina.length,
      };
    },
  };
  if (opciones.conMarcar) {
    lector.marcarEnviadas = async (claves) => {
      const conocidas = new Set(ordenadas.map((f) => f.id));
      const res: ResultadoMarcado = { ok: [], fallidas: [] };
      for (const clave of claves) {
        if (conocidas.has(clave)) { enviadas.add(clave); res.ok.push(clave); }
        else res.fallidas.push({ clave, motivo: 'clave desconocida' });
      }
      return res;
    };
  }
  return lector;
}
