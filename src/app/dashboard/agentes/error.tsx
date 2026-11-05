'use client';

import { useEffect } from 'react';
import { EstadoError, Boton } from '../../ui-v2/componentes';
import { MENSAJE_FLOTA_CAMBIO, esErrorFlotaCambio } from '@/lib/auth/flota_cambio';

// Boundary de los agentes del dashboard (CT-CAL-06): un fallo en la pantalla de UN agente se queda en el agente. Se pinta dentro del
// chrome del panel (el de /dashboard es de pantalla completa) con el mismo contrato que él: el digest en pantalla, seleccionable, y
// una línea de log que lo correlaciona (solo digest y nombre del error: el mensaje de un error de cliente puede traer datos de la pantalla).
export default function AgentesError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    void import('@/lib/logger').then(({ logger }) =>
      logger.error('panel.agentes.boundary', { digest: error.digest ?? 'sin-digest', err: error.name }),
    );
  }, [error]);
  // MX-002: este boundary está MÁS CERCA que el de /dashboard, así que es quien atrapa el FlotaCambioError de las acciones de los
  // agentes (p. ej. decidir un candidato de peajes). «Reintentar» repetiría la misma flota vieja: se dice qué pasó y la salida es recargar.
  if (esErrorFlotaCambio(error)) {
    return (
      <EstadoError
        titulo="Cambiaste de flota"
        accion={<Boton tamano="sm" onClick={() => window.location.reload()}>Recargar</Boton>}
      >
        {MENSAJE_FLOTA_CAMBIO}
      </EstadoError>
    );
  }
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
