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
