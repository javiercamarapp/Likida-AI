'use client';

import { useActionState, useState } from 'react';
import { Aviso, AvisoResultado, Boton, BotonConfirmar, CampoTexto, CampoTextarea, Fieldset, Radio, StatusChip, Tarjeta, clasesBoton, type ResultadoAccion } from '@/app/ui-v2/componentes';
import { mxn, fechaMx } from '@/lib/formato';
import { useT } from '@/lib/i18n/proveedor';
import { dinero } from '@/lib/i18n/es/dinero';
import type { AccionRevision, RevisionDetalle } from '@/lib/likida/revision';
import type { DisputaDeMonto } from '@/lib/likida/gasto_disputa';
import './liquidacion.css';

// ═══════════════════════════════════════════════════════════════════════════
// LA FIRMA HUMANA, EN PANTALLA (auditoría 24, bloqueante 6 — mig. 0299).
//
// «El agente cuadra, tú firmas lo que no.» Hasta hoy la segunda mitad no
// existía: no había NI UN `update` sobre `liquidacion` en toda la app, así que
// el contralor leía el PDF y decidía en Excel. Tres botones y un motivo:
//
//   · APROBAR  — el cierre queda firmado con tu nombre y tu hora.
//   · AJUSTAR  — corrige el monto de un comprobante mal leído (WA-3: el ticket
//                de $8,000 que el modelo leyó $800). Mueve `gasto.monto` y
//                el sistema RECALCULA el cuadre con los montos corregidos
//                antes de guardar el ajuste con tu firma (`revision.ts`
//                ~489-505, mig. 0306: también regenera el PDF).
//   · RECHAZAR — el viaje vuelve a cuadre y al chofer le llega el motivo por
//                WhatsApp, tal como lo escribiste. Pide confirmación en una
//                ventana del sistema que dice la consecuencia.
//
// Ajustar y rechazar EXIGEN motivo: sin él es un botón, no una revisión. Todo
// queda en la bitácora dentro de la misma transacción (la RPC), y el botón se
// deshabilita mientras corre — un doble clic en una red lenta no puede firmar
// dos veces (además la base lo rebota con LR010, pero eso es el cinturón).
// ═══════════════════════════════════════════════════════════════════════════

export interface GastoAjustable {
  id: string; etiqueta: string; monto: number;
  /** A37-P-01: el operador dijo que este monto está mal (`ocr_extra.montoDisputado`) y nadie lo ha corregido. */
  disputa?: DisputaDeMonto | null;
}

type Accion = (previo: ResultadoAccion, fd: FormData) => Promise<ResultadoAccion>;

/** El resultado de una acción, en una región viva SIEMPRE presente (un `aria-live` que nace con su texto no se anuncia). */
function Resultado({ estado }: { estado: ResultadoAccion }) {
  return <div aria-live="polite"><AvisoResultado estado={estado} /></div>;
}

export function PanelRevision({ estado, gastos, accion, folio, corregir = null }: {
  estado: RevisionDetalle;
  /** Los comprobantes con id — los únicos que se pueden ajustar. */
  gastos: GastoAjustable[];
  /** `null` = el rol puede VER la firma pero no ponerla. */
  accion: Accion | null;
  folio: string;
  /** A37-P-01: corrige el monto de un comprobante disputado (solo cuando la liquidación ya no está vigente). `null` = sin permiso. */
  corregir?: Accion | null;
}) {
  const { t: tr } = useT('dinero', dinero);
  const disputados = gastos.filter((g) => g.disputa);
  return (
    <Tarjeta titulo={tr('liquidacion.revision.titulo')}>
      {/* Dos bloques lado a lado (Rovaq: fichas de 2 columnas): a la izquierda el estado de la firma, las disputas y las notas; a la derecha la forma de
          firmar. Sin forma (rol sin permiso o ya cerrada) queda una sola columna, sin media tarjeta vacía. */}
      <div className="rv-liq__rev" data-dos={accion && estado.firmable ? '' : undefined}>
        <div className="rv-liq__firma">
          <FirmaActual estado={estado} />

          {disputados.length > 0 && (
            <Disputas gastos={disputados} firmable={estado.firmable} corregir={estado.firmable ? null : corregir} />
          )}

          {!accion && estado.firmable && <p className="rv-liq__nota">{tr('liquidacion.revision.rolNoFirma')}</p>}
          {!estado.firmable && estado.revision === 'rechazada' && <p className="rv-liq__nota">{tr('liquidacion.revision.rechazadaSigue')}</p>}
        </div>

        {accion && estado.firmable && (
          <Forma accion={accion} gastos={gastos} folio={folio} yaFirmadaPorElMotor={estado.revision !== 'pendiente'} />
        )}
      </div>
    </Tarjeta>
  );
}

/**
 * A37-P-01 (S45-01): el operador apretó «No, corregir» sobre un monto mal leído. Hasta ahora la marca no la leía nadie y la oficina no
 * se enteraba. Mientras la liquidación esté vigente el camino es «Ajustar montos» (recalcula el cuadre con tu firma); si ya se
 * rechazó y el viaje volvió a cuadre, aquí se corrige el monto directo (`corregirMontoGasto`: motivo y firma obligatorios, historial).
 */
function Disputas({ gastos, firmable, corregir }: {
  gastos: GastoAjustable[];
  firmable: boolean;
  corregir: Accion | null;
}) {
  const { t: tr } = useT('dinero', dinero);
  return (
    <div className="rv-liq__disputa">
      <Aviso tono="warn" titulo={gastos.length === 1 ? tr('liquidacion.revision.disputaTituloUno') : tr('liquidacion.revision.disputaTituloVarios')}>
        {firmable ? tr('liquidacion.revision.disputaAjustar') : undefined}
      </Aviso>
      <ul className="rv-liq__ajustes">
        {gastos.map((g) => (
          <li key={g.id} className="rv-liq__disputa-item">
            <span>
              {tr('liquidacion.revision.disputaLeyo', { etiqueta: g.etiqueta, monto: mxn(g.disputa!.montoLeido) })}
              {' · '}
              {g.disputa!.dijo ? tr('liquidacion.revision.disputaDijo', { dijo: g.disputa!.dijo }) : tr('liquidacion.revision.disputaNoDijo')}
              {g.disputa!.en ? <> · {fechaMx(g.disputa!.en)}</> : null}
            </span>
            {corregir && <CorregirMonto accion={corregir} gasto={g} />}
          </li>
        ))}
      </ul>
    </div>
  );
}

function CorregirMonto({ accion, gasto }: { accion: Accion; gasto: GastoAjustable }) {
  const { t: tr } = useT('dinero', dinero);
  const [resultado, enviar, pendiente] = useActionState<ResultadoAccion, FormData>(accion, null);
  return (
    <form action={enviar} className="rv-liq__corregir">
      <input type="hidden" name="gastoId" value={gasto.id} />
      <CampoTexto name="monto" required inputMode="decimal" placeholder={tr('liquidacion.revision.montoCorrecto')}
        etiqueta={tr('liquidacion.revision.montoCorrectoDe', { etiqueta: gasto.etiqueta })} etiquetaOculta />
      <CampoTexto name="motivo" required placeholder={tr('liquidacion.revision.motivoBitacora')}
        etiqueta={tr('liquidacion.revision.motivoCorreccionDe', { etiqueta: gasto.etiqueta })} etiquetaOculta />
      <Boton type="submit" variante="primary" tamano="sm" loading={pendiente}>
        {pendiente ? tr('liquidacion.revision.corrigiendo') : tr('liquidacion.revision.corregirMonto')}
      </Boton>
      <Resultado estado={resultado} />
    </form>
  );
}

function FirmaActual({ estado }: { estado: RevisionDetalle }) {
  const { t: tr } = useT('dinero', dinero);
  const { revision, revisadaPor, revisadaEn, motivo, ajustes } = estado;
  const rotulo = revision === 'pendiente' || revision === 'aprobada' || revision === 'ajustada' || revision === 'rechazada'
    ? tr(`liquidacion.revision.estado.${revision}`)
    : revision;
  return (
    <div>
      <p className="rv-liq__firma-estado">
        {/* El estado de la firma es un sello, no una palabra en negritas (Rovaq 06d: chip de estado junto al título). Pendiente es lo que pide
            acción; las demás ya están resueltas. */}
        <StatusChip tono={revision === 'pendiente' ? 'warn' : revision === 'rechazada' ? 'bad' : revision === 'aprobada' || revision === 'ajustada' ? 'ok' : 'neutral'}>{rotulo}</StatusChip>
        {revision !== 'pendiente' && (
          revisadaPor
            ? <> · {revisadaEn ? tr('liquidacion.revision.firmoEl', { quien: revisadaPor, fecha: fechaMx(revisadaEn) }) : tr('liquidacion.revision.firmo', { quien: revisadaPor })}</>
            /* Sin persona detrás no se dice «la firmó alguien»: cuadró sola y
               eso es lo que se pone. La persona todavía puede corregirla. */
            : <> · {revisadaEn ? tr('liquidacion.revision.cuadroSolaFecha', { fecha: fechaMx(revisadaEn) }) : tr('liquidacion.revision.cuadroSola')}</>
        )}
      </p>
      {motivo && <p className="rv-liq__firma-estado">{tr('liquidacion.revision.motivo', { motivo })}</p>}
      {ajustes.length > 0 && (
        <ul className="rv-liq__ajustes">
          {ajustes.map((a) => (
            <li key={a.gastoId}>{tr('liquidacion.revision.ajusteDe', { concepto: a.concepto, antes: mxn(a.montoAnterior), despues: mxn(a.montoNuevo) })}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

const OPCIONES: ReadonlyArray<{ id: AccionRevision; clave: 'aprobar' | 'ajustar' | 'rechazar' }> = [
  { id: 'aprobar', clave: 'aprobar' },
  { id: 'ajustar', clave: 'ajustar' },
  { id: 'rechazar', clave: 'rechazar' },
];

function Forma({ accion, gastos, folio, yaFirmadaPorElMotor }: {
  accion: Accion;
  gastos: GastoAjustable[];
  folio: string;
  yaFirmadaPorElMotor: boolean;
}) {
  const { t: tr } = useT('dinero', dinero);
  const [resultado, enviar, pendiente] = useActionState<ResultadoAccion, FormData>(accion, null);
  const [elegida, setElegida] = useState<AccionRevision>('aprobar');
  const [motivo, setMotivo] = useState('');
  const exigeMotivo = elegida !== 'aprobar';
  const rotuloElegido = tr(`liquidacion.revision.${OPCIONES.find((o) => o.id === elegida)!.clave}`);

  return (
    <form action={enviar} className="rv-liq__firma">
      {yaFirmadaPorElMotor && <p className="rv-liq__nota">{tr('liquidacion.revision.cuadroSolaCorregible')}</p>}

      {/* Mismo fieldset/legend accesible, pero sin el marco de navegador: rótulo 13/600 y opciones en fila (clase `rv-liq__plano`). */}
      <Fieldset leyenda={tr('liquidacion.revision.queHacer')} className="rv-liq__plano">
        <div className="rv-liq__opciones">
          {OPCIONES.map((o) => (
            <Radio key={o.id} name="accion" value={o.id} checked={elegida === o.id} onChange={() => setElegida(o.id)} etiqueta={tr(`liquidacion.revision.${o.clave}`)} />
          ))}
        </div>
      </Fieldset>

      {elegida === 'ajustar' && (
        <div className="rv-liq__firma">
          <p className="rv-liq__nota">{tr('liquidacion.revision.ajustarAyuda')}</p>
          {gastos.length === 0 ? (
            <p className="rv-liq__nota">{tr('liquidacion.revision.sinRenglones')}</p>
          ) : (
            gastos.map((g) => (
              <div key={g.id} className="rv-liq__monto-fila">
                <span>{g.etiqueta}</span>
                <span className="rv-liq__mono">{mxn(g.monto)}</span>
                <CampoTexto name={`monto:${g.id}`} inputMode="decimal" placeholder={tr('liquidacion.revision.montoCorrecto')}
                  etiqueta={tr('liquidacion.revision.montoCorrectoDe', { etiqueta: g.etiqueta })} etiquetaOculta />
              </div>
            ))
          )}
        </div>
      )}

      <CampoTextarea name="motivo" rows={2} required={exigeMotivo} value={motivo} onChange={(e) => setMotivo(e.target.value)}
        etiqueta={exigeMotivo ? tr('liquidacion.revision.motivoObligatorio') : tr('liquidacion.revision.motivoOpcional')}
        placeholder={elegida === 'rechazar'
          ? tr('liquidacion.revision.placeholderRechazar')
          : elegida === 'ajustar'
            ? tr('liquidacion.revision.placeholderAjustar')
            : tr('liquidacion.revision.placeholderAprobar')} />

      {elegida === 'rechazar' && <p className="rv-liq__nota">{tr('liquidacion.revision.rechazarAviso', { folio })}</p>}

      <Resultado estado={resultado} />

      <div className="rv-liq__confirma">
        {elegida === 'rechazar' ? (
          /* Rechazar devuelve el viaje a cuadre y le manda el motivo al chofer: se confirma en una ventana del sistema. */
          <BotonConfirmar
            etiqueta={pendiente ? tr('liquidacion.revision.firmando') : rotuloElegido} deshabilitado={pendiente || motivo.trim() === ''}
            titulo={tr('liquidacion.revision.rechazarTitulo', { folio })} descripcion={tr('liquidacion.revision.rechazarAviso', { folio })}
            etiquetaConfirmar={tr('liquidacion.revision.rechazarConfirmar')} className={clasesBoton('danger')}
          />
        ) : (
          <Boton type="submit" variante="primary" loading={pendiente}>
            {pendiente ? tr('liquidacion.revision.firmando') : rotuloElegido}
          </Boton>
        )}
      </div>
    </form>
  );
}
