'use client';

import { useState, useActionState, useEffect } from 'react';
import { useFormStatus } from 'react-dom';
import { useRouter } from 'next/navigation';
import { Play, Pause, Send } from 'lucide-react';
import type { ResultadoCobranza } from '@/lib/likida/agentes/cobranza';
import { AvisoCompacto, Boton, Icono } from '@/app/ui-v2/componentes';
import '../agentes.css';

export type AccionSimple = (
  prev: { error?: string } | null,
  fd: FormData,
) => Promise<{ error?: string } | null>;

export type EstadoEjecutar = { error?: string; resultado?: ResultadoCobranza } | null;
export type AccionEjecutar = (prev: EstadoEjecutar, fd: FormData) => Promise<EstadoEjecutar>;

/**
 * "Ejecutar ahora" con confirmación en dos pasos: manda WhatsApp REAL a
 * todos los de la cola, y un botón que dispara mensajes de un clic es un
 * accidente esperando turno. La corrida ignora la ventana (el humano que
 * confirma ES la autorización), pero un agente pausado no corre ni a mano —
 * el motor lo dice y aquí se muestra tal cual.
 */
export function BotonEjecutar({ ejecutarAhora, enCola, activo }: {
  ejecutarAhora: AccionEjecutar;
  enCola: number;
  activo: boolean;
}) {
  const [estado, accion] = useActionState(ejecutarAhora, null);
  const [confirmando, setConfirmando] = useState(false);
  const router = useRouter();

  // Tras una corrida, la cola y la bitácora del servidor ya cambiaron: se
  // refresca la página completa conservando el resumen local. El cierre del
  // paso de confirmación NO vive aquí (setState en un efecto encadena
  // renders): lo hace el onSubmit, que es evento del usuario.
  useEffect(() => {
    if (estado?.resultado) router.refresh();
  }, [estado, router]);

  const r = estado?.resultado;

  return (
    <div className="rv-ag-accion">
      {confirmando ? (
        <form action={accion} onSubmit={() => setConfirmando(false)} className="rv-ag-accion__confirmar">
          <span className="rv-ag-notif__nota">
            ¿Mandar WhatsApp a {enCola} {enCola === 1 ? 'chofer' : 'choferes'} ahora?
          </span>
          <BotonConfirmar />
          <Boton variante="ghost" onClick={() => setConfirmando(false)}>Cancelar</Boton>
        </form>
      ) : (
        <Boton variante="primary" onClick={() => setConfirmando(true)}
          disabled={!activo || enCola === 0}
          title={!activo ? 'El agente está pausado' : enCola === 0 ? 'No hay a quién contactar' : 'Correr la cobranza ahora, sin esperar la ventana'}
          icono={<Icono icono={Send} tam={14} />}>
          Ejecutar ahora
        </Boton>
      )}

      {estado?.error && <AvisoCompacto tono="error" resumen={estado.error} />}
      {r && !confirmando && (
        <div className="rv-ag-accion__resultado">
          {r.omitido ? (
            <AvisoCompacto tono="warn" resumen={`El agente no corrió: ${r.omitido}.`} />
          ) : (
            <p className="rv-ag-notif__nota">
              Contactó a <strong>{r.contactados}</strong> de <span className="cifra-mono">{r.revisados}</span>
              {r.sinTelefono > 0 && <> · {r.sinTelefono} sin teléfono</>}
              {r.fallos.length > 0 && <> · <span className="rv-ag-malo">{r.fallos.length} fallos</span></>}
            </p>
          )}
          {/* FE-14: el reloj de corte (25 s) puede dejar folios sin tocar en una cola grande: se dice, para que el humano sepa que hay
              que volver a apretar "Ejecutar ahora" en vez de asumir que ya se contactó a todos. */}
          {r.cortadosPorReloj > 0 && (
            <AvisoCompacto tono="warn" resumen={`El reloj cortó la corrida — ${r.cortadosPorReloj} sin tocar todavía. Vuelve a apretar "Ejecutar ahora" para seguir.`} />
          )}
          {r.fallos.map((f, i) => (
            <AvisoCompacto key={i} tono="error" resumen={f} />
          ))}
        </div>
      )}
    </div>
  );
}

function BotonConfirmar() {
  const { pending } = useFormStatus();
  return (
    <Boton type="submit" variante="primary" loading={pending} disabled={pending} icono={pending ? undefined : <Icono icono={Send} tam={14} />}>
      {pending ? 'Mandando…' : 'Sí, mandar'}
    </Boton>
  );
}

/** Pausar / reanudar — separado de "guardar estrategia" a propósito: editar
 *  las palabras del mensaje no debe despausar al agente en silencio. */
export function BotonPausa({ alternarPausa, activo }: { alternarPausa: AccionSimple; activo: boolean }) {
  const [estado, accion] = useActionState(alternarPausa, null);
  return (
    <div className="rv-ag-accion">
      <form action={accion}>
        {/* A37-S12-04: el estado DESEADO viaja en el form; el servidor no invierte. */}
        <input type="hidden" name="deseado" value={activo ? 'pausado' : 'activo'} />
        <BotonPausaInterno activo={activo} />
      </form>
      {estado?.error && <AvisoCompacto tono="error" resumen={estado.error} />}
    </div>
  );
}

function BotonPausaInterno({ activo }: { activo: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Boton type="submit" variante="secondary" loading={pending} disabled={pending}
      title={activo ? 'El agente deja de contactar hasta que lo reanudes' : 'El agente vuelve a contactar en su ventana'}
      icono={pending ? undefined : <Icono icono={activo ? Pause : Play} tam={14} />}>
      {activo ? (pending ? 'Pausando…' : 'Pausar agente') : (pending ? 'Reanudando…' : 'Reanudar agente')}
    </Boton>
  );
}
