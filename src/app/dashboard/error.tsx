'use client';

import Link from 'next/link';
import { useEffect } from 'react';

// ═══════════════════════════════════════════════════════════════════════════
// Error boundary del segmento dashboard: un fallo de red/render NO deja
// pantalla rota; muestra un mensaje sobrio y una salida.
//
// TIRABA EL ÚNICO HILO QUE HABÍA. La firma era
// `({ reset }: { error: Error; reset: () => void })`: declaraba el `error` y se
// quedaba solo con `reset`. Next entrega ahí un `digest` —el hash que
// correlaciona lo que el usuario vio con la línea del log del servidor— y se
// descartaba: no se pintaba, no se reportaba, no se registraba
// (auditoría 5, operabilidad, ALTO).
//
// Escenario del 6 de agosto: el contralor abre el panel en la sala, ve "No se
// pudo cargar el panel", y no hay nada que preguntarle —ni un código en
// pantalla— ni nada que buscar después. Ahora hay las dos cosas:
//
//   · El digest EN PANTALLA, seleccionable. Es lo que el presentador puede
//     leer en voz alta o capturar, y lo único que después permite encontrar la
//     petición que falló.
//   · Una línea en el servidor. `src/app/` no importaba el logger en ninguna
//     parte salvo el webhook: las superficies web fallaban sin registrar.
//
// El logger redacta PII, y `digest` está en su lista de claves que NO se tocan
// (`logger.ts`, CLAVES_NO_PII): son diez dígitos, o sea exactamente la forma de
// un celular mexicano sin lada, y salía como `[TEL]` — con eso el puente entre
// pantalla y log dejaba de servir para lo único que sirve.
// ═══════════════════════════════════════════════════════════════════════════
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Import perezoso: el logger es de servidor y este es un componente de
    // cliente. En el navegador el `console.error` del logger es lo que queda en
    // la consola de quien reproduce el fallo; en el servidor, la línea del log.
    void import('@/lib/logger').then(({ logger }) =>
      logger.error('panel.boundary', {
        digest: error.digest ?? 'sin-digest',
        err: error.message,
      }),
    );
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="card p-10 text-center max-w-md">
        <p className="text-xl font-semibold tracking-tight">No se pudo cargar el panel</p>
        <p className="mt-2 text-base" style={{ color: 'var(--muted)' }}>
          Hubo un problema al leer los datos. Puedes reintentar.
        </p>
        <p className="mt-2 text-sm" style={{ color: 'var(--muted)' }}>
          Esto NO significa que no haya liquidaciones: significa que no se pudieron leer.
        </p>
        <div className="mt-6 flex items-center justify-center gap-3">
          <button onClick={reset} className="px-4 py-2 rounded-lg text-sm font-medium"
            style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}>Reintentar</button>
          <Link href="/" className="px-4 py-2 rounded-lg text-sm font-medium hairline">Inicio</Link>
        </div>
        {error.digest && (
          <p className="mt-6 pt-4 border-t text-xs select-all" style={{ color: 'var(--muted)', borderColor: 'var(--line)' }}>
            Código del incidente: <span className="tabular font-medium">{error.digest}</span>
          </p>
        )}
      </div>
    </div>
  );
}
