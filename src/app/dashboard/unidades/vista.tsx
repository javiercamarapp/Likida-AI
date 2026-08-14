import { Truck, ShieldAlert, ShieldCheck, Clock, CircleDashed, Wrench } from 'lucide-react';
import type { UnidadRow } from '@/lib/likida/operacion';
import { clasificarVigencia, contarVigencias, avisoVigencias, type EstadoVigencia } from '@/lib/likida/vigencias';
import { numero } from '@/lib/formato';
import { EstadoVacio } from '@/app/admin/ui/kit';
import { BarraPagina } from '../resumen-visual';

const PILL: Record<EstadoVigencia, { fg: string; bg: string; Icono: typeof ShieldCheck }> = {
  vencido: { fg: 'var(--bad)', bg: 'var(--badbg)', Icono: ShieldAlert },
  por_vencer: { fg: 'var(--warn)', bg: 'var(--warnbg)', Icono: Clock },
  vigente: { fg: 'var(--ok)', bg: 'var(--okbg)', Icono: ShieldCheck },
  sin_dato: { fg: 'var(--muted)', bg: 'var(--canvas)', Icono: CircleDashed },
};

/** Los estados que `unidad.estado` admite, en palabras de persona. */
const ESTADO_UNIDAD: Record<string, string> = {
  disponible: 'Disponible',
  en_ruta: 'En ruta',
  taller: 'En taller',
  baja: 'Dada de baja',
};

/**
 * EL REGISTRO DE UNIDADES — el activo que produce el dinero, con los papeles
 * que la ley le exige para poder producirlo.
 *
 * Es el patrón de "vigencias que anclan" de Handle (su reporte médico con
 * fecha de caducidad), y en carga pesa más: una unidad con la verificación
 * vencida no tiene un pendiente administrativo, tiene un riesgo de multa, de
 * detención y de un seguro que no responde.
 *
 * El motor ya existía entero (`getUnidades`): elige el papel MÁS PRÓXIMO a
 * vencer de los tres y devuelve los días, negativos si ya pasó. Esta pantalla
 * solo lo dice, y lo dice con las mismas palabras que `/dashboard/operadores`
 * usa para las licencias, porque el clasificador es el mismo módulo.
 *
 * SIN DATO NO ES VIGENTE, y por eso tiene su propia pastilla gris y su propio
 * contador: una unidad a la que nadie le capturó la póliza no está en regla,
 * está sin verificar. Pintarla verde es la mentira que el gerente descubriría
 * cuando lo pare un inspector.
 */
export function VistaUnidades({ unidades }: { unidades: readonly UnidadRow[] }) {
  const activas = unidades.filter((u) => u.activo);
  const conteo = contarVigencias(activas);
  const aviso = avisoVigencias(conteo);

  // El orden es el del trabajo: primero lo vencido, luego lo que va a vencer,
  // y hasta el final lo que está en regla. Ordenar por número económico
  // escondería el problema en la fila 40.
  const PESO: Record<EstadoVigencia, number> = { vencido: 0, por_vencer: 1, sin_dato: 2, vigente: 3 };
  const ordenadas = [...activas].sort((a, b) => {
    const va = clasificarVigencia(a.diasAlVencimiento, a.queVence);
    const vb = clasificarVigencia(b.diasAlVencimiento, b.queVence);
    if (PESO[va.estado] !== PESO[vb.estado]) return PESO[va.estado] - PESO[vb.estado];
    // Dentro del mismo estado, lo más urgente primero.
    return (a.diasAlVencimiento ?? 1e9) - (b.diasAlVencimiento ?? 1e9);
  });

  return (
    <main className="h-full">
      <div className="rounded-2xl min-h-full hairline flex flex-col" style={{ background: 'var(--g1)' }}>
        <BarraPagina
          icono={<Truck width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />}
          titulo="Unidades"
        />

        <div className="px-5 py-5 flex-1 space-y-3">
          {aviso && (
            <div className="flex items-start gap-2.5 px-4 py-3 rounded-xl"
              style={{ background: 'var(--badbg)', color: 'var(--bad)' }}>
              <ShieldAlert width={16} height={16} strokeWidth={1.75} className="mt-0.5 shrink-0" />
              <div>
                <p className="text-[13px] font-medium">Papeles que requieren atención</p>
                <p className="text-[12.5px] mt-0.5">{aviso}</p>
              </div>
            </div>
          )}

          {activas.length === 0 ? (
            <EstadoVacio icono={<Truck width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
              Todavía no hay unidades dadas de alta. Cuando registres tus tractocamiones con su póliza,
              permiso SICT y verificación, aquí se ve cuál está por vencer antes de que te pare un inspector.
            </EstadoVacio>
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
                {([
                  ['Vencidos', conteo.vencidos, 'var(--bad)'],
                  [`Vencen en 30 días`, conteo.porVencer, 'var(--warn)'],
                  ['En regla', conteo.vigentes, 'var(--ok)'],
                  ['Sin papeles', conteo.sinDato, 'var(--muted)'],
                ] as const).map(([rotulo, n, color]) => (
                  <div key={rotulo} className="card p-3.5">
                    <div className="text-[20px] font-semibold tabular" style={{ color: n > 0 ? color : 'var(--muted)' }}>
                      {numero(n)}
                    </div>
                    <div className="text-[11px] mt-0.5" style={{ color: 'var(--muted)' }}>{rotulo}</div>
                  </div>
                ))}
              </div>

              {ordenadas.map((u) => {
                const v = clasificarVigencia(u.diasAlVencimiento, u.queVence);
                const p = PILL[v.estado];
                return (
                  <section key={u.id} className="card p-4">
                    <div className="flex items-start gap-3">
                      <p.Icono width={16} height={16} strokeWidth={1.75} className="mt-0.5 shrink-0" style={{ color: p.fg }} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h2 className="font-display text-[14px] font-semibold">{u.numeroEconomico}</h2>
                          {u.placas && (
                            <span className="text-[12px] cifra-mono" style={{ color: 'var(--muted)' }}>{u.placas}</span>
                          )}
                          <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium"
                            style={{ color: 'var(--muted)', background: 'var(--canvas)' }}>
                            {ESTADO_UNIDAD[u.estado] ?? u.estado}
                          </span>
                        </div>

                        {(u.marca || u.modelo || u.anio) && (
                          <p className="text-[12.5px] mt-0.5" style={{ color: 'var(--muted)' }}>
                            {[u.marca, u.modelo, u.anio].filter(Boolean).join(' · ')}
                          </p>
                        )}

                        <div className="flex items-center gap-2 mt-2 flex-wrap">
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium"
                            style={{ color: p.fg, background: p.bg }}>
                            {v.rotulo}
                          </span>
                          {u.ordenesAbiertas > 0 && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium"
                              style={{ color: 'var(--warn)', background: 'var(--warnbg)' }}>
                              <Wrench width={11} height={11} strokeWidth={1.75} />
                              {u.ordenesAbiertas === 1 ? '1 orden abierta' : `${u.ordenesAbiertas} órdenes abiertas`}
                            </span>
                          )}
                          {u.kmActual !== null && (
                            <span className="text-[11px] cifra-mono" style={{ color: 'var(--faint)' }}>
                              {numero(u.kmActual)} km
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </section>
                );
              })}

              <p className="text-[11px] pt-1" style={{ color: 'var(--faint)' }}>
                Se avisa del papel MÁS próximo a vencer de los tres (póliza, permiso SICT, verificación).
                Una unidad sin fecha capturada sale como &quot;sin papeles&quot;, no como vigente — no sabemos
                si está en regla, y decir que sí sería inventarlo.
              </p>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
