'use client';

import { ErrorPanel } from '../ui-v2/componentes/error-panel';

// Error boundary del segmento /dashboard: un fallo de red o de render no deja la pantalla rota. Todo el cuerpo vive en `ErrorPanel`
// (un solo componente para panel, consola y agentes): el digest en pantalla, seleccionable, y su línea de log; jamás el mensaje interno.
export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorPanel error={error} reset={reset} variante="panel" evento="panel.boundary" />;
}
