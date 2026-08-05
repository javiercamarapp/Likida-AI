import { ReceiptText, Eye, FileText } from 'lucide-react';
import { resolverPeriodo, getLiquidacionesFiscales, type LiquidacionFiscal } from '@/lib/cuadra/fiscal';
import { mxn } from '@/lib/utils';
import { litros, fechaMx } from '../../formato';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { KpiTile, EstadoVacio, StatusPill, type Estado } from '../../../admin/ui/kit';
import { EncabezadoFiscal } from '../periodo';
import { safe, extraDe, PieDeAlcance, AvisoDeFallo, type Fallo, type ParamsPanel } from '../comun';

export const dynamic = 'force-dynamic';

const RUTA = '/dashboard/contador/liquidaciones';

/**
 * LIQUIDACIONES, EN MODO LECTURA — el puente entre lo contable y lo operativo.
 *
 * El contador necesita poder amarrar el gasto que ve en las otras pantallas
 * contra el viaje que lo generó y contra el PDF que la flota archiva. Aquí lo
 * ve y se lo puede llevar; lo que NO puede es tocarlo.
 *
 * ── QUÉ HACE ESTA PANTALLA DE SOLO LECTURA, EN CONCRETO ───────────────────
 *
 * No es una promesa en un comentario: no hay una sola Server Action en este
 * archivo, ni un `<form>`, ni un botón que mute. Los únicos elementos
 * interactivos son links (el periodo) y el PDF ya generado. Reabrir un cuadre,
 * reasignar un gasto o cerrar una liquidación son acciones que `permisos.ts` ya
 * le niega al rol (`puedeAsignar` / `puedeAdministrar`), y esta pantalla ni
 * siquiera las ofrece: un botón que existe y rebota enseña que la app está
 * rota.
 *
 * Los acreditables que se muestran son los que el MOTOR calculó y guardó al
 * liquidar (`liquidacion.iva_acreditable` y compañía), no un recálculo desde
 * `gasto`. Recalcularlos aquí produciría dos cifras para el mismo viaje: la del
 * PDF que el contralor archivó y la de esta pantalla.
 */
const ESTADO: Record<string, { estado: Estado; texto: string }> = {
  cuadrada: { estado: 'ok', texto: 'Cuadrada' },
  con_diferencias: { estado: 'warn', texto: 'Con diferencias' },
  revisar: { estado: 'bad', texto: 'Por revisar' },
};

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
export default async function LiquidacionesLecturaPage({
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

  const fallos: Fallo[] = [];
  const liqs = await safe<LiquidacionFiscal[]>(
    () => getLiquidacionesFiscales(tenantId, periodo),
    { que: 'Liquidaciones cerradas en el periodo', en: fallos },
  );

  const totales = liqs?.reduce(
    (a, l) => ({
      comprobado: a.comprobado + l.totalComprobado,
      iva: a.iva + l.ivaAcreditable,
      peaje: a.peaje + l.peajeAcreditable,
      litros: a.litros + l.litrosDieselAcreditables,
    }),
    { comprobado: 0, iva: 0, peaje: 0, litros: 0 },
  );

  return (
    <div className="flex flex-col gap-4">
      <EncabezadoFiscal
        icono={<ReceiptText width={16} height={16} strokeWidth={1.75} />}
        titulo="Liquidaciones (lectura)"
        subtitulo="Lo que el motor cerró en cada viaje, para amarrarlo con tu póliza"
        base={RUTA} periodo={periodo} extra={extra}
      />

      {liqs === null ? (
        <AvisoDeFallo fallos={fallos} />
      ) : (
        <div className="glass-panel overflow-hidden">
          <section className="p-5">
            <div className="flex items-center gap-2 mb-3">
              <Eye width={14} height={14} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />
              <span className="text-xs" style={{ color: 'var(--muted)' }}>
                Solo lectura · cerradas entre {periodo.desde ?? 'el inicio'} y {periodo.hasta ?? 'hoy'}
              </span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <KpiTile icono={<ReceiptText width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}
                etiqueta="Liquidaciones cerradas" valor={liqs.length} formato="entero" />
              <KpiTile icono={<ReceiptText width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}
                etiqueta="Total comprobado" valor={totales?.comprobado ?? 0} formato="mxn"
                nota="Lo que los operadores comprobaron, no la base deducible" />
              <KpiTile icono={<ReceiptText width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}
                etiqueta="IVA acreditable (motor)" valor={totales?.iva ?? 0} formato="mxn"
                nota="Calculado al liquidar y guardado con la liquidación — es el del PDF" />
              <KpiTile icono={<ReceiptText width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}
                etiqueta="Litros de diésel elegibles" valor={totales?.litros ?? 0} formato="litros"
                nota="LIF 2026 20-A. El estímulo en pesos es esto × la cuota del DOF de esa semana" />
            </div>
          </section>

          {liqs.length === 0 ? (
            <div className="px-5 pb-5">
              <EstadoVacio icono={<ReceiptText width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
                Ninguna liquidación se cerró dentro de {periodo.etiqueta}. Ojo con el criterio de fecha: una
                liquidación no tiene fecha de documento, así que aquí se filtra por CUÁNDO SE CERRÓ. Un viaje de
                junio liquidado en julio aparece en julio — que es también como lo va a ver tu póliza.
              </EstadoVacio>
            </div>
          ) : (
            <div className="overflow-x-auto pb-2">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ color: 'var(--muted)' }} className="text-left">
                    <th className="px-5 py-2.5 font-medium">Cerrada</th>
                    <th className="px-5 py-2.5 font-medium">Viaje</th>
                    <th className="px-5 py-2.5 font-medium">Operador</th>
                    <th className="px-5 py-2.5 font-medium">Estatus</th>
                    <th className="px-5 py-2.5 font-medium text-right">Comprobado</th>
                    <th className="px-5 py-2.5 font-medium text-right">Anticipo</th>
                    <th className="px-5 py-2.5 font-medium text-right">Diferencia</th>
                    <th className="px-5 py-2.5 font-medium text-right">IVA acred.</th>
                    <th className="px-5 py-2.5 font-medium text-right">Peaje acred.</th>
                    <th className="px-5 py-2.5 font-medium text-right">Litros</th>
                    <th className="px-5 py-2.5 font-medium">PDF</th>
                  </tr>
                </thead>
                <tbody>
                  {liqs.map((l) => {
                    const e = ESTADO[l.estatus] ?? { estado: 'neutral' as Estado, texto: l.estatus };
                    return (
                      <tr key={l.id} className="border-t" style={{ borderColor: 'var(--line)' }}>
                        <td className="px-5 py-3 whitespace-nowrap" style={{ color: 'var(--muted)' }}>{fechaMx(l.fecha)}</td>
                        <td className="px-5 py-3 font-mono text-xs">{l.viajeFolio ?? '—'}</td>
                        <td className="px-5 py-3" style={{ color: 'var(--muted)' }}>{l.operadorNombre ?? '—'}</td>
                        <td className="px-5 py-3">
                          <StatusPill estado={e.estado}>{e.texto}</StatusPill>
                          {l.observaciones > 0 && (
                            <span className="text-xs ml-2" style={{ color: 'var(--faint)' }}>
                              {l.observaciones} obs.
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-3 text-right tabular">{mxn(l.totalComprobado)}</td>
                        <td className="px-5 py-3 text-right tabular" style={{ color: 'var(--muted)' }}>{mxn(l.totalAnticipo)}</td>
                        <td className="px-5 py-3 text-right tabular"
                          style={Math.abs(l.diferencia) >= 0.5 ? { color: 'var(--warn)' } : undefined}>
                          {mxn(l.diferencia)}
                        </td>
                        <td className="px-5 py-3 text-right tabular">{mxn(l.ivaAcreditable)}</td>
                        <td className="px-5 py-3 text-right tabular">{mxn(l.peajeAcreditable)}</td>
                        <td className="px-5 py-3 text-right tabular">{litros(l.litrosDieselAcreditables)}</td>
                        <td className="px-5 py-3">
                          {l.pdfUrl ? (
                            <a href={l.pdfUrl} target="_blank" rel="noreferrer"
                              className="text-xs inline-flex items-center gap-1 hover:opacity-70 transition-opacity">
                              <FileText width={13} height={13} strokeWidth={2} /> Abrir
                            </a>
                          ) : (
                            <span className="text-xs" style={{ color: 'var(--faint)' }}>Sin PDF</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="px-5 py-4 border-t" style={{ borderColor: 'var(--line)' }}>
            <PieDeAlcance>
              Los acreditables de esta tabla son los que el motor guardó al cerrar cada liquidación — los mismos del
              PDF archivado. No se recalculan aquí: dos cálculos del mismo viaje se leerían como dos verdades.
            </PieDeAlcance>
          </div>
        </div>
      )}
    </div>
  );
}
