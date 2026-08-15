import Link from 'next/link';
import { Receipt } from 'lucide-react';
import { BarraPagina, TituloSeccion } from '../../dashboard/resumen-visual';
import { EstadoVacio } from '../ui/kit';

export const dynamic = 'force-dynamic';

/**
 * Cobranza / Facturas — Likida cobrando a SUS clientes (no confundir con
 * `gasto`: los comprobantes de gasto de un viaje son recibos del conductor,
 * un concepto totalmente distinto).
 *
 * AUDITORÍA 14-ago: esta página abría afirmando "no existe tabla de
 * facturación/Stripe, ni de dunning" — FALSO. `planes`, `suscripcion` y
 * `factura_saas` existen (mig. 0057) y Costos & Facturación ya emite la
 * mensualidad, concilia el pago contra el banco y timbra el CFDI. Lo que de
 * verdad NO existe es el dunning automático — y con cero suscripciones
 * activas, tampoco hay cartera vencida que perseguir. La página lo dice
 * como es y linkea a donde la operación de cobro ya vive.
 */
export default function CobranzaPage() {
  const porVenir = [
    'Recordatorios automáticos de facturas vencidas (dunning)',
    'DSO (días de cobro)',
    'Tasa de recuperación de vencidos',
    'Recordatorios enviados vs. pagos gatillados',
  ];

  return (
    <main className="h-full">
      <div className="rounded-2xl overflow-hidden min-h-full flex flex-col hairline" style={{ background: 'var(--g1)' }}>
        <BarraPagina
          icono={<Receipt width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />}
          titulo="Cobranza / Facturas"
        />

        <div className="px-5 py-5 flex-1 space-y-2.5">
          <EstadoVacio icono={<Receipt width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
            <span className="font-semibold">La operación de cobro ya vive en otra página.</span>{' '}
            Emitir la mensualidad de una flota, marcarla pagada contra el estado de cuenta del banco y
            timbrar su CFDI se hace en{' '}
            <Link href="/admin/costos-facturacion" className="underline font-medium">Costos &amp; Facturación</Link>
            {' '}— las tablas existen (planes, suscripción y factura_saas) y esa pantalla ya escribe en ellas.
            Lo que Likida <span className="font-semibold">no</span> tiene es dunning automático: nadie le
            recuerda sola una factura vencida a una flota. Y como hoy no hay una sola suscripción activa
            (Likida no cobra a ningún cliente todavía), tampoco hay cartera vencida que perseguir.
          </EstadoVacio>

          <div className="card p-4">
            <TituloSeccion>Qué va a mostrar esta página cuando exista el dunning</TituloSeccion>
            <ul className="space-y-2 text-sm mt-3">
              {porVenir.map((item) => (
                <li key={item} className="flex items-start gap-2.5">
                  <span className="w-1 h-1 rounded-full mt-2 shrink-0" style={{ background: 'var(--muted)' }} />
                  <span style={{ color: 'var(--muted)' }}>{item}</span>
                </li>
              ))}
            </ul>
            <p className="text-xs mt-3" style={{ color: 'var(--muted)' }}>
              El monto facturado, el cobrado y las facturas por estatus ya se pueden ver hoy en la sección
              &quot;Por cobrar&quot; de Costos &amp; Facturación — aquí solo se duplicarían.
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
