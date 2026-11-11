'use server';

import { revalidatePath } from 'next/cache';
import { resolverTenantAtadoFirmado, CAMPO_FLOTA_PINTADA, MENSAJE_FLOTA_CAMBIO } from '@/lib/auth/tenant-atado';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import { rateLimit } from '@/lib/ratelimit';
import { logger } from '@/lib/logger';
import { anotarBitacora } from '@/lib/likida/bitacora_escritura';
import { DatoInvalido, mensajeParaPantalla } from '@/lib/likida/errores';
import * as repo from '@/lib/likida/carta_porte_docs/repo';
import { guardarConfigSalida, validarConfigSalida } from '@/lib/likida/carta_porte_docs/salida_config';
import { sinConexionUtil } from '@/lib/likida/carta_porte_docs/tms_puerto';
import { salidaDeFlota } from '@/lib/likida/carta_porte_docs/worker_envios_deps';
import type { ResultadoAccion } from '@/app/dashboard/carta-porte/documentos/forma_accion';
import { guardarPrimerMes } from '@/lib/likida/carta_porte_docs/primer_mes';
import { revisoresDeTexto } from '@/lib/likida/carta_porte_docs/primer_mes_texto';
import { entradaDeTexto, esProbable, type CamposTexto } from './formato';
import { getT } from '@/lib/i18n/servidor';
import { type TAgentes, TR_ES } from '@/app/dashboard/agentes/i18n-agentes';

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURACIÓN DE LA SALIDA AL SISTEMA DEL CLIENTE (T-A3-32).
//
// Server actions A NIVEL DE MÓDULO: vuelven a resolver sesión, rol y flota desde la cookie. JAMÁS aceptan un tenant_id
// del formulario (los campos tenant/rol/vista son el «ver como» firmado que ya valida `resolverTenantEfectivo`).
// La ruta es del área `administracion`: solo dueño/administrador. Aquí no entra ni sale ninguna credencial del TMS.
// ═══════════════════════════════════════════════════════════════════════════

const RUTA = '/dashboard/agentes/carta-porte/configuracion';
const sinPermiso = (tx: TAgentes = TR_ES.t) => (tx('rest.tu_rol_no_puede_cambiar_la'));
const CAMPOS: ReadonlyArray<keyof CamposTexto> = [
  'modo', 'plantillaPorDefecto', 'reintentosMax', 'frecuenciaMin', 'ventanaInicio', 'ventanaFin', 'destinatarioAlertaCorreo',
  'destinatarioAlertaUsuario', 'destinatarioRevisionUsuario', 'destinatarioRevisionCorreo', 'siTmsDesconocido', 'distanciaFormato',
];

/** Guarda la configuración COMPLETA que manda el formulario. Campos: los de `CAMPOS` (texto). */
export async function guardarConfiguracionSalida(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
  const { t: tx } = await getT('agentes');
  // MX-002: la flota que se pintó es la que escribe (la pantalla firma la flota en un campo oculto; la cookie del selector
  // es compartida entre pestañas). Sin firma válida —o con otra flota— no se escribe nada.
  const s = await resolverTenantAtadoFirmado(RUTA, fd.get(CAMPO_FLOTA_PINTADA));
  if (!s) return { ok: false, error: MENSAJE_FLOTA_CAMBIO };
  if (!puedeVerRuta(s.rol, RUTA)) return { ok: false, error: sinPermiso(tx) };
  try {
    if (!(await rateLimit(`cp-salida-config:${s.tenantId}`, 20, 60_000))) return { ok: false, error: tx('rest.demasiados_cambios_en_poco_tiempo_espera') };
    const texto = Object.fromEntries(CAMPOS.map((c) => [c, String(fd.get(c) ?? '')])) as CamposTexto;
    const entrada = entradaDeTexto(texto);
    const valida = validarConfigSalida({ ...entrada });
    // El modo API solo se activa con un conector probado: sin él, la salida sigue siendo la descarga.
    if (valida.modo === 'api' && sinConexionUtil(await salidaDeFlota(s.tenantId))) {
      return { ok: false, error: tx('rest.el_modo_api_todavia_no_se') };
    }
    // Los destinatarios internos tienen que ser personas activas de ESTA flota.
    for (const [campo, rotulo] of [['destinatarioAlertaUsuario', tx('rest.de_la_alerta')], ['destinatarioRevisionUsuario', tx('rest.de_la_revision')]] as const) {
      const id = valida[campo];
      if (id && !(await repo.usuarioRevisor(s.tenantId, id))) return { ok: false, error: tx('rest.el_usuario_no_es_una_persona', { rotulo }) };
    }
    await guardarConfigSalida(s.tenantId, valida, { id: s.userId });
    revalidatePath(RUTA);
    return { ok: true, mensaje: tx('rest.configuracion_guardada') };
  } catch (e) {
    if (e instanceof DatoInvalido) return { ok: false, error: e.message };
    logger.error('carta_porte_docs.salida_config_pantalla', { error: e instanceof Error ? e.message : String(e) });
    return { ok: false, error: mensajeParaPantalla(e, tx('rest.guardar_la_configuracion_de_la_salida')) };
  }
}

/** «Probar conexión»: llama a `probar()` del conector de PS. Sin conector probable no hace nada. Deja bitácora sin detalle del TMS. */
export async function probarConexionSalida(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
  const { t: tx } = await getT('agentes');
  // MX-002: la flota que se pintó es la que escribe (la pantalla firma la flota en un campo oculto; la cookie del selector
  // es compartida entre pestañas). Sin firma válida —o con otra flota— no se escribe nada.
  const s = await resolverTenantAtadoFirmado(RUTA, fd.get(CAMPO_FLOTA_PINTADA));
  if (!s) return { ok: false, error: MENSAJE_FLOTA_CAMBIO };
  if (!puedeVerRuta(s.rol, RUTA)) return { ok: false, error: sinPermiso(tx) };
  try {
    if (!(await rateLimit(`cp-salida-probar:${s.tenantId}`, 6, 60_000))) return { ok: false, error: tx('rest.demasiadas_pruebas_en_poco_tiempo_espera') };
    const puerto = await salidaDeFlota(s.tenantId);
    if (sinConexionUtil(puerto) || !esProbable(puerto)) return { ok: false, error: tx('rest.esta_flota_todavia_no_tiene_conectado') };
    const r = await puerto.probar();
    await anotarBitacora(
      { tenantId: s.tenantId, actor: { id: s.userId }, accion: 'ccp.salida_conexion_probada', entidad: 'tenant', entidadId: s.tenantId, detalle: { ok: r.ok } },
      { evento: 'carta_porte_docs.bitacora_no_escribio' },
    );
    return r.ok ? { ok: true, mensaje: tx('rest.la_conexion_con_el_sistema_del') } : { ok: false, error: tx('rest.la_conexion_con_el_sistema_del_2') };
  } catch (e) {
    logger.error('carta_porte_docs.salida_probar', { error: e instanceof Error ? e.message : String(e) });
    return { ok: false, error: mensajeParaPantalla(e, tx('rest.probar_la_conexion')) };
  }
}

/** Guarda el modo «primer mes» (fecha límite y revisores por departamento). Campos: `hasta` (AAAA-MM-DD o vacío) y `revisores` (un renglón por revisor). */
export async function guardarPrimerMesAccion(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
  const { t: tx } = await getT('agentes');
  // MX-002: la flota que se pintó es la que escribe (la pantalla firma la flota en un campo oculto; la cookie del selector
  // es compartida entre pestañas). Sin firma válida —o con otra flota— no se escribe nada.
  const s = await resolverTenantAtadoFirmado(RUTA, fd.get(CAMPO_FLOTA_PINTADA));
  if (!s) return { ok: false, error: MENSAJE_FLOTA_CAMBIO };
  if (!puedeVerRuta(s.rol, RUTA)) return { ok: false, error: sinPermiso(tx) };
  try {
    if (!(await rateLimit(`cp-primer-mes:${s.tenantId}`, 20, 60_000))) return { ok: false, error: tx('rest.demasiados_cambios_en_poco_tiempo_espera') };
    const hasta = String(fd.get('hasta') ?? '').trim();
    let revisores;
    try { revisores = revisoresDeTexto(String(fd.get('revisores') ?? '')); } catch (e) { return { ok: false, error: e instanceof Error ? e.message : tx('rest.no_entendi_los_revisores') }; }
    if ((hasta === '') !== (revisores.length === 0)) return { ok: false, error: tx('rest.para_encender_el_primer_mes_escribe') };
    await guardarPrimerMes(s.tenantId, { hasta: hasta === '' ? null : hasta, revisores }, { id: s.userId });
    revalidatePath(RUTA);
    return { ok: true, mensaje: hasta === '' ? 'Primer mes apagado.' : tx('rest.primer_mes_guardado_cada_movimiento_se') };
  } catch (e) {
    if (e instanceof DatoInvalido) return { ok: false, error: e.message };
    if (e instanceof Error && /migración 0938/.test(e.message)) return { ok: false, error: e.message };
    logger.error('carta_porte_docs.primer_mes_pantalla', { error: e instanceof Error ? e.message : String(e) });
    return { ok: false, error: mensajeParaPantalla(e, 'guardar el primer mes') };
  }
}
