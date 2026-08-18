'use client';

import { useEffect } from 'react';
import { Kicker, Pildora, TituloEditorial, serifEditorial } from '../editorial';

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

  // El MISMO lenguaje que el 404 (revisado el 17-ago-2026 contra la landing
  // nueva): kicker en mono, titular en serif, píldoras de tinta. Las piezas
  // salen de `editorial.tsx`, no se re-escriben aquí — si el 404 cambia de
  // registro, esta pantalla lo cambia con él.
  //
  // LO QUE NO COPIA DEL 404 es el marco: esto se pinta DENTRO del chrome del
  // panel (sidebar, asistente, el logo ya en pantalla). Repetir ahí la
  // cabecera con logo y el pie de marca sería enseñar la marca dos veces en la
  // misma vista. La consistencia que importa es la de la voz, no la del marco.
  //
  // El digest sigue en pantalla y seleccionable — es el único puente con la
  // línea del log.
  return (
    <div
      className={`${serifEditorial.variable} min-h-screen flex flex-col justify-between px-8 py-8 md:px-14 md:py-12`}
      style={{ background: 'var(--bg)' }}
    >
      <div />
      <div className="max-w-3xl">
        <Kicker>Algo falló</Kicker>
        <TituloEditorial>No se pudo cargar el panel.</TituloEditorial>
        <p className="mt-6 max-w-lg" style={{ color: 'var(--muted)', fontSize: 'clamp(16px, 1.3vw, 18.5px)', lineHeight: 1.65 }}>
          Hubo un problema al leer los datos — que no es lo mismo que no haya datos.
          Reintenta; si sigue, el código de abajo es lo que soporte necesita.
        </p>
        <div className="mt-9 flex flex-wrap items-center gap-3">
          <Pildora onClick={reset}>Reintentar</Pildora>
          <Pildora href="/" variante="borde">Volver al inicio</Pildora>
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
