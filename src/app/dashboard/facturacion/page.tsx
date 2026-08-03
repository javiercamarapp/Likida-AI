import { FileText, ShieldCheck, ShieldAlert, Receipt } from 'lucide-react';
import { getDocumentos, getAcreditables, type DocumentoRow, type Acreditables } from '@/lib/cuadra/analytics';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { KpiTile, EstadoVacio } from '../../admin/ui/kit';

export const dynamic = 'force-dynamic';

async function safe<T>(fn: () => Promise<T>): Promise<T | null> {
  try { return await fn(); } catch { return null; }
}

/**
 * Facturación (PASO 19) — y aquí hay que ser claro sobre QUÉ facturación.
 *
 * Likida procesa los CFDI que la flota RECIBE (diésel, casetas, hospedaje):
 * los valida contra el SAT, revisa el RFC receptor y la lista EFOS. Eso es
 * real y es lo que se enseña.
 *
 * Lo que el PASO 19 describe —emitir el CFDI de Ingreso con Carta Porte 3.1
 * hacia el cliente de la flota, con IdCCP, ubicaciones, mercancías, figura
 * del operador, y el validador pre-timbrado— NO existe: no hay una sola
 * referencia a Carta Porte en el código ni tabla que lo soporte. Es la
 * diferencia entre revisar la factura que te dan y emitir la que tú cobras.
 */
export default async function FacturacionPage({
  searchParams,
}: {
  searchParams: Promise<{ vista?: string; tenant?: string }>;
}) {
  const sp = await searchParams;
  const { tenantId } = await resolverTenantEfectivo('/dashboard/facturacion', sp);

  const [docs, acred] = await Promise.all([
    safe<DocumentoRow[]>(() => getDocumentos(tenantId, 1000)),
    safe<Acreditables>(() => getAcreditables(tenantId)),
  ]);

  const conCfdi = docs?.filter((d) => d.cfdiUuid) ?? [];
  const vigentes = conCfdi.filter((d) => d.estadoSat === 'vigente').length;
  const cancelados = conCfdi.filter((d) => d.estadoSat === 'cancelado').length;
  const conEfos = docs?.filter((d) => d.efos).length ?? 0;

  return (
    <div className="flex flex-col gap-4">
      <header className="glass-panel flex items-center gap-2.5 px-5 py-4">
        <FileText width={16} height={16} strokeWidth={1.75} />
        <div>
          <span className="text-sm font-medium block">Facturación</span>
          <span className="text-xs" style={{ color: 'var(--muted)' }}>
            Los CFDI que recibes y qué tan sanos están ante el SAT
          </span>
        </div>
      </header>

      <div className="glass-panel overflow-hidden">
        <section className="p-5">
          <h2 className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
            CFDI recibidos
          </h2>
          {docs === null ? (
            <div className="card p-4 mt-3 text-sm" style={{ color: 'var(--muted)' }}>No se pudo cargar esta sección.</div>
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
                <KpiTile icono={<Receipt width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--ink)' }} />}
                  etiqueta="Comprobantes con CFDI" valor={conCfdi.length} formato="entero"
                  nota={`De ${docs.length} comprobantes en total — el resto son tickets sin factura`} />
                <KpiTile icono={<ShieldCheck width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--ink)' }} />}
                  etiqueta="Vigentes ante el SAT" valor={vigentes} formato="entero" />
                <KpiTile icono={<ShieldAlert width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--ink)' }} />}
                  etiqueta="Cancelados" valor={cancelados} formato="entero"
                  nota="Un CFDI cancelado después de que lo pagaste deja de ser deducible" />
                <KpiTile icono={<ShieldAlert width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--ink)' }} />}
                  etiqueta="Emisor en lista EFOS" valor={conEfos} formato="entero"
                  nota="Proveedores que el SAT tiene marcados — deducirles es riesgo" />
              </div>
              {conCfdi.length < docs.length && (
                <p className="text-xs mt-3" style={{ color: 'var(--muted)' }}>
                  {docs.length - conCfdi.length} comprobantes no traen CFDI. No siempre es un problema (un ticket de
                  caseta sin factura sigue siendo gasto real), pero sin factura no es deducible.
                </p>
              )}
            </>
          )}
        </section>

        <section className="p-5 border-t" style={{ borderColor: 'var(--line)' }}>
          <h2 className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
            Lo acreditable que sale de esos CFDI
          </h2>
          {acred === null ? (
            <div className="card p-4 mt-3 text-sm" style={{ color: 'var(--muted)' }}>No se pudo cargar esta sección.</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
              <KpiTile icono={<Receipt width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--ink)' }} />}
                etiqueta="IVA acreditable" valor={acred.iva} formato="mxn" nota="LIVA, Art. 5 — CFDI con IVA desglosado" />
              <KpiTile icono={<Receipt width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--ink)' }} />}
                etiqueta="Peaje acreditable (50%)" valor={acred.peaje} formato="mxn" nota="LIF 2026, Art. 20-A" />
              <KpiTile icono={<Receipt width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--ink)' }} />}
                etiqueta="Litros de diésel elegibles" valor={acred.litrosDiesel} formato="litros"
                nota="El estímulo en pesos lo calcula tu contador con la cuota semanal del DOF" />
            </div>
          )}
        </section>

        <div className="px-5 pt-4 pb-5 border-t" style={{ borderColor: 'var(--line)' }}>
          <EstadoVacio>
            <strong>Emitir tus propias facturas todavía no existe aquí.</strong> Lo de arriba es la factura que
            RECIBES (diésel, casetas, hospedaje) validada contra el SAT — no el CFDI de Ingreso que tú le cobras a
            tu cliente.
            <br /><br />
            Por eso tampoco están: Carta Porte 3.1 (ubicaciones, mercancías, autotransporte, permiso SICT, figura
            del operador, IdCCP), el validador pre-timbrado que evita la multa, PUE/PPD con REP al cobrar, y la
            retención del 4% de IVA. Nada de eso tiene una sola línea de código ni tabla en el sistema hoy —
            enseñarlo como una sección vacía con semáforos apagados sería fingir que está a medio construir.
          </EstadoVacio>
        </div>
      </div>
    </div>
  );
}
