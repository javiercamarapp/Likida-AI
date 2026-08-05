import Link from 'next/link';
import { FileCheck2, Download, Receipt } from 'lucide-react';
import {
  resolverPeriodo, getGastosFiscales, contarGastosDelTenant, causasDe, causaDominante,
  type GastoFiscal,
} from '@/lib/cuadra/fiscal';
import { getConfig, type CuadraConfig } from '@/lib/cuadra/config';
import { etiquetaConcepto } from '@/lib/cuadra/cuadre/engine';
import { mxn } from '@/lib/utils';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { puedeExportar } from '@/lib/auth/permisos';
import { fechaMx } from '../../formato';
import { EstadoVacio, StatusPill, KpiTile, type Estado } from '../../../admin/ui/kit';
import { EncabezadoFiscal } from '../periodo';
import { safe, extraDe, opcionesDe, etiquetaFormaPago, PieDeAlcance, SinDato, AvisoDeFallo, type Fallo, type ParamsPanel } from '../comun';

export const dynamic = 'force-dynamic';

const RUTA = '/dashboard/contador/cfdi';

/**
 * CFDI RECIBIDOS — la bandeja del papel, con su validación y su veredicto.
 *
 * ── LA DISTINCIÓN QUE ESTA PANTALLA EXISTE PARA NO BORRAR ─────────────────
 *
 * "Sin validar" NO es "inválido". Un CFDI cuya consulta al SAT nunca se corrió
 * (`estado_sat` nulo) está en un tercer estado: no comprobado. Pintarlo rojo le
 * dice al contador que tiene un problema donde solo tiene una tarea; pintarlo
 * verde le dice que ya se revisó cuando nadie lo hizo. Va ámbar y con esas
 * palabras.
 *
 * Lo mismo con "Sin CFDI": es NEUTRAL, no rojo. Un ticket de papel sin factura
 * es el estado normal de la mayoría de los comprobantes que entran por
 * WhatsApp; enseñarlos como error volvería la bandeja un muro rojo sin
 * información.
 */
type Filtro = 'todos' | 'con_cfdi' | 'sin_cfdi' | 'vigentes' | 'cancelados' | 'por_validar' | 'observados';

const FILTROS: Array<{ valor: Filtro; etiqueta: string }> = [
  { valor: 'todos', etiqueta: 'Todos' },
  { valor: 'con_cfdi', etiqueta: 'Con CFDI' },
  { valor: 'sin_cfdi', etiqueta: 'Sin CFDI' },
  { valor: 'vigentes', etiqueta: 'Vigentes' },
  { valor: 'cancelados', etiqueta: 'Cancelados' },
  { valor: 'por_validar', etiqueta: 'Por validar' },
  { valor: 'observados', etiqueta: 'Con observación' },
];

function aplicarFiltro(gs: GastoFiscal[], f: Filtro, tieneObservacion: (g: GastoFiscal) => boolean): GastoFiscal[] {
  switch (f) {
    case 'con_cfdi': return gs.filter((g) => g.cfdiUuid);
    case 'sin_cfdi': return gs.filter((g) => !g.cfdiUuid);
    case 'vigentes': return gs.filter((g) => g.cfdiUuid && g.estadoSat === 'vigente');
    case 'cancelados': return gs.filter((g) => g.cfdiUuid && g.estadoSat === 'cancelado');
    case 'por_validar': return gs.filter((g) => g.cfdiUuid && g.estadoSat !== 'vigente' && g.estadoSat !== 'cancelado');
    case 'observados': return gs.filter(tieneObservacion);
    default: return gs;
  }
}

/** Qué dice el SAT de este comprobante. Tres estados, no dos. */
function validacion(g: GastoFiscal): { label: string; estado: Estado } {
  if (g.efos === true) return { label: 'Emisor en lista EFOS', estado: 'bad' };
  if (!g.cfdiUuid) return { label: 'Sin CFDI', estado: 'neutral' };
  if (g.estadoSat === 'vigente') return { label: 'Vigente', estado: 'ok' };
  if (g.estadoSat === 'cancelado') return { label: 'Cancelado', estado: 'bad' };
  if (g.estadoSat) return { label: g.estadoSat, estado: 'warn' };
  return { label: 'Sin validar ante el SAT', estado: 'warn' };
}

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
export default async function CfdiPage({
  searchParams,
}: {
  searchParams: Promise<ParamsPanel & { f?: string }>;
}) {
  const sp = await searchParams;
  const { tenantId, rol } = await resolverTenantEfectivo(RUTA, sp);
  return <Contenido {...{ tenantId, sp, rol }} />;
}

export async function Contenido({ tenantId, sp, rol }: { tenantId: string; sp: ParamsPanel & { f?: string }; rol: string; }) {
  const periodo = resolverPeriodo(sp?.p, new Date().toISOString().slice(0, 10));
  const extra = extraDe(sp);
  const filtro: Filtro = (FILTROS.find((f) => f.valor === sp?.f)?.valor ?? 'todos') as Filtro;

  const fallos: Fallo[] = [];
  const [cfg, gastos, conteo] = await Promise.all([
    safe<CuadraConfig>(() => getConfig(tenantId), { que: 'Configuración fiscal de la flota', en: fallos }),
    safe<GastoFiscal[]>(() => getGastosFiscales(tenantId, periodo), { que: 'Bandeja de comprobantes', en: fallos }),
    safe<{ total: number; sinFecha: number }>(() => contarGastosDelTenant(tenantId)),
  ]);

  const opts = cfg ? opcionesDe(cfg) : null;
  const tieneObs = (g: GastoFiscal) => (opts ? causasDe(g, opts).length > 0 : false);
  const visibles = gastos && opts
    ? aplicarFiltro([...gastos].sort((a, b) => (a.fecha ?? '') < (b.fecha ?? '') ? 1 : -1), filtro, tieneObs)
    : [];

  const urlFiltro = (f: Filtro) => {
    const params = new URLSearchParams(extra);
    if (periodo.clave !== 'ejercicio') params.set('p', periodo.clave);
    if (f !== 'todos') params.set('f', f);
    const qs = params.toString();
    return qs ? `${RUTA}?${qs}` : RUTA;
  };

  const urlExport = () => {
    const params = new URLSearchParams(extra);
    params.set('p', periodo.clave);
    if (filtro !== 'todos') params.set('f', filtro);
    return `${RUTA}/export?${params.toString()}`;
  };

  const conCfdi = gastos?.filter((g) => g.cfdiUuid).length ?? 0;
  const conXml = gastos?.filter((g) => g.xmlVerificado === true).length ?? 0;
  const porValidar = gastos?.filter((g) => g.cfdiUuid && g.estadoSat !== 'vigente' && g.estadoSat !== 'cancelado').length ?? 0;

  return (
    <div className="flex flex-col gap-4">
      <EncabezadoFiscal
        icono={<FileCheck2 width={16} height={16} strokeWidth={1.75} />}
        titulo="CFDI recibidos"
        subtitulo="El papel que ampara cada gasto, con lo que el SAT dice de él"
        base={RUTA} periodo={periodo} extra={extra}
      />

      {gastos === null || cfg === null ? (
        <AvisoDeFallo fallos={fallos} />
      ) : (
        <div className="glass-panel overflow-hidden">
          <section className="p-5">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <KpiTile icono={<Receipt width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}
                etiqueta="Comprobantes del periodo" valor={gastos.length} formato="entero" />
              <KpiTile icono={<FileCheck2 width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}
                etiqueta="Con CFDI amarrado" valor={conCfdi} formato="entero"
                nota={gastos.length ? `${gastos.length - conCfdi} son tickets sin timbrar` : undefined} />
              <KpiTile icono={<FileCheck2 width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}
                etiqueta="Con XML recibido y parseado" valor={conXml} formato="entero"
                nota="Sin el XML no hay desglose de impuestos que citar" />
              <KpiTile icono={<Receipt width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}
                etiqueta="Por validar ante el SAT" valor={porValidar} formato="entero"
                nota="Tienen UUID pero nadie corrió la consulta: no es «inválido», es «no comprobado»" />
            </div>
          </section>

          {/* ── Filtros y export ───────────────────────────────────────── */}
          <section className="px-5 pb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-1 p-0.5 rounded-full" style={{ background: 'var(--canvas)' }}>
              {FILTROS.map((f) => (
                <Link key={f.valor} href={urlFiltro(f.valor)}
                  className="text-xs font-medium px-2.5 py-1 rounded-full transition-colors"
                  style={filtro === f.valor ? { background: 'var(--marca)', color: 'white' } : { color: 'var(--muted)' }}>
                  {f.etiqueta}
                </Link>
              ))}
            </div>
            {puedeExportar(rol) && (
              <a href={urlExport()}
                className="text-xs font-medium px-3 py-1.5 rounded-full hairline hover:opacity-70 transition-opacity inline-flex items-center gap-1.5">
                <Download width={13} height={13} strokeWidth={2} />
                Exportar CSV ({visibles.length})
              </a>
            )}
          </section>

          <div className="px-5 pb-3">
            <p className="text-xs" style={{ color: 'var(--faint)' }}>
              El export baja EXACTAMENTE lo que ves: mismo periodo, mismo filtro. Las columnas sin dato van vacías,
              nunca en cero — un 0.00 en la columna de IVA se importaría al ERP como &quot;este gasto no causó IVA&quot;.
            </p>
          </div>

          {visibles.length === 0 ? (
            <div className="px-5 pb-5">
              <EstadoVacio icono={<Receipt width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
                {gastos.length === 0 ? (
                  <>
                    No hay comprobantes con fecha dentro de {periodo.etiqueta}.
                    {conteo && conteo.total > 0 && <> La flota tiene {conteo.total} capturados en total — prueba otro periodo o &quot;Todo&quot;.</>}
                    {conteo && conteo.total === 0 && <> Todavía no ha entrado ninguno.</>}
                  </>
                ) : (
                  <>Ninguno de los {gastos.length} comprobantes de {periodo.etiqueta} cae en el filtro «{FILTROS.find((f) => f.valor === filtro)!.etiqueta}».</>
                )}
              </EstadoVacio>
            </div>
          ) : (
            <div className="overflow-x-auto pb-2">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ color: 'var(--muted)' }} className="text-left">
                    <th className="pl-5 pr-3 py-2.5 font-medium whitespace-nowrap">Fecha</th>
                    <th className="px-3 py-2.5 font-medium">Concepto</th>
                    <th className="px-3 py-2.5 font-medium">RFC emisor</th>
                    <th className="px-3 py-2.5 font-medium">UUID</th>
                    <th className="px-3 py-2.5 font-medium">SAT</th>
                    <th className="px-3 py-2.5 font-medium">Deducible</th>
                    <th className="px-3 py-2.5 font-medium">Pago</th>
                    <th className="px-3 py-2.5 font-medium text-right">Subtotal</th>
                    <th className="px-3 py-2.5 font-medium text-right">IVA</th>
                    <th className="px-3 py-2.5 font-medium text-right">IEPS</th>
                    <th className="pl-3 pr-5 py-2.5 font-medium text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {visibles.map((g) => {
                    const v = validacion(g);
                    const dominante = opts ? causaDominante(g, opts) : null;
                    return (
                      <tr key={g.id} className="border-t" style={{ borderColor: 'var(--line)' }}>
                        <td className="pl-5 pr-3 py-3 whitespace-nowrap" style={{ color: 'var(--muted)' }}>
                          {g.fecha ? fechaMx(g.fecha) : <SinDato titulo="Sin fecha legible en el comprobante" />}
                        </td>
                        <td className="px-3 py-3 whitespace-nowrap">{etiquetaConcepto(g.concepto)}</td>
                        <td className="px-3 py-3 font-mono text-xs" style={{ color: 'var(--muted)' }}>
                          {g.rfcEmisor ?? <SinDato />}
                        </td>
                        <td className="px-3 py-3 font-mono text-[11px]" style={{ color: 'var(--muted)' }}
                          title={g.cfdiUuid ?? undefined}>
                          {g.cfdiUuid ? `${g.cfdiUuid.slice(0, 8)}…` : <SinDato titulo="Ticket sin timbrar" />}
                        </td>
                        <td className="px-3 py-3"><StatusPill estado={v.estado}>{v.label}</StatusPill></td>
                        <td className="px-3 py-3">
                          {dominante
                            ? <StatusPill estado={dominante.gravedad === 'perdida' ? 'bad' : dominante.gravedad === 'en_riesgo' ? 'warn' : 'neutral'}>
                                <span className="whitespace-nowrap">{dominante.titulo}</span>
                              </StatusPill>
                            : <StatusPill estado="ok">Sin observación</StatusPill>}
                        </td>
                        <td className="px-3 py-3 text-xs" style={{ color: 'var(--muted)' }}>
                          {g.formaPago ? etiquetaFormaPago(g.formaPago) : <SinDato titulo="Sin forma de pago capturada" />}
                        </td>
                        <td className="px-3 py-3 text-right tabular">
                          {g.subTotal === null ? <SinDato titulo="No se leyó el subtotal" /> : mxn(g.subTotal)}
                        </td>
                        <td className="px-3 py-3 text-right tabular">
                          {g.ivaTraslado === null ? <SinDato titulo="El comprobante no desglosa IVA" /> : mxn(g.ivaTraslado)}
                        </td>
                        <td className="px-3 py-3 text-right tabular">
                          {g.iepsTraslado === null ? <SinDato titulo="El comprobante no desglosa IEPS" /> : mxn(g.iepsTraslado)}
                        </td>
                        <td className="pl-3 pr-5 py-3 text-right tabular font-medium whitespace-nowrap">{mxn(g.monto)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="px-5 py-4 border-t" style={{ borderColor: 'var(--line)' }}>
            <PieDeAlcance>
              La columna &quot;Deducible&quot; resume lo que estas columnas permiten juzgar: comprobante, estado ante el SAT,
              emisor y medio de pago. Que el gasto sea estrictamente indispensable para la actividad —el otro
              requisito de LISR 27-I— no lo puede ver ningún sistema: lo decide el contador.
            </PieDeAlcance>
          </div>
        </div>
      )}
    </div>
  );
}
