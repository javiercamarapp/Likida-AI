import { ExternalLink, TriangleAlert, ReceiptText } from 'lucide-react';
import { EstadoVacio, StatusPill } from '../../admin/ui/kit';
import { mxn } from '@/lib/utils';
import { fechaMx } from '../formato';
import type { TicketPorFacturar } from '@/lib/likida/facturacion/pendientes';

// ═══════════════════════════════════════════════════════════════════════════
// LOS TICKETS QUE TODAVÍA NO TIENEN FACTURA — y cuánto les queda.
//
// Un gasto sin CFDI no es deducible: el dinero ya salió de la flota y el IVA se
// pierde. Y el ticket CADUCA — las gasolineras dan 7-15 días y la mayoría no
// factura pasado el mes natural. Para una flota que liquida por quincena, el
// ticket del día 2 puede estar vencido cuando la oficina cierra el día 16.
//
// LO QUE ESTA PANTALLA ORDENA POR: urgencia, no por fecha. Lo que vence primero
// va arriba, porque es lo único que todavía se puede salvar. Lo vencido se
// enseña igual —para que se vea cuánto se está perdiendo— pero al final.
//
// EL MONTO SOLO PARA QUIEN VE DINERO. Esta pantalla es de área `operacion` y el
// encargado entra: puede perseguir facturas sin ver cuánto cuestan.
// ═══════════════════════════════════════════════════════════════════════════

function Reloj({ t }: { t: TicketPorFacturar }) {
  const c = t.caducidad;
  if (c.desconocido) return <StatusPill estado="neutral">Sin fecha legible</StatusPill>;
  if (c.vencido) return <StatusPill estado="bad">Vencido</StatusPill>;
  if (c.urgente) return <StatusPill estado="bad">{c.diasRestantes === 0 ? 'Vence hoy' : `${c.diasRestantes} día(s)`}</StatusPill>;
  return <StatusPill estado={c.diasRestantes <= 7 ? 'warn' : 'ok'}>{c.diasRestantes} días</StatusPill>;
}

export function PorFacturar({
  tickets, resumen: r, veDinero,
}: {
  tickets: TicketPorFacturar[];
  resumen: { total: number; vencidos: number; urgentes: number; sinComercio: number; montoTotal: number; montoVencido: number };
  veDinero: boolean;
}) {
  if (tickets.length === 0) {
    return (
      <EstadoVacio icono={<ReceiptText width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
        Todos los comprobantes ya tienen su CFDI. Cuando entre uno sin factura aparece aquí, con el plazo que le queda.
      </EstadoVacio>
    );
  }

  // Lo que urge primero. Lo vencido al final: ya no se puede hacer nada, pero se
  // enseña para que se vea el tamaño de lo que se está perdiendo.
  const orden = [...tickets].sort((a, b) => {
    if (a.caducidad.vencido !== b.caducidad.vencido) return a.caducidad.vencido ? 1 : -1;
    if (a.caducidad.desconocido !== b.caducidad.desconocido) return a.caducidad.desconocido ? 1 : -1;
    return a.caducidad.diasRestantes - b.caducidad.diasRestantes;
  });

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <StatusPill estado="warn">{r.total} sin factura</StatusPill>
        {r.urgentes > 0 && <StatusPill estado="bad">{r.urgentes} urgen</StatusPill>}
        {r.vencidos > 0 && <StatusPill estado="bad">{r.vencidos} vencidos</StatusPill>}
        {r.sinComercio > 0 && <StatusPill estado="neutral">{r.sinComercio} sin portal identificado</StatusPill>}
      </div>

      {veDinero && r.montoVencido > 0 && (
        <div className="flex items-start gap-2.5 text-sm rounded-lg px-3 py-2.5 mb-3"
          style={{ background: 'var(--badbg)', color: 'var(--bad)' }}>
          <TriangleAlert width={16} height={16} strokeWidth={2} className="shrink-0 mt-0.5" />
          <span>
            <strong>{mxn(r.montoVencido)}</strong> en comprobantes que ya no se pueden facturar. Ese gasto dejó de ser
            deducible y su IVA no se recupera.
          </span>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr style={{ color: 'var(--muted)' }} className="text-left">
              <th className="py-2.5 pr-4 font-medium">Plazo</th>
              <th className="py-2.5 pr-4 font-medium">Concepto</th>
              <th className="py-2.5 pr-4 font-medium">Fecha</th>
              {veDinero && <th className="py-2.5 pr-4 font-medium text-right">Importe</th>}
              <th className="py-2.5 pr-4 font-medium">Dónde se factura</th>
              <th className="py-2.5 font-medium">Qué pide el portal</th>
            </tr>
          </thead>
          <tbody>
            {orden.map((t) => (
              <tr key={t.gastoId} className="border-t align-top" style={{ borderColor: 'var(--line)' }}>
                <td className="py-2.5 pr-4"><Reloj t={t} /></td>
                <td className="py-2.5 pr-4 font-medium">{t.concepto}</td>
                <td className="py-2.5 pr-4" style={{ color: 'var(--muted)' }}>{fechaMx(t.fecha)}</td>
                {veDinero && <td className="py-2.5 pr-4 text-right tabular">{mxn(t.monto)}</td>}
                <td className="py-2.5 pr-4">
                  {t.comercio ? (
                    <>
                      <a href={t.comercio.portal} target="_blank" rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 underline">
                        {t.comercio.nombre.slice(0, 28)}
                        <ExternalLink width={11} height={11} strokeWidth={2} />
                      </a>
                      {t.comercio.requiereCuenta && (
                        <span className="block text-xs" style={{ color: 'var(--muted)' }}>pide cuenta</span>
                      )}
                      {!t.plazoVerificado && (
                        <span className="block text-xs" style={{ color: 'var(--faint)' }}>plazo sin verificar</span>
                      )}
                    </>
                  ) : t.urlTicket ? (
                    // Se leyó una liga pero no se reconoce el comercio: se enseña
                    // la liga tal cual en vez de callarla. Es lo único que hay.
                    <a href={t.urlTicket} target="_blank" rel="noopener noreferrer" className="underline text-xs break-all">
                      {t.urlTicket.replace(/^https?:\/\//, '').slice(0, 30)}
                    </a>
                  ) : (
                    <span style={{ color: 'var(--muted)' }}>Sin liga en el ticket</span>
                  )}
                </td>
                <td className="py-2.5">
                  {t.camposPendientes ? (
                    <span className="text-xs" style={{ color: 'var(--muted)' }}>
                      Portal conocido, campos sin leer todavía
                    </span>
                  ) : t.campos.length === 0 ? (
                    <span className="text-xs" style={{ color: 'var(--muted)' }}>—</span>
                  ) : (
                    <div className="flex flex-col gap-0.5">
                      {t.campos.map((c) => (
                        <span key={c.clave} className="text-xs">
                          <span style={{ color: 'var(--muted)' }}>{c.etiqueta}:</span>{' '}
                          {c.valor
                            ? <span className="font-mono">{c.valor}</span>
                            : <span style={{ color: 'var(--warn)' }}>búscalo en el papel</span>}
                        </span>
                      ))}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs mt-3" style={{ color: 'var(--muted)' }}>
        Los datos de arriba salieron del ticket. Los del receptor —RFC, razón social, código postal, régimen y uso de
        CFDI— son los mismos de tu flota en todos los portales y están en Configuración. Un campo que dice
        &quot;búscalo en el papel&quot; es uno que no se pudo leer: preferimos dejarlo vacío a llenarlo con algo
        parecido que el portal rechace.
      </p>
    </>
  );
}
