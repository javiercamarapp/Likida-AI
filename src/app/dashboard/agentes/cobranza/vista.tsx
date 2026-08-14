import { BellRing, Inbox, PhoneOff, Check, X } from 'lucide-react';
import type { ColaCobranza, ContactoBitacora, FilaCola } from '@/lib/likida/agentes/cobranza';
import type { ConfigCobranza } from '@/lib/likida/agentes/cobranza_pura';
import { numero, fechaCorta } from '@/lib/formato';
import { EstadoVacio } from '@/app/admin/ui/kit';
import { BarraPagina } from '../../resumen-visual';
import { BotonEjecutar, BotonPausa, type AccionSimple, type AccionEjecutar } from './controles';
import { FormaEstrategia } from './estrategia';

export interface ExtraAgenteCobranza {
  /** ¿AHORA MISMO está dentro de su ventana de contacto? (calculado en el
   *  servidor con la hora de México, no la del navegador). */
  enVentana: boolean;
  /** El siguiente REAL de la cola (folio + días JUNTOS: un folio verdadero
   *  con días que no son los suyos contradiría la tabla de arriba). null =
   *  cola vacía; la vista previa se declara plantilla. */
  ejemplo: { folio: string | null; dias: number } | null;
}

/** Los días ISO como los lee un humano de tráfico. */
const DIA_CORTO = ['', 'L', 'M', 'X', 'J', 'V', 'S', 'D'];
function rotuloDias(dias: number[]): string {
  // Contiguos → rango ("L–S"); salteados → lista ("L, X, V").
  const contiguos = dias.every((d, i) => i === 0 || d === dias[i - 1] + 1);
  if (contiguos && dias.length > 2) return `${DIA_CORTO[dias[0]]}–${DIA_CORTO[dias[dias.length - 1]]}`;
  return dias.map((d) => DIA_CORTO[d]).join(', ');
}

/**
 * El render del Agente de Cobranza (Fase 1 del plan). Tres zonas de la
 * anatomía Handle: la cola honesta (a quién va a insistir Y a quién no puede,
 * con el porqué), la bitácora de lo que ya hizo, y la estrategia que el
 * cliente edita con la vista previa del mensaje real.
 *
 * AQUÍ NO HAY PESOS A PROPÓSITO: este agente cobra COMPROBANTES, no dinero.
 * Sus cifras son días y contactos, todas medidas.
 */
export function VistaAgenteCobranza({
  cola, config, bitacora, extra, acciones,
}: {
  cola: ColaCobranza;
  config: ConfigCobranza;
  bitacora: ContactoBitacora[] | null;
  extra: ExtraAgenteCobranza;
  acciones: { guardarEstrategia: AccionSimple; alternarPausa: AccionSimple; ejecutarAhora: AccionEjecutar };
}) {
  const ventana = `${rotuloDias(config.diasSemana)} · ${config.horaInicio}–${config.horaFin} h`;

  return (
    <main className="h-full">
      <div className="rounded-2xl min-h-full hairline flex flex-col" style={{ background: 'var(--g1)' }}>
        <BarraPagina
          icono={<BellRing width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />}
          titulo="Agente de Cobranza"
        />
        <div className="px-5 py-5 flex-1 space-y-4">

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Kpi titulo="Para contactar" valor={numero(cola.paraContactar.length)}
              nota="alcanzaron un tier sin contacto" />
            <Kpi titulo="No puede contactar" valor={numero(cola.sinTelefono.length)}
              nota="sin teléfono capturado" tono={cola.sinTelefono.length > 0 ? 'warn' : undefined} />
            <Kpi titulo="Viajes vigilados" valor={numero(cola.vigilados)} nota="abiertos o en cuadre" />
            <Kpi titulo="Estado" valor={config.activo ? 'Activo' : 'Pausado'} nota={ventana}
              tono={config.activo ? undefined : 'warn'} />
          </div>

          {/* ── La cola honesta ── */}
          <section className="card p-4">
            <div className="flex items-start justify-between gap-3 mb-1">
              <div>
                <h2 className="font-display text-[15px] font-semibold">Los va a contactar</h2>
                <p className="text-[11px] mt-0.5" style={{ color: 'var(--faint)' }}>
                  {!config.activo
                    ? 'El agente está pausado: no contacta a nadie, ni con Ejecutar ahora.'
                    : extra.enVentana
                      ? 'Dentro de la ventana — la próxima corrida de la hora los contacta sola.'
                      : `Fuera de la ventana (${ventana}) — los contacta cuando abra, o ahora si tú se lo pides.`}
                </p>
              </div>
              <BotonEjecutar
                ejecutarAhora={acciones.ejecutarAhora}
                enCola={cola.paraContactar.length}
                activo={config.activo}
              />
            </div>
            {cola.paraContactar.length === 0 ? (
              <EstadoVacio icono={<Inbox width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
                Nadie trae comprobantes atrasados a los tiers de hoy — cuando un viaje cruce
                los {config.tiers[0]} días sin comprobar, aparece aquí antes de que el agente le escriba.
              </EstadoVacio>
            ) : (
              <TablaCola filas={cola.paraContactar} />
            )}
          </section>

          <div className="grid lg:grid-cols-2 gap-4">
            {/* A quién NO puede — la mitad honesta de la cola */}
            <section className="card p-4 flex flex-col">
              <h2 className="font-display text-[15px] font-semibold mb-1">A quién no puede escribirle</h2>
              <p className="text-[11px] mb-3" style={{ color: 'var(--faint)' }}>
                Alcanzaron un tier, pero el operador no tiene teléfono capturado
              </p>
              {cola.sinTelefono.length === 0 ? (
                <Leyenda>Todos los operadores con viajes atrasados tienen teléfono — el agente
                  no trae las manos atadas con nadie.</Leyenda>
              ) : (
                <div className="space-y-2">
                  {cola.sinTelefono.map((f) => (
                    <div key={f.viajeId} className="flex items-center gap-2.5 text-[12.5px]">
                      <PhoneOff width={13} height={13} strokeWidth={1.75} className="shrink-0" style={{ color: 'var(--warn)' }} />
                      <span className="font-medium">{f.folio ?? 'Sin folio'}</span>
                      <span className="truncate" style={{ color: 'var(--muted)' }}>{f.operadorNombre ?? 'Operador sin nombre'}</span>
                      <span className="cifra-mono ml-auto shrink-0" style={{ color: 'var(--muted)' }}>{numero(f.dias)} días</span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Bitácora — lo que ya hizo, con sus fallos a la vista */}
            <section className="card p-4 flex flex-col">
              <h2 className="font-display text-[15px] font-semibold mb-1">Bitácora de contactos</h2>
              <p className="text-[11px] mb-3" style={{ color: 'var(--faint)' }}>Los últimos intentos, salieran o no</p>
              {bitacora === null ? (
                <Leyenda>No se pudo leer la bitácora ahora mismo.</Leyenda>
              ) : bitacora.length === 0 ? (
                <Leyenda>Aún sin contactos — cada intento del agente queda escrito aquí,
                  incluidos los que no salieron y su porqué.</Leyenda>
              ) : (
                <div className="space-y-2.5 text-[12.5px]">
                  {bitacora.map((c, i) => (
                    <div key={i} className="flex items-start gap-2">
                      {c.enviado
                        ? <Check width={13} height={13} strokeWidth={2} className="mt-0.5 shrink-0" style={{ color: 'var(--ok)' }} />
                        : <X width={13} height={13} strokeWidth={2} className="mt-0.5 shrink-0" style={{ color: 'var(--bad)' }} />}
                      <div className="min-w-0">
                        {c.enviado ? (
                          <span>Le insistió a <span className="font-medium">{c.operadorNombre ?? 'el operador'}</span> por
                            el viaje <span className="font-medium">{c.folio ?? 'sin folio'}</span> (tier de {c.tier} días)</span>
                        ) : (
                          <span>No le pudo escribir a <span className="font-medium">{c.operadorNombre ?? 'el operador'}</span> por
                            el viaje <span className="font-medium">{c.folio ?? 'sin folio'}</span>{c.detalle ? ` — ${c.detalle}` : ''}</span>
                        )}
                        <span className="block text-[11px]" style={{ color: 'var(--faint)' }}>{fechaCorta(c.cuando)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>

          {/* ── La estrategia del cliente, con vista previa (las "Pruebas") ── */}
          <section className="card p-4">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div>
                <h2 className="font-display text-[15px] font-semibold">Su estrategia</h2>
                <p className="text-[11px] mt-0.5" style={{ color: 'var(--faint)' }}>
                  Cuándo insiste, en qué horario y con qué palabras — la vista previa es el mensaje literal
                </p>
              </div>
              <BotonPausa alternarPausa={acciones.alternarPausa} activo={config.activo} />
            </div>
            <FormaEstrategia
              config={config}
              ejemplo={extra.ejemplo}
              guardar={acciones.guardarEstrategia}
            />
          </section>
        </div>
      </div>
    </main>
  );
}

/** Leyenda de vacío/pendiente — centrada por alto y ancho, como TODAS las
 *  leyendas del panel (regla del 12-ago). */
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

function TablaCola({ filas }: { filas: FilaCola[] }) {
  return (
    <div className="overflow-x-auto mt-3">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="text-left" style={{ color: 'var(--faint)' }}>
            <th className="etiqueta-mono text-[10px] uppercase font-normal pb-2">Viaje</th>
            <th className="etiqueta-mono text-[10px] uppercase font-normal pb-2">Operador</th>
            <th className="etiqueta-mono text-[10px] uppercase font-normal pb-2 text-right">Sin comprobar</th>
            <th className="etiqueta-mono text-[10px] uppercase font-normal pb-2 text-right">Tier que toca</th>
            <th className="etiqueta-mono text-[10px] uppercase font-normal pb-2 text-right">Contactos previos</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((f) => (
            <tr key={f.viajeId} className="border-t" style={{ borderColor: 'var(--line2)' }}>
              <td className="py-2 font-medium">{f.folio ?? 'Sin folio'}</td>
              <td className="py-2" style={{ color: 'var(--muted)' }}>{f.operadorNombre ?? 'Sin nombre'}</td>
              <td className="py-2 text-right cifra-mono">{numero(f.dias)} días</td>
              <td className="py-2 text-right">
                <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium cifra-mono"
                  style={{ color: 'var(--warn)', background: 'var(--warnbg)' }}>
                  {f.tier} días
                </span>
              </td>
              <td className="py-2 text-right cifra-mono" style={{ color: 'var(--muted)' }}>{numero(f.contactosPrevios)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
