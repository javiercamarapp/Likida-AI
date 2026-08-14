import Link from 'next/link';
import { Truck, ArrowRight, Inbox } from 'lucide-react';
import { numero, fechaCorta } from '@/lib/formato';
import { EstadoVacio } from '@/app/admin/ui/kit';
import { BarraPagina } from '../resumen-visual';
import { PillAviso } from '../despacho/vista';

export type FiltroViajes = 'todos' | 'abiertos' | 'en_cuadre' | 'liquidados' | 'escalados';

/** La fila del registro — ViajeRow SIN el anticipo (página de operación:
 *  el peso no sale del servidor), más el cruce a su liquidación si existe. */
export interface FilaRegistroViaje {
  id: string; folio: string; origen: string | null; destino: string | null;
  estatus: string; operadorNombre: string | null; fechaInicio: string | null;
  intakePendientes: number;
  avisadoEn: string | null; aceptadoEn: string | null; escaladoEn: string | null;
  avisosEnviados: number;
  liqId: string | null;
}

const PILL_ESTATUS: Record<string, { etiqueta: string; fg: string; bg: string }> = {
  liquidado: { etiqueta: 'Liquidado', fg: 'var(--ok)', bg: 'var(--okbg)' },
  en_cuadre: { etiqueta: 'En cuadre', fg: 'var(--warn)', bg: 'var(--warnbg)' },
  abierto: { etiqueta: 'Abierto', fg: 'var(--muted)', bg: 'var(--canvas)' },
};

const ROTULO_FILTRO: Record<FiltroViajes, string> = {
  todos: 'Todos', abiertos: 'Abiertos', en_cuadre: 'En cuadre',
  liquidados: 'Liquidados', escalados: 'Escalados',
};

/**
 * El Registro de Viajes (F2): navegable, filtrable, con el estado del aviso
 * al chofer (0058) y el escalamiento a la vista — lo que `escalar_viaje.ts`
 * hacía a ciegas por cron. Sin pesos: es la pantalla que el jefe de tráfico
 * también ve.
 */
export function VistaViajes({ filas, filtro, conteos, cargados, sufijo }: {
  filas: FilaRegistroViaje[];
  filtro: FiltroViajes;
  conteos: {
    total: number | null; abiertos: number | null; enCuadre: number | null;
    liquidados: number | null; escalados: number | null;
  };
  /** Cuántos trajo la ventana de la tabla (tope 100) — para el rótulo honesto. */
  cargados: number;
  sufijo: string;
}) {
  const kpi = (n: number | null) => (n === null ? '—' : numero(n));
  const amp = sufijo ? `${sufijo}&` : '?';

  return (
    <main className="h-full">
      <div className="rounded-2xl min-h-full hairline flex flex-col" style={{ background: 'var(--g1)' }}>
        <BarraPagina
          icono={<Truck width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />}
          titulo="Viajes"
        />
        <div className="px-5 py-5 flex-1 space-y-4">

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Kpi titulo="Viajes en total" valor={kpi(conteos.total)} nota="histórico" />
            <Kpi titulo="Abiertos" valor={kpi(conteos.abiertos)} />
            <Kpi titulo="En cuadre" valor={kpi(conteos.enCuadre)} />
            <Kpi titulo="Escalados sin aceptar" valor={kpi(conteos.escalados)}
              tono={(conteos.escalados ?? 0) > 0 ? 'bad' : undefined} />
          </div>

          <section className="card p-4">
            <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
              <h2 className="font-display text-[15px] font-semibold">El registro</h2>
              <div className="flex items-center gap-1.5 flex-wrap">
                {(Object.keys(ROTULO_FILTRO) as FiltroViajes[]).map((f) => (
                  <Link key={f} href={`/dashboard/viajes${f === 'todos' ? sufijo : `${amp}f=${f}`}`}
                    className="px-2.5 py-1 rounded-lg text-[12px] font-medium transition-colors hairline"
                    style={filtro === f
                      ? { background: 'var(--marca)', color: 'var(--marca-fg)', borderColor: 'var(--marca)' }
                      : { background: 'var(--surface)', color: 'var(--muted)' }}>
                    {ROTULO_FILTRO[f]}
                  </Link>
                ))}
              </div>
            </div>

            {filas.length === 0 ? (
              <EstadoVacio icono={<Inbox width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
                {filtro === 'todos'
                  ? 'Aún no hay viajes registrados — el primero que despaches aparece aquí.'
                  : `Ningún viaje cae en «${ROTULO_FILTRO[filtro]}» dentro de los ${numero(cargados)} más recientes.`}
              </EstadoVacio>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="text-left" style={{ color: 'var(--faint)' }}>
                      <th className="etiqueta-mono text-[10px] uppercase font-normal pb-2">Viaje</th>
                      <th className="etiqueta-mono text-[10px] uppercase font-normal pb-2">Operador</th>
                      <th className="etiqueta-mono text-[10px] uppercase font-normal pb-2">Inicio</th>
                      <th className="etiqueta-mono text-[10px] uppercase font-normal pb-2">Aviso al chofer</th>
                      <th className="etiqueta-mono text-[10px] uppercase font-normal pb-2 pr-6 text-right">Fotos en proceso</th>
                      <th className="etiqueta-mono text-[10px] uppercase font-normal pb-2">Estatus</th>
                      <th className="pb-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {filas.map((v) => {
                      const e = PILL_ESTATUS[v.estatus] ?? { etiqueta: v.estatus, fg: 'var(--muted)', bg: 'var(--canvas)' };
                      return (
                        <tr key={v.id} className="border-t" style={{ borderColor: 'var(--line2)' }}>
                          <td className="py-2">
                            <span className="font-medium block">{v.folio}</span>
                            <span className="block text-[11px]" style={{ color: 'var(--faint)' }}>
                              {v.origen && v.destino ? `${v.origen} → ${v.destino}` : v.origen ?? v.destino ?? 'sin ruta capturada'}
                            </span>
                          </td>
                          <td className="py-2" style={{ color: 'var(--muted)' }}>{v.operadorNombre ?? 'Sin asignar'}</td>
                          <td className="py-2" style={{ color: 'var(--muted)' }}>{v.fechaInicio ? fechaCorta(v.fechaInicio) : '—'}</td>
                          <td className="py-2">
                            {v.estatus === 'liquidado'
                              ? <span style={{ color: 'var(--faint)' }}>—</span>
                              : <PillAviso v={v} />}
                          </td>
                          <td className="py-2 pr-6 text-right cifra-mono" style={{ color: v.intakePendientes > 0 ? undefined : 'var(--faint)' }}>
                            {v.intakePendientes > 0 ? numero(v.intakePendientes) : '—'}
                          </td>
                          <td className="py-2">
                            <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium"
                              style={{ color: e.fg, background: e.bg }}>{e.etiqueta}</span>
                          </td>
                          <td className="py-2 text-right">
                            {v.liqId && (
                              <Link href={`/dashboard/${v.liqId}${sufijo}`}
                                className="inline-flex items-center gap-1 text-[12px] font-medium hover:opacity-70 transition-opacity"
                                style={{ color: 'var(--marca)' }}>
                                Ver <ArrowRight width={12} height={12} strokeWidth={2} />
                              </Link>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <p className="text-[11px] mt-3" style={{ color: 'var(--faint)' }}>
                  La tabla enseña los {numero(cargados)} viajes más recientes; los conteos de arriba
                  sí cuentan todo el histórico.
                </p>
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
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
