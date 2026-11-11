// Las acciones de la bitácora en palabras de la oficina. La clave (`flota.creada`, `usuario.rol_cambiado`) es del sistema: aquí se
// traduce por dominio y, lo que no se conoce, se vuelve legible sin inventar nada (nunca se oculta la acción).

const DOMINIO: Record<string, string> = {
  admin_wa: 'WhatsApp del equipo',
  agente: 'Agente',
  app_user: 'Persona',
  autofactura: 'Autofactura',
  buzon: 'Buzón de facturas',
  campana: 'Campaña',
  ccp: 'Carta Porte',
  cobranza: 'Cobranza',
  cola: 'Cola de aprobación',
  conductor: 'Conductor',
  empresa: 'Empresa',
  facturacion: 'Facturación',
  factura: 'Factura',
  facturas: 'Facturas',
  flota: 'Flota',
  gps: 'GPS',
  gasto: 'Gasto',
  impersonacion: 'Ver como una flota',
  interruptor: 'Interruptor',
  jornada: 'Jornada',
  marketing: 'Estudio de marketing',
  mcp: 'Conexión de IA',
  mensualidad: 'Mensualidad',
  operador: 'Operador',
  pago: 'Pago',
  plan: 'Plan',
  portal_pago: 'Portal de pago',
  portal_relogin: 'Reconexión de portal',
  prospectos: 'Prospectos',
  regla: 'Regla de vigilancia',
  runner: 'Corrida de agentes',
  sat_descarga: 'Descarga del SAT',
  soporte: 'Soporte',
  suscripcion: 'Suscripción',
  techo_ia: 'Techo de IA',
  tenant: 'Flota',
  terminal: 'Patio',
  ticket: 'Ticket',
  timbre: 'Timbrado',
  unidad: 'Unidad',
  usuario: 'Usuario',
  vigia: 'Vigía',
};

/** `usuario.rol_cambiado` → «Usuario · rol cambiado». Una clave sin punto se muestra tal cual, legible. */
export function etiquetaAccion(accion: string): string {
  const [cabeza, ...resto] = accion.split('.');
  const legible = (t: string) => t.replace(/[_:]+/g, ' ').trim();
  if (resto.length === 0) return legible(cabeza).replace(/^./, (c) => c.toUpperCase());
  const dominio = DOMINIO[cabeza] ?? legible(cabeza).replace(/^./, (c) => c.toUpperCase());
  return `${dominio} · ${legible(resto.join(' '))}`;
}

const ENTIDAD: Record<string, string> = {
  tenant: 'Flota', app_user: 'Persona', operador: 'Operador', viaje: 'Viaje', gasto: 'Gasto', cliente: 'Cliente', tarifa: 'Tarifa',
  factura_emitida: 'Factura emitida', pago_recibido: 'Pago recibido', conector_credencial: 'Conexión', tenant_api_key: 'Llave de API',
  campana: 'Campaña', agente_definicion: 'Agente', cola_aprobacion: 'Pieza por aprobar', interruptor: 'Interruptor', runner: 'Corrida de agentes',
  plan: 'Plan', suscripcion: 'Suscripción', factura_saas: 'Mensualidad', ticket_soporte: 'Ticket de soporte', unidad: 'Unidad',
};

/** La entidad tocada, en palabras. `null` = la acción no apuntó a una cosa concreta. */
export function etiquetaEntidad(entidad: string | null): string {
  if (!entidad) return '—';
  return ENTIDAD[entidad] ?? entidad.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

export const ROTULO_TIPO_ACCESO: Record<'lectura' | 'descarga' | 'ver_como', string> = {
  lectura: 'Lectura de pantalla',
  descarga: 'Descarga',
  ver_como: 'Ver como la flota',
};
