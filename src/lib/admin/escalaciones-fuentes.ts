// Parte PURA de la bandeja de escalaciones (sin base de datos): la importan componentes de cliente (rótulos traducidos), que no pueden
// arrastrar `supabase/admin` ni `node:async_hooks` al navegador.

export type FuenteEscalacion =
  | 'arco' | 'corridas' | 'talachas' | 'facturas_proveedor' | 'tickets' | 'liquidaciones';

export const NOMBRE_FUENTE: Record<FuenteEscalacion, string> = {
  arco: 'Solicitudes ARCO',
  corridas: 'Corridas en fallo',
  talachas: 'Talachas por autorizar',
  facturas_proveedor: 'Facturas de proveedor',
  tickets: 'Tickets de soporte',
  liquidaciones: 'Liquidaciones en revisión',
};
