import { redirect } from 'next/navigation';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import { hoyMx } from '@/lib/formato';
import { logger } from '@/lib/logger';
import { armarFilasEstadias, rangoDeDias } from '@/lib/likida/conductor/estadias_lectura';
import { leerCatalogosFiltro, leerDatosEstadias } from '@/lib/likida/conductor/repo_validacion';
import { sufijoTenant } from '../../../sufijo';
import { VistaEstadias } from './vista';

export const dynamic = 'force-dynamic';

const RUTA = '/dashboard/agentes/conductores/estadias';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Las estadías en andén del Agente 5 (0385): llegada→salida de cada carga y descarga, con la hora exacta del
 * mensaje, su fuente, la validación contra la ubicación y las fotos. Cero pesos en pantalla (área `operacion`):
 * el cobro (horas libres, tarifa, monto propuesto) va por el CSV de /v1/estadias para quien ve dinero.
 */
export default async function PaginaEstadias({ searchParams }: {
  searchParams: Promise<{ vista?: string; tenant?: string; rol?: string; desde?: string; hasta?: string; terminal?: string; cliente?: string; chofer?: string }>;
}) {
  const sp = await searchParams;
  const { tenantId, rol } = await resolverTenantEfectivo(RUTA, sp);
  if (!puedeVerRuta(rol, RUTA)) redirect('/dashboard');

  const hasta = sp.hasta && FECHA.test(sp.hasta) ? sp.hasta : hoyMx();
  const desde = sp.desde && FECHA.test(sp.desde) ? sp.desde : new Date(new Date(`${hasta}T12:00:00-06:00`).getTime() - 6 * 86_400_000).toISOString().slice(0, 10);
  const uuidONada = (v: string | undefined) => (v && UUID.test(v) ? v.toLowerCase() : '');
  const filtros = { desde, hasta, terminalId: uuidONada(sp.terminal), clienteId: uuidONada(sp.cliente), operadorId: uuidONada(sp.chofer) };
  const rango = rangoDeDias(desde, hasta);

  const catalogos = await leerCatalogosFiltro(tenantId).catch(() => null);
  let filas: ReturnType<typeof armarFilasEstadias> | null = null;
  let error: string | null = null;
  if ('error' in rango) error = rango.error;
  else {
    try {
      const datos = await leerDatosEstadias(tenantId, rango.desde, rango.hasta, {
        terminalId: filtros.terminalId || undefined, clienteId: filtros.clienteId || undefined, operadorId: filtros.operadorId || undefined,
      });
      // Sin pactos a propósito: esta pantalla no valora dinero (los minutos son lo que ve el jefe de tráfico).
      filas = armarFilasEstadias(datos, new Date(), { flota: null, porCliente: new Map() });
    } catch (e) {
      logger.error('estadias.pantalla_fallo', { tenantId, err: e instanceof Error ? e.message : String(e) });
      error = 'No se pudieron leer las estadías ahora mismo. Intenta de nuevo en un momento.';
    }
  }

  // El CSV con dinero solo lo ofrece quien ve dinero (la ruta lo vuelve a exigir: esto es cortesía, no el candado).
  const veDinero = puedeVerRuta(rol, '/dashboard/facturacion');
  const qs = new URLSearchParams({ desde, hasta, formato: 'csv' });
  if (filtros.terminalId) qs.set('terminalId', filtros.terminalId);
  if (filtros.clienteId) qs.set('clienteId', filtros.clienteId);
  if (filtros.operadorId) qs.set('operadorId', filtros.operadorId);
  const ocultos: Record<string, string> = {};
  if (sp.tenant) ocultos.tenant = sp.tenant; else if (sp.vista) ocultos.vista = sp.vista;
  if (sp.rol) ocultos.rol = sp.rol;

  return (
    <VistaEstadias
      sufijo={sufijoTenant(sp)} filtros={filtros} catalogos={catalogos}
      filas={filas?.filas ?? []}
      resumen={filas?.resumen ?? { paradas: 0, cerradas: 0, enCurso: 0, minutosCerradas: 0, minutosExcedentes: null, montoPropuesto: {}, sinPacto: 0 }}
      truncada={filas?.truncada ?? false} error={error} csvUrl={veDinero ? `/api/v1/estadias?${qs.toString()}` : null} ocultos={ocultos}
    />
  );
}
