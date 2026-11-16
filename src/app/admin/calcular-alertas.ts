import type { ResumenNegocio, ConversacionActiva } from '@/lib/admin/negocio';
import type { ConteosEscalaciones } from '@/lib/admin/escalaciones';
import { NOMBRE_FUENTE } from '@/lib/admin/escalaciones';
import { tenantDemo } from '@/lib/auth/tenant-demo';
import type { TrDe } from '@/lib/i18n/tr_tipos';
import { trAdminInicioEs } from '@/lib/i18n/tr_admin';

export interface Alerta {
  tipo: 'ok' | 'atencion';
  texto: string;
  /** A dónde lleva la alerta — la fila de /admin/notificaciones lo pinta
   *  como "Ver". Las de escalación llevan TODAS a /admin/escalaciones: la
   *  bandeja es donde se destraban, no cada pantalla por separado. */
  href?: string;
}

type Tr = TrDe<'admin_inicio'>;

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
  /** `null` = el resumen del negocio no se pudo leer (A37-S07-07): se omiten
   *  las señales que dependen de él en vez de inventarlas. */
  r: ResumenNegocio | null,
  conversaciones: ConversacionActiva[],
  escalaciones: ConteosEscalaciones,
  /** FE-9: cuántas conversaciones hay DE VERDAD (`contarConversacionesActivas`).
   *  `conversaciones` es la página de 20 más recientes, así que la alerta
   *  decía "20 conversación(es) con actividad reciente" hubiera 21 o 4,000.
   *  `null`/omitido = no se pudo contar, y la alerta cae al tamaño de la
   *  página diciéndolo. */
  conversacionesTotal: number | null = null,
  /** Traductor de `admin_inicio`; sin él, español (los llamadores y pruebas existentes no cambian). */
  t: Tr = trAdminInicioEs,
): Alerta[] {
  const alertas: Alerta[] = [];
  const e = escalaciones;

  // ── Escalaciones — todo lo que espera a un humano, primero ─────────────
  if (e.arco !== null && e.arco > 0) {
    alertas.push({
      tipo: 'atencion',
      texto: t(e.arco === 1 ? 'raiz7.alerta_arco.uno' : 'raiz7.alerta_arco.otros', { n: e.arco }),
      href: '/admin/escalaciones',
    });
  }
  if (e.corridasFallo !== null && e.corridasFallo > 0) {
    alertas.push({
      tipo: 'atencion',
      texto: t(e.corridasFallo === 1 ? 'raiz7.alerta_corrida.uno' : 'raiz7.alerta_corrida.otros', { n: e.corridasFallo }),
      href: '/admin/escalaciones',
    });
  }
  if (e.talachas !== null && e.talachas > 0) {
    alertas.push({
      tipo: 'atencion',
      texto: t(e.talachas === 1 ? 'raiz7.alerta_talacha.uno' : 'raiz7.alerta_talacha.otros', { n: e.talachas }),
      href: '/admin/escalaciones',
    });
  }
  if (e.facturasProveedor !== null && e.facturasProveedor > 0) {
    alertas.push({
      tipo: 'atencion',
      texto: t(e.facturasProveedor === 1 ? 'raiz7.alerta_factura_prov.uno' : 'raiz7.alerta_factura_prov.otros', { n: e.facturasProveedor }),
      href: '/admin/escalaciones',
    });
  }
  if (e.ticketsAbiertos !== null && e.ticketsAbiertos > 0) {
    // El vencido manda: si hay SLA roto, la alerta lo dice con el número.
    const vencidos = e.ticketsVencidos ?? 0;
    alertas.push({
      tipo: 'atencion',
      texto: vencidos > 0
        ? t(vencidos === 1 ? 'raiz7.alerta_ticket_vencido.uno' : 'raiz7.alerta_ticket_vencido.otros', { n: vencidos, abiertos: e.ticketsAbiertos })
        : t(e.ticketsAbiertos === 1 ? 'raiz7.alerta_ticket_abierto.uno' : 'raiz7.alerta_ticket_abierto.otros', { n: e.ticketsAbiertos }),
      href: '/admin/escalaciones',
    });
  }
  if (e.liquidacionesRevisar !== null && e.liquidacionesRevisar > 0) {
    alertas.push({
      tipo: 'atencion',
      texto: t(e.liquidacionesRevisar === 1 ? 'raiz7.alerta_liquidacion.uno' : 'raiz7.alerta_liquidacion.otros', { n: e.liquidacionesRevisar }),
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
      texto: t('raiz7.alerta_ciegas', { fuentes: ciegas.join(', ') }),
      href: '/admin/escalaciones',
    });
  }

  // ── Las señales de siempre ─────────────────────────────────────────────
  if (r && r.tendenciaCosto !== null && r.tendenciaCosto >= 30) {
    alertas.push({
      tipo: 'atencion',
      texto: t('raiz7.alerta_costo_ia', { pct: r.tendenciaCosto }),
      href: '/admin/costos-facturacion',
    });
  }
  if (conversacionesTotal !== null ? conversacionesTotal > 0 : conversaciones.length > 0) {
    alertas.push({
      tipo: 'ok',
      texto: conversacionesTotal !== null
        ? t('raiz7.alerta_conv_total', { n: conversacionesTotal })
        : t('raiz7.alerta_conv_pagina', { n: conversaciones.length }),
      href: '/admin/conversaciones',
    });
  }
  // AUDITORÍA 24, ADM-5: `r.tenants <= 1` disparaba esta alerta con el
  // PRIMER cliente real dado de alta (el cliente de demo, sin el demo) — 1 tenant,
  // pero NO el demo. El criterio verificable (mismo que `esSoloDemo` en
  // consola.tsx) es que el ÚNICO tenant que hay sea, de verdad, el tenant
  // demo — no que haya como máximo uno.
  const esSoloDemo = r !== null && r.tenants === 1 && r.flotas[0]?.id === tenantDemo();
  if (esSoloDemo) {
    alertas.push({
      tipo: 'atencion',
      texto: t('raiz7.alerta_solo_demo'),
      href: '/admin/flotas',
    });
  }
  return alertas;
}
