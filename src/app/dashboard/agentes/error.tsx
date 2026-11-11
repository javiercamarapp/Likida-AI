'use client';

import { ErrorPanel } from '../../ui-v2/componentes/error-panel';

// Boundary de los agentes del dashboard (CT-CAL-06): un fallo en la pantalla de UN agente se queda en el agente. Está MÁS CERCA que el
// de /dashboard, así que también atrapa el FlotaCambioError de sus acciones (MX-002): `ErrorPanel` lo reconoce y dice «recarga».
export default function AgentesError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorPanel error={error} reset={reset} variante="agente" evento="panel.agentes.boundary" />;
}
