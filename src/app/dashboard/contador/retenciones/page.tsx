import { Percent, FileWarning, Truck } from 'lucide-react';
import { resolverPeriodo, getGastosFiscales, diagnosticoRetencion, type GastoFiscal } from '@/lib/cuadra/fiscal';
import { mxn } from '@/lib/utils';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { EstadoVacio } from '../../../admin/ui/kit';
import { EncabezadoFiscal } from '../periodo';
import { safe, extraDe, PieDeAlcance, type ParamsPanel } from '../comun';

export const dynamic = 'force-dynamic';

const RUTA = '/dashboard/contador/retenciones';

/**
 * RETENCIONES — la pantalla que dice QUE NO SE PUEDE, y exactamente por qué.
 *
 * Esta pantalla no calcula nada, y esa es su función. La retención del 4% de
 * IVA por autotransporte terrestre de carga es de las primeras cosas que un
 * contador de flota busca, así que la alternativa a decirlo aquí no es
 * "omitirlo": es que lo busque, no lo encuentre, y suponga que el sistema ya lo
 * consideró en otra cifra.
 *
 * Se resiste la tentación de pintar `subtotal × 0.04`. Sería una línea de
 * código y produciría un número que entra directo a una declaración mensual y
 * que no está en ningún comprobante: la retención efectiva la fija el CFDI del
 * proveedor, y no siempre aplica —si el proveedor es persona moral, no hay
 * retención que enterar—.
 *
 * Lo que sí se enseña es la SEÑAL: cuántos comprobantes del periodo son pagos a
 * un tercero que mueve carga (`concepto = 'flete'`), que son los candidatos, y
 * los dos campos exactos que harían falta para convertir esa señal en cifra.
 */
/**
 * SEPARADO EN DOS EN LA LÍNEA DE LA AUTORIZACIÓN, y no por gusto de arquitectura.
 *
 * `Page` hace UNA cosa: resolver quién entra y a qué flota (`resolverTenantEfectivo`,
 * que además gatea la ruta por rol). `Contenido` hace el resto — sus propias
 * consultas REALES a Supabase y todo el render.
 *
 * El corte existe porque estas pantallas viven detrás de sesión y la única forma
 * honesta de MIRAR el render es un preview temporal que importe el componente
 * REAL con datos REALES (CLAUDE.md, "Cómo se verifica"). Un preview que copie el
 * JSX verifica la copia. `Contenido` es ese punto de entrada: recibe el tenant ya
 * resuelto y no sabe de sesiones, así que se puede montar sin una.
 *
 * La autorización NO se movió de sitio: sigue corriendo antes, en `Page`, y es la
 * única puerta. `Contenido` no es una ruta — no hay URL que llegue a él.
 */
export default async function RetencionesPage({
  searchParams,
}: {
  searchParams: Promise<ParamsPanel>;
}) {
  const sp = await searchParams;
  const { tenantId } = await resolverTenantEfectivo(RUTA, sp);
  return <Contenido {...{ tenantId, sp }} />;
}

export async function Contenido({ tenantId, sp }: { tenantId: string; sp: ParamsPanel; }) {
  const periodo = resolverPeriodo(sp?.p, new Date().toISOString().slice(0, 10));
  const extra = extraDe(sp);

  const gastos = await safe<GastoFiscal[]>(() => getGastosFiscales(tenantId, periodo));
  const d = gastos ? diagnosticoRetencion(gastos) : null;

  return (
    <div className="flex flex-col gap-4">
      <EncabezadoFiscal
        icono={<Percent width={16} height={16} strokeWidth={1.75} />}
        titulo="Retenciones de IVA"
        subtitulo="Autotransporte terrestre de carga — qué falta para poder calcularlas"
        base={RUTA} periodo={periodo} extra={extra}
      />

      <div className="glass-panel overflow-hidden">
        <section className="p-5">
          <h2 className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
            Hoy no se puede calcular, y no es un pendiente de pantalla
          </h2>
          <div className="mt-3">
            <EstadoVacio icono={<FileWarning width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
              El importe retenido no está en la base de datos. Faltan dos cosas, en este orden:
              <br /><br />
              <strong>1. El parser del XML no lee el nodo.</strong>{' '}
              <code className="text-xs">intake/cfdi_xml.ts</code> recorre{' '}
              <code className="text-xs">cfdi:Impuestos/cfdi:Traslados/cfdi:Traslado</code> y solo eso: suma IVA (002)
              e IEPS (003) trasladados. El nodo{' '}
              <code className="text-xs">cfdi:Impuestos/cfdi:Retenciones/cfdi:Retencion[@Impuesto=&quot;002&quot;]</code> —donde
              vive el importe retenido— se descarta al importar. Aunque el proveedor lo mande, hoy se tira.
              <br /><br />
              <strong>2. No hay columna donde guardarlo.</strong> <code className="text-xs">gasto</code> tiene 31
              columnas; las de impuestos son <code className="text-xs">iva_traslado</code>,{' '}
              <code className="text-xs">ieps_traslado</code> y <code className="text-xs">sub_total</code>. Ninguna de
              retenidos. Haría falta <code className="text-xs">gasto.iva_retenido numeric</code> (y su gemela para
              ISR, si algún día se ocupa).
              <br /><br />
              <strong>Por qué no se deriva del subtotal.</strong> Calcularlo como el 4% del subtotal daría un número
              en cada renglón, y sería inventado: la retención la fija el comprobante del proveedor, la tasa aplicable
              depende de quién emite (no hay retención entre personas morales por este concepto), y esa cifra se
              teclea en una declaración mensual con nombre y RFC. Un número plausible aquí es peor que un hueco:
              el hueco se pregunta, el número se copia.
            </EstadoVacio>
          </div>
        </section>

        {/* ── La señal que sí existe ────────────────────────────────── */}
        <section className="p-5 border-t" style={{ borderColor: 'var(--line)' }}>
          <h2 className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
            Lo que sí se puede decir · {periodo.etiqueta}
          </h2>
          {gastos === null || d === null ? (
            <div className="card p-4 mt-3 text-sm" style={{ color: 'var(--muted)' }}>
              No se pudo leer los comprobantes del periodo.
            </div>
          ) : (
            <div className="card p-4 mt-3">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                  style={{ background: 'var(--canvas)', border: '1px solid var(--line)' }}>
                  <Truck width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />
                </div>
                <div className="min-w-0">
                  <p className="text-sm">
                    {d.candidatos === 0 ? (
                      <>Ningún comprobante del periodo está clasificado como <strong>flete</strong> — el concepto con el
                      que el sistema etiqueta un pago a un tercero que mueve carga. Si la flota subcontrata y no
                      aparece aquí, es que esos pagos no entran por WhatsApp.</>
                    ) : (
                      <>
                        <strong className="tabular">{d.candidatos}</strong> comprobante{d.candidatos === 1 ? '' : 's'} del
                        periodo, por <strong className="tabular">{mxn(d.montoCandidatos)}</strong>, están clasificados
                        como <strong>flete</strong>: pagos a un tercero que mueve carga. Son los candidatos a llevar
                        retención cuando la flota es quien contrata.
                      </>
                    )}
                  </p>
                  <p className="text-xs mt-2" style={{ color: 'var(--muted)' }}>
                    Es una SEÑAL, no un cálculo. Cuántos de esos llevan retención de verdad, y por cuánto, lo dice el
                    CFDI de cada proveedor — que es justo lo que falta importar.
                  </p>
                </div>
              </div>
            </div>
          )}
        </section>

        {/* ── El otro lado, que no es de este panel ─────────────────── */}
        <section className="p-5 border-t" style={{ borderColor: 'var(--line)' }}>
          <h2 className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
            El otro lado de la retención
          </h2>
          <div className="mt-3">
            <EstadoVacio icono={<Percent width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
              Lo que los clientes de la flota le retienen a ELLA vive en los CFDI que la flota emite, no en los que
              recibe. Este panel mira el gasto —los comprobantes que los operadores mandan por WhatsApp—, que es lo
              que Likida captura. Enseñarlo aquí en cero daría a entender que nadie le retuvo nada en el periodo.
            </EstadoVacio>
          </div>
        </section>

        <div className="px-5 py-4 border-t" style={{ borderColor: 'var(--line)' }}>
          <PieDeAlcance />
        </div>
      </div>
    </div>
  );
}
