'use client';

import { useActionState } from 'react';
import { Aviso, Boton, CampoTexto, StatusChip, Tarjeta } from '../../ui-v2/componentes';
import { AvisoResultado } from '../../ui-v2/componentes/aviso-resultado';
import { BotonConfirmar } from '../../ui-v2/componentes/confirmar';
import { clasesBoton } from '../../ui-v2/componentes/boton';
import { numero } from '@/lib/formato';
import type { ResumenBandejaCola, ResumenVencidas } from '@/lib/admin/cola-aprobacion';
import '../bandeja.css';

export type ResultadoConteo =
  | { error: string; resumen?: undefined; entrada?: undefined }
  | { resumen: ResumenVencidas; entrada: { dias: string; limite: string; tipos: string }; error?: undefined }
  | null;
export type ResultadoVaciado = { ok: string; error?: undefined } | { error: string; ok?: undefined } | null;

/**
 * Vaciar la cola de aprobación por lotes (auditoría admin, P0). Tres pasos que NO se saltan:
 *  1. CONTAR: el dry-run (`contarVencidas`) dice cuántas piezas tocaría y de qué tipos. No escribe nada.
 *  2. CONFIRMAR: el diálogo repite la cifra contada y qué le pasa a cada pieza.
 *  3. EJECUTAR: el servidor vuelve a contar y se niega si la cifra cambió; el lote deja UNA entrada firmada en la bitácora.
 * Lo que se ejecuta son los parámetros CONTADOS (campos ocultos), no lo que haya quedado escrito después en el formulario.
 */
export function LimpiezaLote({ contar, vaciar, bandeja }: {
  contar: (previo: ResultadoConteo, fd: FormData) => Promise<ResultadoConteo>;
  vaciar: (previo: ResultadoVaciado, fd: FormData) => Promise<ResultadoVaciado>;
  /** Estado de la bandeja leído por el servidor; `null` = no se pudo leer. */
  bandeja: ResumenBandejaCola | null;
}) {
  const [conteo, enviarConteo, contando] = useActionState<ResultadoConteo, FormData>(contar, null);
  const [vaciado, enviarVaciado, vaciando] = useActionState<ResultadoVaciado, FormData>(vaciar, null);
  const r = conteo?.resumen;

  return (
    <Tarjeta titulo="Limpiar piezas vencidas">
      <div className="bj-lote">
        {bandeja === null ? (
          <Aviso tono="warn">No se pudo leer el estado de la bandeja ahora mismo. Contar sí intenta leerla por su cuenta.</Aviso>
        ) : bandeja.frenaAlRunner ? (
          <Aviso tono="error" titulo="La bandeja está frenando a los agentes.">
            Hay {numero(bandeja.pendientes)} piezas pendientes
            {bandeja.diasMasVieja !== null ? ` y la más vieja lleva ${numero(Math.floor(bandeja.diasMasVieja))} días` : ''}
            ; el runner no fabrica encima mientras haya {numero(bandeja.topeBandeja)} o más, o alguna con más de {numero(bandeja.diasVencimiento)} días.
            Resolverlas (aprobar, rechazar o limpiar las vencidas) lo destraba; el tope no se toca.
          </Aviso>
        ) : (
          <p className="bj-nota">
            Hay {numero(bandeja.pendientes)} piezas pendientes y la bandeja no está frenando a los agentes ahora mismo.
          </p>
        )}

        <p className="bj-nota">
          Las piezas con más de N días sin atender se rechazan por lote, las más viejas primero, con el motivo «Archivada por vencimiento».
          No se envía nada. Cada lote deja una entrada firmada en la bitácora. Primero se cuenta; nada cambia hasta que confirmas.
        </p>

        <form action={enviarConteo} className="bj-lote">
          <div className="bj-lote__campos">
            <CampoTexto etiqueta="Días sin atender" tipo="number" name="dias" min={1} max={365} step={1} defaultValue={30} />
            <CampoTexto etiqueta="Piezas por lote" tipo="number" name="limite" min={1} max={200} step={1} defaultValue={50} />
            <CampoTexto etiqueta="Solo estos tipos (opcional)" name="tipos" placeholder="parte_diario, parte_semanal" ayuda="Vacío = todos. Separados por coma." />
          </div>
          <div className="bj-acciones">
            <Boton type="submit" variante="secondary" tamano="sm" disabled={contando}>{contando ? 'Contando…' : 'Contar (no cambia nada)'}</Boton>
          </div>
        </form>

        {conteo?.error && <Aviso tono="error">{conteo.error}</Aviso>}

        {r && (
          <div className="bj-lote">
            {r.vencidas === 0 ? (
              <Aviso tono="ok">No hay piezas pendientes con más de {numero(r.dias)} días. No hay nada que limpiar con estos criterios.</Aviso>
            ) : (
              <>
                <ul className="bj-lote__resumen">
                  <li>Con más de {numero(r.dias)} días sin atender hay <strong>{numero(r.vencidas)}</strong> piezas.</li>
                  <li>Este lote tocaría <strong>{numero(r.enElLote)}</strong> (tope por lote: {numero(r.limite)}; las más viejas primero).</li>
                  {r.vencidas > r.enElLote && <li>Quedarían {numero(r.vencidas - r.enElLote)} para otro lote.</li>}
                </ul>
                <div className="bj-lote__desglose" aria-label="Por tipo de pieza">
                  {Object.entries(r.porTipo).sort((a, b) => b[1] - a[1]).map(([t, n]) => (
                    <StatusChip key={t} tono="neutral">{t}: {numero(n)}</StatusChip>
                  ))}
                </div>
                {vaciado?.ok ? null : (
                  <form action={enviarVaciado} className="bj-acciones">
                    <input type="hidden" name="dias" value={conteo.entrada.dias} />
                    <input type="hidden" name="limite" value={conteo.entrada.limite} />
                    <input type="hidden" name="tipos" value={conteo.entrada.tipos} />
                    <input type="hidden" name="esperadas" value={r.enElLote} />
                    <BotonConfirmar
                      etiqueta={vaciando ? 'Archivando…' : `Archivar ${numero(r.enElLote)} piezas`}
                      deshabilitado={vaciando}
                      tono="peligro"
                      titulo="Archivar piezas vencidas"
                      etiquetaConfirmar={`Sí, archivar ${numero(r.enElLote)}`}
                      descripcion={`Se rechazarán ${numero(r.enElLote)} piezas pendientes con más de ${numero(r.dias)} días, las más viejas primero, `
                        + 'con el motivo «Archivada por vencimiento». No se envía nada a nadie. Queda firmado en la bitácora con tu usuario. '
                        + 'Esta pantalla no tiene botón para deshacerlo. Si la cifra cambió desde que contaste, no se ejecuta.'}
                      className={clasesBoton('danger', 'sm')}
                    />
                  </form>
                )}
              </>
            )}
          </div>
        )}

        <AvisoResultado estado={vaciado} />
      </div>
    </Tarjeta>
  );
}
