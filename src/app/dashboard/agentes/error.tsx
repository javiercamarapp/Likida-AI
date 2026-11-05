'use client';

import { useEffect } from 'react';
import { EstadoError } from '../../ui-v2/componentes';

// Boundary de los agentes del dashboard (CT-CAL-06): un fallo en la pantalla de UN agente se queda en el agente. Se pinta dentro del
// chrome del panel (el de /dashboard es de pantalla completa) con el mismo contrato que él: el digest en pantalla, seleccionable, y
// una línea de log que lo correlaciona (solo digest y nombre del error: el mensaje de un error de cliente puede traer datos de la pantalla).
export default function AgentesError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    void import('@/lib/logger').then(({ logger }) =>
      logger.error('panel.agentes.boundary', { digest: error.digest ?? 'sin-digest', err: error.name }),
    );
  }, [error]);
  return (
    <>
      <EstadoError titulo="No se pudo cargar este agente" onReintentar={reset}>
        Hubo un problema al leer los datos, que no es lo mismo que no haya datos. Reintenta; si sigue, el código de abajo es lo que soporte necesita.
      </EstadoError>
      {error.digest && (
        <p className="select-all" style={{ color: 'var(--muted)', fontSize: 12, marginTop: 12 }}>
          Código del incidente: <span className="tabular">{error.digest}</span>
        </p>
      )}
    </>
  );
}
