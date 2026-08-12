import type { ReactNode } from 'react';
import { resolverFormato } from '../admin/ui/formato-preset';

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
    <h2 className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
      {children}
    </h2>
  );
}

// ── Encabezado de página ─────────────────────────────────────────────────

/** El saludo, limpio (patrón FlowAI/Voiceon: "Welcome back, Jane!"). Sin
 *  foto y sin degradado — el encabezado es texto sobre la lámina blanca.
 *  Se pinta en los tres estados (vacío, parcial, con datos): el tagline es
 *  una frase de bienvenida, no una cifra del negocio — no le aplica la
 *  regla de "nunca inventar". */
export function HeroSaludo({ saludo, nombre, tagline }: { saludo: string; nombre: string; tagline: string }) {
  return (
    <div className="px-5 pt-5 pb-1 shrink-0 min-w-0">
      <h1 className="text-xl font-semibold tracking-tight truncate">
        {saludo}, {nombre} 👋
      </h1>
      <p className="text-[13px] mt-0.5 truncate" style={{ color: 'var(--muted)' }}>{tagline}</p>
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
