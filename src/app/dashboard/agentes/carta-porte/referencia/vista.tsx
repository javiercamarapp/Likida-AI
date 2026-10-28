import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { numero } from '@/lib/formato';
import type { ClienteRef, Tablero } from '@/lib/likida/carta_porte_docs/referencia_cliente';
import { REFERENCIA_MAX } from '@/lib/likida/carta_porte_docs/referencia_cliente';
import { BotonEnvio, CAMPO, FormaAccion, type AccionDoc } from '../../../carta-porte/documentos/forma_accion';

export interface VerComo { tenant?: string; rol?: string; vista?: string }

function Ocultos({ ver }: { ver: VerComo }) {
  return (
    <>
      {ver.tenant && <input type="hidden" name="tenant" value={ver.tenant} />}
      {ver.rol && <input type="hidden" name="rol" value={ver.rol} />}
      {ver.vista && <input type="hidden" name="vista" value={ver.vista} />}
    </>
  );
}

export function VistaReferencia({ tablero, clientes, exigen, folios, truncado, sufijo, ver, acciones }: {
  /** `null` = la lectura falló (se dice, no se pinta «sin pendientes»). */
  tablero: Tablero | null;
  clientes: ClienteRef[];
  exigen: ReadonlySet<string>;
  folios: Record<string, string | null>;
  truncado: boolean;
  sufijo: string;
  ver: VerComo;
  acciones: { capturar: AccionDoc; exigencia: AccionDoc };
}) {
  return (
    <main className="max-w-[1100px] mx-auto px-5 py-6 space-y-5">
      <Link href={`/dashboard/agentes/carta-porte${sufijo}`} className="text-[12.5px] font-medium inline-flex items-center gap-1 hover:opacity-75" style={{ color: 'var(--marca)' }}>
        <ArrowLeft width={13} height={13} strokeWidth={1.75} /> Volver al agente de Carta Porte
      </Link>
      <header className="space-y-1">
        <h1 className="font-display text-[19px] font-semibold">Referencia del cliente</h1>
        <p className="text-[12.5px]" style={{ color: 'var(--muted)' }}>
          Algunos clientes necesitan su referencia para cobrar. Aquí ves los viajes ya cargados que no la traen. Es un aviso para quien la pide:
          no frena el viaje ni el timbrado, y la referencia no va dentro de la Carta Porte.
        </p>
      </header>

      {tablero === null ? (
        <p role="alert" className="text-[13px]" style={{ color: 'var(--bad)' }}>No se pudieron leer los viajes. Intenta de nuevo; no significa que no haya pendientes.</p>
      ) : tablero.total === 0 ? (
        <p className="text-[13px]" style={{ color: 'var(--muted)' }}>
          {exigen.size === 0 ? 'Ningún cliente exige referencia todavía. Enciende la regla abajo para los que sí.' : 'No hay viajes cargados sin referencia de los clientes que la exigen.'}
        </p>
      ) : (
        <section aria-label="Pendientes" className="space-y-4">
          <p className="text-[12.5px]"><strong>{numero(tablero.total)}</strong> {tablero.total === 1 ? 'viaje' : 'viajes'} sin referencia{truncado ? ' (la lectura llegó a su tope: faltan los más antiguos)' : ''}.</p>
          {tablero.clientes.map((c) => (
            <div key={c.clienteId} className="card p-3.5 space-y-2">
              <h2 className="text-[13px] font-medium">{c.clienteNombre} · {numero(c.pendientes)} · el más antiguo lleva {numero(c.masAntiguoHoras)} h</h2>
              <ul className="space-y-2">
                {c.viajes.slice(0, 50).map((v) => (
                  <li key={v.viajeId}>
                    <FormaAccion accion={acciones.capturar} className="flex flex-wrap items-center gap-2">
                      <Ocultos ver={ver} />
                      <input type="hidden" name="viajeId" value={v.viajeId} />
                      <span className="text-[12.5px] w-48">Viaje {folios[v.viajeId] ?? v.viajeId.slice(0, 8)} · {numero(v.antiguedadHoras)} h</span>
                      <label className="sr-only" htmlFor={`ref-${v.viajeId}`}>Referencia del viaje</label>
                      <input id={`ref-${v.viajeId}`} name="referencia" maxLength={REFERENCIA_MAX} className={`${CAMPO} !w-64`} placeholder="Referencia del cliente" />
                      <BotonEnvio variante="secundario" etiqueta="Guardar" pendiente="Guardando…" />
                    </FormaAccion>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      )}

      <section aria-label="Qué clientes la exigen" className="card p-3.5 space-y-2">
        <h2 className="text-[13px] font-medium">Clientes que exigen referencia</h2>
        {clientes.length === 0 ? <p className="text-[12.5px]" style={{ color: 'var(--muted)' }}>Aún no hay clientes en la flota.</p> : (
          <ul className="space-y-1.5">
            {clientes.map((c) => (
              <li key={c.id}>
                <FormaAccion accion={acciones.exigencia} className="flex flex-wrap items-center gap-2">
                  <Ocultos ver={ver} />
                  <input type="hidden" name="clienteId" value={c.id} />
                  <input type="hidden" name="exige" value={exigen.has(c.id) ? '0' : '1'} />
                  <span className="text-[12.5px] w-64">{c.nombre} · {exigen.has(c.id) ? 'la exige' : 'no la exige'}</span>
                  <BotonEnvio variante="secundario" etiqueta={exigen.has(c.id) ? 'Dejar de exigir' : 'Exigir'} pendiente="Guardando…" />
                </FormaAccion>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
