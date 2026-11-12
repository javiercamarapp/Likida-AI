import { CRONS, TOLERANCIA_LATIDO_MS, esHuecoDeConfiguracion, type CronId, type LatidoDetallado } from '@/lib/admin/salud';
import { etiquetaContadorVigia } from '../observabilidad/etiquetas';
import { type TSistema, T_SISTEMA_ES } from '@/lib/i18n/sistema_tr';

// ═══════════════════════════════════════════════════════════════════════════
// LO QUE DICE /admin/crons Y LA PORTADA DE SALUD, SIN REACT: nombres en palabras, el oficio de cada reloj, el resumen de cuántos laten,
// el «por qué no corrió» y la guía de arreglo cuando falta configuración. Todo puro para poder probarlo.
//
// Cuántos son NO se escribe aquí: sale de `CRONS`, la constante que `salud.test.ts` cruza contra vercel.json y contra el CHECK de la
// base. `Record<CronId, …>` hace que un reloj nuevo sin nombre NO compile.
// ═══════════════════════════════════════════════════════════════════════════

/** Cómo se llama cada reloj en la oficina (el id es del sistema y no se pinta). */
export const nombreReloj = (t: TSistema = T_SISTEMA_ES): Record<CronId, string> => ({
  'wa-pendientes': t('crons_estado_relojes.whatsapp_entrante'),
  'wa-outbox': t('crons_estado_relojes.whatsapp_saliente'),
  escalar: t('crons_estado_relojes.escalamientos_y_citas'),
  facturar: t('crons_estado_relojes.facturas_de_portales'),
  purgar: t('crons_estado_relojes.purga_por_retencion'),
  runner: t('crons_estado_relojes.corrida_de_agentes'),
  gps: t('crons_estado_relojes.posiciones_gps'),
  asistencia: t('crons_estado_relojes.asistencia_en_emergencias'),
  'descarga-sat': t('crons_estado_relojes.descarga_del_sat'),
  jornada: t('crons_estado_relojes.registro_de_jornada'),
  'portales-vivos': t('crons_estado_relojes.portales_de_facturacion'),
  'liquidaciones-externas': t('crons_estado_relojes.liquidaciones_externas'),
  peajes: t('crons_estado_relojes.desgloses_de_peaje'),
  'conductor-hitos': t('crons_estado_relojes.hitos_del_viaje'),
  vigia: t('crons_estado_relojes.vigia_de_sla'),
  'jornada-alertas': t('crons_estado_relojes.alertas_de_jornada'),
  'buzon-entrega': t('crons_estado_relojes.buzon_del_contador'),
  'carta-porte-docs': t('crons_estado_relojes.documentos_de_carta_porte'),
  guardia: t('crons_estado_relojes.guardia_de_produccion'),
  tms: t('crons_estado_relojes.sistema_de_transporte_del_cliente'),
});
export const NOMBRE_RELOJ = nombreReloj();

/** Qué hace cada reloj, en una línea, para que el rojo se pueda priorizar. */
export const oficioReloj = (t: TSistema = T_SISTEMA_ES): Record<CronId, string> => ({
  'wa-pendientes': t('crons_estado_relojes.recoge_los_mensajes_de_whatsapp_que'),
  'wa-outbox': t('crons_estado_relojes.manda_los_mensajes_de_whatsapp_encolados'),
  escalar: t('crons_estado_relojes.escala_lo_que_lleva_demasiado_tiempo'),
  facturar: t('crons_estado_relojes.pide_las_facturas_de_los_tickets'),
  purgar: t('crons_estado_relojes.borra_lo_que_ya_cumplio_su'),
  runner: t('crons_estado_relojes.despacha_a_la_compania_de_agentes'),
  gps: t('crons_estado_relojes.baja_las_posiciones_de_las_unidades'),
  asistencia: t('crons_estado_relojes.vigila_las_emergencias_sin_reconocer'),
  'descarga-sat': t('crons_estado_relojes.recoge_del_sat_las_facturas_que'),
  jornada: t('crons_estado_relojes.asienta_el_registro_de_jornada_del'),
  'portales-vivos': t('crons_estado_relojes.comprueba_que_los_portales_de_facturacion'),
  'liquidaciones-externas': t('crons_estado_relojes.entrega_y_concilia_las_liquidaciones_que'),
  peajes: t('crons_estado_relojes.importa_y_concilia_los_desgloses_de'),
  'conductor-hitos': t('crons_estado_relojes.pide_persigue_y_escala_los_hitos'),
  vigia: t('crons_estado_relojes.vigila_el_plazo_de_los_clientes'),
  'jornada-alertas': t('crons_estado_relojes.avisa_al_encargado_y_al_operador'),
  'buzon-entrega': t('crons_estado_relojes.arma_y_manda_al_contador_el'),
  'carta-porte-docs': t('crons_estado_relojes.extrae_los_documentos_de_carta_porte'),
  guardia: t('crons_estado_relojes.la_guardia_de_produccion_clasifica_lo'),
  tms: t('crons_estado_relojes.lee_solo_lectura_los_viajes_liquidaciones'),
});
export const OFICIO_RELOJ = oficioReloj();

/** "cada 5 min" / "cada 4 h" / "una vez al día". */
export function cadaCuanto(ms: number, t: TSistema = T_SISTEMA_ES): string {
  if (ms < 3_600_000) return t('crons_estado_relojes.cada_min', { n: Math.round(ms / 60_000) });
  if (ms < 86_400_000) return t('crons_estado_relojes.cada_h', { n: Math.round(ms / 3_600_000) });
  return t('crons_estado_relojes.una_vez_al_dia');
}

/** "hace 3 min" / "hace 2.5 h" / "hace 4 d". `null` = nunca latió. */
export function desdeHace(min: number | null, t: TSistema = T_SISTEMA_ES): string {
  if (min === null) return t('crons_estado_relojes.nunca');
  if (min < 60) return t('crons_estado_relojes.hace_min', { n: min });
  if (min < 1440) return t('crons_estado_relojes.hace_h', { n: Math.round(min / 6) / 10 });
  return t('crons_estado_relojes.hace_d', { n: Math.round(min / 144) / 10 });
}

/**
 * Lo que el propio cron dejó dicho de su última pasada, tal cual, sin `codigo` (que ya tiene su propio renglón) ni claves vacías. No
 * inventa una interpretación: una corrida `parcial` promete «el detalle está abajo» y aquí es lo que se enseña.
 */
export function resumenDetalle(detalle: Record<string, unknown>, t: TSistema = T_SISTEMA_ES): string | null {
  const partes = Object.entries(detalle)
    .filter(([clave, valor]) => clave !== 'codigo' && valor !== undefined && valor !== null)
    .map(([clave, valor]): string | null => {
      const nombre = etiquetaContadorVigia(clave, t);
      if (Array.isArray(valor)) return valor.length > 0 ? `${nombre}: ${valor.length}` : null;
      if (typeof valor === 'number') return valor > 0 ? `${nombre}: ${valor}` : null;
      if (typeof valor === 'string') return valor.trim() !== '' ? `${nombre}: ${valor}` : null;
      if (typeof valor === 'boolean') return valor ? nombre : null;
      return null;
    })
    .filter((x): x is string => x !== null);
  return partes.length > 0 ? partes.join(' · ') : null;
}

/**
 * El resumen de arriba, dos ejes —los MISMOS que /api/health—: antes solo miraba la cadencia y un reloj que latía puntual reportando
 * `fallo` cada minuto salía en «todos latieron». El panel del operador no puede ser más laxo que el endpoint público.
 */
export function resumenRelojes(lista: Array<{ cron: CronId; l: LatidoDetallado }>): {
  sinLatir: CronId[]; conFallo: CronId[]; parciales: CronId[];
} {
  return {
    sinLatir: lista.filter((x) => x.l.estado !== 'ok').map((x) => x.cron),
    conFallo: lista.filter((x) => x.l.estado === 'ok' && x.l.ultimoEstado === 'fallo').map((x) => x.cron),
    parciales: lista.filter((x) => x.l.estado === 'ok' && x.l.ultimoEstado === 'parcial').map((x) => x.cron),
  };
}

export interface PorQueNoCorrio {
  texto: string;
  /** `config` = falta configuración (tiene guía de arreglo); `apagado` = alguien lo apagó a propósito; `averia` = algo se rompió. */
  causa: 'config' | 'apagado' | 'averia' | 'espera' | 'sin_dato' | 'ninguna';
}

/**
 * «Por qué no corrió»: para cada reloj, la causa con las palabras que el cron dejó, en este orden: apagado a propósito (palanca), falta de
 * configuración declarada, fallo con código, nunca latió, dejó de latir, o el detalle de una pasada parcial. Un reloj sano devuelve
 * `ninguna` y la tabla pinta un guion: NO se inventa un motivo.
 */
export function porQueNoCorrio(l: LatidoDetallado, t: TSistema = T_SISTEMA_ES): PorQueNoCorrio {
  if (l.motivoSalto !== null) return { texto: l.motivoSalto, causa: /palanca/i.test(l.motivoSalto) ? 'apagado' : esHuecoDeConfiguracion(l.motivoSalto) ? 'config' : 'espera' };
  if (l.ultimoEstado === 'parcial' && esHuecoDeConfiguracion(l.detalle)) return { texto: t('crons_estado_relojes.falta_configuracion_no_se_puede_hacer'), causa: 'config' };
  if (l.ultimoEstado === 'fallo' && typeof l.detalle.codigo === 'string') return { texto: t('crons_estado_relojes.fallo_con_codigo', { codigo: l.detalle.codigo }), causa: 'averia' };
  if (l.estado === 'sin_latido') return { texto: t('crons_estado_relojes.no_ha_escrito_su_pulso_ni'), causa: 'sin_dato' };
  if (l.estado === 'vencido') return { texto: t('crons_estado_relojes.deberia_haber_latido_mas_min_de', { cadaCuanto: cadaCuanto(l.cadenciaMs, t), Math: Math.round(TOLERANCIA_LATIDO_MS / 60_000) }), causa: 'averia' };
  if (l.ultimoEstado === 'parcial' || l.ultimoEstado === 'fallo') {
    const r = resumenDetalle(l.detalle, t);
    if (r !== null) return { texto: r, causa: l.ultimoEstado === 'fallo' ? 'averia' : 'espera' };
  }
  return { texto: '', causa: 'ninguna' };
}

export interface GuiaArreglo {
  cron: CronId;
  /** Qué no funciona, en palabras de la oficina. */
  queFalta: string;
  /** Quién lo destraba. */
  quien: string;
  /** Pasos concretos; aquí sí pueden ir los nombres que usa quien configura. */
  pasos: string[];
  /** Lo que el propio reloj dejó dicho (puede traer nombres de variables). */
  dicho: string | null;
}

const guias = (t: TSistema = T_SISTEMA_ES): Partial<Record<CronId, Omit<GuiaArreglo, 'cron' | 'dicho'>>> => ({
  'descarga-sat': {
    queFalta: t('crons_estado_relojes.la_descarga_masiva_de_facturas_del'),
    quien: t('crons_estado_relojes.lo_destraba_javier_depende_de_un'),
    pasos: [
      t('crons_estado_relojes.cerrar_el_contrato_con_el_proveedor'),
      t('crons_estado_relojes.poner_en_el_servidor_likida_sat'),
      t('crons_estado_relojes.esperar_la_siguiente_pasada_del_reloj'),
    ],
  },
  escalar: {
    queFalta: t('crons_estado_relojes.el_barrido_de_citas_no_corre'),
    quien: t('crons_estado_relojes.lo_destraba_javier_necesita_una_cuenta'),
    pasos: [
      t('crons_estado_relojes.crear_la_llave_de_api_y'),
      t('crons_estado_relojes.ponerlos_en_el_servidor_calcom_api'),
      t('crons_estado_relojes.esperar_la_siguiente_pasada_del_reloj_2'),
    ],
  },
});

/**
 * La guía de arreglo de un reloj con corrida PARCIAL por falta de configuración. Los dos conocidos (Descarga del SAT y Escalamientos y
 * citas) traen pasos propios; cualquier otro hueco declarado trae lo genérico y lo que el propio reloj dijo. `null` = no hay nada que
 * arreglar (o no es un hueco de configuración: una avería no se disfraza de «falta configurar»).
 */
export function guiaDeArreglo(cron: CronId, l: LatidoDetallado, t: TSistema = T_SISTEMA_ES): GuiaArreglo | null {
  if (l.ultimoEstado !== 'parcial' || !esHuecoDeConfiguracion(l.detalle)) return null;
  const dicho = typeof l.detalle.motivo === 'string' && l.detalle.motivo.trim() !== '' ? l.detalle.motivo : null;
  const propia = guias(t)[cron];
  if (propia) return { cron, ...propia, dicho };
  return {
    cron,
    queFalta: t('crons_estado_relojes.no_puede_hacer_su_trabajo_le', { nombreReloj: nombreReloj(t)[cron] }),
    quien: t('crons_estado_relojes.lo_destraba_quien_administra_el_servidor'),
    pasos: [t('crons_estado_relojes.poner_la_variable_o_la_credencial')],
    dicho,
  };
}

export { CRONS };
