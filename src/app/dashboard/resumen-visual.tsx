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

/** Foto de `public/hero-camion.webp` (2626×596, ~4.4:1) — con el borde
 *  IZQUIERDO desvanecido en el propio archivo (canal alfa, 20% del ancho,
 *  negro→blanco), no una máscara CSS: una máscara puesta en el contenedor
 *  se mide contra el ANCHO DEL CONTENEDOR, que cambia con la pantalla,
 *  mientras que el borde de la foto (con `contain`) siempre cae en el mismo
 *  % de SU PROPIO ancho — desvanecerlo en el archivo es lo único que
 *  garantiza que el difuminado caiga justo donde empieza la foto en
 *  cualquier resolución.
 *
 *  `background-size: cover` (el approach original) se descartó el 8-ago-2026:
 *  el contenedor real mide ~10:1 de ancho:alto (`getBoundingClientRect()`,
 *  1148×116) contra ~4.4:1 de la foto — `cover` solo puede mostrar una franja
 *  angosta de la imagen (la cuenta no depende de qué tan alto se recorte el
 *  archivo), y el camión completo (techo a llantas) no cabe en esa franja:
 *  SIEMPRE se le corta algo, sin importar cuánto se reencuadre. `contain` +
 *  `right center` es la única combinación que garantiza el camión ENTERO
 *  visible sin importar el ancho de pantalla: la imagen se ancla a la
 *  derecha a su tamaño real (limitado por la altura del contenedor), y el
 *  borde desvanecido se funde con el degradado de marca (la segunda capa de
 *  `background`) en vez de cortar en seco — se ve una sola imagen continua,
 *  no una foto pegada junto a un rectángulo de color. */
export function HeroSaludo({ saludo, nombre, tagline }: { saludo: string; nombre: string; tagline: string }) {
  return (
    <div
      className="mx-5 mt-3 rounded-2xl px-5 py-8 flex items-center gap-4 overflow-hidden shrink-0"
      style={{ background: `url('/hero-camion.webp') right center / contain no-repeat, ${DEGRADADO_MARCA}` }}
    >
      <div className="min-w-0">
        <h1 className="text-xl tracking-tight truncate" style={{ fontFamily: 'var(--font-display), var(--font-sans)', fontWeight: 600, color: '#1a1207' }}>
          {saludo}, {nombre} 👋
        </h1>
        <p className="text-sm mt-1 truncate" style={{ color: '#1a1207', opacity: 0.85 }}>{tagline}</p>
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
