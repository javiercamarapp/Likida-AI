import type { ResumenNegocio, ConversacionActiva } from '@/lib/admin/negocio';

export interface Alerta { tipo: 'ok' | 'atencion'; texto: string }

/**
 * Nada de contadores inventados ("14 items waiting"): las alertas se
 * calculan de datos reales — tendencia de costo, conversaciones activas.
 * Vive en su propio archivo (no dentro de `notificaciones.tsx`, que ahora
 * es 'use client' por el estado de leídas) para que tanto `layout.tsx`
 * (Server Component) como la campana y la lista (Client Components) usen
 * EXACTAMENTE el mismo cálculo, sin arrastrar una directiva 'use client'
 * a un archivo que no necesita React en absoluto.
 */
export function calcularAlertas(r: ResumenNegocio, conversaciones: ConversacionActiva[]): Alerta[] {
  const alertas: Alerta[] = [];
  if (r.tendenciaCosto !== null && r.tendenciaCosto >= 30) {
    alertas.push({ tipo: 'atencion', texto: `El costo de IA subió ${r.tendenciaCosto}% esta semana vs la anterior.` });
  }
  if (conversaciones.length > 0) {
    alertas.push({ tipo: 'ok', texto: `${conversaciones.length} conversación(es) de WhatsApp con actividad reciente.` });
  }
  if (r.tenants <= 1) {
    alertas.push({ tipo: 'atencion', texto: 'Likida sigue con solo el tenant demo — sin clientes reales dados de alta.' });
  }
  return alertas;
}
