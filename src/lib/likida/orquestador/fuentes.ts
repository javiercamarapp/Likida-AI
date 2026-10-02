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
  | { estado: 'creada'; id: string }
  | { estado: 'ya_abierta'; id: string; creadaEn: string }
  | { estado: 'folio_no_encontrado' }
  | { estado: 'no_disponible' };

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
