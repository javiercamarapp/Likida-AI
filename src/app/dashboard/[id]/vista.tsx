import { AlertTriangle, Check } from 'lucide-react';
import { Boton, Icono, StatusChip, type TonoEstado } from '@/app/ui-v2/componentes';
import { mxn, fechaHoraMx } from '@/lib/formato';
import { trEs, type Tr } from '@/lib/i18n/dinero_tr';
import type { ClavePlural, Variables } from '@/lib/i18n/traducir';
import type { DiccionarioDe } from '@/lib/i18n/catalogo';
// La cubeta del motor, importada — nunca reconstruida. Ver `estadoRenglon` abajo.
import { cubetaDe } from '@/lib/likida/cuadre/engine';
import type { TipoDiferencia } from '@/types/likida';
import './liquidacion.css';

// ═══════════════════════════════════════════════════════════════════════════
// LAS PIEZAS DEL DETALLE DE LIQUIDACIÓN (sistema ui-v2).
//
// Pura presentación, sin sesión ni consultas: la página (`page.tsx`) decide
// qué se pinta y con qué permiso; aquí solo se dibuja con las piezas del
// sistema (StatusChip, Boton, Icono). Cero `style=`, cero tokens nuevos.
// ═══════════════════════════════════════════════════════════════════════════

/** El plural del diccionario (`clave.uno` / `clave.otros`) para un traductor que solo trae `t`. */
export function plural(tr: Tr, base: ClavePlural<DiccionarioDe<'dinero'>>, n: number, variables?: Variables): string {
  return tr(`${base}.${n === 1 ? 'uno' : 'otros'}` as Parameters<Tr>[0], { n, ...variables });
}

/** El estatus de la LIQUIDACIÓN lo nombra `dashboard/estatus.ts` (fuente
 *  única, vigilada por `etiquetas_sincronizadas.test.ts`); aquí solo se
 *  traduce su token de color al tono del chip de estado.
 *  Un color que no es semáforo (estatus desconocido) va neutro. */
export function estadoDeColor(color: string): TonoEstado {
  if (color.includes('--color-ok')) return 'ok';
  if (color.includes('--color-warn')) return 'warn';
  if (color.includes('--color-bad')) return 'bad';
  return 'neutral';
}

// ── Línea de tiempo ──────────────────────────────────────────────────────

export interface Hito {
  etiqueta: string;
  /** ISO del sello, o `null` si no ocurrió (o no hay registro). */
  cuando: string | null;
  /** Texto que sustituye a la hora cuando el hito se cumplió sin sello
   *  (p. ej. el PDF, que no guarda su propia hora). */
  textoSinHora?: string;
  /** Qué decir cuando NO hay sello — por defecto "Sin registro". */
  pendiente?: string;
  nota?: string;
}

/** avisado → aceptado → comprobantes → cuadre → PDF, con los sellos reales
 *  del viaje. Un hito sin sello se pinta hueco y lo dice; no se deduce una
 *  hora de otro hito (sería inventarla). */
export function LineaDeTiempo({ hitos, tr = trEs }: { hitos: Hito[]; tr?: Tr }) {
  return (
    <ol className="rv-liq__tiempo">
      {hitos.map((h) => {
        const hecho = h.cuando !== null || h.textoSinHora !== undefined;
        return (
          <li key={h.etiqueta} className="rv-liq__hito" data-hecho={hecho || undefined}>
            <span className="rv-liq__punto" aria-hidden="true" />
            <div className="rv-liq__hito-cuerpo">
              <div className="rv-liq__hito-etq">{h.etiqueta}</div>
              <div className="rv-liq__hito-hora">
                {h.cuando ? fechaHoraMx(h.cuando) : (h.textoSinHora ?? h.pendiente ?? tr('liquidacion.detalle.hitoSinRegistro'))}
              </div>
              {h.nota && <div className="rv-liq__hito-nota">{h.nota}</div>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

// ── Diferencias ──────────────────────────────────────────────────────────

export function Diferencia({ nota, monto, tr = trEs }: { nota: string; monto: number; tr?: Tr }) {
  return (
    <li className="rv-liq__dif">
      <Icono icono={AlertTriangle} className="rv-liq__dif-icono" />
      <span className="rv-liq__dif-nota">{nota}</span>
      {monto > 0 && <span className="rv-liq__cifra">{mxn(monto)}</span>}
      {/* No existe todavía la acción de aprobar/descontar una diferencia
          desde el panel (el cuadre es del motor y el descuento de nómina
          vive en el PDF del contralor). El botón se ve para que el flujo se
          entienda, y está deshabilitado con la razón a la vista: un botón
          que parece funcionar y no hace nada es un rótulo que miente. */}
      <Boton disabled variante="secondary" tamano="sm" title={tr('liquidacion.detalle.aprobarDescontarRazon')}>
        {tr('liquidacion.detalle.aprobarDescontar')}
      </Boton>
    </li>
  );
}

// ── Comprobantes ─────────────────────────────────────────────────────────

/** c_FormaPago del SAT — solo las claves que un comprobante de viaje trae
 *  en la práctica. Una clave desconocida se pinta cruda, no se adivina.
 *
 *  AUDITORÍA 21 (frontend, MEDIO 2): faltaban '05' y '06' pese a que el motor
 *  los trata como medios VÁLIDOS (`MEDIOS_LISR_27_III` y
 *  `MEDIOS_ELECTRONICOS_PEAJE` en cuadre/engine.ts) y '05' es el pago típico
 *  del diésel de flota (RMF 3.3.1.7) — el contralor veía "05" crudo justo en
 *  la columna que sustenta la deducibilidad. `etiqueta_forma_pago.test.ts`
 *  vigila que toda clave que el motor admite tenga rótulo aquí. */
const FORMA_PAGO = {
  '01': 'liquidacion.formaPago.c01', '02': 'liquidacion.formaPago.c02', '03': 'liquidacion.formaPago.c03',
  '04': 'liquidacion.formaPago.c04', '05': 'liquidacion.formaPago.c05', '06': 'liquidacion.formaPago.c06',
  '28': 'liquidacion.formaPago.c28', '29': 'liquidacion.formaPago.c29', '99': 'liquidacion.formaPago.c99',
} as const;

export function etiquetaFormaPago(clave?: string, tr: Tr = trEs): string {
  if (!clave) return '—';
  return clave in FORMA_PAGO ? tr(FORMA_PAGO[clave as keyof typeof FORMA_PAGO]) : clave;
}

type ClaveRenglon =
  | 'noDeducible' | 'duplicado' | 'posibleDuplicado' | 'montoInvalido' | 'noFiscal' | 'sinCfdi' | 'sobreTope'
  | 'porConfirmar' | 'porRevisar' | 'cfdiVigente' | 'cfdiValidado' | 'cfdiSinValidar';

/** `etiqueta` sale SIEMPRE en español (la leen las pruebas y los registros); `clave` es la del diccionario para pintarla en el idioma activo. */
export type EstadoRenglon = { estado: TonoEstado; etiqueta: string; clave: ClaveRenglon; validado?: boolean };

const claveDic = (clave: ClaveRenglon) => `liquidacion.renglon.${clave}` as const;
const rotuloEs = (clave: ClaveRenglon): string => trEs(claveDic(clave));
const renglon = (estado: TonoEstado, clave: ClaveRenglon, extra: { validado?: boolean } = {}): EstadoRenglon => ({ estado, clave, etiqueta: rotuloEs(clave), ...extra });

/**
 * AUDITORÍA 18-c3, ARQ-C3-1 (CRÍTICO) — y AUDITORÍA 28, ARQ-B2 (BAJO,
 * reincidente 25/26/27). `engine.ts` dice sobre `cubetaDe` que es «LA ÚNICA
 * definición de en qué cubeta cae un gasto … vive aquí, exportada, para que
 * nadie la reconstruya», y cuenta el bug que costó cuando `pdf.ts` la
 * reconstruyó. Este archivo lo hizo lo mismo dos veces:
 *
 * - Primero (18-c3) con un `Set` a mano que no coincidía con ninguna de las
 *   dos listas del motor. Le faltaba `rfc_receptor` (una factura al RFC del
 *   operador salía «Por revisar» en la tabla y «No deducible» doce
 *   centímetros arriba) y le sobraba `combustible_efectivo` (el motor lo
 *   pone en POR CONFIRMAR, deducible hasta el 15% de la RFA 2.9).
 * - Después (26/27), aunque el `Set` ya se importaba del motor, `pagoPendiente`
 *   se preguntaba aparte y le faltaba el criterio de engine.ts:474 (`!g.cfdiUuid
 *   → 'por_confirmar'`, «un ticket no es una factura»): un ticket de diésel
 *   sin CFDI y sin diferencias caía a `{estado:'neutral', etiqueta:'Ticket'}`
 *   mientras el bloque de deducibilidad de la MISMA hoja (que sí llama
 *   `cubetaDe`) decía «Por confirmar» sobre el mismo comprobante.
 *
 * AHORA `estadoRenglon` llama `cubetaDe` de verdad (no reconstruye ninguna
 * lista) y solo pone el RÓTULO encima de lo que el motor ya decidió.
 */
/**
 * Problemas del COMPROBANTE, no veredictos de deducibilidad. El motor no los
 * pone en ninguna de sus dos cubetas, así que la tabla tampoco puede afirmar
 * «No deducible» sobre ellos: se nombran por lo que son.
 */
const CLAVE_CAPTURA: Record<string, ClaveRenglon> = {
  duplicado: 'duplicado',
  posible_duplicado_sin_folio: 'posibleDuplicado',
  monto_invalido: 'montoInvalido',
  comprobante_no_fiscal: 'noFiscal',
};
/** Tipos que son "sobre tope": política o tope fiscal. */
export const TIPOS_TOPE = new Set(['sobre_politica', 'viatico_excede_fiscal', 'efectivo_sobre_15', 'efectivo_sobre_tope']);

/**
 * El estado de UN renglón, a partir de las diferencias que el motor le
 * colgó (por `gastoId`) y de lo que el SAT dijo del CFDI. El orden es el de
 * gravedad: no deducible › captura › sin CFDI › sobre tope › por confirmar ›
 * por revisar › validado.
 */
export function estadoRenglon(
  // `estadoSat` es `string` a propósito, no `EstadoSat` (types/likida.ts): los
  // llamadores de producción (`detalle.tsx`, `LiquidacionDetalle['gastos']`
  // en analytics.ts) también lo declaran como `string` —viene de una consulta
  // amplia, no del tipo estrecho de `Gasto`— así que un `Pick<Gasto, …>` aquí
  // rompería esos llamadores por un campo que ni `cubetaDe` necesita. Los
  // otros tres SÍ coinciden con `Gasto` porque `cubetaDe` los toma tal cual.
  g: { cfdiUuid?: string; estadoSat?: string; cfdiValido?: boolean; formaPago?: string; pagadoEn?: string },
  tipos: string[],
): EstadoRenglon {
  // LA cubeta, no una reconstrucción: `cubetaDe` ya decide no_deducible /
  // por_confirmar / deducible con las dos listas del motor, `pagoPendiente`
  // (crédito sin REP) Y el criterio de «un ticket no es una factura»
  // (`!g.cfdiUuid`). Aquí solo se traduce esa decisión a rótulo.
  //
  // `tipos` sigue siendo `string[]` (no `TipoDiferencia[]`): viene de
  // `LiquidacionDetalle['diferencias']` (analytics.ts), que lo declara como
  // `string` a propósito — es dato de BD, no un literal del código, y una
  // liquidación vieja podría traer un tipo que el dominio actual ya no usa.
  // El cast a `TipoDiferencia` es seguro porque `cubetaDe`/`NO_DEDUCIBLE_ISR`/
  // `POR_CONFIRMAR` solo hacen `.includes()` contra sus listas: un tipo fuera
  // del dominio simplemente no casa con ninguna, igual que hoy.
  const cubeta = cubetaDe(g, tipos.map((tipo) => ({ tipo: tipo as TipoDiferencia })));
  if (cubeta === 'no_deducible') return renglon('bad', 'noDeducible');
  const captura = tipos.find((t) => t in CLAVE_CAPTURA);
  if (captura) return renglon('warn', CLAVE_CAPTURA[captura]);
  if (tipos.includes('sin_cfdi')) return renglon('warn', 'sinCfdi');
  if (tipos.some((t) => TIPOS_TOPE.has(t))) return renglon('warn', 'sobreTope');
  // AUDITORÍA 28, ARQ-B2 (BAJO, reincidente 25/26/27): antes esta rama
  // preguntaba `TIPOS_POR_CONFIRMAR.has(t)` (copia de la lista del motor) y,
  // si no había diferencias, `pagoPendiente(g)` por separado (ARQ-25) — pero
  // le faltaba el tercer motivo de `cubetaDe` (`!g.cfdiUuid`, engine.ts:474):
  // un ticket de diésel sin CFDI y sin diferencias caía al «Ticket» neutral
  // de abajo mientras el bloque de deducibilidad de la misma pantalla (que sí
  // llama `cubetaDe`) decía «Por confirmar» sobre el mismo comprobante.
  if (cubeta === 'por_confirmar') return renglon('warn', 'porConfirmar');
  if (tipos.length > 0) return renglon('warn', 'porRevisar');
  if (g.estadoSat === 'vigente') return renglon('ok', 'cfdiVigente', { validado: true });
  if (g.cfdiValido) return renglon('ok', 'cfdiValidado', { validado: true });
  // En este punto `cubeta` solo puede ser 'deducible' (no_deducible y
  // por_confirmar ya se filtraron arriba), y `cubetaDe` manda CUALQUIER gasto
  // sin CFDI a 'por_confirmar' (engine.ts:474) — así que `g.cfdiUuid` es
  // siempre verdadero aquí. Un «Ticket» sin CFDI que el motor declare
  // deducible no existe hoy (ver `estado_renglon.test.ts`); si algún camino
  // nuevo lo produjera, esta rama tendría que distinguirlo de nuevo.
  return renglon('neutral', 'cfdiSinValidar');
}

export function PillRenglon({ e, tr = trEs }: { e: EstadoRenglon; tr?: Tr }) {
  return (
    <StatusChip tono={e.estado}>
      {e.validado && <Icono icono={Check} tam={14} />}
      {tr(claveDic(e.clave))}
    </StatusChip>
  );
}
