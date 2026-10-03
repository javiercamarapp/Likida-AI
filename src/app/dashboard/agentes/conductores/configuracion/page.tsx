import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import { puedeAdministrar } from '@/lib/auth/permisos';
import { logger } from '@/lib/logger';
import { valoresDeForma } from '@/lib/likida/conductor/config_forma';
import { guardarConfigDelPanel } from '@/lib/likida/conductor/acciones_config';
import { cargarContactosTrafico, leerConfigConductor } from '@/lib/likida/conductor/repo';
import { emailDeUsuario } from '@/lib/likida/conductor/trabajo';
import { leerCatalogosFiltro } from '@/lib/likida/conductor/repo_validacion';
import { sufijoTenant } from '../../../sufijo';
import { VistaConfigConductor } from './vista';
import type { ResultadoConfig } from './forma';

export const dynamic = 'force-dynamic';

const RUTA = '/dashboard/agentes/conductores/configuracion';

/**
 * La configuración de flota del Agente 5 «Conductor»: escalera de recordatorios, ventana horaria, tope diario, plazos,
 * validación de ubicación, avisos a la oficina y a quién se escala. Antes solo se editaba con `PUT /v1/conductor/config`.
 * El jefe de tráfico la ve; el dueño la guarda (misma validación que el PUT).
 */
export default async function PaginaConfigConductor({ searchParams }: { searchParams: Promise<{ vista?: string; tenant?: string; rol?: string }> }) {
  const sp = await searchParams;
  const { tenantId, rol } = await resolverTenantEfectivo(RUTA, sp);
  if (!puedeVerRuta(rol, RUTA)) redirect('/dashboard');

  const [config, contactos, catalogos] = await Promise.all([
    leerConfigConductor(tenantId).catch((e) => { logger.warn('conductor.config_no_leida', { tenantId, err: e instanceof Error ? e.message : String(e) }); return null; }),
    cargarContactosTrafico(tenantId).catch(() => null),
    leerCatalogosFiltro(tenantId).catch(() => null),
  ]);

  async function accionGuardar(_previo: ResultadoConfig, fd: FormData): Promise<ResultadoConfig> {
    'use server';
    const s = await resolverTenantEfectivo(RUTA, sp);
    if (!puedeVerRuta(s.rol, RUTA)) return { ok: false, error: 'No tienes acceso a esta configuración.' };
    const email = await emailDeUsuario(s.userId).catch(() => null);
    const r = await guardarConfigDelPanel({ tenantId: s.tenantId, rol: s.rol, usuarioId: s.userId, email }, fd);
    if (r.ok) revalidatePath(RUTA);
    return r;
  }

  return (
    <VistaConfigConductor
      sufijo={sufijoTenant(sp)} config={config} valores={config ? valoresDeForma(config) : null} contactos={contactos}
      patios={catalogos?.terminales ?? []} puedeEditar={puedeAdministrar(rol)} accionGuardar={accionGuardar}
    />
  );
}
