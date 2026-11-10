'use client';

import { ErrorPanel } from '../ui-v2/componentes/error-panel';

// Error boundary de /admin (y, por re-exportación, de flotas, mapa-prospectos, observabilidad y qa): el fallo se queda en el área.
export default function AdminError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorPanel error={error} reset={reset} variante="admin" evento="admin.boundary" />;
}
