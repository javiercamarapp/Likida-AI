import { redirect } from 'next/navigation';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { requireSessionTenant } from '@/lib/auth/guard';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import { puedeAsignar } from '@/lib/auth/permisos';
import {
  getTableroOperacion, getViajesSinAsignar, getCargaOperadores, crearViaje, avisarAlChofer,
} from '@/lib/likida/operacion';
import { listOperadores, reasignarOperador } from '@/lib/likida/repo';
import { crearOperador } from '@/lib/likida/administracion';
import { DatoInvalido } from '@/lib/likida/errores';
import { getViajes } from '@/lib/likida/analytics';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { VistaDespacho } from './vista';

export const dynamic = 'force-dynamic';

function safe<T>(fn: () => Promise<T>): Promise<T | null> {
  return fn().catch(() => null);
}

/**
 * Despacho — la página donde se ACTÚA (13-ago-2026): crear viaje, asignar
 * y avisar en un paso, insistirle al chofer que no acepta, y dar de alta
 * operadores sin brincar de página. La foto de solo lectura de la mañana
 * vive en el Resumen del encargado; aquí viven los botones.
 *
 * Área `operacion`: el jefe de tráfico entra y NO hay un peso en pantalla.
 * Toda action re-verifica sesión y permiso ADENTRO (alcanzables por POST
 * directo), y el tenant viaja por closure del render, nunca del cliente.
 */
export default async function PaginaDespacho({
  searchParams,
}: {
  searchParams: Promise<{ vista?: string; tenant?: string; rol?: string }>;
}) {
  const sp = await searchParams;
  const { tenantId, rol } = await resolverTenantEfectivo('/dashboard/despacho', sp);
  if (!puedeVerRuta(rol, '/dashboard/despacho')) redirect('/dashboard');

  const base = sp.tenant ? `?tenant=${sp.tenant}` : sp.vista ? `?vista=${sp.vista}` : '';
  const sufijo = sp.rol ? `${base}${base ? '&' : '?'}rol=${sp.rol}` : base;
  const destino = `/dashboard/despacho${sufijo}`;

  // Las COLAS son el corazón: sin catch — base caída = página caída, no una
  // cola vacía que afirma "nada por asignar". El tablero y la carga degradan.
  const [tablero, sinAsignar, viajes, operadores, carga] = await Promise.all([
    safe(() => getTableroOperacion(tenantId)),
    getViajesSinAsignar(tenantId),
    getViajes(tenantId, 100),
    listOperadores(tenantId),
    safe(() => getCargaOperadores(tenantId)),
  ]);

  /** El chequeo que TODA action repite: sesión viva, rol que asigna, y que
   *  la flota de la sesión sea la del render (superadmin exento: su tenant
   *  efectivo es el del demo/`?tenant=`). */
  async function guardia(): Promise<string | null> {
    const sesion = await requireSessionTenant('/dashboard/despacho');
    if (!puedeAsignar(sesion.rol)) return 'Tu rol no puede despachar viajes.';
    if (sesion.rol !== 'superadmin' && sesion.tenantId !== tenantId) return 'Este despacho no es de tu flota.';
    return null;
  }

  async function crear(_prev: { error?: string } | null, fd: FormData): Promise<{ error?: string } | null> {
    'use server';
    const rechazo = await guardia();
    if (rechazo) return { error: rechazo };

    const texto = (n: string, max: number) => {
      const v = fd.get(n);
      return typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;
    };
    const anticipoCrudo = fd.get('anticipo');
    const anticipo = typeof anticipoCrudo === 'string' && anticipoCrudo.trim() !== '' ? Number(anticipoCrudo) : 0;
    if (!Number.isFinite(anticipo) || anticipo < 0) {
      return { error: 'El anticipo tiene que ser un monto válido (o dejarse vacío).' };
    }
    const fecha = texto('fechaInicio', 10);
    if (fecha && !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
      return { error: 'La fecha de inicio no tiene un formato válido.' };
    }
    try {
      // `crearViaje` re-valida que el operador sea de ESTA flota y manda el
      // aviso de WhatsApp él mismo (y se traga el fallo del aviso a
      // propósito: el viaje ya existe y "Reavisar" vive aquí abajo).
      await crearViaje(tenantId, {
        folio: texto('folio', 40),
        origen: texto('origen', 120),
        destino: texto('destino', 120),
        fechaInicio: fecha,
        anticipo,
        operadorId: texto('operadorId', 64),
      });
    } catch (err) {
      logger.error('despacho.crear.fallo', { err: err instanceof Error ? err.message : String(err) });
      return { error: 'No se pudo crear el viaje. Revisa los datos e inténtalo de nuevo.' };
    }
    redirect(destino);
  }

  async function asignarYAvisar(_prev: { error?: string } | null, fd: FormData): Promise<{ error?: string } | null> {
    'use server';
    const rechazo = await guardia();
    if (rechazo) return { error: rechazo };

    const viajeId = typeof fd.get('viajeId') === 'string' ? (fd.get('viajeId') as string).trim().slice(0, 64) : '';
    const operadorId = typeof fd.get('operadorId') === 'string' ? (fd.get('operadorId') as string).trim().slice(0, 64) : '';
    if (!viajeId || !operadorId) return { error: 'Falta el viaje o el operador.' };

    try {
      // `reasignarOperador` verifica que el operador sea de ESTA flota y el
      // update ancla tenant — un id ajeno no encuentra fila.
      await reasignarOperador(tenantId, viajeId, operadorId);
    } catch (err) {
      logger.error('despacho.asignar.fallo', { viajeId, err: err instanceof Error ? err.message : String(err) });
      return { error: 'No se pudo asignar. Inténtalo de nuevo.' };
    }
    try {
      await avisarAlChofer(tenantId, operadorId, viajeId);
    } catch (err) {
      // Asignado SÍ quedó; el aviso no salió — se dice y "Reavisar" existe.
      logger.error('despacho.aviso.fallo', { viajeId, err: err instanceof Error ? err.message : String(err) });
      return { error: 'Quedó asignado, pero el aviso de WhatsApp no salió — usa Reavisar en "En curso".' };
    }
    redirect(destino);
  }

  async function reenviarAviso(_prev: { error?: string } | null, fd: FormData): Promise<{ error?: string } | null> {
    'use server';
    const rechazo = await guardia();
    if (rechazo) return { error: rechazo };

    const viajeId = typeof fd.get('viajeId') === 'string' ? (fd.get('viajeId') as string).trim().slice(0, 64) : '';
    if (!viajeId) return { error: 'Falta el viaje.' };

    // El destinatario se resuelve AQUÍ, anclado al tenant — el cliente no
    // elige a quién se le manda el WhatsApp.
    const { data: v, error } = await supabaseAdmin()
      .from('viaje').select('operador_id')
      .eq('id', viajeId).eq('tenant_id', tenantId).maybeSingle();
    if (error || !v?.operador_id) {
      return { error: 'Ese viaje no tiene operador asignado (o no se pudo leer).' };
    }
    try {
      await avisarAlChofer(tenantId, v.operador_id as string, viajeId);
    } catch (err) {
      logger.error('despacho.reaviso.fallo', { viajeId, err: err instanceof Error ? err.message : String(err) });
      return { error: 'El aviso no salió — inténtalo de nuevo en un momento.' };
    }
    redirect(destino);
  }

  async function altaOperador(_prev: { error?: string } | null, fd: FormData): Promise<{ error?: string } | null> {
    'use server';
    const rechazo = await guardia();
    if (rechazo) return { error: rechazo };

    const nombre = typeof fd.get('nombre') === 'string' ? (fd.get('nombre') as string).trim().slice(0, 120) : '';
    const telefono = typeof fd.get('telefono') === 'string' ? (fd.get('telefono') as string).trim().slice(0, 20) : '';
    if (!nombre || !telefono) return { error: 'Faltan el nombre o el WhatsApp.' };

    const sesion = await requireSessionTenant('/dashboard/despacho');
    try {
      // `crearOperador` normaliza la lada 52 y falla CERRADO ante duplicados
      // (incluso entre flotas) — sus mensajes están escritos para pantalla.
      await crearOperador(tenantId, { nombre, telefono }, { id: sesion.userId });
    } catch (err) {
      if (err instanceof DatoInvalido) return { error: err.message };
      logger.error('despacho.alta_operador.fallo', { err: err instanceof Error ? err.message : String(err) });
      return { error: 'No se pudo dar de alta. Inténtalo de nuevo.' };
    }
    redirect(destino);
  }

  return (
    <VistaDespacho
      tablero={tablero}
      sinAsignar={sinAsignar}
      activos={viajes.filter((v) => v.estatus === 'abierto' || v.estatus === 'en_cuadre')}
      operadores={operadores}
      carga={carga}
      crear={crear}
      asignarYAvisar={asignarYAvisar}
      reenviarAviso={reenviarAviso}
      altaOperador={altaOperador}
    />
  );
}
