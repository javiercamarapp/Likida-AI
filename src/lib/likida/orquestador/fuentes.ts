import type { EntradaTableroViajes } from './tablero_viajes';
import type { EntregasBuzon } from './resumenes';
import type { EntradaSalud } from './salud_agentes';
import type { EscalacionValida, TareaAbierta } from './escalamiento';
import type { ColaCobranza } from '../agentes/cobranza';
import type { ContactoGastoBitacora, Efectividad } from '../agentes/cobranza_gasto';
import type { LoteTablero, FaseTablero } from '../autofactura/control_emision_repo';
import type { ControlEmision } from '../autofactura/control_emision';
import type { ConteoBuzon } from '../buzon/repo';
import type { GrupoVigia } from '../vigia/historial/repo';
import type { DatosTablero as DatosVigia } from '../vigia/repo';
import type { Instruccion } from '../convenios/tipos';
import type { EstadoLiquidacionExterna } from '../liquidacion_externa/esquema';
import type { LiquidacionExterna } from '../liquidacion_externa/repo';
import type { ReporteReclamacion } from '../peajes/reclamacion';
import type { FilaJornadaDia } from '../jornada/repo';
import type { ResultadoAvisoTarea } from './aviso_escalacion';

// ═══════════════════════════════════════════════════════════════════════════
// LAS FUENTES DEL ORQUESTADOR — el puerto entre las herramientas y los datos.
//
// Las herramientas NUNCA tocan la base: piden a una `Fuentes`. Toda fuente
//   · recibe `tenantId` como PRIMER argumento y no tiene ninguna forma de pedir
//     otra flota (el tenant lo fija el servidor al autorizar la sesión; el modelo
//     solo elige herramientas y enums);
//   · devuelve el dato CRUDO del lector de su agente — el recorte y la
//     eliminación de PII viven en `resumenes.ts`, que es puro y se prueba aparte.
// En producción es `fuentesReales()`; las pruebas ponen una en memoria.
// ═══════════════════════════════════════════════════════════════════════════

export interface CatalogoNombres { id: string; nombre: string }

export interface EntradaTableroConCatalogos extends EntradaTableroViajes {
  terminales: CatalogoNombres[];
  clientes: CatalogoNombres[];
}

export type ResultadoCrearEscalacion =
  // `aviso`: qué pasó con el aviso saliente en caliente (apagado por defecto: `omitido_apagado`); ausente = no se intentó.
  | { estado: 'creada'; id: string; aviso?: ResultadoAvisoTarea }
  | { estado: 'ya_abierta'; id: string; creadaEn: string }
  | { estado: 'folio_no_encontrado' }
  | { estado: 'no_disponible' };

/** El convenio ligado a un viaje abierto y sus instrucciones (la foto que se le dijo al operador). */
export interface ConvenioDeViaje {
  folio: string; origen: string | null; destino: string | null; cliente: string | null;
  convenioNombre: string | null; ligadoPor: 'auto' | 'manual' | null; despachoEnviado: boolean; instrucciones: Instruccion[];
}

/** Estado de entrega de la liquidación externa: conteos por estado y lo que más pide mirar (fallidas y «no coincide»). */
export interface EntregaLiquidacionExterna {
  porEstado: Record<EstadoLiquidacionExterna, number | null>;
  noCoincide: number | null;
  fallidas: LiquidacionExterna[] | null;
  conAcuseNoCoincide: LiquidacionExterna[] | null;
}

/** El último desglose de peajes (no anulado) con su reporte de reclamación PASE × GPS × geocerca. `null` reporte = no hay desglose. */
export interface ReclamacionPeajes { desglose: { id: string; proveedor: string | null; periodoDesde: string | null; periodoHasta: string | null } | null; reporte: ReporteReclamacion | null }

export interface Fuentes {
  entradaTablero(tenantId: string, ahora: Date): Promise<EntradaTableroConCatalogos>;
  vigia(tenantId: string, ahora: Date): Promise<{ datos: DatosVigia; grupos: GrupoVigia[] | null }>;
  buzon(tenantId: string, ahora: Date): Promise<{ conteo: ConteoBuzon; entregas: EntregasBuzon | null }>;
  cobranza(tenantId: string, ahora: Date): Promise<{ cola: ColaCobranza; gastos: { efectividad: Efectividad; bitacora: ContactoGastoBitacora[] } | null }>;
  autofactura(tenantId: string): Promise<{ control: ControlEmision | 'sin_fila' | null; lotes: LoteTablero[] | null; fases: FaseTablero[] | null }>;
  salud(tenantId: string, ahora: Date): Promise<EntradaSalud>;
  crearEscalacion(
    tenantId: string, e: EscalacionValida,
    quien: { rol: string; usuarioId: string | null },
  ): Promise<ResultadoCrearEscalacion>;
  escalacionesAbiertas(tenantId: string, limite?: number): Promise<TareaAbierta[] | null>;
  /** Convenio e instrucciones de un viaje ABIERTO por su folio. `null` = la base no tiene los convenios (0580); `'sin_viaje'` = ningún viaje abierto con ese folio. */
  convenioDeViaje(tenantId: string, folio: string): Promise<ConvenioDeViaje | 'sin_viaje' | null>;
  /** Entrega de la liquidación externa. `null` = la base no la tiene (0370). */
  liquidacionExterna(tenantId: string): Promise<EntregaLiquidacionExterna | null>;
  /** Reclamación de peajes del último desglose. `null` = la base no tiene los peajes. */
  reclamacionPeajes(tenantId: string): Promise<ReclamacionPeajes | null>;
  /** Jornada de los últimos `dias` días (incluido hoy). `null` = la base no tiene la jornada. */
  jornada(tenantId: string, ahora: Date, dias: number): Promise<{ dias: FilaJornadaDia[]; truncada: boolean } | null>;
  /** Una persona atiende una tarea abierta de SU flota. `false` = no existe, no es de esta flota o ya estaba atendida. */
  atenderEscalacion(tenantId: string, id: string, quien: { usuarioId: string | null; nota: string | null }): Promise<boolean>;
}

let actuales: Fuentes | null = null;
let reales: (() => Fuentes) | null = null;

/** Registra la fábrica real (la llama `fuentes_reales.ts` al importarse). */
export function registrarFuentesReales(f: () => Fuentes): void { reales = f; }

/** Las pruebas ponen sus dobles; `null` vuelve a las reales. */
export function ponerFuentes(f: Fuentes | null): void { actuales = f; }

export function fuentes(): Fuentes {
  if (actuales) return actuales;
  if (!reales) throw new Error('orquestador: las fuentes reales no se registraron (¿falta importar fuentes_reales?)');
  return reales();
}
