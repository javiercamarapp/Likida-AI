import { type TResto, T_RESTO_ES } from '@/lib/i18n/resto_tr';
// ═══════════════════════════════════════════════════════════════════════════
// «¿ESTOY LISTO?» del día de la conexión (P0-4). Función PURA: recibe lecturas ya hechas y devuelve la lista de comprobaciones.
//
// Reglas:
//   · Cada lectura que no se pudo hacer vale `null` y su comprobación dice «sin dato». Jamás se convierte en «listo» ni en «pendiente».
//   · Nunca se muestra un valor del cliente (ni URL, ni credencial, ni correo): solo estados y conteos.
//   · «Listo» exige evidencia MEDIDA. Una credencial guardada pero nunca probada no es «lista».
// ═══════════════════════════════════════════════════════════════════════════

export type EstadoComprobacion = 'listo' | 'pendiente' | 'sin_dato';
export type ResponsableListo = 'cliente' | 'dueno' | 'likida';
export type EstadoInterruptorListo = 'encendido' | 'apagado' | 'ilegible';

export interface LecturasListo {
  credencial: { activa: boolean; probadaEn: string | null; ultimoError: string | null } | 'sin_credencial' | null;
  /** ¿hay mapeo ACTIVO del recurso `liquidaciones`? */
  mapeoLiquidaciones: boolean | null;
  operadores: { activos: number; conCorreo: number | null } | null;
  config: {
    activa: boolean; usaCorreo: boolean; remitenteCapturado: boolean; responderAEfectivo: boolean;
    revisores: number; primerMesVigente: boolean; noEnviarAntes: string | null; polizaProvisional: boolean | null;
  } | null;
  interruptores: { global: EstadoInterruptorListo | null; liquidacion: EstadoInterruptorListo | null };
  /** Vivas (no revocadas). */
  llavesApi: number | null;
  entorno: { lector: 'muestra_tms' | 'supuesto' | 'invalido'; banderaMuestra: boolean };
}

export interface Comprobacion {
  id: string;
  titulo: string;
  estado: EstadoComprobacion;
  /** Qué se midió, sin valores del cliente. */
  evidencia: string;
  responsable: ResponsableListo;
  /** Dónde se resuelve (ruta del panel) o `null` si lo hace el equipo de Likida. */
  href: string | null;
}

export const rotuloResponsable = (t: TResto = T_RESTO_ES): Record<ResponsableListo, string> => ({ cliente: t('cfg.cliente'), dueno: t('op.dueno_de_la_flota'), likida: t('op.equipo_de_likida') });
export const ROTULO_RESPONSABLE = rotuloResponsable();
export const ROTULO_COMPROBACION: Record<EstadoComprobacion, string> = { listo: 'Listo', pendiente: 'Pendiente', sin_dato: 'Sin dato' };

const sinLectura = (t: TResto = T_RESTO_ES) => (t('op.no_se_pudo_comprobar_ahora_no'));

function c(id: string, titulo: string, estado: EstadoComprobacion, evidencia: string, responsable: ResponsableListo, href: string | null): Comprobacion {
  return { id, titulo, estado, evidencia, responsable, href };
}

export function armarListo(l: LecturasListo, t: TResto = T_RESTO_ES): Comprobacion[] {
  const salida: Comprobacion[] = [];

  // 1 · credencial probada
  if (l.credencial === null) salida.push(c('credencial', 'Credencial del TMS probada', 'sin_dato', sinLectura(t), 'dueno', '/dashboard/conexiones'));
  else if (l.credencial === 'sin_credencial') salida.push(c('credencial', 'Credencial del TMS probada', 'pendiente', t('op.aun_no_hay_credencial_capturada'), 'dueno', '/dashboard/conexiones'));
  else if (!l.credencial.activa) salida.push(c('credencial', 'Credencial del TMS probada', 'pendiente', t('op.la_credencial_esta_desactivada'), 'dueno', '/dashboard/conexiones'));
  else if (!l.credencial.probadaEn) salida.push(c('credencial', 'Credencial del TMS probada', 'pendiente', 'Capturada, pero nunca probada contra el sistema real.', 'dueno', '/dashboard/conexiones'));
  else if (l.credencial.ultimoError) salida.push(c('credencial', 'Credencial del TMS probada', 'pendiente', t('op.la_ultima_prueba_o_lectura_fallo'), 'dueno', '/dashboard/conexiones'));
  else salida.push(c('credencial', 'Credencial del TMS probada', 'listo', t('op.activa_y_probada_sin_error'), 'dueno', '/dashboard/conexiones'));

  // 2 · mapeo de liquidaciones
  salida.push(l.mapeoLiquidaciones === null
    ? c('mapeo', 'Mapeo de liquidaciones activo', 'sin_dato', sinLectura(t), 'likida', null)
    : l.mapeoLiquidaciones
      ? c('mapeo', 'Mapeo de liquidaciones activo', 'listo', t('op.hay_una_version_activa_del_mapeo'), 'likida', null)
      : c('mapeo', 'Mapeo de liquidaciones activo', 'pendiente', t('op.sin_mapeo_activo_el_equipo_de'), 'likida', null));

  // 3 · lector de desgloses (entorno)
  salida.push(l.entorno.lector === 'muestra_tms'
    ? c('lector', 'Lector de desgloses configurado', 'listo', t('op.el_contrato_muestra_tms_esta_configurado'), 'likida', null)
    : l.entorno.lector === 'invalido'
      ? c('lector', 'Lector de desgloses configurado', 'pendiente', t('op.la_configuracion_del_lector_no_es'), 'likida', null)
      : c('lector', 'Lector de desgloses configurado', 'pendiente', t('op.usa_el_contrato_supuesto_falta_configurar'), 'likida', null));
  salida.push(l.entorno.banderaMuestra
    ? c('bandera', t('op.recepcion_de_la_muestra_por_api'), 'listo', t('op.la_bandera_de_la_muestra_esta'), 'likida', null)
    : c('bandera', t('op.recepcion_de_la_muestra_por_api'), 'pendiente', t('op.la_bandera_de_la_muestra_esta_2'), 'likida', null));

  // 4 · llave API
  salida.push(l.llavesApi === null
    ? c('llave', 'Llave de API emitida', 'sin_dato', sinLectura(t), 'dueno', '/dashboard/llaves-api')
    : l.llavesApi > 0
      ? c('llave', 'Llave de API emitida', 'listo', `${l.llavesApi} llave(s) vigente(s).`, 'dueno', '/dashboard/llaves-api')
      : c('llave', 'Llave de API emitida', 'pendiente', t('op.no_hay_ninguna_llave_vigente'), 'dueno', '/dashboard/llaves-api'));

  // 5 · operadores con correo
  if (l.operadores === null || l.operadores.conCorreo === null) salida.push(c('operadores', 'Operadores con correo', 'sin_dato', sinLectura(t), 'cliente', '/dashboard/operadores'));
  else if (l.operadores.activos === 0) salida.push(c('operadores', 'Operadores con correo', 'pendiente', t('op.aun_no_hay_operadores_dados_de'), 'cliente', '/dashboard/operadores'));
  else if (l.operadores.conCorreo < l.operadores.activos) {
    salida.push(c('operadores', 'Operadores con correo', 'pendiente', `${l.operadores.conCorreo} de ${l.operadores.activos} operadores activos tienen correo.`, 'cliente', '/dashboard/operadores'));
  } else salida.push(c('operadores', 'Operadores con correo', 'listo', `Los ${l.operadores.activos} operadores activos tienen correo.`, 'cliente', '/dashboard/operadores'));

  // 6 · revisor designado
  salida.push(l.config === null
    ? c('revisor', 'Revisor designado', 'sin_dato', sinLectura(t), 'dueno', '/dashboard/agentes/liquidacion/configuracion')
    : l.config.revisores === 0
      ? c('revisor', 'Revisor designado', 'pendiente', t('op.no_hay_revisor_nadie_recibe_la'), 'dueno', '/dashboard/agentes/liquidacion/configuracion')
      : !l.config.primerMesVigente
        ? c('revisor', 'Revisor designado', 'pendiente', t('op.hay_revisor_pero_el_periodo_de'), 'dueno', '/dashboard/agentes/liquidacion/configuracion')
        : c('revisor', 'Revisor designado', 'listo', t('op.revisor_es_con_el_periodo_de', { revisores: l.config.revisores }), 'dueno', '/dashboard/agentes/liquidacion/configuracion'));

  // 7 · remitente
  salida.push(l.config === null
    ? c('remitente', 'Remitente del correo', 'sin_dato', sinLectura(t), 'dueno', '/dashboard/agentes/liquidacion/configuracion')
    : l.config.remitenteCapturado && l.config.responderAEfectivo
      ? c('remitente', 'Remitente del correo', 'listo', t('op.hay_remitente_y_direccion_de_respuesta'), 'dueno', '/dashboard/agentes/liquidacion/configuracion')
      : c('remitente', 'Remitente del correo', 'pendiente', t('op.falta_el_remitente_o_la_direccion'), 'dueno', '/dashboard/agentes/liquidacion/configuracion'));

  // 8 · fecha de corte
  salida.push(l.config === null
    ? c('corte', 'Fecha de corte', 'sin_dato', sinLectura(t), 'dueno', '/dashboard/agentes/liquidacion/configuracion')
    : l.config.noEnviarAntes
      ? c('corte', 'Fecha de corte', 'listo', t('op.hay_fecha_de_corte_lo_anterior'), 'dueno', '/dashboard/agentes/liquidacion/configuracion')
      : c('corte', 'Fecha de corte', 'pendiente', t('op.sin_fecha_de_corte_el_historico'), 'dueno', '/dashboard/agentes/liquidacion/configuracion'));

  // 9 · póliza
  salida.push(l.config === null || l.config.polizaProvisional === null
    ? c('poliza', t('op.poliza_provisional'), 'sin_dato', sinLectura(t), 'dueno', null)
    : l.config.polizaProvisional
      ? c('poliza', t('op.poliza_provisional'), 'listo', t('op.encendida_sin_poliza_se_guarda_marcado'), 'dueno', null)
      : c('poliza', t('op.poliza_provisional'), 'pendiente', t('op.apagada_sin_poliza_no_se_guarda'), 'dueno', null));

  // 10 · interruptores
  const { global, liquidacion } = l.interruptores;
  if (global === null || liquidacion === null || global === 'ilegible' || liquidacion === 'ilegible') {
    salida.push(c('interruptores', 'Interruptores encendidos', 'sin_dato', sinLectura(t), 'likida', null));
  } else if (global === 'apagado' || liquidacion === 'apagado') {
    const cuales = [global === 'apagado' ? 'global' : null, liquidacion === 'apagado' ? t('op.agente_de_liquidacion') : null].filter(Boolean).join(' y ');
    salida.push(c('interruptores', 'Interruptores encendidos', 'pendiente', t('op.apagado_es_un_freno_puesto_se', { cuales }), 'likida', null));
  } else salida.push(c('interruptores', 'Interruptores encendidos', 'listo', t('op.el_global_y_el_del_agente'), 'likida', null));

  // 11 · envío activo
  salida.push(l.config === null
    ? c('envio', t('op.envio_por_correo_activado'), 'sin_dato', sinLectura(t), 'dueno', '/dashboard/agentes/liquidacion/configuracion')
    : l.config.activa && l.config.usaCorreo
      ? c('envio', t('op.envio_por_correo_activado'), 'listo', t('op.el_envio_por_correo_esta_activado'), 'dueno', '/dashboard/agentes/liquidacion/configuracion')
      : c('envio', t('op.envio_por_correo_activado'), 'pendiente', t('op.el_envio_esta_apagado_o_el'), 'dueno', '/dashboard/agentes/liquidacion/configuracion'));

  return salida;
}

export interface ResumenListo { listos: number; total: number; pendientes: number; sinDato: number; todoListo: boolean }
export function resumirListo(cs: readonly Comprobacion[]): ResumenListo {
  const listos = cs.filter((x) => x.estado === 'listo').length;
  const pendientes = cs.filter((x) => x.estado === 'pendiente').length;
  const sinDato = cs.filter((x) => x.estado === 'sin_dato').length;
  return { listos, total: cs.length, pendientes, sinDato, todoListo: listos === cs.length && cs.length > 0 };
}
