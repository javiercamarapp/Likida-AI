import { redirect } from 'next/navigation';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import * as repo from '@/lib/likida/carta_porte_docs/repo';
import { CONFIG_SALIDA_ARRANQUE } from '@/lib/likida/carta_porte_docs/salida_config';
import { SIN_TMS } from '@/lib/likida/carta_porte_docs/tms_puerto';
import { salidaDeFlota } from '@/lib/likida/carta_porte_docs/worker_envios_deps';
import { sufijoTenant } from '../../../sufijo';
import { guardarConfiguracionSalida, probarConexionSalida } from './actions';
import { esProbable } from './formato';
import { VistaConfiguracionSalida } from './vista';

export const dynamic = 'force-dynamic';

const RUTA = '/dashboard/agentes/carta-porte/configuracion';

/**
 * La configuración de la salida del Agente de Carta Porte (T-A3-32). Gatea con su propia llave (`RUTA`, área
 * administración: solo dueño/administrador) y lee SOLO lo de la flota de la sesión. Sin fila guardada muestra los
 * valores de arranque rotulados como tales; una lectura caída lanza (error boundary), no finge «arranque».
 */
export default async function PaginaConfiguracionSalida({
  searchParams,
}: {
  searchParams: Promise<{ vista?: string; tenant?: string; rol?: string }>;
}) {
  const sp = await searchParams;
  const { tenantId, rol } = await resolverTenantEfectivo(RUTA, sp);
  if (!puedeVerRuta(rol, RUTA)) redirect('/dashboard');

  const fila = await repo.leerSalidaConfig(tenantId);
  const personas = await repo.usuariosRevisores(tenantId);
  const puerto = await salidaDeFlota(tenantId); // nunca lanza: sin conector es SIN_TMS
  const hayConector = puerto !== SIN_TMS;

  return (
    <VistaConfiguracionSalida
      config={fila ?? { ...CONFIG_SALIDA_ARRANQUE }}
      esArranque={fila === null}
      personas={personas.map((p) => ({ id: p.id, nombre: p.nombre ?? p.email }))}
      conector={{ hay: hayConector, puedeProbar: hayConector && esProbable(puerto) }}
      sufijo={sufijoTenant(sp)}
      ver={{ ...(sp.tenant ? { tenant: sp.tenant } : {}), ...(sp.rol ? { rol: sp.rol } : {}), ...(sp.vista ? { vista: sp.vista } : {}) }}
      acciones={{ guardar: guardarConfiguracionSalida, probar: probarConexionSalida }}
    />
  );
}
