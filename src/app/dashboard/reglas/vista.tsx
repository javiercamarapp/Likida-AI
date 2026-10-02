import { fechaHoraMx } from '@/lib/formato';
import { EstadoVacio, StatusPill } from '@/app/admin/ui/kit';
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
      <p className="text-[11.5px]" style={{ color: 'var(--faint)' }}>
        {regla.ultimaCorridaEn
          ? `Revisada el ${fechaHoraMx(regla.ultimaCorridaEn)} — todavía no ha sonado.`
          : 'Todavía no la reviso: el barrido corre cada hora.'}
      </p>
    );
  }
  return (
    <div className="space-y-1">
      <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
        Últimas veces que sonó
      </p>
      {regla.ultimasEvidencias.map((e) => (
        <p key={`${e.disparadoEn}-${e.evidencia.slice(0, 24)}`} className="text-[11.5px]" style={{ color: 'var(--ink2)' }}>
          <span className="cifra-mono" style={{ color: 'var(--faint)' }}>{fechaHoraMx(e.disparadoEn)}</span>{' '}
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
    return (
      <p className="text-[11.5px]" style={{ color: 'var(--faint)' }}>
        Todavía no ha mandado ningún aviso.
      </p>
    );
  }
  return (
    <div className="space-y-1">
      {regla.ultimosAvisos.map((a) => (
        <p key={`${a.enviadoEn}-${a.resultado}`} className="text-[11.5px]" style={{ color: 'var(--ink2)' }}>
          <span className="cifra-mono" style={{ color: 'var(--faint)' }}>{fechaHoraMx(a.enviadoEn)}</span>{' '}
          {a.resultado === 'enviado'
            ? `Avisó ${a.casos} caso${a.casos === 1 ? '' : 's'} por ${VIA[a.via ?? ''] ?? 'WhatsApp'}.`
            : <span style={{ color: 'var(--bad)' }}>No salió ({a.casos} caso{a.casos === 1 ? '' : 's'}): {a.error ?? 'WhatsApp lo rechazó'}. Se reintenta.</span>}
        </p>
      ))}
    </div>
  );
}

function Ficha({ regla, acciones }: { regla: ReglaEnPantalla; acciones: AccionesRegla }) {
  const pendiente = regla.estado === 'pendiente';
  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1 min-w-0">
          <p className="text-[13.5px] font-medium" style={{ color: 'var(--ink)' }}>{regla.frase}</p>
          {/* La cita de lo que la persona escribió. Está aquí para que pueda
              juzgar la traducción — no porque el sistema la vuelva a leer. */}
          <p className="text-[11.5px] italic" style={{ color: 'var(--muted)' }}>
            Tú escribiste: &ldquo;{regla.textoOriginal}&rdquo;
          </p>
          <p className="text-[11px]" style={{ color: 'var(--faint)' }}>
            {regla.titulo} · {CANAL[regla.canal] ?? regla.canal}
          </p>
        </div>
        <div className="shrink-0">
          <StatusPill estado={pendiente ? 'warn' : regla.estado === 'activa' ? 'ok' : 'neutral'}>
            {pendiente ? 'Esperando tu confirmación' : regla.estado === 'activa' ? 'Vigilando' : 'Pausada'}
          </StatusPill>
        </div>
      </div>

      {!pendiente && <Evidencias regla={regla} />}

      {!pendiente && (
        <details className="rounded-lg hairline p-3">
          <summary className="cursor-pointer text-[12px] font-medium select-none list-none" style={{ color: 'var(--ink2)' }}>
            Historial de avisos y límite de frecuencia
          </summary>
          <div className="pt-3 space-y-3">
            <HistorialAvisos regla={regla} />
            <FormaFrecuencia accion={acciones.frecuencia} id={regla.id}
              maxAvisosDia={regla.maxAvisosDia} minHorasEntreAvisos={regla.minHorasEntreAvisos} />
          </div>
        </details>
      )}

      <div className="flex flex-wrap items-start gap-2 pt-1">
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
  );
}

export function ListaReglas({ reglas, acciones }: {
  reglas: readonly ReglaEnPantalla[];
  acciones: AccionesRegla;
}) {
  const pendientes = reglas.filter((r) => r.estado === 'pendiente');
  const resto = reglas.filter((r) => r.estado !== 'pendiente');

  return (
    <div className="space-y-5">
      {pendientes.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--warn)' }}>
            Esperando tu confirmación — todavía no vigilan nada
          </h2>
          {pendientes.map((r) => <Ficha key={r.id} regla={r} acciones={acciones} />)}
        </section>
      )}

      <section className="space-y-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
          Tus reglas
        </h2>
        {resto.length === 0 ? (
          <EstadoVacio>
            Todavía no tienes ninguna regla confirmada. Escribe arriba de qué quieres
            que te avise y te enseño cómo lo entendí antes de encenderla.
          </EstadoVacio>
        ) : (
          resto.map((r) => <Ficha key={r.id} regla={r} acciones={acciones} />)
        )}
      </section>
    </div>
  );
}
