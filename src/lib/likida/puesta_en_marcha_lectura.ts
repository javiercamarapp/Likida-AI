// Las señales reales de la puesta en marcha (W2): cada una se lee POR SEPARADO y
// cae a `null` si falla — una consulta caída no tumba el checklist ni lo vuelve
// «todo pendiente». Ver `puesta_en_marcha.ts` para las reglas.

import { numeroWhatsAppDeLikida } from './arranque_whatsapp';
import { getDatosResponsable, getPerfilCrudo } from './repo';
import { onboardingFiscalListo } from './perfil/preguntas';
import { getTerminales, getJefesDeTrafico } from './terminales';
import { contarPendientes } from './invitacion_operador';
import { getOperadoresConteos, getUnidadesConteos, politicaPropiaDeclarada } from './administracion';
import { getPrimerosPasos } from './primeros-pasos';
import { DIAS_AVISO } from './vigencias';
import { hoyMx } from '@/lib/formato';
import { ahoraMs } from '@/lib/saludo';
import type { SenalesMarcha } from './puesta_en_marcha';

async function seguro<T>(f: () => Promise<T>): Promise<T | null> {
  try { return await f(); } catch { return null; }
}

export async function leerSenalesMarcha(tenantId: string): Promise<SenalesMarcha> {
  const hoy = hoyMx(new Date(ahoraMs()));
  const [
    datosResponsable, perfilFiscalListo, patios, conteosOperadores, pendientes, conteosUnidades,
    politicaPropia, jefes, primerosPasos,
  ] = await Promise.all([
    // `getDatosResponsable` devuelve `null` si la flota no capturó razón social o
    // domicilio (eso es «pendiente») y LANZA si la base no contestó (eso es «sin dato»).
    seguro(async () => (await getDatosResponsable(tenantId)) !== null),
    seguro(async () => onboardingFiscalListo(await getPerfilCrudo(tenantId))),
    seguro(async () => (await getTerminales(tenantId)).length),
    seguro(() => getOperadoresConteos(tenantId, hoy, DIAS_AVISO)),
    seguro(() => contarPendientes(tenantId, { tipo: 'flota' })),
    seguro(() => getUnidadesConteos(tenantId, hoy, DIAS_AVISO)),
    seguro(() => politicaPropiaDeclarada(tenantId)),
    seguro(async () => (await getJefesDeTrafico(tenantId)).length),
    seguro(() => getPrimerosPasos(tenantId)),
  ]);
  return {
    datosResponsable,
    perfilFiscalListo,
    numeroWhatsApp: numeroWhatsAppDeLikida(),
    patios,
    operadores: conteosOperadores && pendientes !== null
      ? { activos: conteosOperadores.activos, pendientesDeInvitar: pendientes }
      : null,
    unidadesActivas: conteosUnidades ? conteosUnidades.activas : null,
    politicaPropia,
    jefes,
    primerosPasos,
  };
}
