import { type TSistema, T_SISTEMA_ES } from '@/lib/i18n/sistema_tr';
// Las acciones de la bitácora en palabras de la oficina. La clave (`flota.creada`, `usuario.rol_cambiado`) es del sistema: aquí se
// traduce por dominio y, lo que no se conoce, se vuelve legible sin inventar nada (nunca se oculta la acción).

const dominioTr = (t: TSistema = T_SISTEMA_ES): Record<string, string> => ({
  admin_wa: t('bitacora_etiquetas.whatsapp_del_equipo'),
  agente: t('observabilidad.agente'),
  app_user: t('bitacora_etiquetas.persona'),
  autofactura: t('bitacora_etiquetas.autofactura'),
  buzon: t('bitacora_etiquetas.buzon_de_facturas'),
  campana: t('bitacora_etiquetas.campana'),
  ccp: t('bitacora_etiquetas.carta_porte'),
  cobranza: t('bitacora_etiquetas.cobranza'),
  cola: t('bitacora_etiquetas.cola_de_aprobacion'),
  conductor: t('bitacora_etiquetas.conductor'),
  empresa: t('vendedores_formas.empresa'),
  facturacion: t('bitacora_etiquetas.facturacion'),
  factura: t('bitacora_etiquetas.factura'),
  facturas: t('bitacora_etiquetas.facturas'),
  flota: t('observabilidad.flota'),
  gps: 'GPS',
  gasto: t('corridas.gasto'),
  impersonacion: t('bitacora_etiquetas.ver_como_una_flota'),
  interruptor: t('bitacora_etiquetas.interruptor'),
  jornada: t('bitacora_etiquetas.jornada'),
  marketing: t('bitacora_etiquetas.estudio_de_marketing'),
  mcp: t('bitacora_etiquetas.conexion_de_ia'),
  mensualidad: t('bitacora_etiquetas.mensualidad'),
  operador: t('bitacora_etiquetas.operador'),
  pago: t('bitacora_etiquetas.pago'),
  plan: t('bitacora_etiquetas.plan'),
  portal_pago: t('bitacora_etiquetas.portal_de_pago'),
  portal_relogin: t('bitacora_etiquetas.reconexion_de_portal'),
  prospectos: t('mapa_prospectos_cerebro.prospectos'),
  regla: t('bitacora_etiquetas.regla_de_vigilancia'),
  runner: t('crons_estado_relojes.corrida_de_agentes'),
  sat_descarga: t('crons_estado_relojes.descarga_del_sat'),
  soporte: t('bitacora_etiquetas.soporte'),
  suscripcion: t('bitacora_etiquetas.suscripcion'),
  techo_ia: t('bitacora_etiquetas.techo_de_ia'),
  tenant: t('observabilidad.flota'),
  terminal: t('bitacora_etiquetas.patio'),
  ticket: t('qa_banco_verdad.ticket'),
  timbre: t('bitacora_etiquetas.timbrado'),
  unidad: t('bitacora_etiquetas.unidad'),
  usuario: t('bitacora_etiquetas.usuario'),
  vigia: t('bitacora_etiquetas.vigia'),
});

/** `usuario.rol_cambiado` → «Usuario · rol cambiado». Una clave sin punto se muestra tal cual, legible. */
export function etiquetaAccion(accion: string, t: TSistema = T_SISTEMA_ES): string {
  const [cabeza, ...resto] = accion.split('.');
  const legible = (s: string) => s.replace(/[_:]+/g, ' ').trim();
  if (resto.length === 0) return legible(cabeza).replace(/^./, (c) => c.toUpperCase());
  const dominio = dominioTr(t)[cabeza] ?? legible(cabeza).replace(/^./, (c) => c.toUpperCase());
  return `${dominio} · ${legible(resto.join(' '))}`;
}

const entidadTr = (t: TSistema = T_SISTEMA_ES): Record<string, string> => ({
  tenant: t('observabilidad.flota'), app_user: t('bitacora_etiquetas.persona'), operador: t('bitacora_etiquetas.operador'), viaje: t('bitacora_etiquetas.viaje'), gasto: t('corridas.gasto'), cliente: t('bitacora_etiquetas.cliente'), tarifa: t('bitacora_etiquetas.tarifa'),
  factura_emitida: t('bitacora_etiquetas.factura_emitida'), pago_recibido: t('bitacora_etiquetas.pago_recibido'), conector_credencial: t('bitacora_etiquetas.conexion'), tenant_api_key: t('bitacora_etiquetas.llave_de_api'),
  campana: t('bitacora_etiquetas.campana'), agente_definicion: t('observabilidad.agente'), cola_aprobacion: t('bitacora_etiquetas.pieza_por_aprobar'), interruptor: t('bitacora_etiquetas.interruptor'), runner: t('crons_estado_relojes.corrida_de_agentes'),
  plan: t('bitacora_etiquetas.plan'), suscripcion: t('bitacora_etiquetas.suscripcion'), factura_saas: t('bitacora_etiquetas.mensualidad'), ticket_soporte: t('bitacora_etiquetas.ticket_de_soporte'), unidad: t('bitacora_etiquetas.unidad'),
});

/** La entidad tocada, en palabras. `null` = la acción no apuntó a una cosa concreta. */
export function etiquetaEntidad(entidad: string | null, t: TSistema = T_SISTEMA_ES): string {
  if (!entidad) return '—';
  return entidadTr(t)[entidad] ?? entidad.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

export const rotuloTipoAcceso = (t: TSistema = T_SISTEMA_ES): Record<'lectura' | 'descarga' | 'ver_como', string> => ({
  lectura: t('bitacora_etiquetas.lectura_de_pantalla'),
  descarga: t('bitacora_etiquetas.descarga'),
  ver_como: t('bitacora_etiquetas.ver_como_la_flota'),
});
export const ROTULO_TIPO_ACCESO = rotuloTipoAcceso();
