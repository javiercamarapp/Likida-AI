import { Building2, Inbox, Download, TriangleAlert } from 'lucide-react';
import type { FacturaProveedor } from '@/lib/likida/proveedores';
import { mxn, numero, fechaCorta } from '@/lib/formato';
import { EstadoVacio } from '@/app/admin/ui/kit';
import { BarraPagina } from '../../resumen-visual';
import { SubirFactura, BotonesDecision, type AccionProveedores } from './controles';

/**
 * La ventana del Agente de Proveedores (F6): la bandeja donde el XML del
 * taller espera la decisión de un humano, y el export que sustituye la
 * captura manual en el ERP. El agente prepara y marca (receptor ajeno,
 * duplicados); la persona decide — nunca al revés.
 */
export function VistaAgenteProveedores({ facturas, rfcFlota, sufijo, acciones, notificaciones }: {
  facturas: FacturaProveedor[];
  rfcFlota: string | null;
  sufijo: string;
  acciones: { subirFactura: AccionProveedores; decidir: AccionProveedores };
  /** La sección de Notificaciones, ya renderizada en el servidor
   *  (`SeccionNotificaciones`). Entra como ReactNode y no como datos: esta
   *  vista no debe importar el motor de avisos, que trae `supabaseAdmin`. */
  notificaciones?: React.ReactNode;
}) {
  const pendientes = facturas.filter((f) => f.estado === 'pendiente');
  const aprobadas = facturas.filter((f) => f.estado === 'aprobada');
  const rechazadas = facturas.filter((f) => f.estado === 'rechazada');
  const receptorAjeno = pendientes.filter((f) => f.receptorEsFlota === false).length;

  return (
    <main className="h-full">
      <div className="rounded-2xl min-h-full hairline flex flex-col" style={{ background: 'var(--g1)' }}>
        <BarraPagina
          icono={<Building2 width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />}
          titulo="Agente de Proveedores"
        />
        <div className="px-5 py-5 flex-1 space-y-4">

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Kpi titulo="Esperan tu decisión" valor={numero(pendientes.length)}
              tono={pendientes.length > 0 ? 'warn' : undefined} />
            <Kpi titulo="Aprobadas" valor={numero(aprobadas.length)} nota="listas para el export" />
            <Kpi titulo="Rechazadas" valor={numero(rechazadas.length)} />
            <Kpi titulo="Con receptor ajeno" valor={numero(receptorAjeno)}
              nota="el CFDI no es a tu RFC" tono={receptorAjeno > 0 ? 'bad' : undefined} />
          </div>

          <section className="card p-4">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <h2 className="font-display text-[15px] font-semibold mb-1">Subir factura de proveedor</h2>
                <p className="text-[11px] mb-3" style={{ color: 'var(--faint)' }}>
                  El XML que manda el taller, la refaccionaria o el proveedor de diésel — dato duro
                  del CFDI, sin OCR. {rfcFlota
                    ? <>Se valida contra el RFC de tu flota ({rfcFlota}).</>
                    : <>Tu flota aún no tiene RFC capturado: la validación de receptor queda pendiente y se dice.</>}
                </p>
                <SubirFactura subirFactura={acciones.subirFactura} />
              </div>
              {aprobadas.length > 0 && (
                <a href={`/api/export/facturas-proveedor${sufijo}`}
                  className="hairline inline-flex items-center gap-1.5 text-[12.5px] font-medium px-3 py-1.5 rounded-lg transition-colors hover:bg-[var(--canvas)] shrink-0"
                  style={{ background: 'var(--surface)' }}>
                  <Download width={13} height={13} strokeWidth={1.75} />
                  Exportar aprobadas (CSV para tu ERP)
                </a>
              )}
            </div>
          </section>

          <section className="card p-4">
            <h2 className="font-display text-[15px] font-semibold mb-1">La bandeja</h2>
            <p className="text-[11px] mb-3" style={{ color: 'var(--faint)' }}>
              Pendientes arriba; lo decidido queda con su quién y su cuándo
            </p>
            {facturas.length === 0 ? (
              <EstadoVacio icono={<Inbox width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
                Aún no hay facturas de proveedor — sube el primer XML y aparece aquí
                esperando tu decisión.
              </EstadoVacio>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="text-left" style={{ color: 'var(--faint)' }}>
                      <th className="etiqueta-mono text-[10px] uppercase font-normal pb-2">Fecha</th>
                      <th className="etiqueta-mono text-[10px] uppercase font-normal pb-2">Proveedor (RFC)</th>
                      <th className="etiqueta-mono text-[10px] uppercase font-normal pb-2">Concepto</th>
                      <th className="etiqueta-mono text-[10px] uppercase font-normal pb-2 pr-6 text-right">Total</th>
                      <th className="etiqueta-mono text-[10px] uppercase font-normal pb-2">Estado</th>
                      <th className="etiqueta-mono text-[10px] uppercase font-normal pb-2 text-right pr-1">Decidir</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...pendientes, ...aprobadas, ...rechazadas].map((f) => (
                      <tr key={f.id} className="border-t align-top" style={{ borderColor: 'var(--line2)' }}>
                        <td className="py-2.5" style={{ color: 'var(--muted)' }}>{f.fecha ? fechaCorta(f.fecha) : '—'}</td>
                        <td className="py-2.5">
                          <span className="cifra-mono block">{f.emisorRfc ?? 'sin RFC'}</span>
                          {f.receptorEsFlota === false && (
                            <span className="inline-flex items-center gap-1 text-[11px]" style={{ color: 'var(--bad)' }}>
                              <TriangleAlert width={11} height={11} strokeWidth={2} /> receptor ajeno
                            </span>
                          )}
                          {f.receptorEsFlota === null && (
                            <span className="block text-[11px]" style={{ color: 'var(--faint)' }}>receptor sin validar</span>
                          )}
                        </td>
                        <td className="py-2.5">
                          <span className="block truncate max-w-[26ch]" title={f.descripcion ?? undefined}>
                            {f.descripcion ?? 'sin descripción en el XML'}
                          </span>
                          {f.conceptos > 1 && (
                            <span className="block text-[11px]" style={{ color: 'var(--faint)' }}>
                              y {numero(f.conceptos - 1)} concepto{f.conceptos - 1 === 1 ? '' : 's'} más
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 pr-6 text-right cifra-mono">{mxn(f.total)}</td>
                        <td className="py-2.5"><PillEstado f={f} /></td>
                        <td className="py-2.5 pl-3 text-right">
                          {f.estado === 'pendiente'
                            ? <BotonesDecision facturaId={f.id} decidir={acciones.decidir} />
                            : <span className="text-[11px]" style={{ color: 'var(--faint)' }}>
                                {f.decididoPor ?? '—'}{f.decididoEn ? ` · ${fechaCorta(f.decididoEn)}` : ''}
                              </span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <p className="text-[11px]" style={{ color: 'var(--faint)' }}>
            El export CSV usa el layout genérico importable a SAP Business One y CONTPAQi. La
            escritura directa a SAP B1 se diseña con las credenciales del cliente — este agente
            no la promete antes de tenerlas.
          </p>

          {notificaciones}
        </div>
      </div>
    </main>
  );
}

function PillEstado({ f }: { f: FacturaProveedor }) {
  const cfg = f.estado === 'aprobada'
    ? { rotulo: 'Aprobada', fg: 'var(--ok)', bg: 'var(--okbg)' }
    : f.estado === 'rechazada'
      ? { rotulo: 'Rechazada', fg: 'var(--muted)', bg: 'var(--canvas)' }
      : { rotulo: 'Pendiente', fg: 'var(--warn)', bg: 'var(--warnbg)' };
  return (
    <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium"
      style={{ color: cfg.fg, background: cfg.bg }}>{cfg.rotulo}</span>
  );
}

function Kpi({ titulo, valor, nota, tono }: { titulo: string; valor: string; nota?: string; tono?: 'warn' | 'bad' }) {
  return (
    <div className="card p-3.5">
      <div className="etiqueta-mono text-[10px] uppercase" style={{ color: 'var(--faint)' }}>{titulo}</div>
      <div className="cifra-mono text-[20px] font-medium mt-1"
        style={tono ? { color: `var(--${tono})` } : undefined}>{valor}</div>
      {nota && <div className="text-[11px] mt-0.5" style={{ color: 'var(--faint)' }}>{nota}</div>}
    </div>
  );
}
