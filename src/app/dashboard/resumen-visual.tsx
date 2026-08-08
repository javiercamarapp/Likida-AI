import type { ReactNode } from 'react';
import { resolverFormato, type FormatoPreset } from '../admin/ui/formato-preset';

/**
 * Piezas visuales del Resumen de FLOTA — dirección elegida el 7-ago-2026
 * (ver conversación de diseño: degradado de marca, tarjetas con más aire,
 * gráficas de `admin/charts.tsx`/`admin/ui/graficas.tsx` reusadas, nunca
 * reinventadas). Viven en esta página a propósito, no en `admin/ui/kit`:
 * es la única pantalla que usa este tratamiento — admin y el resto de
 * /dashboard se quedan con `KpiTile` monocromo. Si algún día se decide
 * llevar este lenguaje a todo el producto, ESO se sube al kit compartido;
 * mientras tanto una sola pantalla no debe arrastrar a las demás.
 */

/** Compartido entre `page.tsx` (server) y `actividad.tsx` (client) — vive
 *  aquí, no en `page.tsx`, porque ese archivo importa consultas a la base
 *  (`supabaseAdmin`, `analytics.ts`); un componente cliente que lo
 *  importara arrastraría ese código al bundle del navegador. Este archivo
 *  no importa nada server-only, así que es seguro cruzarlo hacia el
 *  cliente. */
export function TituloSeccion({ children }: { children: ReactNode }) {
  return (
    <h2 className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
      {children}
    </h2>
  );
}

// ── Hero de saludo ───────────────────────────────────────────────────────

/** El degradado de marca sube hasta el encabezado, no solo los KPIs de abajo
 *  — así se ve la dirección visual elegida el 7-ago incluso con la flota en
 *  cero (`estado === 'vacio'`): esto vive AFUERA de esa rama en `page.tsx` a
 *  propósito, para que se pinte en los tres estados (vacío, parcial, con
 *  datos). El tagline es una frase de bienvenida, no una cifra del negocio
 *  — no le aplica la regla de "nunca inventar" de `CLAUDE.md`. */
/** Naranja de marca puro (`--g4` → `--marca`, la rampa de `admin/charts.tsx`),
 *  no `--ink` → `--marca`: eso se leía café oscuro, no el naranja vivo de la
 *  dirección elegida. Mismo degradado en el hero y en cada KpiDegradado —
 *  una sola fuente, para que un cambio de tono no se desincronice entre los
 *  dos. */
export const DEGRADADO_MARCA = 'linear-gradient(135deg, var(--g3) 0%, var(--marca) 100%)';

/** Foto de `public/hero-camion.jpg` (2560×551, ~4.6:1) — UNA sola imagen
 *  panorámica, con el degradado claro→naranja ya horneado adentro (no un
 *  div de CSS aparte): el texto se sobrepone directo sobre la foto en
 *  cualquier punto del ancho.
 *
 *  Reemplazada el 8-ago-2026 con una imagen que Javier trajo él mismo
 *  (recortada del PNG original con `sips -c`, quitando el margen blanco del
 *  recuadro redondeado que traía — quedarse con SOLO el contenido evita el
 *  hairline blanco que ese margen dejaba asomar en la esquina). El banner
 *  sigue a `py-8`/`center 49%` sin tocar: con `background-size: cover` y un
 *  contenedor bastante más ancho que alto, el ancho SIEMPRE se llena
 *  completo (cero franjas laterales, por definición de `cover`) — lo único
 *  que cambia con una imagen nueva es cuánto se recorta verticalmente, y
 *  `49%` ya centraba bien al camión en la imagen anterior; verificado
 *  mirando el render, no solo calculado. */
export function HeroSaludo({ saludo, nombre, tagline }: { saludo: string; nombre: string; tagline: string }) {
  return (
    <div
      className="mx-5 mt-3 rounded-2xl px-5 py-8 text-white flex items-center gap-4 overflow-hidden shrink-0"
      style={{ background: `url('/hero-camion.jpg') center 49% / cover no-repeat, ${DEGRADADO_MARCA}` }}
    >
      <div className="min-w-0">
        <h1 className="text-xl tracking-tight truncate" style={{ fontFamily: 'var(--font-display), var(--font-sans)', fontWeight: 600 }}>
          {saludo}, {nombre} 👋
        </h1>
        <p className="text-sm mt-1 opacity-90 truncate">{tagline}</p>
      </div>
    </div>
  );
}

// ── KpiDegradado ─────────────────────────────────────────────────────────

/** El % contra el periodo anterior — NO siempre "subió = verde". Gastar
 *  más no es bueno para un jefe de flota, aunque el número sea más grande
 *  que el mes pasado; `bueno` lo decide cada llamador según qué significa
 *  esa métrica (ver `page.tsx`), no esta tarjeta. Sin `tendencia` (rango
 *  'todo', o sin periodo anterior legible) no se pinta nada — un "0.0%"
 *  inventado se leería como "sin cambio", que es una afirmación distinta
 *  de "no se pudo comparar". */
export function KpiDegradado({
  icono, etiqueta, valor, formato = 'numero', tendencia, flechas,
}: {
  icono: ReactNode;
  etiqueta: string;
  valor: number;
  formato?: FormatoPreset;
  tendencia?: { pct: number; bueno: boolean } | null;
  /** Controles de paginación de periodo (`KpiPeriodo`, cliente) — viven
   *  AQUÍ, no en el llamador, porque el círculo del ícono ya fija el ancho
   *  de esa columna; duplicar el layout en cada sitio que necesite flechas
   *  se hubiera desincronizado con el primer cambio de padding. */
  flechas?: ReactNode;
}) {
  const fmt = resolverFormato(formato);
  return (
    <div
      className="rounded-2xl p-4 text-white flex items-center justify-between gap-3 min-w-0 h-full"
      style={{ background: DEGRADADO_MARCA }}
    >
      <div className="min-w-0">
        <div className="text-xs font-medium opacity-85 truncate">{etiqueta}</div>
        <div className="text-xl font-semibold tracking-tight tabular mt-1 truncate">{fmt(valor)}</div>
        {tendencia && (
          <div className="text-[11px] font-semibold mt-1 tabular" style={{ color: tendencia.bueno ? '#bbf7d0' : '#fecaca' }}>
            {tendencia.pct >= 0 ? '↑' : '↓'} {Math.abs(tendencia.pct)}% vs periodo anterior
          </div>
        )}
      </div>
      <div className="flex flex-col items-center gap-1.5 shrink-0">
        {/* Círculo BLANCO opaco, no translúcido — el ícono va del color de
            marca, no blanco sobre blanco. */}
        <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0" style={{ background: '#ffffff', color: 'var(--marca)' }}>
          {icono}
        </div>
        {flechas}
      </div>
    </div>
  );
}

// ── Motor fiscal (el moat) ───────────────────────────────────────────────

/** Lo que ningún TMS genérico calcula: mismo motor que
 *  `/dashboard/contador/deducciones` (`getGastosFiscales` +
 *  `resumirPerdidas`, no una copia). Si el motor no pudo leer, se dice — no
 *  se esconde la tarjeta ni se enseña un cero que parezca "sin riesgo".
 *
 *  El diésel del estímulo NO va aquí en pesos — va en LITROS, y la tarjeta
 *  vive en `page.tsx` (`docs/conocimiento/guion-demo.md` +
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
