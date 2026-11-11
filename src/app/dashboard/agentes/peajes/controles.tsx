'use client';

import { useState, useActionState, useEffect } from 'react';
import { useFormStatus } from 'react-dom';
import { useRouter } from 'next/navigation';
import { RefreshCw } from 'lucide-react';
import type { ResumenBarrido } from '@/lib/likida/intake/consolidado';
import { Boton, Icono, Tooltip } from '@/app/ui-v2/componentes';
import './peajes.css';
import { useT } from '@/lib/i18n/proveedor';
import { agentes as agentesEs } from '@/lib/i18n/es/agentes';

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
  const { t: tx } = useT('agentes', agentesEs);
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
              ? tx('rest.barrer_las_lineas_pendientes_contra_los')
              : tx(pendientes === 1 ? 'rest.barrer_la_linea_pendiente.uno' : 'rest.barrer_la_linea_pendiente.otros', { n: pendientes })}
          </span>
          <BotonConfirmar />
          <Boton variante="ghost" tamano="sm" onClick={() => setConfirmando(false)}>{tx('cobranza.controles.cancelar')}</Boton>
        </form>
      ) : (
        <Tooltip texto={tx('rest.volver_a_cruzar_las_lineas_pendientes')}><Boton variante="secondary" tamano="sm" onClick={() => setConfirmando(true)} icono={<Icono icono={RefreshCw} tam={14} />}>{tx('cobranza.controles.ejecutar_ahora')}</Boton></Tooltip>
      )}

      {estado?.error && <p className="rv-pj-sub rv-pj-malo" role="alert">{estado.error}</p>}
      {r && !confirmando && (
        <p className="rv-pj-sub" role="status">
          {/* REN-31C-C1: `revisadas === 0` dejó de significar «la cola está
              vacía» cuando el barrido ganó reloj (REN-30-C1) — un corte antes
              de la primera línea da 0 revisadas sobre 1,000 pendientes. La
              cola vacía es la que además no cortó nada. */}
          {r.revisadas === 0 && r.cortadosPorReloj === 0 ? (
            tx('rest.no_habia_nada_pendiente_que_barrer')
          ) : r.revisadas === 0 ? (
            <>{tx('rest.no_alcance_a_revisar_ninguna_en')}{' '}<strong className="rv-ag-num">{r.cortadosPorReloj}</strong>{' '}
              {r.cortadosPorReloj === 1 ? tx('rest.linea_pendiente') : tx('rest.lineas_pendientes')}{' '}{tx('rest.fuera_por_tiempo_vuelve_a_ejecutar')}</>
          ) : (
            <>{tx('rest.revise')}{' '}<strong className="rv-ag-num">{r.revisadas}</strong>{' '}
              {r.revisadas === 1 ? tx('rest.linea_pendiente') : tx('rest.lineas_pendientes')}{tx('rest.amarre')}{' '}<strong className="rv-ag-num">{r.conciliadas}</strong>{' '}{tx('rest.contra_gastos_nuevos_refresque_candidatos_de')}{' '}<span className="rv-ag-num">{r.candidatosRefrescados}</span>;
              {' '}{r.siguenPendientes === 1 ? 'sigue' : 'siguen'} <span className="rv-ag-num">{r.siguenPendientes}</span>.
              {/* REN-30-C1: sin esta línea, «revisé 40» sobre una cola de 1,000
                  se lee como que la cola quedó limpia. */}
              {r.cortadosPorReloj > 0 && (
                <>{tx('rest.quedaron')}{' '}<strong className="rv-ag-num">{r.cortadosPorReloj}</strong>{' '}{tx('rest.fuera_de_esta_pasada_por_tiempo')}</>
              )}
            </>
          )}
        </p>
      )}
    </div>
  );
}

function BotonConfirmar() {
  const { t: tx } = useT('agentes', agentesEs);
  const { pending } = useFormStatus();
  return (
    <Boton type="submit" variante="primary" tamano="sm" loading={pending} icono={<Icono icono={RefreshCw} tam={14} />}>
      {pending ? 'Barriendo…' : tx('rest.si_barrer')}
    </Boton>
  );
}
