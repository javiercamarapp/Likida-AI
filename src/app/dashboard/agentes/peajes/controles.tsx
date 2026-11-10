'use client';

import { useState, useActionState, useEffect } from 'react';
import { useFormStatus } from 'react-dom';
import { useRouter } from 'next/navigation';
import { RefreshCw } from 'lucide-react';
import type { ResumenBarrido } from '@/lib/likida/intake/consolidado';
import { Boton, Icono } from '@/app/ui-v2/componentes';
import './peajes.css';

export type EstadoBarrer = { error?: string; resumen?: ResumenBarrido } | null;
export type AccionBarrer = (prev: EstadoBarrer, fd: FormData) => Promise<EstadoBarrer>;

/**
 * "Ejecutar ahora" con confirmación en dos pasos — el mismo patrón que el
 * Agente de Cobranza (`cobranza/controles.tsx`). Aquí no sale ningún WhatsApp:
 * el barrido re-corre el cruce sobre las líneas pendientes contra los gastos
 * que llegaron DESPUÉS del estado de cuenta, y escribe solo lo que amarra. La
 * confirmación se conserva igual porque escribe conciliaciones fiscales, y un
 * botón que escribe de un clic es un accidente esperando turno.
 *
 * NO se deshabilita con la cola en cero: el conteo de la página puede estar
 * viejo (un gasto pudo llegar hace un segundo), y con cero de verdad el acuse
 * lo dice tal cual en vez de mentir con un botón muerto.
 */
export function BotonEjecutar({ ejecutarAhora, pendientes }: {
  ejecutarAhora: AccionBarrer;
  /** Lo que la página alcanzó a leer. `null` = la cola no se pudo leer. */
  pendientes: number | null;
}) {
  const [estado, accion] = useActionState(ejecutarAhora, null);
  const [confirmando, setConfirmando] = useState(false);
  const router = useRouter();

  // Tras un barrido, la cola y los KPIs del servidor ya cambiaron: se
  // refresca la página completa conservando el acuse local. El cierre del
  // paso de confirmación NO vive aquí (setState en un efecto encadena
  // renders): lo hace el onSubmit, que es evento del usuario.
  useEffect(() => {
    if (estado?.resumen) router.refresh();
  }, [estado, router]);

  const r = estado?.resumen;

  return (
    <div className="rv-pj-control">
      {confirmando ? (
        <form action={accion} onSubmit={() => setConfirmando(false)} className="rv-pj-confirmar">
          <span className="rv-pj-sub">
            {pendientes === null
              ? '¿Barrer las líneas pendientes contra los gastos de hoy?'
              : `¿Barrer ${pendientes === 1 ? 'la línea pendiente' : `las ${pendientes} líneas pendientes`} contra los gastos de hoy?`}
          </span>
          <BotonConfirmar />
          <Boton onClick={() => setConfirmando(false)}>Cancelar</Boton>
        </form>
      ) : (
        <Boton variante="primary" onClick={() => setConfirmando(true)} icono={<Icono icono={RefreshCw} />}
          title="Volver a cruzar las líneas pendientes contra los gastos que llegaron después">
          Ejecutar ahora
        </Boton>
      )}

      {estado?.error && <p className="rv-pj-sub rv-pj-malo" role="alert">{estado.error}</p>}
      {r && !confirmando && (
        <p className="rv-pj-sub" role="status">
          {/* REN-31C-C1: `revisadas === 0` dejó de significar «la cola está
              vacía» cuando el barrido ganó reloj (REN-30-C1) — un corte antes
              de la primera línea da 0 revisadas sobre 1,000 pendientes. La
              cola vacía es la que además no cortó nada. */}
          {r.revisadas === 0 && r.cortadosPorReloj === 0 ? (
            'No había nada pendiente que barrer.'
          ) : r.revisadas === 0 ? (
            <>
              No alcancé a revisar ninguna en esta pasada: quedaron{' '}
              <strong className="cifra-mono">{r.cortadosPorReloj}</strong>{' '}
              {r.cortadosPorReloj === 1 ? 'línea pendiente' : 'líneas pendientes'} fuera por tiempo.
              Vuelve a ejecutar para seguir donde se quedó.
            </>
          ) : (
            <>
              Revisé <strong className="cifra-mono">{r.revisadas}</strong>{' '}
              {r.revisadas === 1 ? 'línea pendiente' : 'líneas pendientes'}; amarré{' '}
              <strong className="cifra-mono">{r.conciliadas}</strong> contra
              gastos nuevos; refresqué candidatos de <span className="cifra-mono">{r.candidatosRefrescados}</span>;
              {' '}{r.siguenPendientes === 1 ? 'sigue' : 'siguen'} <span className="cifra-mono">{r.siguenPendientes}</span>.
              {/* REN-30-C1: sin esta línea, «revisé 40» sobre una cola de 1,000
                  se lee como que la cola quedó limpia. */}
              {r.cortadosPorReloj > 0 && (
                <>
                  {' '}Quedaron <strong className="cifra-mono">{r.cortadosPorReloj}</strong>{' '}
                  fuera de esta pasada por tiempo: vuelve a ejecutar para seguir donde se quedó.
                </>
              )}
            </>
          )}
        </p>
      )}
    </div>
  );
}

function BotonConfirmar() {
  const { pending } = useFormStatus();
  return (
    <Boton type="submit" variante="primary" loading={pending} icono={<Icono icono={RefreshCw} />}>
      {pending ? 'Barriendo…' : 'Sí, barrer'}
    </Boton>
  );
}
