// Lectura de las señales del asistente de puesta en marcha. SOLO usa lectores que ya existen (ninguna consulta directa propia): el
// asistente no abre una frontera de datos nueva. Cada lectura cae a `null` POR SEPARADO (null ≠ 0): una consulta caída
// no tumba el asistente ni lo vuelve «todo pendiente».

import { correoConfigurado } from '@/lib/correo/enviar';
import { hoyMx } from '@/lib/formato';
import { ahoraMs } from '@/lib/saludo';
import { listarCredenciales } from '../conectores/credenciales';
import { getOperadoresConteos, getUnidadesConteos } from '../administracion';
import { DIAS_AVISO } from '../vigencias';
import { getJefesDeTrafico, getTerminales } from '../terminales';
import { contarOperadoresConCorreo, leerConfigCorreo, listarDesgloses } from '../liquidacion_externa/repo_correo';
import { leerConfigSalida } from '../carta_porte_docs/salida_config';
import type { SenalesAsistente } from './pasos_cinco_agentes';

/** Los conectores que cuentan como «el sistema de transporte del cliente». */
const IDS_TMS: readonly string[] = ['tms_api_lectura', 'tms_generico', 'tabla_propia'];

async function seguro<T>(f: () => Promise<T>): Promise<T | null> {
  try { return await f(); } catch { return null; }
}

export async function leerSenalesAsistente(tenantId: string): Promise<SenalesAsistente> {
  const hoy = hoyMx(new Date(ahoraMs()));
  const [credenciales, desgloses, cfgCorreo, conteosOp, conCorreo, conteosUni, patios, jefes, salida] = await Promise.all([
    seguro(() => listarCredenciales(tenantId)),
    seguro(async () => {
      const l = await listarDesgloses(tenantId, { limite: 1 });
      return l.ok ? l.valor.items.length : null;
    }),
    seguro(async () => {
      const l = await leerConfigCorreo(tenantId);
      return l.ok ? l.valor : null;
    }),
    seguro(() => getOperadoresConteos(tenantId, hoy, DIAS_AVISO)),
    seguro(() => contarOperadoresConCorreo(tenantId)),
    seguro(() => getUnidadesConteos(tenantId, hoy, DIAS_AVISO)),
    seguro(async () => (await getTerminales(tenantId)).length),
    seguro(() => getJefesDeTrafico(tenantId)),
    seguro(() => leerConfigSalida(tenantId)),
  ]);

  const tms = credenciales === null ? null : (() => {
    const c = credenciales.find((x) => IDS_TMS.includes(x.conectorId));
    return c ? { activa: c.activo, probadaEn: c.probadaEn, ultimoError: c.ultimoError } : ('sin_credencial' as const);
  })();

  return {
    tms,
    archivosRecibidos: desgloses,
    correoPlataforma: correoConfigurado(),
    correoDesglose: cfgCorreo === null ? null : {
      activa: cfgCorreo.activa,
      usaCorreo: cfgCorreo.canal === 'correo' || cfgCorreo.canal === 'ambos',
      remitenteCapturado: Boolean(cfgCorreo.remitenteNombre || cfgCorreo.remitenteCorreo),
    },
    operadores: conteosOp === null ? null : { activos: conteosOp.activos, conCorreo },
    unidadesActivas: conteosUni === null ? null : conteosUni.activas,
    patios,
    coordinadores: jefes === null ? null : jefes.length,
    supervisores: jefes === null ? null : jefes.filter((j) => j.terminalId !== null).length,
    revisorCartaPorte: salida === null ? null : Boolean(salida.destinatarioRevisionUsuario),
  };
}
