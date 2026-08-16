import type { ReactNode } from 'react';
import Link from 'next/link';
import { resolverFormato } from '../admin/ui/formato-preset';
import { StatusPill, type Estado } from '../admin/ui/kit';
import { mxn, fechaMx } from '@/lib/formato';

/**
 * Piezas visuales del Resumen de FLOTA — dirección v3 del 12-ago-2026
 * (DESIGN.md, destilada de las 8 referencias de Desktop/DASHBOARD): cifras
 * en tinta sobre blanco, el naranja como acento, cero degradados de relleno.
 *
 * Aquí vivieron `DEGRADADO_MARCA` y `KpiDegradado` (dirección del
 * 7-ago-2026). Se retiraron completos: los KPI ahora son `StatCard` del kit
 * compartido (`admin/ui/kit.tsx`) — el camino inverso al que este archivo
 * anunciaba ("si algún día se decide llevar este lenguaje a todo el
 * producto, eso se sube al kit"): lo que subió al kit fue el lenguaje
 * limpio, no el degradado. La foto del camión (`public/hero-camion.webp`,
 * con su empalme de 12000px documentado en git) queda en `public/` fuera
 * de uso por si alguna pieza de marketing la quiere.
 */

/** Compartido entre `inicio-contenido.tsx` (server) y `actividad.tsx`
 *  (client) — vive aquí, no en la página, porque ese archivo importa
 *  consultas a la base (`supabaseAdmin`); un componente cliente que lo
 *  importara arrastraría ese código al bundle del navegador. */
export function TituloSeccion({ children }: { children: ReactNode }) {
  return (
    <h2 className="etiqueta-mono text-[11px] font-medium uppercase" style={{ color: 'var(--muted)' }}>
      {children}
    </h2>
  );
}

// ── Encabezado de página ─────────────────────────────────────────────────

/** La barra superior: breadcrumb de página a la
 *  izquierda, lo contextual (badge de superadmin, filtros) a la derecha,
 *  separada del contenido por un hairline. SIN buscador ni campana: no hay
 *  búsqueda ni notificaciones reales en /dashboard, y un control que no
 *  hace nada es un rótulo que miente. Se agregan cuando existan. */
export function BarraPagina({ icono, titulo, derecha }: { icono?: ReactNode; titulo: string; derecha?: ReactNode }) {
  return (
    <div className="px-5 h-11 flex items-center justify-between gap-3 border-b shrink-0" style={{ borderColor: 'var(--line)', background: 'var(--surface)' }}>
      <div className="flex items-center gap-2 text-[13px] font-medium min-w-0">
        {icono}
        <span className="truncate">{titulo}</span>
      </div>
      {derecha}
    </div>
  );
}

/** El chip de fecha ("27 April, 2026") — la fecha REAL del
 *  servidor, formateada por `lib/formato` como todo lo demás. */
export function ChipFecha({ icono, children }: { icono?: ReactNode; children: ReactNode }) {
  return (
    <span className="hairline inline-flex items-center gap-1.5 text-[13px] font-medium px-3 h-8 rounded-lg shrink-0" style={{ background: 'var(--surface)' }}>
      {icono}
      {children}
    </span>
  );
}

/** El saludo, limpio (estilo "Welcome Back, Jane!" — sin emoji).
 *  Se pinta en los tres estados (vacío, parcial, con
 *  datos): el tagline es una frase de bienvenida, no una cifra del negocio
 *  — no le aplica la regla de "nunca inventar". `derecha` es el slot del
 *  chip de fecha / CTA cuando exista una acción real. */
export function HeroSaludo({ saludo, nombre, tagline, derecha }: { saludo: string; nombre: string; tagline: string; derecha?: ReactNode }) {
  return (
    <div className="px-5 pt-3.5 pb-0.5 shrink-0 min-w-0 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="font-display text-[20px] font-semibold truncate">
          {saludo}, {nombre}
        </h1>
        <p className="text-[13px] mt-1 truncate" style={{ color: 'var(--muted)' }}>{tagline}</p>
      </div>
      {derecha}
    </div>
  );
}

// ── Viajes recientes (la tabla protagonista de la referencia) ────────────

/** Lo que `getViajes` ya trae — copia estructural para no importar tipos de
 *  `analytics.ts` (ese módulo carga `supabaseAdmin`; los TIPOS cruzarían
 *  bien, pero la dependencia invita a importar funciones después). */
export interface FilaViaje {
  id: string; folio: string; origen: string | null; destino: string | null;
  estatus: string; anticipo: number; operadorNombre: string | null;
  fechaInicio: string | null;
  /** El id de la LIQUIDACIÓN del viaje (si ya cerró) — `/dashboard/[id]` se
   *  abre con ese id, no con el del viaje. Lo resuelve el servidor cruzando
   *  `getLiquidaciones` por folio; sin él, la fila no linkea. */
  liqId?: string | null;
}

/** `viaje.estatus` solo admite estos tres (constraint `viaje_estatus_dominio`).
 *  Un valor fuera del dominio se pinta crudo en neutro — visible, no roto.
 *  Exportado porque `tablero-operacion.tsx` (la tabla de viajes SIN pesos del
 *  encargado) pinta el mismo estatus: dos mapas se separan al primer estatus
 *  nuevo, que es exactamente como se rompió `CONCEPTO` dos veces. */
export const PILL_ESTATUS: Record<string, { estado: Estado; etiqueta: string }> = {
  liquidado: { estado: 'ok', etiqueta: 'Liquidado' },
  en_cuadre: { estado: 'warn', etiqueta: 'En cuadre' },
  abierto: { estado: 'neutral', etiqueta: 'Abierto' },
};

/**
 * La tabla de viajes
 * REALES de la flota: folio + ruta, operador, anticipo, estatus como pill y
 * fecha de inicio. "Ver" solo en los liquidados — `/dashboard/[id]` es el
 * detalle de la LIQUIDACIÓN (pantalla de dinero), un viaje abierto no tiene
 * a dónde llevar todavía; un link a un 404 es peor que no ponerlo. Sin
 * "Ver todo": la página de Viajes se rehará a su tiempo, y un link muerto
 * anuncia una página que no existe.
 */
export function TablaViajes({ viajes, sufijo = '' }: { viajes: FilaViaje[]; sufijo?: string }) {
  if (viajes.length === 0) {
    return (
      <div className="min-h-[72px] w-full flex items-center justify-center">
        <p className="text-sm text-center" style={{ color: 'var(--muted)' }}>
          Aún no hay viajes registrados. En cuanto la flota abra su primer viaje, aparece aquí.
        </p>
      </div>
    );
  }
  const TH = 'etiqueta-mono text-left text-[10px] font-medium uppercase px-3 py-1.5';
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr className="sticky top-0 z-10" style={{ background: 'var(--canvas)' }}>
            <th className={`${TH} rounded-l-lg`} style={{ color: 'var(--muted)' }}>Viaje</th>
            <th className={TH} style={{ color: 'var(--muted)' }}>Operador</th>
            <th className={`${TH} text-right`} style={{ color: 'var(--muted)' }}>Anticipo</th>
            <th className={TH} style={{ color: 'var(--muted)' }}>Estatus</th>
            <th className={TH} style={{ color: 'var(--muted)' }}>Inicio</th>
            <th className={`${TH} rounded-r-lg text-right`} style={{ color: 'var(--muted)' }}>Acción</th>
          </tr>
        </thead>
        <tbody>
          {viajes.map((v) => {
            const pill = PILL_ESTATUS[v.estatus] ?? { estado: 'neutral' as Estado, etiqueta: v.estatus };
            const ruta = v.origen && v.destino ? `${v.origen} → ${v.destino}` : v.origen ?? v.destino;
            return (
              <tr key={v.id} className="border-b transition-colors hover:bg-[var(--canvas)]" style={{ borderColor: 'var(--line2)' }}>
                <td className="px-3 py-2 min-w-0">
                  <div className="text-sm font-medium">{v.folio}</div>
                  {/* Sin origen/destino capturados no se inventa una ruta:
                      un guion dice "falta el dato", no "viaje sin ruta". */}
                  <div className="text-xs mt-0.5 truncate max-w-[260px]" style={{ color: 'var(--muted)' }}>{ruta ?? '—'}</div>
                </td>
                <td className="px-3 py-2 text-sm whitespace-nowrap">{v.operadorNombre ?? <span style={{ color: 'var(--faint)' }}>Sin asignar</span>}</td>
                <td className="cifra-mono px-3 py-2 text-[13px] text-right whitespace-nowrap">{mxn(v.anticipo)}</td>
                <td className="px-3 py-2"><StatusPill estado={pill.estado}>{pill.etiqueta}</StatusPill></td>
                <td className="px-3 py-2 text-[13px] whitespace-nowrap" style={{ color: 'var(--muted)' }}>{fechaMx(v.fechaInicio)}</td>
                <td className="px-3 py-2 text-right">
                  {v.liqId ? (
                    <Link href={`/dashboard/${v.liqId}${sufijo}`} className="text-[13px] font-medium hover:opacity-70 transition-opacity">
                      Ver
                    </Link>
                  ) : (
                    <span className="text-[13px]" style={{ color: 'var(--faint)' }}>—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Motor fiscal (el moat) ───────────────────────────────────────────────

/** Lo que ningún TMS genérico calcula: mismo motor que el panel fiscal
 *  (`getGastosFiscales` + `resumirPerdidas`, no una copia). Si el motor no
 *  pudo leer, se dice — no se esconde la tarjeta ni se enseña un cero que
 *  parezca "sin riesgo".
 *
 *  El diésel del estímulo NO va aquí en pesos — va en LITROS, y la tarjeta
 *  vive en `inicio-contenido.tsx` (`docs/conocimiento/guion-demo.md` +
 *  `guion_demo.test.ts`): el IEPS en pesos se quitó del panel el 25-jul
 *  porque sumaba el trasladado del CFDI, que no es el estímulo — el
 *  estímulo es cuota vigente (la publica el DOF cada semana) × litros, y
 *  esa cuota no vive en este componente. */
export function MotorFiscal({
  resumen,
}: {
  resumen: {
    montoPerdido: number; montoEnRiesgo: number; montoRecuperable: number;
    porCausa: Array<{ titulo: string; n: number; monto: number }>;
  } | null;
}) {
  const fmt = resolverFormato('mxn');
  if (!resumen) {
    return <p className="text-sm" style={{ color: 'var(--muted)' }}>No se pudo leer el motor fiscal en este momento.</p>;
  }
  const top = resumen.porCausa.slice(0, 3);
  // "En riesgo/perdido" y "Recuperable pidiendo factura" subieron al nivel
  // de KPI el 8-ago-2026 (`MotorFiscalPeriodo`, con flechas ‹ ›
  // semanal/mensual/histórico) — aquí solo se queda la lista de causas, que
  // no tiene equivalente arriba.
  if (top.length === 0) return null;
  return (
    <div className="space-y-1.5">
      {top.map((c, i) => (
        <div key={i} className="flex items-center justify-between gap-3 text-sm">
          <span className="truncate min-w-0">{c.titulo} · {c.n} comprobante{c.n === 1 ? '' : 's'}</span>
          <span className="tabular shrink-0" style={{ color: 'var(--muted)' }}>{fmt(c.monto)}</span>
        </div>
      ))}
    </div>
  );
}
