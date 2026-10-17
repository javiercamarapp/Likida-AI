// ═══════════════════════════════════════════════════════════════════════════
// LECTOR DE LIQUIDACIONES del conector TMS (T-TMS-07). SOLO LEE: no escribe en la base ni invoca la ruta de A1;
// entrega cuerpos que `validarLiquidacionExterna` (protegido, sin cambios) ACEPTA tal cual, listos para que A1 los
// reciba por su ruta (`liquidacion_externa/api.ts`; la integración la hace el frente A1 / B3).
//
// Requisito (crudo c3cc57d3 88:30–101:21 y 67:16–68:21): tres tablas del sistema de nómina (nómina por bitácora,
// operadores, concepto de nómina) ligadas por ID y póliza; «cada bitácora te genera una póliza»; lo que tiene
// valor en CARGO es percepción y lo que tiene valor en ABONO es deducción; hay bitácoras que NO traen póliza.
// Likida NO recalcula sueldos ni bonos: el total es la suma de los renglones tal como vienen.
//
// SUPUESTO (BLOQUEO EXTERNO: la documentación/JSON real de la API de nómina y el catálogo de conceptos no existen):
// rutas, columnas y formatos viven en `mapeos/liquidaciones.supuesto.json`. Plan B: T-TMS-13 (exportaciones).
//
// Reglas (nada se descarta en silencio):
//  · una bitácora SIN póliza no se convierte en cuerpo: va a `pendientes_poliza` (se lee de nuevo cuando la tenga);
//  · los conceptos «ocultos» del catálogo SE CONSERVAN en el cuerpo y se marcan en `ocultos`; la regla de
//    presentación (diésel como «otros», renglón «Viaje») es del renderer de A1, no de este lector;
//  · un concepto que no está en el catálogo pasa con la etiqueta «(sin catalogar)» y se lista en `sin_catalogar`;
//  · un neto negativo se entrega y se marca en `advertencias` (no se oculta ni se corrige);
//  · un grupo que `validarLiquidacionExterna` rechaza va a `rechazadas` con el motivo del validador;
//  · si la lectura de nómina queda incompleta (presupuesto agotado, cursor en círculo) NO se emite ningún cuerpo:
//    una póliza partida entre páginas daría un total parcial que el chofer leería como definitivo.
// ═══════════════════════════════════════════════════════════════════════════
import { aCentavos, huellaContenido, validarLiquidacionExterna } from '../../liquidacion_externa/esquema';
import { utcALocal, ZONA_POR_OMISION } from '../tabla_propia/tiempo';
import { estadoDeFila, type EstadoFila } from './huella';
import mapeoSupuesto from './mapeos/liquidaciones.supuesto.json';
import type { MapeoTms } from './mapeo';
import { paginar, type OpcionesPaginar, type PuntoReanudo } from './paginar';
import type { SesionTms } from './sesion';
import type { FilaRechazadaTms, LectorTms, LecturaTms } from './tipos';

export interface MapeoLiquidacionesTms { nomina: MapeoTms; operadores: MapeoTms; conceptos: MapeoTms }

export const MAPEO_LIQUIDACIONES_SUPUESTO: MapeoLiquidacionesTms = {
  nomina: mapeoSupuesto.nomina as unknown as MapeoTms,
  operadores: mapeoSupuesto.operadores as unknown as MapeoTms,
  conceptos: mapeoSupuesto.conceptos as unknown as MapeoTms,
};

/** Sufijo de la descripción de un concepto que el catálogo no conoce. */
export const ETIQUETA_SIN_CATALOGAR = '(sin catalogar)';
const SISTEMA_ORIGEN = 'tms';

/** Cuerpo del POST de A1, tal como lo acepta `validarLiquidacionExterna`. */
export type CuerpoLiquidacion = Record<string, unknown>;

export interface LiquidacionTms {
  cuerpo: CuerpoLiquidacion;
  /** `claveExterna` del cuerpo (bitácora-póliza). */
  clave: string;
  /** Huella del contenido normalizado (`huellaContenido`): la que usa A1 para decidir 200 vs 409. */
  huella: string;
  /** Contra las huellas previas: nueva, omitida (igual) o actualizada (corregida en el origen). */
  estado: EstadoFila;
  bitacora: string;
  poliza: string;
  /** Claves de los conceptos que el catálogo marca como ocultos (siguen en el cuerpo). */
  ocultos: string[];
  /** Claves de los conceptos que no están en el catálogo. */
  sin_catalogar: string[];
  advertencias: string[];
}

export interface RechazoLiquidacion {
  tabla: 'nomina' | 'operadores' | 'conceptos' | 'liquidacion';
  /** Dónde: `fila N` en una tabla o `bitácora X póliza Y` en una liquidación armada. */
  ref: string;
  motivo: string;
}

export interface PendientePoliza { bitacora: string; operador_id: string; renglones: number }

export interface LecturaLiquidaciones {
  /** Todos los cuerpos válidos, en orden de bitácora. */
  cuerpos: LiquidacionTms[];
  /** `nueva` + `actualizada`: lo que hay que entregar a A1. */
  porEntregar: LiquidacionTms[];
  rechazadas: RechazoLiquidacion[];
  pendientes_poliza: PendientePoliza[];
  avisos: string[];
  completa: boolean;
  backlog: boolean;
  reanudar?: PuntoReanudo;
}

export type ResultadoLiquidaciones =
  | ({ ok: true } & LecturaLiquidaciones)
  | { ok: false; motivo: string; parcial: LecturaLiquidaciones };

export interface OpcionesLiquidaciones extends OpcionesPaginar {
  /** Huellas ya entregadas (clave → huella) para clasificar nueva/omitida/actualizada. */
  previas?: ReadonlyMap<string, string>;
}

interface RenglonNomina {
  id: string; poliza?: string; bitacora: string; operador_id: string; concepto_id: string;
  cargo?: number; abono?: number; desglose?: string; desde: string; hasta: string;
}
interface OperadorCrudo { id: string; numero_empleado?: string; telefono?: string }
interface ConceptoCrudo { id: string; clave?: string; descripcion: string; oculto?: boolean }

const vacia = (): LecturaLiquidaciones =>
  ({ cuerpos: [], porEntregar: [], rechazadas: [], pendientes_poliza: [], avisos: [], completa: false, backlog: false });

const pesos = (centavos: number): string => (centavos / 100).toFixed(2);

function zonaDe(mapeo: MapeoTms): string {
  const c = mapeo.campos.desde;
  return (typeof c === 'object' && c.zona) || ZONA_POR_OMISION;
}

function aClave(bitacora: string, poliza: string): string {
  return `${bitacora}-${poliza}`.replace(/[^A-Za-z0-9._:/#-]/g, '_').replace(/^[^A-Za-z0-9]+/, '');
}

/** Lee las tres tablas de la ventana [desde, hasta] (ISO UTC) y arma un cuerpo por póliza. No escribe nada. */
export async function leerLiquidaciones(
  sesion: SesionTms, mapeo: MapeoLiquidacionesTms,
  ventana: { desde: string; hasta: string; reanudar?: PuntoReanudo }, opciones: OpcionesLiquidaciones = {},
): Promise<ResultadoLiquidaciones> {
  const salida = vacia();
  const falla = (motivo: string): ResultadoLiquidaciones => ({ ok: false, motivo, parcial: salida });
  const previas = opciones.previas ?? new Map<string, string>();
  const pag: OpcionesPaginar = {
    paginacion: opciones.paginacion, venceEn: opciones.venceEn, ahora: opciones.ahora, maxPaginas: opciones.maxPaginas,
  };

  // — catálogos: sin ellos no se puede nombrar ni identificar nada; si fallan o quedan incompletos, no se arma nada —
  const operadores = new Map<string, OperadorCrudo>();
  const conceptos = new Map<string, ConceptoCrudo>();
  const catalogos: Array<[string, 'operadores' | 'conceptos']> = [['operadores', 'operadores'], ['conceptos', 'conceptos']];
  for (const [nombre, tabla] of catalogos) {
    const r = await paginar<OperadorCrudo & ConceptoCrudo>(sesion, mapeo[tabla], { desde: ventana.desde, hasta: ventana.hasta }, pag);
    const base = r.ok ? r : r.parcial;
    for (const x of base.rechazadas) salida.rechazadas.push({ tabla, ref: `fila ${x.indice}`, motivo: x.motivo });
    for (const a of base.avisos) salida.avisos.push(`${nombre}: ${a}`);
    if (!r.ok) return falla(`no se pudo leer la tabla de ${nombre}: ${r.motivo}`);
    if (!r.completa) return falla(`la tabla de ${nombre} quedó incompleta; sin ella no se arman liquidaciones`);
    for (const f of r.filas) (tabla === 'operadores' ? operadores : conceptos).set(f.fila.id, f.fila);
  }

  // — nómina por bitácora —
  const rn = await paginar<RenglonNomina>(sesion, mapeo.nomina, { desde: ventana.desde, hasta: ventana.hasta, reanudar: ventana.reanudar }, pag);
  const base = rn.ok ? rn : rn.parcial;
  for (const x of base.rechazadas) salida.rechazadas.push({ tabla: 'nomina', ref: `fila ${x.indice}`, motivo: x.motivo });
  for (const a of base.avisos) salida.avisos.push(`nómina: ${a}`);
  salida.backlog = base.backlog;
  salida.reanudar = base.reanudar;
  if (!rn.ok) return falla(`no se pudo leer la nómina por bitácora: ${rn.motivo}`);
  if (!rn.completa) {
    salida.avisos.push('la lectura de nómina quedó incompleta: no se entrega ninguna liquidación para no dar un total parcial');
    return { ok: true, ...salida };
  }
  salida.completa = true;

  // — agrupar por (bitácora, póliza); sin póliza → pendientes —
  const grupos = new Map<string, { bitacora: string; poliza: string; renglones: RenglonNomina[] }>();
  const sinPoliza = new Map<string, PendientePoliza>();
  for (const { fila } of rn.filas) {
    if (fila.poliza === undefined) {
      const p = sinPoliza.get(fila.bitacora) ?? { bitacora: fila.bitacora, operador_id: fila.operador_id, renglones: 0 };
      p.renglones += 1;
      sinPoliza.set(fila.bitacora, p);
      continue;
    }
    const k = JSON.stringify([fila.bitacora, fila.poliza]);
    const g = grupos.get(k) ?? { bitacora: fila.bitacora, poliza: fila.poliza, renglones: [] };
    g.renglones.push(fila);
    grupos.set(k, g);
  }
  salida.pendientes_poliza = [...sinPoliza.values()];

  const zona = zonaDe(mapeo.nomina);
  const aDia = (iso: string): string => utcALocal(new Date(iso), zona).slice(0, 10);
  const rechazar = (g: { bitacora: string; poliza: string }, motivo: string): void => {
    salida.rechazadas.push({ tabla: 'liquidacion', ref: `bitácora ${g.bitacora} póliza ${g.poliza}`, motivo });
  };

  for (const g of grupos.values()) {
    const operadorIds = new Set(g.renglones.map((r) => r.operador_id));
    if (operadorIds.size !== 1) { rechazar(g, 'los renglones de la póliza traen más de un operador'); continue; }
    const op = operadores.get(g.renglones[0].operador_id);
    if (!op) { rechazar(g, 'el operador de la póliza no está en la tabla de operadores'); continue; }
    const operador: Record<string, string> = {};
    if (op.numero_empleado !== undefined) operador.numeroEmpleado = op.numero_empleado;
    if (op.telefono !== undefined) operador.telefono = op.telefono;
    if (Object.keys(operador).length === 0) { rechazar(g, 'el operador no trae número de empleado ni teléfono con qué identificarlo'); continue; }

    const percepciones: Array<Record<string, unknown>> = [];
    const deducciones: Array<Record<string, unknown>> = [];
    const ocultos: string[] = []; const sinCatalogar: string[] = []; const advertencias: string[] = [];
    let netoCentavos = 0; let malo: string | undefined;
    for (const r of g.renglones) {
      const cargo = r.cargo ?? 0; const abono = r.abono ?? 0;
      if (cargo < 0 || abono < 0) { malo = `el concepto ${r.concepto_id} trae un importe negativo; no se corrige ni se invierte`; break; }
      const cat = conceptos.get(r.concepto_id);
      const clave = cat?.clave ?? r.concepto_id;
      // El desglose es el nombre que RH quiere que aparezca; si no viene, la descripción del catálogo.
      const nombre = r.desglose ?? cat?.descripcion;
      const descripcion = cat ? (nombre as string) : `${nombre ?? `Concepto ${r.concepto_id}`} ${ETIQUETA_SIN_CATALOGAR}`;
      if (!cat) sinCatalogar.push(clave);
      else if (cat.oculto === true) ocultos.push(clave);
      if (cargo === 0 && abono === 0) { advertencias.push(`el concepto ${clave} viene sin importe (cargo y abono en cero)`); continue; }
      if (cargo > 0) { percepciones.push({ clave, descripcion, tipo: 'percepcion', monto: cargo }); netoCentavos += aCentavos(cargo); }
      if (abono > 0) { deducciones.push({ clave, descripcion, tipo: 'deduccion', monto: abono }); netoCentavos -= aCentavos(abono); }
    }
    if (malo) { rechazar(g, malo); continue; }
    if (percepciones.length + deducciones.length === 0) { rechazar(g, 'la póliza no trae ningún renglón con importe'); continue; }
    if (netoCentavos < 0) advertencias.push(`el neto es negativo (${pesos(netoCentavos)}): se entrega tal cual, revisar con nómina`);

    const clave = aClave(g.bitacora, g.poliza);
    const cuerpo: CuerpoLiquidacion = {
      claveExterna: clave,
      sistemaOrigen: SISTEMA_ORIGEN,
      operador,
      viajes: [g.bitacora],
      periodo: {
        desde: g.renglones.map((r) => aDia(r.desde)).sort()[0],
        hasta: g.renglones.map((r) => aDia(r.hasta)).sort().reverse()[0],
      },
      conceptos: [...percepciones, ...deducciones],
      total: netoCentavos / 100,
      moneda: 'MXN',
    };
    try {
      const huella = huellaContenido(validarLiquidacionExterna(cuerpo));
      salida.cuerpos.push({
        cuerpo, clave, huella, estado: estadoDeFila(previas, clave, huella), bitacora: g.bitacora, poliza: g.poliza,
        ocultos, sin_catalogar: sinCatalogar, advertencias,
      });
    } catch (e) {
      rechazar(g, e instanceof Error ? e.message : 'el validador rechazó el cuerpo');
    }
  }
  salida.porEntregar = salida.cuerpos.filter((c) => c.estado !== 'omitida');
  return { ok: true, ...salida };
}

/** Adaptador al contrato `LectorTms`: lanza si la lectura falla (el sincronizador usa `leerLiquidaciones` y conserva el parcial). */
export function lectorLiquidaciones(
  sesion: SesionTms, mapeo: MapeoLiquidacionesTms = MAPEO_LIQUIDACIONES_SUPUESTO, opciones: OpcionesLiquidaciones = {},
): LectorTms<LiquidacionTms> {
  return {
    recurso: 'liquidaciones',
    async leer(desde, hasta): Promise<LecturaTms<LiquidacionTms>> {
      const r = await leerLiquidaciones(sesion, mapeo, { desde, hasta }, opciones);
      if (!r.ok) throw new Error(r.motivo);
      const rechazadas: FilaRechazadaTms[] = r.rechazadas.map((x, indice) => ({ indice, motivo: `${x.tabla} ${x.ref}: ${x.motivo}` }));
      return { filas: r.cuerpos, rechazadas };
    },
  };
}
