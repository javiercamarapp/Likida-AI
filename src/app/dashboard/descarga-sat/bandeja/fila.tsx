'use client';

import { useActionState, useState } from 'react';
import { Archive, Link2, RotateCcw, Search } from 'lucide-react';
import { fechaMx, fechaHoraMx, mxn } from '@/lib/formato';
import { AvisoCompacto, Boton, BotonEnlace, CampoFecha, CampoTexto, Disclosure, Icono, StatusChip } from '@/app/ui-v2/componentes';
import '../descarga-sat.css';
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
    return <span className="rv-sat__nota" data-tono="warn">no se pudo comprobar si este gasto sigue ahí</span>;
  }
  if (c.vive === false) {
    return <span className="rv-sat__nota" data-tono="bad">ese gasto ya no existe (se borró el viaje del que colgaba)</span>;
  }
  if (c.yaTieneCfdi === true) {
    return <span className="rv-sat__nota" data-tono="warn">ya tiene comprobante — le llegó por otro camino</span>;
  }
  // EL GASTO CAMBIÓ DESDE EL CRUCE — y solo entonces se dice. Repetir «hoy: …» debajo de un candidato idéntico llena la fila de ruido y entierra justo el caso que importa: el gasto al que alguien le movió el monto o la fecha entre que el motor lo propuso y hoy.
  const cambio = c.montoHoy !== c.montoOfrecido
    || c.fechaHoy !== c.fechaOfrecida
    || c.conceptoHoy !== c.conceptoOfrecido;
  if (!cambio) {
    return <span className="rv-sat__nota">sin cambios desde el cruce</span>;
  }
  return (
    <span className="rv-sat__nota" data-tono="warn">
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
    <li className="rv-sat__fila">
      {/* ── La identidad del comprobante ─────────────────────────────── */}
      <div className="rv-sat__cab">
        <strong>
          {/* `null` ≠ 0: un CFDI sin total legible lo dice. */}
          {fila.total === null ? <span className="rv-sat__nota" data-tono="warn">sin total legible</span> : mxn(fila.total)}
        </strong>
        <StatusChip tono={
          fila.estatus === 'casado' ? 'ok'
            : fila.estatus === 'ambiguo' ? 'warn'
              : fila.estatus === 'ignorado' ? 'neutral' : 'bad'
        }>
          {fila.estatus}
        </StatusChip>
        <span className="rv-sat__tenue">
          {fila.rfcEmisor ?? 'sin RFC de emisor'}
          {' · '}
          {fila.fecha ? fechaMx(fila.fecha) : 'sin fecha'}
          {fila.tipoComprobante ? ` · tipo ${fila.tipoComprobante}` : ''}
        </span>
        <span className="rv-sat__uuid" title="Folio fiscal — la llave del comprobante ante el SAT">{fila.cfdiUuid}</span>
      </div>

      {/* Lo que el motor dijo, TAL CUAL. */}
      {fila.motivo && <p className="rv-sat__texto">{fila.motivo}</p>}

      {/* La firma viva: quién dejó esta fila como está. */}
      {fila.resueltoPorEmail && (
        <p className="rv-sat__nota">
          Lo dejó así {fila.resueltoPorEmail}
          {fila.resueltoEn ? ` el ${fechaHoraMx(fila.resueltoEn)}` : ''}.
        </p>
      )}
      {!fila.resueltoPorEmail && fila.estatus === 'casado' && (
        <p className="rv-sat__nota">Casó solo: lo decidió el cruce automático, no una persona.</p>
      )}

      {estado?.error && <AvisoCompacto tono="error" resumen={estado.error} />}
      {estado?.ok && <AvisoCompacto tono="ok" resumen={estado.ok} />}

      <form action={enviar} className="rv-sat__bloque">
        <input type="hidden" name="cfdi" value={fila.id} />

        {/* ── AMBIGUO: los candidatos, y se ELIGE uno ─────────────────── */}
        {fila.estatus === 'ambiguo' && (
          fila.candidatos.length === 0 ? (
            <AvisoCompacto tono="warn" resumen="Está marcado como ambiguo pero no quedó ninguna lista de candidatos legible."
              mas="No se puede elegir a ciegas: archívalo con motivo, o pídele a soporte que revise por qué se quedó así." />
          ) : (
            <div className="rv-sat__bloque">
              <p className="rv-sat__nota">
                Varios gastos empataron con este importe y Likida no adivina cuál es.
                Elige tú — y quedará firmado con tu correo.
              </p>
              {fila.candidatos.map((c) => (
                <div key={c.gastoId} className="rv-sat__candidato">
                  <span>
                    {c.montoOfrecido === null ? 'sin monto anotado' : mxn(c.montoOfrecido)}
                    {c.fechaOfrecida ? ` · ${fechaMx(c.fechaOfrecida)}` : ''}
                    {c.conceptoOfrecido ? ` · ${c.conceptoOfrecido}` : ''}
                  </span>
                  <EstadoCandidato c={c} />
                  <Boton type="submit" name="operacion" value={`ligar:${c.gastoId}`} variante="primary" tamano="sm"
                    disabled={pendiente || c.vive !== true || c.yaTieneCfdi === true}
                    icono={<Icono icono={Link2} />}>
                    Es éste
                  </Boton>
                </div>
              ))}
            </div>
          )
        )}

        {/* ── DISPONIBLE: el buscador de gastos ───────────────────────── */}
        {fila.estatus === 'disponible' && busqueda !== null && (
          <div className="rv-sat__candidato rv-sat__candidato--col">
            <p className="rv-sat__nota">
              Solo se ofrecen gastos de tu flota que TODAVÍA no tienen comprobante. El
              importe viene prellenado con el total del CFDI (± $1). Desde aquí no se crea
              un gasto: si nadie lo reportó, ése es el hallazgo.
            </p>
            {busqueda.error !== null ? (
              <AvisoCompacto tono="error" resumen={`No se pudo buscar — eso NO significa que no haya gastos que correspondan: ${busqueda.error}`} />
            ) : (
              <>
                {busqueda.gastos.length === 0 ? (
                  <p className="rv-sat__texto">
                    Ningún gasto sin comprobante coincide con esos filtros. Amplía el rango de
                    fechas o quita el importe — o archívalo, si de verdad nadie lo reportó.
                  </p>
                ) : (
                  <ul className="rv-sat__lista">
                    {busqueda.gastos.map((g) => (
                      <li key={g.id} className="rv-sat__candidato">
                        <span>
                          {mxn(g.monto)}
                          {g.fecha ? ` · ${fechaMx(g.fecha)}` : ' · sin fecha'}
                          {` · ${g.concepto}`}
                          {g.folio ? ` · folio ${g.folio}` : ''}
                          {g.rfcEmisor ? ` · ${g.rfcEmisor}` : ''}
                        </span>
                        <Boton type="submit" name="operacion" value={`ligar:${g.id}`} variante="primary" tamano="sm" disabled={pendiente}
                          icono={<Icono icono={Link2} />}>
                          Ligar a este gasto
                        </Boton>
                      </li>
                    ))}
                  </ul>
                )}
                {busqueda.truncada && (
                  <AvisoCompacto tono="warn" resumen="Hay más gastos que cumplen esos filtros de los que caben aquí — esta lista está recortada. Acota la fecha o el importe para verlos todos." />
                )}
              </>
            )}
          </div>
        )}

        {/* El motivo, cuando la operación quita una afirmación. */}
        {motivando !== null && (
          <CampoTexto name="motivo" autoFocus required etiqueta={motivando === 'ignorar' ? 'Por qué se archiva' : 'Por qué se deshace'} etiquetaOculta
            placeholder={motivando === 'ignorar'
              ? 'Por qué se archiva (obligatorio) — «no es de esta flota», «duplicado del folio X»…'
              : 'Por qué se deshace (obligatorio) — «era del ticket de la otra unidad»…'} />
        )}

        <div className="rv-sat__acciones">
          {fila.estatus === 'disponible' && hrefBuscar !== null && busqueda === null && (
            <BotonEnlace href={hrefBuscar} variante="secondary" tamano="sm" icono={<Icono icono={Search} />}>
              Buscar el gasto que le toca
            </BotonEnlace>
          )}
          {busqueda !== null && hrefCerrarBusqueda !== null && (
            <BotonEnlace href={hrefCerrarBusqueda} variante="ghost" tamano="sm">Cerrar el buscador</BotonEnlace>
          )}

          {(fila.estatus === 'disponible' || fila.estatus === 'ambiguo') && (
            motivando === 'ignorar' ? (
              <>
                <Boton type="submit" name="operacion" value="ignorar" disabled={pendiente} variante="danger" tamano="sm" icono={<Icono icono={Archive} />}>
                  Archivar
                </Boton>
                <Boton type="button" onClick={() => setMotivando(null)} variante="secondary" tamano="sm">Cancelar</Boton>
              </>
            ) : (
              <Boton type="button" onClick={() => setMotivando('ignorar')} variante="secondary" tamano="sm" icono={<Icono icono={Archive} />}>
                Archivar con motivo…
              </Boton>
            )
          )}

          {(fila.estatus === 'casado' || fila.estatus === 'ignorado') && (
            motivando === 'revertir' ? (
              <>
                <Boton type="submit" name="operacion" value="revertir" disabled={pendiente} variante="primary" tamano="sm" icono={<Icono icono={RotateCcw} />}>
                  {fila.estatus === 'casado' ? 'Deshacer el cruce' : 'Devolver a la bandeja'}
                </Boton>
                <Boton type="button" onClick={() => setMotivando(null)} variante="secondary" tamano="sm">Cancelar</Boton>
              </>
            ) : (
              <Boton type="button" onClick={() => setMotivando('revertir')} variante="secondary" tamano="sm" icono={<Icono icono={RotateCcw} />}>
                {fila.estatus === 'casado' ? 'Deshacer el cruce…' : 'Devolver a la bandeja…'}
              </Boton>
            )
          )}
        </div>
      </form>

      {/* El buscador va en SU PROPIO form (GET, sin JS): navegar no puede compartir formulario con las acciones de arriba. */}
      {busqueda !== null && (
        <form method="get" className="rv-sat__buscador">
          {busqueda.campoPagina.map((c) => (
            <input key={c.nombre} type="hidden" name={c.nombre} value={c.valor} />
          ))}
          <input type="hidden" name="buscar" value={fila.id} />
          <CampoTexto name="bimporte" etiqueta="Importe" defaultValue={busqueda.importe} inputMode="decimal" />
          <CampoFecha name="bdesde" etiqueta="Desde" defaultValue={busqueda.desde} />
          <CampoFecha name="bhasta" etiqueta="Hasta" defaultValue={busqueda.hasta} />
          <CampoTexto name="btexto" etiqueta="Folio o RFC del ticket" defaultValue={busqueda.texto} placeholder="A-1234 · XAXX010101000" />
          <Boton type="submit" variante="secondary" tamano="sm">Buscar</Boton>
        </form>
      )}

      {/* ── EL EXPEDIENTE: lo que hace que deshacer no sea borrar ────── */}
      {fila.historial.length > 0 && (
        <Disclosure variante="linea" titulo={`Qué se ha decidido sobre este comprobante (${fila.historial.length})`}>
          <ul className="rv-sat__lista">
            {fila.historial.map((h, i) => (
              <li key={i} className="rv-sat__nota">
                <strong>{h.acto}</strong>{' '}
                {h.estatusAntes} → {h.estatusDespues} ·{' '}
                {/* `null` en actorEmail SOLO ocurre en 'degradado': lo hizo la base, no una persona, y se dice con esas palabras. */}
                {h.actorEmail ?? 'lo hizo la base, no una persona'} ·{' '}
                {fechaHoraMx(h.creadoEn)}
                {h.motivo ? ` — ${h.motivo}` : ''}
              </li>
            ))}
          </ul>
        </Disclosure>
      )}
    </li>
  );
}
