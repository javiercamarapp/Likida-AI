import { trEs, type Tr } from '@/lib/i18n/dinero_tr';
import { fechaHoraMx } from '@/lib/formato';
import { Disclosure, EstadoVacio, StatusChip, Tarjeta } from '@/app/ui-v2/componentes';
import './reglas.css';
import type { ReglaEnPantalla } from '@/lib/likida/reglas/repo';
import { BotonDeRegla, BorrarRegla, FormaFrecuencia, type AccionForma } from './forma';

// ═══════════════════════════════════════════════════════════════════════════
// LA LISTA DE REGLAS — presentacional, en el servidor.
//
// Lo que esta vista NO hace: rellenar. Una regla que nunca ha disparado dice
// "todavía no ha sonado", no "0 avisos" — un cero se lee como medición y esto
// es la ausencia de una. Es la misma distinción que `null ≠ 0` sostiene en
// vigencias.ts y en todo el motor.
// ═══════════════════════════════════════════════════════════════════════════

export interface AccionesRegla {
  confirmar: AccionForma;
  pausar: AccionForma;
  reanudar: AccionForma;
  borrar: AccionForma;
  frecuencia: AccionForma;
}

const canal = (tr: Tr): Record<string, string> => ({
  dinero: tr('reglas.vista.teLlegaATi'),
  operacion: tr('reglas.vista.leLlegaAlJefe'),
});
function Evidencias({ regla, tr = trEs }: { regla: ReglaEnPantalla; tr?: Tr }) {
  if (regla.ultimasEvidencias.length === 0) {
    return (
      <p className="rv-reglas__tenue">
        {regla.ultimaCorridaEn
          ? tr('reglas.vista.revisadaElTodaviaNo', { v: fechaHoraMx(regla.ultimaCorridaEn) })
          : tr('reglas.vista.todaviaNoLaReviso')}
      </p>
    );
  }
  return (
    <div className="rv-reglas__avisos">
      <p className="rv-reglas__rotulo">{tr('reglas.vista.ultimasVecesQueSono')}</p>
      {regla.ultimasEvidencias.map((e) => (
        <p key={`${e.disparadoEn}-${e.evidencia.slice(0, 24)}`} className="rv-reglas__renglon">
          <span className="rv-reglas__fecha">{fechaHoraMx(e.disparadoEn)}</span>{' '}
          {e.evidencia}
        </p>
      ))}
    </div>
  );
}

const via = (tr: Tr): Record<string, string> => ({
  texto: tr('reglas.vista.mensajeDeWhatsapp'), botones: tr('reglas.vista.viaBotones'), plantilla: tr('reglas.vista.viaPlantilla'),
});
/** El historial de AVISOS (0520): cada vez que la regla intentó avisar, salió o
 *  no, y por qué canal. Distinto de «Últimas veces que sonó», que cita los casos. */
function HistorialAvisos({ regla, tr = trEs }: { regla: ReglaEnPantalla; tr?: Tr }) {
  if (regla.ultimosAvisos.length === 0) {
    return <p className="rv-reglas__tenue">{tr('reglas.vista.todaviaNoHaMandado')}</p>;
  }
  return (
    <div className="rv-reglas__avisos">
      {regla.ultimosAvisos.map((a) => (
        <p key={`${a.enviadoEn}-${a.resultado}`} className="rv-reglas__renglon">
          <span className="rv-reglas__fecha">{fechaHoraMx(a.enviadoEn)}</span>{' '}
          {a.resultado === 'enviado'
            ? tr('reglas.vista.avisoCasoPor', { casos: a.casos, v: a.casos === 1 ? '' : 's', v2: via(tr)[a.via ?? ''] ?? 'WhatsApp' })
            : <span className="rv-reglas__error">{tr('reglas.vista.noSalioCasoSe', { casos: a.casos, v: a.casos === 1 ? '' : 's', v2: a.error ?? tr('reglas.vista.whatsappLoRechazo') })}</span>}
        </p>
      ))}
    </div>
  );
}

function Ficha({ regla, acciones, tr = trEs }: { regla: ReglaEnPantalla; acciones: AccionesRegla; tr?: Tr }) {
  const pendiente = regla.estado === 'pendiente';
  return (
    <Tarjeta titulo={regla.frase} acciones={
      <StatusChip tono={pendiente ? 'warn' : regla.estado === 'activa' ? 'ok' : 'neutral'}>
        {pendiente ? tr('reglas.vista.esperandoTuConfirmacion') : regla.estado === 'activa' ? tr('reglas.vista.vigilando') : tr('reglas.vista.pausada')}
      </StatusChip>
    }>
      <div className="rv-reglas__ficha">
        {/* La cita de lo que la persona escribió. Está aquí para que pueda juzgar la traducción — no porque el sistema la vuelva a leer. */}
        <p className="rv-reglas__cita">
          {tr('reglas.vista.tuEscribiste', { texto: regla.textoOriginal })}
        </p>
        <p className="rv-reglas__tenue">
          {regla.titulo} · {canal(tr)[regla.canal] ?? regla.canal}
        </p>

        {!pendiente && <Evidencias tr={tr} regla={regla} />}

        {!pendiente && (
          <Disclosure variante="linea" titulo={tr('reglas.vista.historialDeAvisosY')}>
            <div className="rv-reglas__avisos">
              <HistorialAvisos tr={tr} regla={regla} />
              <FormaFrecuencia accion={acciones.frecuencia} id={regla.id}
                maxAvisosDia={regla.maxAvisosDia} minHorasEntreAvisos={regla.minHorasEntreAvisos} />
            </div>
          </Disclosure>
        )}

        <div className="rv-reglas__botones">
          {pendiente ? (
            <>
              <BotonDeRegla accion={acciones.confirmar} id={regla.id}
                etiqueta={tr('reglas.vista.siVigilalo')} ocupado="Encendiendo…" tono="marca" />
              <BorrarRegla accion={acciones.borrar} id={regla.id} />
            </>
          ) : regla.estado === 'activa' ? (
            <>
              <BotonDeRegla accion={acciones.pausar} id={regla.id} etiqueta={tr('reglas.vista.pausar')} ocupado="Pausando…" />
              <BorrarRegla accion={acciones.borrar} id={regla.id} />
            </>
          ) : (
            <>
              <BotonDeRegla accion={acciones.reanudar} id={regla.id} etiqueta={tr('reglas.vista.reanudar')} ocupado="Reanudando…" />
              <BorrarRegla accion={acciones.borrar} id={regla.id} />
            </>
          )}
        </div>
      </div>
    </Tarjeta>
  );
}

export function ListaReglas({ reglas, acciones, tr = trEs }: {
  reglas: readonly ReglaEnPantalla[];
  acciones: AccionesRegla; tr?: Tr;
}) {
  const pendientes = reglas.filter((r) => r.estado === 'pendiente');
  const resto = reglas.filter((r) => r.estado !== 'pendiente');

  return (
    <>
      {pendientes.length > 0 && (
        <>
          <h2 className="rv-reglas__seccion" data-tono="warn">
            {tr('reglas.vista.esperandoTuConfirmacionTodav')}
          </h2>
          {pendientes.map((r) => <Ficha tr={tr} key={r.id} regla={r} acciones={acciones} />)}
        </>
      )}

      <h2 className="rv-reglas__seccion">{tr('reglas.vista.tusReglas')}</h2>
      {resto.length === 0 ? (
        <EstadoVacio titulo={tr('reglas.vista.sinReglasConfirmadas')} contenido>
          {tr('reglas.vista.escribeArribaDeQue')}
        </EstadoVacio>
      ) : (
        resto.map((r) => <Ficha tr={tr} key={r.id} regla={r} acciones={acciones} />)
      )}
    </>
  );
}
