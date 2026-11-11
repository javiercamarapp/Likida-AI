import { supabaseAdmin } from '@/lib/supabase/admin';
import { acotada } from '@/lib/likida/presupuesto';
import { listarCredenciales } from '@/lib/likida/conectores/credenciales';
import { getOperadoresConteos } from '@/lib/likida/administracion';
import { leerInterruptor, type NombreInterruptor } from '@/lib/likida/interruptores';
import { contarOperadoresConCorreo, leerConfigCorreo, modoPrimerMesVigente, responderAEfectivo } from '@/lib/likida/liquidacion_externa/repo_correo';
import { medirPolizaProvisional } from '@/lib/likida/liquidacion_externa/poliza_provisional';
import { banderaMuestraTmsEncendida } from '@/lib/likida/liquidacion_externa/desglose_muestra_recepcion';
import { seleccionarContratoDesglose } from '@/lib/likida/liquidacion_externa/desglose_muestra_pull_config';
import { hoyMx } from '@/lib/formato';
import { DIAS_AVISO } from '@/lib/likida/vigencias';
import type { EstadoInterruptorListo, LecturasListo } from './listo';

const IDS_TMS: readonly string[] = ['tms_api_lectura', 'tms_generico', 'tabla_propia'];

/** Cada lectura cae a `null` POR SEPARADO: una consulta caída no tumba las demás ni se lee como «no hay». */
async function seguro<T>(f: () => Promise<T | null>): Promise<T | null> {
  try { return await f(); } catch { return null; }
}

async function contar(consulta: PromiseLike<{ count: number | null; error: { message: string } | null }>, etiqueta: string): Promise<number | null> {
  const r = await acotada(consulta, etiqueta);
  return r.error || r.count === null ? null : r.count;
}

const estadoInterruptor = async (n: NombreInterruptor): Promise<EstadoInterruptorListo | null> => seguro(async () => leerInterruptor(n));

export async function leerLecturasListo(tenantId: string): Promise<LecturasListo> {
  const hoy = hoyMx();
  const [credenciales, mapeo, operadores, conCorreo, config, polizaProvisional, llaves, global, liquidacion] = await Promise.all([
    seguro(() => listarCredenciales(tenantId)),
    seguro(() => contar(supabaseAdmin().from('tms_mapeo').select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId).eq('recurso', 'liquidaciones').eq('activo', true), 'listo.mapeo')),
    seguro(() => getOperadoresConteos(tenantId, hoy, DIAS_AVISO)),
    seguro(() => contarOperadoresConCorreo(tenantId)),
    seguro(async () => { const l = await leerConfigCorreo(tenantId); return l.ok ? l.valor : null; }),
    medirPolizaProvisional(tenantId),
    seguro(() => contar(supabaseAdmin().from('tenant_api_key').select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId).is('revocada_en', null), 'listo.llaves')),
    estadoInterruptor('global'),
    estadoInterruptor('agente:liquidacion'),
  ]);

  const credencial = credenciales === null ? null : (() => {
    const x = credenciales.find((y) => IDS_TMS.includes(y.conectorId));
    return x ? { activa: x.activo, probadaEn: x.probadaEn, ultimoError: x.ultimoError } : ('sin_credencial' as const);
  })();
  const contrato = seleccionarContratoDesglose();

  return {
    credencial,
    mapeoLiquidaciones: mapeo === null ? null : mapeo > 0,
    operadores: operadores === null ? null : { activos: operadores.activos, conCorreo },
    config: config === null ? null : {
      activa: config.activa,
      usaCorreo: config.canal === 'correo' || config.canal === 'ambos',
      remitenteCapturado: Boolean(config.remitenteNombre || config.remitenteCorreo),
      responderAEfectivo: responderAEfectivo(config) !== null,
      revisores: config.revisores.length,
      primerMesVigente: modoPrimerMesVigente(config, hoy),
      noEnviarAntes: config.noEnviarAntes,
      polizaProvisional,
    },
    interruptores: { global, liquidacion },
    llavesApi: llaves,
    entorno: { lector: contrato.contrato === 'muestra-tms' ? 'muestra_tms' : contrato.contrato === 'invalido' ? 'invalido' : 'supuesto', banderaMuestra: banderaMuestraTmsEncendida() },
  };
}
