import Link from 'next/link';
import { Scale, ArrowRight, Inbox, CircleCheck, CircleAlert, CircleSlash } from 'lucide-react';
import type { ConciliacionConsolidado, LineaPorConciliar, DesgloseRecibido } from '@/lib/likida/analytics';
import { mxn, numero, fechaCorta } from '@/lib/formato';
import { LEYENDA_CORTA } from '@/lib/likida/cuadre/leyendas';
import { EstadoVacio } from '@/app/admin/ui/kit';
import { BarraPagina } from '../../resumen-visual';
import { SubirDesglose, type AccionSubir } from './subir';
import { BotonEjecutar, type AccionBarrer } from './controles';

/**
 * La ventana del Agente de Peajes (F5): lo que el estado de cuenta del
 * TAG/monedero dice contra lo que los viajes comprobaron. Tres cubetas
 * honestas — conciliadas / por conciliar / sin gasto que corresponda — y el
 * estado del estímulo de peaje (LIF 2026 art. 20, ap. A) SIN presentar el
 * bruto como ahorro. La mesa para resolver a mano vive en Combustible y
 * casetas.
 *
 * AUDITORÍA 3 FI-A1, ALTO: la card del estímulo citaba la RMF 9.1.8 —regla
 * SIN ficha en `normas/`— y pintaba en verde ("Factor 0.5 sobre el importe
 * sin IVA") lo que la ficha verificada `normas/lif-2026-20-A.yaml` deja SIN
 * RESOLVER (H4: la ley dice "gasto total erogado", el motor usa el subtotal
 * sin IVA). Ahora cada renglón dice exactamente lo que su ficha sostiene, la
 * única cita normativa es la que SÍ tiene ficha verificada, las cuatro
 * condiciones de elegibilidad de la ley se listan completas (antes solo una),
 * y la cifra lleva la leyenda de descargo de CFF 89 (`cuadre/leyendas.ts`)
 * que ya llevan las demás pantallas con cifra fiscal.
 */
export function VistaAgentePeajes({
  conciliacion, lineas, desgloses, peajeAcreditable, sufijo, subirDesglose, ejecutarAhora, notificaciones,
}: {
  conciliacion: ConciliacionConsolidado | null;
  lineas: LineaPorConciliar[] | null;
  desgloses: DesgloseRecibido[] | null;
  /** Peaje con factor 0.5 ya aplicado por el motor, histórico. null = no se pudo leer. */
  peajeAcreditable: number | null;
  sufijo: string;
  subirDesglose: AccionSubir;
  /** El barrido a demanda: re-cruza la cola contra los gastos de hoy. */
  ejecutarAhora: AccionBarrer;
  /** La sección de Notificaciones, ya renderizada en el servidor
   *  (`SeccionNotificaciones`). Entra como ReactNode y no como datos: esta
   *  vista no debe importar el motor de avisos, que trae `supabaseAdmin`. */
  notificaciones?: React.ReactNode;
}) {
  const total = conciliacion ? conciliacion.conciliadas + conciliacion.porConciliar + conciliacion.sinMatch : 0;
  const pct = conciliacion && total > 0 ? Math.round((conciliacion.conciliadas / total) * 100) : null;

  return (
    <main className="h-full">
      <div className="rounded-2xl min-h-full hairline flex flex-col" style={{ background: 'var(--g1)' }}>
        <BarraPagina
          icono={<Scale width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />}
          titulo="Agente de Peajes"
        />
        <div className="px-5 py-5 flex-1 space-y-4">

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Kpi titulo="Líneas conciliadas" valor={conciliacion ? numero(conciliacion.conciliadas) : '—'}
              nota={pct !== null ? `${numero(pct)}% del estado de cuenta` : 'aún sin estados de cuenta'} />
            <Kpi titulo="Por conciliar" valor={conciliacion ? numero(conciliacion.porConciliar) : '—'}
              nota="esperan a un humano" tono={(conciliacion?.porConciliar ?? 0) > 0 ? 'warn' : undefined} />
            <Kpi titulo="Sin gasto que corresponda" valor={conciliacion ? numero(conciliacion.sinMatch) : '—'}
              nota="revisadas y documentadas" />
            <Kpi titulo="Estados de cuenta" valor={conciliacion ? numero(conciliacion.cfdis) : '—'}
              nota="CFDI consolidados recibidos" />
          </div>

          {/* ── La ingesta: el ritual del PoC ── */}
          <section className="card p-4">
            <h2 className="font-display text-[15px] font-semibold mb-1">Subir estado de cuenta</h2>
            <p className="text-[11px] mb-3" style={{ color: 'var(--faint)' }}>
              El XML del CFDI consolidado del TAG o del monedero — el mismo que el proveedor manda
              cada corte. El agente lo cruza contra los gastos de los viajes al instante.
              (También entra reenviándolo al WhatsApp de Likida desde la oficina. El desglose en
              Excel/PDF todavía no entra por aquí.)
            </p>
            <SubirDesglose subirDesglose={subirDesglose} />
          </section>

          <div className="grid lg:grid-cols-2 gap-4">
            {/* La cola honesta */}
            <section className="card p-4 flex flex-col">
              <div className="flex items-start justify-between gap-3 mb-1">
                <h2 className="font-display text-[15px] font-semibold">Esperan a un humano</h2>
                {(lineas?.length ?? 0) > 0 && (
                  <Link href={`/dashboard/combustible-casetas${sufijo}`}
                    className="inline-flex items-center gap-1 text-[12px] font-medium hover:opacity-70 transition-opacity shrink-0"
                    style={{ color: 'var(--marca)' }}>
                    Resolver en la mesa <ArrowRight width={12} height={12} strokeWidth={2} />
                  </Link>
                )}
              </div>
              <p className="text-[11px] mb-3" style={{ color: 'var(--faint)' }}>
                Líneas del estado de cuenta a las que el cruce automático no les encontró gasto único.
                El barrido las re-cruza contra los gastos que llegaron después.
              </p>
              <div className="mb-3">
                <BotonEjecutar ejecutarAhora={ejecutarAhora} pendientes={lineas === null ? null : lineas.length} />
              </div>
              {lineas === null ? (
                <Leyenda>No se pudo leer la cola ahora mismo.</Leyenda>
              ) : lineas.length === 0 ? (
                <Leyenda>Nada espera a un humano — cada línea nueva que el cruce no
                  resuelva solo, aparece aquí.</Leyenda>
              ) : (
                <div className="space-y-2">
                  {lineas.slice(0, 6).map((l) => (
                    <div key={l.id} className="flex items-center gap-2.5 text-[12.5px]">
                      <span className="shrink-0" style={{ color: 'var(--muted)' }}>{l.fecha ? fechaCorta(l.fecha) : 'sin fecha'}</span>
                      <span className="truncate" title={l.descripcion ?? undefined}>{l.descripcion ?? 'sin descripción'}</span>
                      <span className="ml-auto shrink-0 cifra-mono">{mxn(l.monto)}</span>
                      <span className="shrink-0 text-[11px]" style={{ color: 'var(--faint)' }}>
                        {l.candidatos.length === 0 ? 'sin candidatos' : `${numero(l.candidatos.length)} candidato${l.candidatos.length === 1 ? '' : 's'}`}
                      </span>
                    </div>
                  ))}
                  {lineas.length > 6 && (
                    <p className="text-[11px] pt-1" style={{ color: 'var(--faint)' }}>
                      y {numero(lineas.length - 6)} más en la mesa.
                    </p>
                  )}
                </div>
              )}
            </section>

            {/* Bitácora de desgloses */}
            <section className="card p-4 flex flex-col">
              <h2 className="font-display text-[15px] font-semibold mb-1">Estados de cuenta recibidos</h2>
              <p className="text-[11px] mb-3" style={{ color: 'var(--faint)' }}>Cada consolidado, con el saldo de su cruce</p>
              {desgloses === null ? (
                <Leyenda>No se pudo leer la bitácora ahora mismo.</Leyenda>
              ) : desgloses.length === 0 ? (
                <EstadoVacio icono={<Inbox width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
                  Aún no llega ningún estado de cuenta — súbelo arriba o reenvíalo por WhatsApp
                  y el cruce corre solo.
                </EstadoVacio>
              ) : (
                <div className="space-y-2.5 text-[12.5px]">
                  {desgloses.map((d) => (
                    <div key={d.cfdiXmlId} className="flex items-center gap-2.5">
                      <span className="cifra-mono text-[11px] shrink-0" style={{ color: 'var(--faint)' }}>{d.uuidCorto}</span>
                      <span className="shrink-0" style={{ color: 'var(--muted)' }}>{d.recibido ? fechaCorta(d.recibido) : '—'}</span>
                      <span className="ml-auto shrink-0 cifra-mono">{mxn(d.monto)}</span>
                      <span className="shrink-0 inline-flex items-center gap-1 text-[11px]" style={{ color: 'var(--ok)' }}>
                        <CircleCheck width={11} height={11} strokeWidth={2} /> {numero(d.conciliadas)}
                      </span>
                      {d.porConciliar > 0 && (
                        <span className="shrink-0 inline-flex items-center gap-1 text-[11px]" style={{ color: 'var(--warn)' }}>
                          <CircleAlert width={11} height={11} strokeWidth={2} /> {numero(d.porConciliar)}
                        </span>
                      )}
                      {d.sinMatch > 0 && (
                        <span className="shrink-0 inline-flex items-center gap-1 text-[11px]" style={{ color: 'var(--muted)' }}>
                          <CircleSlash width={11} height={11} strokeWidth={2} /> {numero(d.sinMatch)}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>

          {/* ── El estímulo de peaje: cada renglón dice lo que su ficha sostiene ── */}
          <section className="card p-4">
            <h2 className="font-display text-[15px] font-semibold mb-1">El estímulo de peaje — hasta 50% (LIF 2026 art. 20, ap. A)</h2>
            <p className="text-[11px] mb-3" style={{ color: 'var(--faint)' }}>
              La ley otorga un acreditamiento de hasta el 50% del gasto en autopistas de cuota,
              aplicable únicamente cumpliendo los requisitos que el SAT fija en reglas de carácter
              general. Ese texto del SAT Likida aún no lo tiene verificado, así que esta pantalla
              no afirma qué pide. Lo que sí produce: cada línea del TAG ligada a su gasto de viaje.
            </p>
            <div className="grid md:grid-cols-2 gap-x-6 gap-y-1.5 text-[12.5px]">
              <Requisito tono="ok" texto="Cruce del estado de cuenta del TAG contra los gastos de los viajes, por monto y fecha — es lo que esta pantalla produce" />
              <Requisito tono="abierto" texto="Factor 0.5 por viaje sobre el subtotal SIN IVA — la base exacta está sin resolver: la ley dice «gasto total erogado» y el motor usa la lectura conservadora sin IVA (~13.8% menos que sobre el total); pregunta para tu contador" />
              <Requisito tono="abierto" texto="Requisitos operativos de las reglas del SAT — sin texto verificado: Likida no afirma cuáles son ni que este cruce los cumpla; confírmalos con tu contador" />
              <Requisito tono="flota" texto="Dedicación EXCLUSIVA al transporte terrestre de carga, pasaje o turismo — lo declara la flota, Likida no lo verifica" />
              <Requisito tono="flota" texto="Casetas de la Red Nacional de Autopistas de Cuota — el motor no distingue la red: aplica el factor a toda caseta" />
              <Requisito tono="flota" texto="Ingresos anuales menores a $300 millones — dato de la flota, Likida no lo conoce" />
              <Requisito tono="flota" texto="No ser parte relacionada (LISR art. 179) — dato de la flota, Likida no lo conoce" />
            </div>
            {peajeAcreditable !== null && (
              <p className="text-[12px] mt-3 pt-2.5 border-t" style={{ color: 'var(--muted)', borderColor: 'var(--line2)' }}>
                Peaje con el factor ya aplicado, histórico:{' '}
                <span className="cifra-mono font-medium" style={{ color: 'var(--ink)' }}>{mxn(peajeAcreditable)}</span>
                {' '}— es estímulo BRUTO, sujeto a las condiciones de arriba, y es ingreso acumulable:
                tu contador lo neta de ISR.
              </p>
            )}
            <p className="text-[11px] pt-3" style={{ color: 'var(--faint)' }}>{LEYENDA_CORTA}</p>
          </section>

          {notificaciones}
        </div>
      </div>
    </main>
  );
}

/**
 * Tres tonos y ninguno miente:
 * - `ok`      (palomita verde): hecho verificable en esta pantalla o sostenido
 *   por ficha verificada. Es el único que afirma.
 * - `abierto` (alerta ámbar): pregunta abierta — la ficha lo deja SIN RESOLVER
 *   o la regla no tiene texto verificado. Antes esto salía en verde (FI-A1).
 * - `flota`   (alerta gris): condición que va por cuenta de la flota; Likida
 *   no la conoce ni la verifica.
 */
function Requisito({ tono, texto }: { tono: 'ok' | 'abierto' | 'flota'; texto: string }) {
  return (
    <div className="flex items-start gap-2">
      {tono === 'ok'
        ? <CircleCheck width={13} height={13} strokeWidth={2} className="mt-0.5 shrink-0" style={{ color: 'var(--ok)' }} />
        : <CircleAlert width={13} height={13} strokeWidth={2} className="mt-0.5 shrink-0" style={{ color: tono === 'abierto' ? 'var(--warn)' : 'var(--muted)' }} />}
      <span style={{ color: tono === 'ok' ? undefined : 'var(--muted)' }}>{texto}</span>
    </div>
  );
}

function Leyenda({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex-1 min-h-[110px] flex items-center justify-center">
      <p className="text-[12.5px] text-center max-w-[34ch]" style={{ color: 'var(--muted)' }}>{children}</p>
    </div>
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
