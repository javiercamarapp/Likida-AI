'use client';

import { useActionState, useState } from 'react';
import Link from 'next/link';
import { Archive, Link2, RotateCcw, Search, TriangleAlert } from 'lucide-react';
import { fechaMx, fechaHoraMx, mxn } from '@/lib/formato';
import { StatusPill } from '../../../admin/ui/kit';
import type { FilaBandeja, CandidatoVista, GastoCandidatoBusqueda } from '@/lib/likida/sat_descarga/bandeja';

// ═══════════════════════════════════════════════════════════════════════════
// UN COMPROBANTE Y LO QUE SE PUEDE HACER CON ÉL.
//
// Los botones que aparecen dependen del estatus, y esa es toda la lógica de
// esta pantalla:
//
//   · ambiguo    → LOS CANDIDATOS, con lo que el motor anotó Y lo que el gasto
//                  dice hoy, más «archivar con motivo».
//   · disponible → «buscar un gasto» (un buscador, jamás una lista de todo) y
//                  «archivar con motivo».
//   · casado     → «deshacer», con motivo obligatorio.
//   · ignorado   → «devolver a la bandeja», con motivo obligatorio.
//
// TODO LO QUE QUITA UNA AFIRMACIÓN PIDE MOTIVO ANTES DE ENVIAR, y el botón se
// deshabilita mientras corre: ligar no es idempotente y el doble clic en una
// red lenta manda dos veces la misma decisión.
//
// EL EXPEDIENTE SE VE DEBAJO DE LA FILA, siempre que exista. Es la mitad que
// hace que «deshacer» sea distinto de «borrar»: quien mire esta pantalla
// dentro de seis meses tiene que poder leer que alguien ligó, que otro lo
// deshizo, y por qué.
// ═══════════════════════════════════════════════════════════════════════════

export type ResultadoFila = { ok?: string; error?: string } | null;
export type AccionFila = (previo: ResultadoFila, fd: FormData) => Promise<ResultadoFila>;

/** Qué dice un candidato HOY, sin adivinar cuando no se pudo comprobar. */
function EstadoCandidato({ c }: { c: CandidatoVista }) {
  if (c.vive === null) {
    return (
      <span className="text-[11.5px]" style={{ color: 'var(--warn)' }}>
        no se pudo comprobar si este gasto sigue ahí
      </span>
    );
  }
  if (c.vive === false) {
    return (
      <span className="text-[11.5px]" style={{ color: 'var(--bad)' }}>
        ese gasto ya no existe (se borró el viaje del que colgaba)
      </span>
    );
  }
  if (c.yaTieneCfdi === true) {
    return (
      <span className="text-[11.5px]" style={{ color: 'var(--warn)' }}>
        ya tiene comprobante — le llegó por otro camino
      </span>
    );
  }
  // EL GASTO CAMBIÓ DESDE EL CRUCE — y solo entonces se dice. Repetir «hoy:
  // $1,160 · 24 ago · caseta» debajo de un candidato idéntico llena la fila de
  // ruido y entierra justo el caso que importa: el gasto al que alguien le
  // movió el monto o la fecha entre que el motor lo propuso y hoy.
  const cambio = c.montoHoy !== c.montoOfrecido
    || c.fechaHoy !== c.fechaOfrecida
    || c.conceptoHoy !== c.conceptoOfrecido;
  if (!cambio) {
    return (
      <span className="text-[11.5px]" style={{ color: 'var(--muted)' }}>
        sin cambios desde el cruce
      </span>
    );
  }
  return (
    <span className="text-[11.5px]" style={{ color: 'var(--warn)' }}>
      cambió — hoy: {c.montoHoy === null ? 'sin monto legible' : mxn(c.montoHoy)}
      {c.fechaHoy ? ` · ${fechaMx(c.fechaHoy)}` : ''}
      {c.conceptoHoy ? ` · ${c.conceptoHoy}` : ''}
    </span>
  );
}

export function FilaComprobante({
  fila, accion, hrefBuscar, hrefCerrarBusqueda, busqueda,
}: {
  fila: FilaBandeja;
  accion: AccionFila;
  /** A dónde va «buscar un gasto». `null` cuando esta fila no lo ofrece. */
  hrefBuscar: string | null;
  hrefCerrarBusqueda: string | null;
  /** Los resultados del buscador, SOLO para la fila que lo tiene abierto. */
  busqueda: {
    gastos: GastoCandidatoBusqueda[];
    truncada: boolean;
    error: string | null;
    importe: string;
    desde: string;
    hasta: string;
    texto: string;
    campoPagina: Array<{ nombre: string; valor: string }>;
  } | null;
}) {
  const [estado, enviar, pendiente] = useActionState<ResultadoFila, FormData>(accion, null);
  const [motivando, setMotivando] = useState<null | 'ignorar' | 'revertir'>(null);

  return (
    <li className="hairline rounded-lg p-3 list-none" style={{ background: 'var(--surface)' }}>
      {/* ── La identidad del comprobante ─────────────────────────────── */}
      <div className="flex items-start gap-2 flex-wrap">
        <span className="text-[13px] font-medium">
          {/* `null` ≠ 0: un CFDI sin total legible lo dice. */}
          {fila.total === null
            ? <span style={{ color: 'var(--warn)' }}>sin total legible</span>
            : mxn(fila.total)}
        </span>
        <StatusPill estado={
          fila.estatus === 'casado' ? 'ok'
            : fila.estatus === 'ambiguo' ? 'warn'
              : fila.estatus === 'ignorado' ? 'neutral' : 'bad'
        }>
          {fila.estatus}
        </StatusPill>
        <span className="text-[12px]" style={{ color: 'var(--muted)' }}>
          {fila.rfcEmisor ?? 'sin RFC de emisor'}
          {' · '}
          {fila.fecha ? fechaMx(fila.fecha) : 'sin fecha'}
          {fila.tipoComprobante ? ` · tipo ${fila.tipoComprobante}` : ''}
        </span>
        <span className="ml-auto cifra-mono text-[10.5px] shrink-0" style={{ color: 'var(--faint)' }}
          title="Folio fiscal — la llave del comprobante ante el SAT">
          {fila.cfdiUuid}
        </span>
      </div>

      {/* Lo que el motor dijo, TAL CUAL. */}
      {fila.motivo && (
        <p className="text-[12px] mt-1.5 m-0" style={{ color: 'var(--muted)' }}>{fila.motivo}</p>
      )}

      {/* La firma viva: quién dejó esta fila como está. */}
      {fila.resueltoPorEmail && (
        <p className="text-[11.5px] mt-1 m-0" style={{ color: 'var(--faint)' }}>
          Lo dejó así {fila.resueltoPorEmail}
          {fila.resueltoEn ? ` el ${fechaHoraMx(fila.resueltoEn)}` : ''}.
        </p>
      )}
      {!fila.resueltoPorEmail && fila.estatus === 'casado' && (
        <p className="text-[11.5px] mt-1 m-0" style={{ color: 'var(--faint)' }}>
          Casó solo: lo decidió el cruce automático, no una persona.
        </p>
      )}

      {estado?.error && (
        <p className="text-[12px] mt-2 mb-0 flex items-start gap-1.5" style={{ color: 'var(--bad)' }}>
          <TriangleAlert width={13} height={13} strokeWidth={2} className="shrink-0 mt-0.5" aria-hidden />
          {estado.error}
        </p>
      )}
      {estado?.ok && (
        <p className="text-[12px] mt-2 mb-0" style={{ color: 'var(--ok)' }}>{estado.ok}</p>
      )}

      <form action={enviar} className="mt-2.5 space-y-2">
        <input type="hidden" name="cfdi" value={fila.id} />

        {/* ── AMBIGUO: los candidatos, y se ELIGE uno ─────────────────── */}
        {fila.estatus === 'ambiguo' && (
          fila.candidatos.length === 0 ? (
            <p className="text-[12px] m-0" style={{ color: 'var(--warn)' }}>
              Está marcado como ambiguo pero no quedó ninguna lista de candidatos legible.
              No se puede elegir a ciegas: archívalo con motivo, o pídele a soporte que
              revise por qué se quedó así.
            </p>
          ) : (
            <div className="space-y-1.5">
              <p className="text-[11.5px] m-0" style={{ color: 'var(--muted)' }}>
                Varios gastos empataron con este importe y Likida no adivina cuál es.
                Elige tú — y quedará firmado con tu correo.
              </p>
              {fila.candidatos.map((c) => (
                <div key={c.gastoId} className="hairline rounded-lg px-2.5 py-2 flex items-center gap-2.5 flex-wrap"
                  style={{ background: 'var(--canvas)' }}>
                  <span className="text-[12.5px]">
                    {c.montoOfrecido === null ? 'sin monto anotado' : mxn(c.montoOfrecido)}
                    {c.fechaOfrecida ? ` · ${fechaMx(c.fechaOfrecida)}` : ''}
                    {c.conceptoOfrecido ? ` · ${c.conceptoOfrecido}` : ''}
                  </span>
                  <EstadoCandidato c={c} />
                  <button type="submit" name="operacion" value={`ligar:${c.gastoId}`}
                    disabled={pendiente || c.vive !== true || c.yaTieneCfdi === true}
                    className="ml-auto inline-flex items-center gap-1.5 text-[12px] font-medium px-3 py-1.5 rounded-full transition-opacity hover:opacity-85 disabled:opacity-40 disabled:cursor-not-allowed"
                    style={{ background: 'var(--ink)', color: 'var(--surface)' }}>
                    <Link2 width={12} height={12} strokeWidth={2} /> Es éste
                  </button>
                </div>
              ))}
            </div>
          )
        )}

        {/* ── DISPONIBLE: el buscador de gastos ───────────────────────── */}
        {fila.estatus === 'disponible' && busqueda !== null && (
          <div className="hairline rounded-lg p-2.5 space-y-2" style={{ background: 'var(--canvas)' }}>
            <p className="text-[11.5px] m-0" style={{ color: 'var(--muted)' }}>
              Solo se ofrecen gastos de tu flota que TODAVÍA no tienen comprobante. El
              importe viene prellenado con el total del CFDI (± $1). Desde aquí no se crea
              un gasto: si nadie lo reportó, ése es el hallazgo.
            </p>
            {busqueda.error !== null ? (
              <p className="text-[12px] m-0" style={{ color: 'var(--bad)' }}>
                No se pudo buscar — eso NO significa que no haya gastos que correspondan:
                {' '}{busqueda.error}
              </p>
            ) : (
              <>
                {busqueda.gastos.length === 0 ? (
                  <p className="text-[12px] m-0" style={{ color: 'var(--muted)' }}>
                    Ningún gasto sin comprobante coincide con esos filtros. Amplía el rango de
                    fechas o quita el importe — o archívalo, si de verdad nadie lo reportó.
                  </p>
                ) : (
                  <ul className="space-y-1.5 m-0 p-0 list-none">
                    {busqueda.gastos.map((g) => (
                      <li key={g.id} className="flex items-center gap-2.5 flex-wrap">
                        <span className="text-[12.5px]">
                          {mxn(g.monto)}
                          {g.fecha ? ` · ${fechaMx(g.fecha)}` : ' · sin fecha'}
                          {` · ${g.concepto}`}
                          {g.folio ? ` · folio ${g.folio}` : ''}
                          {g.rfcEmisor ? ` · ${g.rfcEmisor}` : ''}
                        </span>
                        <button type="submit" name="operacion" value={`ligar:${g.id}`} disabled={pendiente}
                          className="ml-auto inline-flex items-center gap-1.5 text-[12px] font-medium px-3 py-1.5 rounded-full transition-opacity hover:opacity-85 disabled:opacity-50"
                          style={{ background: 'var(--ink)', color: 'var(--surface)' }}>
                          <Link2 width={12} height={12} strokeWidth={2} /> Ligar a este gasto
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {busqueda.truncada && (
                  <p className="text-[11.5px] m-0" style={{ color: 'var(--warn)' }}>
                    Hay más gastos que cumplen esos filtros de los que caben aquí — esta lista
                    está recortada. Acota la fecha o el importe para verlos todos.
                  </p>
                )}
              </>
            )}
          </div>
        )}

        {/* El motivo, cuando la operación quita una afirmación. */}
        {motivando !== null && (
          <input name="motivo" autoFocus required
            aria-label={motivando === 'ignorar' ? 'Por qué se archiva' : 'Por qué se deshace'}
            placeholder={motivando === 'ignorar'
              ? 'Por qué se archiva (obligatorio) — «no es de esta flota», «duplicado del folio X»…'
              : 'Por qué se deshace (obligatorio) — «era del ticket de la otra unidad»…'}
            className="w-full text-[12.5px] px-3 py-2 rounded-lg hairline"
            style={{ background: 'var(--canvas)' }} />
        )}

        <div className="flex items-center gap-2 flex-wrap">
          {fila.estatus === 'disponible' && hrefBuscar !== null && busqueda === null && (
            <Link href={hrefBuscar}
              className="inline-flex items-center gap-1.5 text-[12px] font-medium px-3 py-1.5 rounded-full hairline hover:opacity-70 transition-opacity">
              <Search width={12} height={12} strokeWidth={1.75} /> Buscar el gasto que le toca
            </Link>
          )}
          {busqueda !== null && hrefCerrarBusqueda !== null && (
            <Link href={hrefCerrarBusqueda}
              className="text-[12px] font-medium px-3 py-1.5 rounded-full hairline hover:opacity-70 transition-opacity">
              Cerrar el buscador
            </Link>
          )}

          {(fila.estatus === 'disponible' || fila.estatus === 'ambiguo') && (
            motivando === 'ignorar' ? (
              <>
                <button type="submit" name="operacion" value="ignorar" disabled={pendiente}
                  className="inline-flex items-center gap-1.5 text-[12px] font-medium px-3 py-1.5 rounded-full transition-opacity hover:opacity-85 disabled:opacity-50"
                  style={{ background: 'var(--bad)', color: 'var(--surface)' }}>
                  <Archive width={12} height={12} strokeWidth={2} /> Archivar
                </button>
                <button type="button" onClick={() => setMotivando(null)}
                  className="text-[12px] font-medium px-3 py-1.5 rounded-full hairline hover:opacity-70 transition-opacity">
                  Cancelar
                </button>
              </>
            ) : (
              <button type="button" onClick={() => setMotivando('ignorar')}
                className="inline-flex items-center gap-1.5 text-[12px] font-medium px-3 py-1.5 rounded-full hairline hover:opacity-70 transition-opacity"
                style={{ color: 'var(--bad)' }}>
                <Archive width={12} height={12} strokeWidth={1.75} /> Archivar con motivo…
              </button>
            )
          )}

          {(fila.estatus === 'casado' || fila.estatus === 'ignorado') && (
            motivando === 'revertir' ? (
              <>
                <button type="submit" name="operacion" value="revertir" disabled={pendiente}
                  className="inline-flex items-center gap-1.5 text-[12px] font-medium px-3 py-1.5 rounded-full transition-opacity hover:opacity-85 disabled:opacity-50"
                  style={{ background: 'var(--warn)', color: 'var(--surface)' }}>
                  <RotateCcw width={12} height={12} strokeWidth={2} />
                  {fila.estatus === 'casado' ? 'Deshacer el cruce' : 'Devolver a la bandeja'}
                </button>
                <button type="button" onClick={() => setMotivando(null)}
                  className="text-[12px] font-medium px-3 py-1.5 rounded-full hairline hover:opacity-70 transition-opacity">
                  Cancelar
                </button>
              </>
            ) : (
              <button type="button" onClick={() => setMotivando('revertir')}
                className="inline-flex items-center gap-1.5 text-[12px] font-medium px-3 py-1.5 rounded-full hairline hover:opacity-70 transition-opacity">
                <RotateCcw width={12} height={12} strokeWidth={1.75} />
                {fila.estatus === 'casado' ? 'Deshacer el cruce…' : 'Devolver a la bandeja…'}
              </button>
            )
          )}
        </div>
      </form>

      {/* El buscador va en SU PROPIO form (GET, sin JS): navegar no puede
          compartir formulario con las acciones de arriba. */}
      {busqueda !== null && (
        <form method="get" className="mt-2 flex items-end gap-2 flex-wrap">
          {busqueda.campoPagina.map((c) => (
            <input key={c.nombre} type="hidden" name={c.nombre} value={c.valor} />
          ))}
          <input type="hidden" name="buscar" value={fila.id} />
          <label className="flex flex-col gap-1 text-[11px]" style={{ color: 'var(--muted)' }}>
            Importe
            <input name="bimporte" defaultValue={busqueda.importe} inputMode="decimal"
              className="text-[12.5px] rounded-lg px-2 py-1.5 hairline w-28" style={{ background: 'var(--canvas)' }} />
          </label>
          <label className="flex flex-col gap-1 text-[11px]" style={{ color: 'var(--muted)' }}>
            Desde
            <input name="bdesde" type="date" defaultValue={busqueda.desde}
              className="text-[12.5px] rounded-lg px-2 py-1.5 hairline" style={{ background: 'var(--canvas)' }} />
          </label>
          <label className="flex flex-col gap-1 text-[11px]" style={{ color: 'var(--muted)' }}>
            Hasta
            <input name="bhasta" type="date" defaultValue={busqueda.hasta}
              className="text-[12.5px] rounded-lg px-2 py-1.5 hairline" style={{ background: 'var(--canvas)' }} />
          </label>
          <label className="flex flex-col gap-1 text-[11px] flex-1 min-w-40" style={{ color: 'var(--muted)' }}>
            Folio o RFC del ticket
            <input name="btexto" defaultValue={busqueda.texto} placeholder="A-1234 · XAXX010101000"
              className="text-[12.5px] rounded-lg px-2 py-1.5 hairline w-full" style={{ background: 'var(--canvas)' }} />
          </label>
          <button type="submit"
            className="text-[12px] font-medium px-3 py-1.5 rounded-full hairline hover:opacity-70 transition-opacity">
            Buscar
          </button>
        </form>
      )}

      {/* ── EL EXPEDIENTE: lo que hace que deshacer no sea borrar ────── */}
      {fila.historial.length > 0 && (
        <details className="mt-2.5">
          <summary className="text-[11.5px] cursor-pointer" style={{ color: 'var(--muted)' }}>
            Qué se ha decidido sobre este comprobante ({fila.historial.length})
          </summary>
          <ul className="mt-1.5 space-y-1 m-0 p-0 list-none">
            {fila.historial.map((h, i) => (
              <li key={i} className="text-[11.5px]" style={{ color: 'var(--muted)' }}>
                <strong>{h.acto}</strong>{' '}
                {h.estatusAntes} → {h.estatusDespues} ·{' '}
                {/* `null` en actorEmail SOLO ocurre en 'degradado': lo hizo la
                    base, no una persona, y se dice con esas palabras. */}
                {h.actorEmail ?? 'lo hizo la base, no una persona'} ·{' '}
                {fechaHoraMx(h.creadoEn)}
                {h.motivo ? ` — ${h.motivo}` : ''}
              </li>
            ))}
          </ul>
        </details>
      )}
    </li>
  );
}
