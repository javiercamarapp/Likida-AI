import type { ReactNode } from 'react';
import { resolverFormato, type FormatoPreset } from '../admin/ui/formato-preset';
import { fechaMx } from '@/lib/formato';
import type { Caducidad } from '@/lib/likida/facturacion/caducidad';

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

// ── KpiDegradado ─────────────────────────────────────────────────────────

export function KpiDegradado({
  icono, etiqueta, valor, formato = 'numero',
}: {
  icono: ReactNode;
  etiqueta: string;
  valor: number;
  formato?: FormatoPreset;
}) {
  const fmt = resolverFormato(formato);
  return (
    <div
      className="rounded-2xl p-4 text-white flex items-center justify-between gap-3 min-w-0"
      style={{ background: 'linear-gradient(135deg, var(--ink) 0%, var(--marca) 100%)' }}
    >
      <div className="min-w-0">
        <div className="text-xs font-medium opacity-85 truncate">{etiqueta}</div>
        <div className="text-xl font-semibold tracking-tight tabular mt-1 truncate">{fmt(valor)}</div>
      </div>
      <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'rgba(255,255,255,0.18)' }}>
        {icono}
      </div>
    </div>
  );
}

// ── Próximos vencimientos (facturación) ─────────────────────────────────

/** Los 3 comprobantes más urgentes por facturar, de `getPorFacturar` — NO
 *  es un calendario genérico (esa pieza del mockup original no tiene dato
 *  real detrás, y no se inventa uno): es el plazo REAL de portal que ya
 *  calcula `caducidad.ts`. Se excluyen los de plazo `desconocido` — un
 *  comercio sin identificar no tiene fecha límite que enseñar sin adivinar. */
export function ProximosVencimientos({
  items,
}: {
  items: Array<{ nombre: string; monto: number; caducidad: Caducidad }>;
}) {
  const fmt = resolverFormato('mxn');
  const ordenados = items
    .filter((i) => !i.caducidad.desconocido)
    .sort((a, b) => a.caducidad.diasRestantes - b.caducidad.diasRestantes)
    .slice(0, 3);

  if (ordenados.length === 0) {
    return (
      <p className="text-sm" style={{ color: 'var(--muted)' }}>
        Nada por facturar con plazo conocido en este momento.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {ordenados.map((it, i) => {
        const color = it.caducidad.vencido ? 'var(--color-bad)' : it.caducidad.urgente ? 'var(--warn)' : 'var(--muted)';
        const texto = it.caducidad.vencido
          ? 'vencido'
          : it.caducidad.diasRestantes === 0
            ? 'vence hoy'
            : `vence en ${it.caducidad.diasRestantes} día${it.caducidad.diasRestantes === 1 ? '' : 's'}`;
        return (
          <div key={i} className="flex items-center justify-between gap-3 text-sm">
            <span className="truncate min-w-0">{it.nombre}</span>
            <span className="tabular shrink-0">{fmt(it.monto)}</span>
            <span className="text-xs font-medium shrink-0" style={{ color }}>{texto}</span>
          </div>
        );
      })}
    </div>
  );
}

// ── Viajes recientes ──────────────────────────────────────────────────────

const ESTATUS_ETIQUETA: Record<string, { texto: string; color: string }> = {
  abierto: { texto: 'Abierto', color: 'var(--muted)' },
  en_cuadre: { texto: 'En cuadre', color: 'var(--warn)' },
  liquidado: { texto: 'Liquidado', color: 'var(--color-ok)' },
};

export function TablaViajesRecientes({
  viajes,
}: {
  viajes: Array<{ id: string; operadorNombre: string | null; origen: string | null; destino: string | null; anticipo: number; estatus: string; fechaInicio: string | null }>;
}) {
  const fmt = resolverFormato('mxn');
  if (viajes.length === 0) {
    return <p className="text-sm" style={{ color: 'var(--muted)' }}>Aún no hay viajes registrados.</p>;
  }
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left" style={{ color: 'var(--muted)' }}>
          <th className="font-medium pb-2 pr-3">Operador</th>
          <th className="font-medium pb-2 pr-3">Ruta</th>
          <th className="font-medium pb-2 pr-3 text-right">Anticipo</th>
          <th className="font-medium pb-2 pr-3">Estado</th>
          <th className="font-medium pb-2 text-right">Inicio</th>
        </tr>
      </thead>
      <tbody>
        {viajes.map((v) => {
          const est = ESTATUS_ETIQUETA[v.estatus] ?? { texto: v.estatus, color: 'var(--muted)' };
          return (
            <tr key={v.id} className="border-t" style={{ borderColor: 'var(--line)' }}>
              <td className="py-2 pr-3 truncate max-w-[160px]">{v.operadorNombre ?? '—'}</td>
              <td className="py-2 pr-3 truncate max-w-[220px]" style={{ color: 'var(--muted)' }}>
                {v.origen && v.destino ? `${v.origen} → ${v.destino}` : '—'}
              </td>
              <td className="py-2 pr-3 text-right tabular">{fmt(v.anticipo)}</td>
              <td className="py-2 pr-3">
                <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ color: est.color, background: 'var(--canvas)' }}>
                  {est.texto}
                </span>
              </td>
              <td className="py-2 text-right" style={{ color: 'var(--muted)' }}>{fechaMx(v.fechaInicio)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
