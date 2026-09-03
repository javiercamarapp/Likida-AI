import type { ReactNode } from 'react';
import { AlertTriangle, Check } from 'lucide-react';
import { StatusPill, type Estado } from '@/app/admin/ui/kit';
import { mxn, fechaHoraMx } from '@/lib/formato';
// Las cubetas del motor, importadas — nunca copiadas. Ver `TIPOS_MALOS` abajo.
import { NO_DEDUCIBLE_ISR, POR_CONFIRMAR, pagoPendiente } from '@/lib/likida/cuadre/engine';

// ═══════════════════════════════════════════════════════════════════════════
// LAS PIEZAS DEL DETALLE DE LIQUIDACIÓN v2 (22-ago-2026).
//
// Pura presentación, sin sesión ni consultas: la página (`page.tsx`) decide
// qué se pinta y con qué permiso; aquí solo se dibuja con el lenguaje del
// panel (DESIGN.md v3.1): tarjeta blanca con hairline, rótulo mono en
// mayúsculas, cifra tabular, color solo en estatus. Cero tokens nuevos.
// ═══════════════════════════════════════════════════════════════════════════

/** Botón primario (tinta) y secundario (blanco con hairline) — DESIGN.md §3.
 *  Máximo UNA primaria visible por vista; en el detalle es "Descargar PDF". */
export const BTN_PRIMARIO = 'inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-[12.5px] font-medium transition-opacity hover:opacity-85 disabled:opacity-50';
export const BTN_SECUNDARIO = 'inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-[12.5px] font-medium hairline transition-colors hover:bg-[var(--canvas)] disabled:opacity-50 disabled:cursor-not-allowed';
export const ESTILO_PRIMARIO = { background: 'var(--marca)', color: 'var(--marca-fg)' } as const;
export const ESTILO_SECUNDARIO = { background: 'var(--surface)', color: 'var(--ink)' } as const;

/** El estatus de la LIQUIDACIÓN lo nombra `dashboard/estatus.ts` (fuente
 *  única, vigilada por `etiquetas_sincronizadas.test.ts`); aquí solo se
 *  traduce su token de color al `Estado` del kit para pintarlo como pill.
 *  Un color que no es semáforo (estatus desconocido) va neutro. */
export function estadoDeColor(color: string): Estado {
  if (color.includes('--color-ok')) return 'ok';
  if (color.includes('--color-warn')) return 'warn';
  if (color.includes('--color-bad')) return 'bad';
  return 'neutral';
}

/** Rótulo mono en mayúsculas — el de `TituloSeccion`, reutilizado aquí con
 *  el mismo tamaño para que el detalle se lea igual que el Resumen. */
export function Rotulo({ children }: { children: ReactNode }) {
  return (
    <div className="etiqueta-mono text-[10px] uppercase" style={{ color: 'var(--faint)' }}>{children}</div>
  );
}

/** La tarjeta de KPI del detalle: misma anatomía que la del registro de
 *  viajes (rótulo mono arriba, cifra tabular 20 px, sublínea gris). `tono`
 *  solo colorea la cifra y SIEMPRE viene acompañado de la sublínea que dice
 *  por qué: nunca color solo. */
export function Kpi({ titulo, valor, nota, tono }: {
  titulo: string; valor: ReactNode; nota?: ReactNode; tono?: 'ok' | 'warn' | 'bad';
}) {
  return (
    <div className="card p-3.5 min-w-0">
      <Rotulo>{titulo}</Rotulo>
      <div className="cifra-mono text-[20px] font-medium mt-1 truncate"
        style={tono ? { color: `var(--${tono})` } : undefined}>{valor}</div>
      {nota && <div className="text-[11px] mt-0.5 truncate" style={{ color: 'var(--faint)' }}>{nota}</div>}
    </div>
  );
}

/** Una ficha "rótulo: valor" de la cabecera (fecha, ruta, operador…). */
export function Dato({ titulo, children, ancho }: { titulo: string; children: ReactNode; ancho?: boolean }) {
  return (
    <div className={`min-w-0 ${ancho ? 'xl:col-span-2' : ''}`}>
      <Rotulo>{titulo}</Rotulo>
      <div className="text-[13px] font-medium mt-0.5 truncate">{children}</div>
    </div>
  );
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
export function LineaDeTiempo({ hitos }: { hitos: Hito[] }) {
  return (
    <ol className="space-y-0">
      {hitos.map((h, i) => {
        const hecho = h.cuando !== null || h.textoSinHora !== undefined;
        const ultimo = i === hitos.length - 1;
        return (
          <li key={h.etiqueta} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span className="w-2.5 h-2.5 rounded-full mt-1.5 shrink-0"
                style={hecho
                  ? { background: 'var(--marca)' }
                  : { border: '1.5px solid var(--line2)', background: 'var(--surface)' }} />
              {!ultimo && <span className="flex-1 w-px my-1" style={{ borderLeft: '1px dashed var(--line2)' }} />}
            </div>
            <div className={`min-w-0 ${ultimo ? '' : 'pb-3.5'}`}>
              <div className="text-[13px] font-medium leading-5" style={hecho ? undefined : { color: 'var(--muted)' }}>{h.etiqueta}</div>
              <div className="cifra-mono text-[11.5px]" style={{ color: hecho ? 'var(--muted)' : 'var(--faint)' }}>
                {h.cuando ? fechaHoraMx(h.cuando) : (h.textoSinHora ?? h.pendiente ?? 'Sin registro')}
              </div>
              {h.nota && <div className="text-[11px] mt-0.5" style={{ color: 'var(--faint)' }}>{h.nota}</div>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

// ── Diferencias ──────────────────────────────────────────────────────────

export function Diferencia({ nota, monto }: { nota: string; monto: number }) {
  return (
    <li className="flex items-start gap-3 py-2.5" style={{ borderBottom: '1px dashed var(--line2)' }}>
      <AlertTriangle width={14} height={14} strokeWidth={1.75} className="mt-0.5 shrink-0" style={{ color: 'var(--warn)' }} aria-hidden />
      <span className="text-[13px] flex-1 min-w-0 leading-5">{nota}</span>
      {monto > 0 && <span className="cifra-mono text-[13px] font-medium whitespace-nowrap">{mxn(monto)}</span>}
      {/* No existe todavía la acción de aprobar/descontar una diferencia
          desde el panel (el cuadre es del motor y el descuento de nómina
          vive en el PDF del contralor). El botón se ve para que el flujo se
          entienda, y está deshabilitado con la razón a la vista: un botón
          que parece funcionar y no hace nada es un rótulo que miente. */}
      <button type="button" disabled
        title="Todavía no se puede aprobar ni descontar desde el panel: la decisión se toma sobre el PDF con tu contador."
        className={`${BTN_SECUNDARIO} h-7 px-2.5 text-[11.5px] shrink-0`} style={ESTILO_SECUNDARIO}>
        Aprobar / Descontar
      </button>
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
const FORMA_PAGO: Record<string, string> = {
  '01': 'Efectivo', '02': 'Cheque', '03': 'Transferencia', '04': 'Tarjeta de crédito',
  '05': 'Monedero electrónico', '06': 'Dinero electrónico',
  '28': 'Tarjeta de débito', '29': 'Tarjeta de servicios', '99': 'Por definir',
};

export function etiquetaFormaPago(clave?: string): string {
  if (!clave) return '—';
  return FORMA_PAGO[clave] ?? clave;
}

export type EstadoRenglon = { estado: Estado; etiqueta: string; validado?: boolean };

/**
 * Los tipos que el motor declara NO deducibles. **No es una lista de aquí.**
 *
 * AUDITORÍA 18-c3, ARQ-C3-1 (CRÍTICO). `engine.ts` dice sobre `cubetaDe` que es
 * «LA ÚNICA definición de en qué cubeta cae un gasto … vive aquí, exportada,
 * para que nadie la reconstruya», y cuenta el bug que costó cuando `pdf.ts` la
 * reconstruyó. Este archivo lo hizo otra vez: tenía un `Set` a mano que no
 * coincidía con ninguna de las dos listas del motor. Le faltaba `rfc_receptor`
 * (una factura al RFC del operador salía «Por revisar» en la tabla y «No
 * deducible» doce centímetros arriba) y le sobraba `combustible_efectivo`, que
 * el motor pone en POR CONFIRMAR porque es deducible hasta el 15% de la RFA
 * 2.9 — el mismo error que `engine.ts` documenta haber corregido una vez.
 *
 * Se importa la constante del motor a propósito: una copia vuelve a divergir.
 */
const TIPOS_MALOS = new Set<string>(NO_DEDUCIBLE_ISR);
/** El tercer estado del motor: no es pérdida, es que todavía no se puede afirmar. */
const TIPOS_POR_CONFIRMAR = new Set<string>(POR_CONFIRMAR);
/**
 * Problemas del COMPROBANTE, no veredictos de deducibilidad. El motor no los
 * pone en ninguna de sus dos cubetas, así que la tabla tampoco puede afirmar
 * «No deducible» sobre ellos: se nombran por lo que son.
 */
const ETIQUETA_CAPTURA: Record<string, string> = {
  duplicado: 'Duplicado',
  monto_invalido: 'Monto inválido',
  comprobante_no_fiscal: 'No es comprobante fiscal',
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
  g: { cfdiUuid?: string; estadoSat?: string; cfdiValido?: boolean; formaPago?: string; pagadoEn?: string },
  tipos: string[],
): EstadoRenglon {
  if (tipos.some((t) => TIPOS_MALOS.has(t))) return { estado: 'bad', etiqueta: 'No deducible' };
  const captura = tipos.find((t) => t in ETIQUETA_CAPTURA);
  if (captura) return { estado: 'warn', etiqueta: ETIQUETA_CAPTURA[captura] };
  if (tipos.includes('sin_cfdi')) return { estado: 'warn', etiqueta: 'Sin CFDI' };
  if (tipos.some((t) => TIPOS_TOPE.has(t))) return { estado: 'warn', etiqueta: 'Sobre tope' };
  if (tipos.some((t) => TIPOS_POR_CONFIRMAR.has(t))) return { estado: 'warn', etiqueta: 'Por confirmar' };
  if (tipos.length > 0) return { estado: 'warn', etiqueta: 'Por revisar' };
  // ARQ-25 (ALTO): `cubetaDe` (engine.ts) manda a `por_confirmar` un gasto a
  // crédito (forma '99') sin REP aunque el motor no emita ninguna diferencia
  // para él — el renglón no puede afirmar "CFDI vigente" sobre un comprobante
  // que el motor todavía no cuenta como deducible. Se importa `pagoPendiente`
  // del motor a propósito: la misma pregunta, la misma función.
  if (pagoPendiente(g)) return { estado: 'warn', etiqueta: 'Por confirmar' };
  if (g.estadoSat === 'vigente') return { estado: 'ok', etiqueta: 'CFDI vigente', validado: true };
  if (g.cfdiValido) return { estado: 'ok', etiqueta: 'CFDI validado', validado: true };
  if (g.cfdiUuid) return { estado: 'neutral', etiqueta: 'CFDI sin validar' };
  return { estado: 'neutral', etiqueta: 'Ticket' };
}

export function PillRenglon({ e }: { e: EstadoRenglon }) {
  return (
    <StatusPill estado={e.estado}>
      {e.validado && <Check width={11} height={11} strokeWidth={2.5} aria-hidden />}
      {e.etiqueta}
    </StatusPill>
  );
}

/** Encabezado de tabla del panel (mismo `TH` que el Resumen y el registro). */
export const TH = 'etiqueta-mono text-left text-[10px] font-medium uppercase px-3 py-2 whitespace-nowrap';
