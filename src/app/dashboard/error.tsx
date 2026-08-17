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

  // El MISMO lenguaje que el 404 (orden del 17-ago): display grande, mucho
  // aire, salidas en texto. El digest sigue en pantalla y seleccionable —
  // es el único puente con la línea del log.
  return (
    <div
      className="min-h-screen flex flex-col justify-between px-8 py-8 md:px-14 md:py-12"
      style={{ background: 'var(--bg)' }}
    >
      <div />
      <div className="max-w-3xl">
        <p className="text-xs font-medium uppercase" style={{ color: 'var(--muted)', letterSpacing: '0.14em' }}>
          Algo falló
        </p>
        <h1
          className="mt-5 font-medium"
          style={{
            fontFamily: 'var(--font-display), system-ui, sans-serif',
            fontSize: 'clamp(34px, 6vw, 72px)',
            lineHeight: 0.98,
            letterSpacing: '-0.042em',
            textWrap: 'balance',
          }}
        >
          No se pudo cargar el panel
        </h1>
        <p className="mt-6 max-w-lg" style={{ color: 'var(--muted)', fontSize: 'clamp(16px, 1.5vw, 19px)', lineHeight: 1.55 }}>
          Hubo un problema al leer los datos — que no es lo mismo que no haya datos.
          Reintenta; si sigue, el código de abajo es lo que soporte necesita.
        </p>
        <div className="mt-9 flex items-center gap-7">
          <button onClick={reset} className="group inline-flex items-center gap-2 text-base font-medium" style={{ color: 'var(--ink)' }}>
            <span className="pb-0.5" style={{ borderBottom: '1px solid color-mix(in srgb, var(--ink) 28%, transparent)' }}>Reintentar</span>
            <span aria-hidden className="transition-transform duration-200 group-hover:translate-x-1 motion-reduce:transform-none motion-reduce:transition-none">→</span>
          </button>
          <Link href="/" className="text-base font-medium" style={{ color: 'var(--muted)' }}>Inicio</Link>
        </div>
        {error.digest && (
          <p className="mt-8 text-xs select-all" style={{ color: 'var(--faint, var(--muted))' }}>
            Código del incidente: <span className="tabular font-medium">{error.digest}</span>
          </p>
        )}
      </div>
      <p className="text-xs" style={{ color: 'var(--faint, var(--muted))' }}>
        Likida · Liquidación de viajes por WhatsApp
      </p>
    </div>
  );
}
