import Link from 'next/link';
import { Bell } from 'lucide-react';
import type { ResumenNegocio, ConversacionActiva } from '@/lib/admin/negocio';

export interface Alerta { tipo: 'ok' | 'atencion'; texto: string }

/**
 * Nada de contadores inventados ("14 items waiting"): las alertas se
 * calculan de datos reales — tendencia de costo, conversaciones activas.
 * Vive aquí (no en cada page.tsx que las necesita) para que layout.tsx Y
 * admin/notificaciones/page.tsx usen EXACTAMENTE el mismo cálculo, no dos
 * copias que se puedan desincronizar.
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

/**
 * La campana ya NO abre un dropdown — lleva a /admin/notificaciones, una
 * página real (decisión explícita: "debe de aparecer una página de
 * notificaciones"). Server Component: sin estado propio, solo un Link con
 * el punto rojo si hay algo que de verdad requiere atención.
 */
export default function Notificaciones({ alertas }: { alertas: Alerta[] }) {
  const hayAtencion = alertas.some((a) => a.tipo === 'atencion');

  return (
    <Link href="/admin/notificaciones"
      className="relative w-9 h-9 rounded-lg hairline flex items-center justify-center hover:opacity-70 transition-opacity shrink-0"
      style={{ background: 'var(--surface)' }}>
      <Bell width={16} height={16} strokeWidth={1.75} style={{ color: 'var(--ink)' }} />
      {hayAtencion && (
        <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full" style={{ background: 'var(--color-bad)' }} />
      )}
    </Link>
  );
}
