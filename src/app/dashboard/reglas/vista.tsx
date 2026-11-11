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

const CANAL: Record<string, string> = {
  dinero: 'Te llega a ti (dueño/contador)',
  operacion: 'Le llega al jefe de tráfico',
};

function Evidencias({ regla }: { regla: ReglaEnPantalla }) {
  if (regla.ultimasEvidencias.length === 0) {
    return (
      <p className="rv-reglas__tenue">
        {regla.ultimaCorridaEn
          ? `Revisada el ${fechaHoraMx(regla.ultimaCorridaEn)} — todavía no ha sonado.`
          : 'Todavía no la reviso: el barrido corre cada hora.'}
      </p>
    );
  }
  return (
    <div className="rv-reglas__avisos">
      <p className="rv-reglas__rotulo">Últimas veces que sonó</p>
      {regla.ultimasEvidencias.map((e) => (
        <p key={`${e.disparadoEn}-${e.evidencia.slice(0, 24)}`} className="rv-reglas__renglon">
          <span className="rv-reglas__fecha">{fechaHoraMx(e.disparadoEn)}</span>{' '}
          {e.evidencia}
        </p>
      ))}
    </div>
  );
}

const VIA: Record<string, string> = {
  texto: 'mensaje de WhatsApp', botones: 'mensaje con botones', plantilla: 'plantilla (ventana de 24 h cerrada)',
};

/** El historial de AVISOS (0520): cada vez que la regla intentó avisar, salió o
 *  no, y por qué canal. Distinto de «Últimas veces que sonó», que cita los casos. */
function HistorialAvisos({ regla }: { regla: ReglaEnPantalla }) {
  if (regla.ultimosAvisos.length === 0) {
    return <p className="rv-reglas__tenue">Todavía no ha mandado ningún aviso.</p>;
  }
  return (
    <div className="rv-reglas__avisos">
      {regla.ultimosAvisos.map((a) => (
        <p key={`${a.enviadoEn}-${a.resultado}`} className="rv-reglas__renglon">
          <span className="rv-reglas__fecha">{fechaHoraMx(a.enviadoEn)}</span>{' '}
          {a.resultado === 'enviado'
            ? `Avisó ${a.casos} caso${a.casos === 1 ? '' : 's'} por ${VIA[a.via ?? ''] ?? 'WhatsApp'}.`
            : <span className="rv-reglas__error">No salió ({a.casos} caso{a.casos === 1 ? '' : 's'}): {a.error ?? 'WhatsApp lo rechazó'}. Se reintenta.</span>}
        </p>
      ))}
    </div>
  );
}

function Ficha({ regla, acciones }: { regla: ReglaEnPantalla; acciones: AccionesRegla }) {
  const pendiente = regla.estado === 'pendiente';
  return (
    <Tarjeta titulo={regla.frase} acciones={
      <StatusChip tono={pendiente ? 'warn' : regla.estado === 'activa' ? 'ok' : 'neutral'}>
        {pendiente ? 'Esperando tu confirmación' : regla.estado === 'activa' ? 'Vigilando' : 'Pausada'}
      </StatusChip>
    }>
      <div className="rv-reglas__ficha">
        {/* La cita de lo que la persona escribió. Está aquí para que pueda juzgar la traducción — no porque el sistema la vuelva a leer. */}
        <p className="rv-reglas__cita">
          Tú escribiste: &ldquo;{regla.textoOriginal}&rdquo;
        </p>
        <p className="rv-reglas__tenue">
          {regla.titulo} · {CANAL[regla.canal] ?? regla.canal}
        </p>

        {!pendiente && <Evidencias regla={regla} />}

        {!pendiente && (
          <Disclosure variante="linea" titulo="Historial de avisos y límite de frecuencia">
            <div className="rv-reglas__avisos">
              <HistorialAvisos regla={regla} />
              <FormaFrecuencia accion={acciones.frecuencia} id={regla.id}
                maxAvisosDia={regla.maxAvisosDia} minHorasEntreAvisos={regla.minHorasEntreAvisos} />
            </div>
          </Disclosure>
        )}

        <div className="rv-reglas__botones">
          {pendiente ? (
            <>
              <BotonDeRegla accion={acciones.confirmar} id={regla.id}
                etiqueta="Sí, vigílalo" ocupado="Encendiendo…" tono="marca" />
              <BorrarRegla accion={acciones.borrar} id={regla.id} />
            </>
          ) : regla.estado === 'activa' ? (
            <>
              <BotonDeRegla accion={acciones.pausar} id={regla.id} etiqueta="Pausar" ocupado="Pausando…" />
              <BorrarRegla accion={acciones.borrar} id={regla.id} />
            </>
          ) : (
            <>
              <BotonDeRegla accion={acciones.reanudar} id={regla.id} etiqueta="Reanudar" ocupado="Reanudando…" />
              <BorrarRegla accion={acciones.borrar} id={regla.id} />
            </>
          )}
        </div>
      </div>
    </Tarjeta>
  );
}

export function ListaReglas({ reglas, acciones }: {
  reglas: readonly ReglaEnPantalla[];
  acciones: AccionesRegla;
}) {
  const pendientes = reglas.filter((r) => r.estado === 'pendiente');
  const resto = reglas.filter((r) => r.estado !== 'pendiente');

  return (
    <>
      {pendientes.length > 0 && (
        <>
          <h2 className="rv-reglas__seccion" data-tono="warn">
            Esperando tu confirmación — todavía no vigilan nada
          </h2>
          {pendientes.map((r) => <Ficha key={r.id} regla={r} acciones={acciones} />)}
        </>
      )}

      <h2 className="rv-reglas__seccion">Tus reglas</h2>
      {resto.length === 0 ? (
        <EstadoVacio titulo="Sin reglas confirmadas" contenido>
          Escribe arriba de qué quieres que te avise y te enseño cómo lo entendí antes de encenderla.
        </EstadoVacio>
      ) : (
        resto.map((r) => <Ficha key={r.id} regla={r} acciones={acciones} />)
      )}
    </>
  );
}
