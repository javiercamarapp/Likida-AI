import type { ResumenNegocio, ConversacionActiva } from '@/lib/admin/negocio';
import type { ConteosEscalaciones } from '@/lib/admin/escalaciones';
import { NOMBRE_FUENTE } from '@/lib/admin/escalaciones';
import { tenantDemo } from '@/lib/auth/tenant-demo';

export interface Alerta {
  tipo: 'ok' | 'atencion';
  texto: string;
  /** A dónde lleva la alerta — la fila de /admin/notificaciones lo pinta
   *  como "Ver". Las de escalación llevan TODAS a /admin/escalaciones: la
   *  bandeja es donde se destraban, no cada pantalla por separado. */
  href?: string;
}

/** "3 talachas" / "1 talacha" sin duplicar el ternario en cada alerta. */
const n = (cuenta: number, singular: string, plural: string) =>
  `${cuenta} ${cuenta === 1 ? singular : plural}`;

/**
 * Nada de contadores inventados ("14 items waiting"): las alertas se
 * calculan de datos reales — tendencia de costo, conversaciones activas y
 * los conteos de la bandeja de escalaciones. Los conteos LLEGAN COMO
 * PARÁMETRO ya resueltos (salen de `getBandejaEscalaciones`, las MISMAS
 * lecturas que pinta /admin/escalaciones): esta función no consulta nada,
 * para que la campana y la bandeja no puedan contar distinto.
 *
 * Vive en su propio archivo (no dentro de `notificaciones.tsx`, que es
 * 'use client' por el estado de leídas) para que tanto la consola (Server
 * Component) como la campana y la lista (Client Components) usen
 * EXACTAMENTE el mismo cálculo.
 *
 * Un conteo en `null` significa "esa fuente no se pudo leer" — y se AVISA,
 * porque una campana callada sobre una fuente ciega afirmaría "no hay nada".
 */
export function calcularAlertas(
  r: ResumenNegocio,
  conversaciones: ConversacionActiva[],
  escalaciones: ConteosEscalaciones,
  /** FE-9: cuántas conversaciones hay DE VERDAD (`contarConversacionesActivas`).
   *  `conversaciones` es la página de 20 más recientes, así que la alerta
   *  decía "20 conversación(es) con actividad reciente" hubiera 21 o 4,000.
   *  `null`/omitido = no se pudo contar, y la alerta cae al tamaño de la
   *  página diciéndolo. */
  conversacionesTotal: number | null = null,
): Alerta[] {
  const alertas: Alerta[] = [];
  const e = escalaciones;

  // ── Escalaciones — todo lo que espera a un humano, primero ─────────────
  if (e.arco !== null && e.arco > 0) {
    alertas.push({
      tipo: 'atencion',
      texto: `${n(e.arco, 'solicitud ARCO espera', 'solicitudes ARCO esperan')} respuesta (plazo legal de 20 días hábiles).`,
      href: '/admin/escalaciones',
    });
  }
  if (e.corridasFallo !== null && e.corridasFallo > 0) {
    alertas.push({
      tipo: 'atencion',
      texto: `${n(e.corridasFallo, 'corrida de agente terminó', 'corridas de agentes terminaron')} en fallo.`,
      href: '/admin/escalaciones',
    });
  }
  if (e.talachas !== null && e.talachas > 0) {
    alertas.push({
      tipo: 'atencion',
      texto: `${n(e.talachas, 'talacha espera', 'talachas esperan')} la autorización del jefe.`,
      href: '/admin/escalaciones',
    });
  }
  if (e.facturasProveedor !== null && e.facturasProveedor > 0) {
    alertas.push({
      tipo: 'atencion',
      texto: `${n(e.facturasProveedor, 'factura de proveedor espera', 'facturas de proveedor esperan')} decisión humana.`,
      href: '/admin/escalaciones',
    });
  }
  if (e.ticketsAbiertos !== null && e.ticketsAbiertos > 0) {
    // El vencido manda: si hay SLA roto, la alerta lo dice con el número.
    const vencidos = e.ticketsVencidos ?? 0;
    alertas.push({
      tipo: 'atencion',
      texto: vencidos > 0
        ? `${n(vencidos, 'ticket de soporte tiene', 'tickets de soporte tienen')} el SLA vencido (${e.ticketsAbiertos} abiertos en total).`
        : `${n(e.ticketsAbiertos, 'ticket de soporte abierto', 'tickets de soporte abiertos')}.`,
      href: '/admin/escalaciones',
    });
  }
  if (e.liquidacionesRevisar !== null && e.liquidacionesRevisar > 0) {
    alertas.push({
      tipo: 'atencion',
      texto: `${n(e.liquidacionesRevisar, 'liquidación espera', 'liquidaciones esperan')} revisión humana en la bandeja.`,
      href: '/admin/escalaciones',
    });
  }
  // NULL ≠ 0: una fuente ilegible se dice, no se calla — la campana ciega
  // que no avisa que está ciega es la campana que miente.
  const ciegas = (
    [
      ['arco', e.arco], ['corridas', e.corridasFallo], ['talachas', e.talachas],
      ['facturas_proveedor', e.facturasProveedor], ['tickets', e.ticketsAbiertos],
      ['liquidaciones', e.liquidacionesRevisar],
    ] as const
  ).filter(([, v]) => v === null).map(([id]) => NOMBRE_FUENTE[id]);
  if (ciegas.length > 0) {
    alertas.push({
      tipo: 'atencion',
      texto: `No se pudo leer: ${ciegas.join(', ')} — ahí puede haber pendientes que la campana no está viendo.`,
      href: '/admin/escalaciones',
    });
  }

  // ── Las señales de siempre ─────────────────────────────────────────────
  if (r.tendenciaCosto !== null && r.tendenciaCosto >= 30) {
    alertas.push({
      tipo: 'atencion',
      texto: `El costo de IA subió ${r.tendenciaCosto}% esta semana vs la anterior.`,
      href: '/admin/costos-facturacion',
    });
  }
  if (conversacionesTotal !== null ? conversacionesTotal > 0 : conversaciones.length > 0) {
    alertas.push({
      tipo: 'ok',
      texto: conversacionesTotal !== null
        ? `${conversacionesTotal} conversación(es) de WhatsApp abiertas.`
        : `Al menos ${conversaciones.length} conversación(es) de WhatsApp con actividad reciente (no se pudo contar el total).`,
      href: '/admin/conversaciones',
    });
  }
  // AUDITORÍA 24, ADM-5: `r.tenants <= 1` disparaba esta alerta con el
  // PRIMER cliente real dado de alta (Innovativos, sin el demo) — 1 tenant,
  // pero NO el demo. El criterio verificable (mismo que `esSoloDemo` en
  // consola.tsx) es que el ÚNICO tenant que hay sea, de verdad, el tenant
  // demo — no que haya como máximo uno.
  const esSoloDemo = r.tenants === 1 && r.flotas[0]?.id === tenantDemo();
  if (esSoloDemo) {
    alertas.push({
      tipo: 'atencion',
      texto: 'Likida sigue con solo el tenant demo — sin clientes reales dados de alta.',
      href: '/admin/flotas',
    });
  }
  return alertas;
}
