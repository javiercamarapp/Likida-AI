/**
 * El enlace al CSV de estadías. MX-016 / P06-07: tiene que llevar el `?tenant=` del «ver como» del superadmin; sin él
 * la ruta /api/v1/estadias exportaba la flota de la sesión (o un 404) y no la que la pantalla estaba mostrando.
 */
export function urlCsvEstadias(
  p: { desde: string; hasta: string; terminalId?: string | null; clienteId?: string | null; operadorId?: string | null },
  tenant?: string | null,
): string {
  const qs = new URLSearchParams({ desde: p.desde, hasta: p.hasta, formato: 'csv' });
  if (p.terminalId) qs.set('terminalId', p.terminalId);
  if (p.clienteId) qs.set('clienteId', p.clienteId);
  if (p.operadorId) qs.set('operadorId', p.operadorId);
  if (tenant) qs.set('tenant', tenant);
  return `/api/v1/estadias?${qs.toString()}`;
}
