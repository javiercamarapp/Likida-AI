import { ESTADOS_FACTURA_SAAS, type EstadoFacturaSaas } from '@/lib/saas/transferencia';

// Los filtros de /admin/facturas y de su exportación: viven en la URL (`?estado=&desde=&hasta=`) y SE VALIDAN igual en la página y en
// la acción que arma el CSV, para que el archivo contenga exactamente lo que la pantalla enseña. Lo que no es una fecha AAAA-MM-DD
// real o un estado conocido se descarta (no se manda a la base).
export interface FiltrosFacturas { estado?: EstadoFacturaSaas; desde?: string; hasta?: string }

export function fechaValida(v: unknown): string | undefined {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return undefined;
  const d = new Date(`${v}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v ? undefined : v;
}

export function leerFiltros(sp: { estado?: unknown; desde?: unknown; hasta?: unknown }): FiltrosFacturas {
  const estado = typeof sp.estado === 'string' && (ESTADOS_FACTURA_SAAS as readonly string[]).includes(sp.estado) ? (sp.estado as EstadoFacturaSaas) : undefined;
  const f: FiltrosFacturas = {};
  if (estado) f.estado = estado;
  const desde = fechaValida(sp.desde);
  const hasta = fechaValida(sp.hasta);
  if (desde) f.desde = desde;
  if (hasta) f.hasta = hasta;
  return f;
}

/** Un rango al revés (desde después de hasta) no devuelve nada: se dice en vez de pintar «sin facturas». */
export function rangoAlReves(f: FiltrosFacturas): boolean {
  return Boolean(f.desde && f.hasta && f.desde > f.hasta);
}

// ── Periodo (Rovaq FilterBar: segmentado Este mes · 30 días · 90 días · 12 meses · Personalizado) ─────────────────────────────────────────
// Los atajos NO añaden un parámetro nuevo: fijan `desde` (y dejan `hasta` abierto), que es lo que ya validan la página y la exportación.
// Así el CSV contiene exactamente el rango que se ve y la URL sigue siendo `?estado=&desde=&hasta=`.
export type ClavePeriodo = 'todo' | 'mes' | '30' | '90' | '12m';
export const PERIODOS: readonly ClavePeriodo[] = ['mes', '30', '90', '12m', 'todo'];

function sumarDias(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** `desde` del atajo respecto de `hoy` (AAAA-MM-DD en hora de México); `undefined` = sin límite inferior. */
export function desdeDePeriodo(clave: ClavePeriodo, hoy: string): string | undefined {
  switch (clave) {
    case 'mes': return `${hoy.slice(0, 8)}01`;
    case '30': return sumarDias(hoy, -29);
    case '90': return sumarDias(hoy, -89);
    case '12m': {
      const d = new Date(`${hoy}T00:00:00Z`);
      d.setUTCFullYear(d.getUTCFullYear() - 1);
      d.setUTCDate(d.getUTCDate() + 1);
      return d.toISOString().slice(0, 10);
    }
    default: return undefined;
  }
}

/** El atajo que describe el rango vigente, o `personalizado` si no coincide con ninguno (p. ej. hay un `hasta` o un `desde` propio). */
export function periodoVigente(f: FiltrosFacturas, hoy: string): ClavePeriodo | 'personalizado' {
  if (!f.desde && !f.hasta) return 'todo';
  if (f.hasta) return 'personalizado';
  return PERIODOS.find((c) => c !== 'todo' && desdeDePeriodo(c, hoy) === f.desde) ?? 'personalizado';
}
