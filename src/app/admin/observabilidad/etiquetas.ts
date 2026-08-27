/**
 * El nombre de cada interruptor (0110) como se enseña en pantalla — lo usan
 * la sección de Interruptores de /admin/observabilidad y el ⌘K.
 *
 * Módulo plano SIN 'use client' a propósito (mismo criterio que rutas.ts):
 * lo consumen Server y Client Components. No puede importar el catálogo de
 * `agentes/notificaciones.ts` (arrastra supabaseAdmin al bundle del cliente),
 * así que los nombres se repiten aquí — la prueba de dominio vive en la base
 * (CHECK de la 0110) y en `INTERRUPTORES` (interruptores.ts), no en este mapa:
 * un id que falte aquí se pinta crudo, visible, no roto.
 */
export const ETIQUETA_INTERRUPTOR: Record<string, string> = {
  'global': 'TODO el sistema (global)',
  'agente:liquidacion': 'Agente de Liquidación',
  'agente:facturas': 'Agente de Facturas',
  'agente:cobranza': 'Agente de Cobranza',
  'agente:conductores': 'Agente de Conductores',
  'agente:peajes': 'Agente de Peajes',
  'agente:proveedores': 'Agente de Proveedores',
  'agente:ventas': 'Agente de Ventas',
  'agente:redactor': 'Redactor de Primer Contacto',
  'agente:kpi_whatsapp': 'KPI a WhatsApp (hoy por correo)',
  'agente:desempeno_startup': 'Desempeño de la startup',
  'agente:orquestador': 'Orquestador 80/20',
  'agente:orquestador_semanal': 'Orquestador semanal del ciclo',
  // Éxito del cliente (0218) — los seis que vigilan a la flota ya firmada.
  'agente:onboarding_cliente': 'Onboarding del cliente',
  'agente:exito_cliente': 'Éxito del cliente',
  'agente:retencion': 'Retención',
  'agente:cobranza_saas': 'Cobranza SaaS (mensualidades de Likida)',
  'agente:soporte': 'Soporte (SLA de tickets)',
  'agente:atencion_faq': 'Atención y FAQ (borradores de ticket)',
};

export function etiquetaInterruptor(id: string): string {
  return ETIQUETA_INTERRUPTOR[id] ?? id;
}
