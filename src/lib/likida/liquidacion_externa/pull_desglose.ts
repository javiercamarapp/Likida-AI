// ═══════════════════════════════════════════════════════════════════════════
// PULL CONSUMIDOR DE DESGLOSES (T-A1-24): lee del sistema de transporte, a través del puerto `LectorDesglosesPuerto`,
// las bitácoras nuevas o modificadas y las entrega a `recibirDesglose`.
//
// Likida es CONSUMIDOR: este módulo NO habla HTTP, NO guarda credenciales y NO imprime datos del operador. Todo el acceso
// a datos entra por `DependenciasPull` (por omisión, `repo_correo` y `recibirDesglose`).
//
// Garantías:
//   · CURSOR: se lee de `liquidacion_pull_estado`; la primera página re-lee una ventana de traslape (24 h antes del
//     cursor, porque la póliza llega tarde). Las repetidas se absorben por la idempotencia de `recibirDesglose`.
//   · El cursor avanza SOLO después de procesar y persistir cada página, y NUNCA retrocede (el traslape lo haría).
//     Un error del sistema origen (`TmsNoDisponible`, `TmsLimite`, `TmsCredenciales`) o de persistencia deja el cursor
//     intacto, guarda `ultimo_error` y la pasada termina sin lanzar: la siguiente corrida reintenta.
//   · SIN PÓLIZA: la bitácora NO se envía; abre la excepción `sin_poliza`, que se resuelve sola cuando una lectura
//     posterior ya trae la póliza.
//   · MAPEO INVÁLIDO: excepción `mapeo_invalido` con SOLO el nombre del campo (nunca valores personales).
//   · MARCA «ENVIADO»: opcional (el puerto puede no ofrecerla). Solo para claves cuyo correo al OPERADOR ya está
//     `enviada`/`entregada`; un fallo de marca NO afecta la entrega (la verdad es Likida; la marca es cortesía del TMS).
//   · TOPE: ≤ 100 ítems NUEVOS por pasada (para no pasar `maxDuration`). La relectura del traslape no consume ese tope,
//     pero tiene el suyo (`TOPE_RELECTURA`): si la ventana lo excede, la pasada falla de forma visible en vez de ciclar.
// ═══════════════════════════════════════════════════════════════════════════

import { logger } from '@/lib/logger';
import { CampoInvalido } from '@/lib/http/campos_cuerpo';
import { claveDeBitacora, validarDesgloseBitacora, type DesgloseBitacora } from './desglose_contrato';
import {
  reLeerDesdeDeCursor, TmsCredenciales, TmsLimite, TmsNoDisponible,
  type CursorDesglose, type LectorDesglosesPuerto,
} from './desglose_puerto';
import { recibirDesglose, type ResultadoDesglose } from './desglose_recibir';
import {
  abrirExcepcion, entregasDe, guardarCursorPull, leerCursorPull, listarExcepciones, resolverExcepcion,
  type EntregaCorreo, type EstadoPull, type TipoExcepcion,
} from './repo_correo';

export const TOPE_ITEMS_POR_PASADA = 100;
export const TOPE_RELECTURA = 300;

export interface DependenciasPull {
  ahora: () => Date;
  /** `null` si las tablas del pull no están disponibles (migraciones 0785-0787 sin aplicar). */
  leerEstado: (tenantId: string) => Promise<EstadoPull | null>;
  guardarEstado: (tenantId: string, e: Parameters<typeof guardarCursorPull>[1]) => Promise<void>;
  recibir: (tenantId: string, d: DesgloseBitacora) => Promise<ResultadoDesglose>;
  abrirExcepcion: (
    tenantId: string, clave: string, tipo: TipoExcepcion, detalle: Record<string, unknown>, ahora: Date,
  ) => Promise<{ id: number; nueva: boolean }>;
  /** Excepciones `sin_poliza` abiertas: clave externa → id. */
  excepcionesSinPoliza: (tenantId: string) => Promise<Map<string, number>>;
  resolverExcepcion: (tenantId: string, id: number, ahora: Date) => Promise<boolean>;
  entregasDe: (tenantId: string, liquidacionId: string) => Promise<EntregaCorreo[]>;
}

export const dependenciasPullPorOmision: DependenciasPull = {
  ahora: () => new Date(),
  leerEstado: async (t) => {
    const l = await leerCursorPull(t);
    return l.ok ? l.valor : null;
  },
  guardarEstado: guardarCursorPull,
  recibir: (t, d) => recibirDesglose(t, d),
  abrirExcepcion,
  excepcionesSinPoliza: async (t) => {
    const l = await listarExcepciones(t, { soloAbiertas: true, tipo: 'sin_poliza', limite: 500 });
    return new Map(l.ok ? l.valor.map((e) => [e.claveExterna, e.id] as const) : []);
  },
  resolverExcepcion,
  entregasDe: async (t, id) => {
    const l = await entregasDe(t, id);
    return l.ok ? l.valor : [];
  },
};

export interface OpcionesPull {
  /** Tamaño de página pedido al puerto; entero ≥ 1, se recorta a `TOPE_ITEMS_POR_PASADA`. */
  limite?: number;
  /** A37-S09-02: instante (ms) tras el cual no se pide otra página. El cursor ya guardado hace seguro cortar entre páginas. */
  venceEn?: number;
}

export interface ResultadoPull {
  estado: 'ok' | 'error' | 'no_disponible';
  paginas: number;
  /** Ítems leídos en esta pasada (incluye el traslape). */
  leidas: number;
  /** Desgloses nuevos guardados. */
  importadas: number;
  /** Excepciones abiertas o refrescadas por esta pasada. */
  excepciones: number;
  /** Excepciones `sin_poliza` resueltas porque la póliza ya llegó. */
  resueltas: number;
  marcadas: number;
  marcasFallidas: number;
  hayMas: boolean;
  cursor: CursorDesglose | null;
  /** Clase del error (sin datos personales); solo con `estado: 'error'`. */
  error?: string;
}

function posicion(c: CursorDesglose): [number, string] {
  return [Date.parse(c.desde), c.despuesDe];
}

/** > 0 si `a` está después de `b`. */
function comparar(a: CursorDesglose, b: CursorDesglose): number {
  const [ta, ia] = posicion(a);
  const [tb, ib] = posicion(b);
  if (ta !== tb) return ta - tb;
  return ia < ib ? -1 : ia > ib ? 1 : 0;
}

function claveDe(crudo: unknown): string {
  const d = crudo as { terminal?: unknown; bitacora?: unknown } | null;
  if (d && typeof d.bitacora === 'string' && d.bitacora !== '') {
    return claveDeBitacora(typeof d.terminal === 'string' ? d.terminal : undefined, d.bitacora);
  }
  return 'BIT-DESCONOCIDA';
}

/** Solo la clase del error: el mensaje de una falla de base o de red puede traer datos que no deben quedar en `ultimo_error`. */
function descripcionError(e: unknown): string {
  if (e instanceof TmsNoDisponible || e instanceof TmsLimite || e instanceof TmsCredenciales) return `${e.name}: ${e.message}`;
  return e instanceof Error ? `${e.name} al procesar el desglose` : 'error desconocido';
}

export async function pullDesgloses(
  tenantId: string, lector: LectorDesglosesPuerto, deps: DependenciasPull = dependenciasPullPorOmision, opciones: OpcionesPull = {},
): Promise<ResultadoPull> {
  const r: ResultadoPull = {
    estado: 'ok', paginas: 0, leidas: 0, importadas: 0, excepciones: 0, resueltas: 0, marcadas: 0, marcasFallidas: 0, hayMas: false, cursor: null,
  };
  const estado = await deps.leerEstado(tenantId);
  if (!estado) return { ...r, estado: 'no_disponible' };

  const ahora = deps.ahora();
  const cursorInicial = estado.cursor;
  r.cursor = cursorInicial;
  const tamano = Math.min(Math.max(Math.trunc(opciones.limite ?? TOPE_ITEMS_POR_PASADA), 1), TOPE_ITEMS_POR_PASADA);
  const reLeerDesde = reLeerDesdeDeCursor(cursorInicial);
  const acumulado = () => ({
    leidas: estado.leidas + r.leidas, importadas: estado.importadas + r.importadas, excepciones: estado.excepciones + r.excepciones,
  });

  try {
    const sinPoliza = await deps.excepcionesSinPoliza(tenantId);
    let lectura: CursorDesglose | null = cursorInicial; // dónde seguir leyendo
    let nuevos = 0;
    let releidos = 0;
    let primera = true;

    while (nuevos < TOPE_ITEMS_POR_PASADA) {
      const limite = Math.min(tamano, TOPE_ITEMS_POR_PASADA - nuevos);
      const pagina = await lector.listar({
        tenantId, cursor: lectura, limite, ...(primera && reLeerDesde !== undefined ? { reLeerDesde } : {}),
      });
      const eraPrimera = primera;
      primera = false;
      r.paginas += 1;
      r.hayMas = pagina.hayMas;

      const esNueva = !cursorInicial || (pagina.siguiente !== null && comparar(pagina.siguiente, cursorInicial) > 0);
      if (esNueva) nuevos += pagina.items.length; else releidos += pagina.items.length;
      if (releidos > TOPE_RELECTURA) throw new Error('ventana de traslape mayor que el tope de relectura');

      const porMarcar: string[] = [];
      // Filas que el lector ya no pudo mapear: excepción visible (solo el nombre del campo), nunca descarte silencioso.
      for (const rech of pagina.rechazadas ?? []) {
        r.leidas += 1;
        await deps.abrirExcepcion(tenantId, rech.clave, 'mapeo_invalido', { campo: rech.campo }, ahora);
        r.excepciones += 1;
      }
      for (const crudo of pagina.items) {
        r.leidas += 1;
        const clave = claveDe(crudo);
        let d: DesgloseBitacora;
        try {
          d = validarDesgloseBitacora(crudo);
        } catch (e) {
          if (!(e instanceof CampoInvalido)) throw e;
          await deps.abrirExcepcion(tenantId, clave, 'mapeo_invalido', { campo: e.campo }, ahora);
          r.excepciones += 1;
          continue;
        }

        if (d.poliza === null) {
          await deps.abrirExcepcion(tenantId, clave, 'sin_poliza', { bitacora: d.bitacora }, ahora);
          r.excepciones += 1;
          continue;
        }

        let res: ResultadoDesglose;
        try {
          res = await deps.recibir(tenantId, d);
        } catch (e) {
          if (!(e instanceof CampoInvalido)) throw e;
          await deps.abrirExcepcion(tenantId, clave, 'mapeo_invalido', { campo: e.campo }, ahora);
          r.excepciones += 1;
          continue;
        }

        // La póliza ya llegó: la excepción de «sin póliza» se resuelve sola.
        const abierta = sinPoliza.get(res.claveExterna);
        if (abierta !== undefined && await deps.resolverExcepcion(tenantId, abierta, ahora)) {
          sinPoliza.delete(res.claveExterna);
          r.resueltas += 1;
        }

        if (res.estado === 'creada') {
          r.importadas += 1;
          r.excepciones += res.excepciones.length;
        } else if (res.estado !== 'idempotente') {
          r.excepciones += 1; // correccion_pendiente / operador_no_encontrado: el servicio ya abrió la excepción
        }

        if (d.enviadoOrigen !== true && (res.estado === 'idempotente' || (res.estado === 'creada' && !res.retenida))) {
          if (await operadorYaRecibio(deps, tenantId, res.liquidacionId)) porMarcar.push(res.claveExterna);
        }
      }

      await marcar(lector, porMarcar, r);

      // El cursor avanza solo tras procesar la página, y nunca hacia atrás (el traslape lo haría retroceder).
      const sig = pagina.siguiente;
      const avanza = sig !== null && (!r.cursor || comparar(sig, r.cursor) > 0);
      await deps.guardarEstado(tenantId, { ...(avanza ? { cursor: sig } : {}), ahora, exito: true, ...acumulado() });
      if (avanza) r.cursor = sig;

      if (!pagina.hayMas || pagina.items.length === 0 || sig === null) break;
      // A37-S09-02: sin reloj no hay más páginas; `hayMas` queda en true y la siguiente pasada continúa desde el cursor.
      if (opciones.venceEn !== undefined && Date.now() >= opciones.venceEn) break;
      if (!eraPrimera && lectura && comparar(sig, lectura) <= 0) break; // el origen no avanzó: no ciclar
      lectura = sig;
    }
    return r;
  } catch (e) {
    const error = descripcionError(e);
    r.estado = 'error';
    r.error = error;
    logger.warn('liqcorreo.pull_error', { tipo: e instanceof Error ? e.name : 'desconocido' });
    try {
      await deps.guardarEstado(tenantId, { ahora, exito: false, error, ...acumulado() });
    } catch {
      logger.error('liqcorreo.pull_estado_no_guardado', {});
    }
    return r;
  }
}

async function operadorYaRecibio(deps: DependenciasPull, tenantId: string, liquidacionId: string): Promise<boolean> {
  try {
    const entregas = await deps.entregasDe(tenantId, liquidacionId);
    return entregas.some((e) => e.rol === 'operador' && (e.estado === 'enviada' || e.estado === 'entregada'));
  } catch {
    return false; // la marca es cortesía: sin saberlo, no se marca
  }
}

async function marcar(lector: LectorDesglosesPuerto, claves: string[], r: ResultadoPull): Promise<void> {
  if (!lector.marcarEnviadas || claves.length === 0) return;
  try {
    const res = await lector.marcarEnviadas(claves);
    r.marcadas += res.ok.length;
    r.marcasFallidas += res.fallidas.length;
  } catch {
    r.marcasFallidas += claves.length; // un fallo de marca no afecta la entrega ni el cursor
  }
}
