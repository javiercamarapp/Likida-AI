'use client';

import { useEffect } from 'react';

// ═══════════════════════════════════════════════════════════════════════════
// LA ÚLTIMA RED: un fallo en el layout raíz.
//
// `dashboard/error.tsx` solo atrapa lo que pasa DENTRO del segmento. Si truena
// el layout raíz —o cualquier superficie fuera del panel: /acceso, /demo, la
// portada— no había boundary y Next servía su pantalla por defecto: fondo
// blanco, "Application error: a client-side exception has occurred", en inglés
// y sin salida (auditoría 5, operabilidad, ALTO — `find src/app -name
// "global-error.tsx"` devolvía vacío).
//
// Este archivo REEMPLAZA el <html> entero, así que va con sus propias etiquetas
// y sin depender de nada del layout que acaba de fallar. Por eso los estilos van
// en línea: `globals.css` lo carga el layout raíz, y aquí puede no haber llegado.
// Los colores son los del sistema en su versión clara, que es la que sobrevive
// a un fallo de carga de la hoja de estilos.
//
// Lo que sí conserva es lo único que importa a las 3 a.m.: el `digest` en
// pantalla y una línea en el log con ese mismo digest.
// ═══════════════════════════════════════════════════════════════════════════
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    void import('@/lib/logger').then(({ logger }) =>
      logger.error('app.global_error', {
        digest: error.digest ?? 'sin-digest',
        err: error.message,
      }),
    );
  }, [error]);

  // El MISMO lenguaje que el 404 (orden del 17-ago), pero TODO en línea: si
  // esto se pinta es porque el layout raíz murió y globals.css puede no haber
  // llegado. El logo va como <img> del asset estático (sobrevive al crash del
  // árbol de React) y la tipografía display cae a la del sistema.
  return (
    <html lang="es">
      <body style={{
        margin: 0, minHeight: '100vh', display: 'flex', flexDirection: 'column',
        justifyContent: 'space-between', background: '#fbfbfd', color: '#0b0b0f',
        padding: 'clamp(2rem, 5vw, 3.5rem)',
        fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", Inter, system-ui, sans-serif',
      }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/images/logo.png" alt="Likida" style={{ height: 24, width: 'auto', alignSelf: 'flex-start' }} />

        <div style={{ maxWidth: '48rem' }}>
          <p style={{ margin: 0, fontSize: '0.75rem', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.14em', color: '#6b7280' }}>
            Algo se rompió
          </p>
          <h1 style={{
            margin: '1.25rem 0 0', fontWeight: 500,
            fontSize: 'clamp(34px, 6vw, 72px)', lineHeight: 0.98, letterSpacing: '-0.042em',
          }}>
            La aplicación no pudo continuar
          </h1>
          <p style={{ marginTop: '1.5rem', maxWidth: '32rem', color: '#6b7280', fontSize: 'clamp(16px, 1.5vw, 19px)', lineHeight: 1.55 }}>
            Vuelve a intentarlo en un momento. Si sigue igual, el código de abajo
            es exactamente lo que soporte necesita para encontrar qué pasó.
          </p>
          <div style={{ marginTop: '2.25rem', display: 'flex', alignItems: 'center', gap: '1.75rem' }}>
            <button onClick={reset} style={{
              background: 'none', border: 'none', padding: 0, cursor: 'pointer',
              fontSize: '1rem', fontWeight: 500, color: '#0b0b0f',
              borderBottom: '1px solid rgba(11,11,15,0.28)', paddingBottom: 2,
            }}>Reintentar →</button>
            {/* `<a>` y no `<Link>` a propósito: lo que falló es el layout raíz,
                así que una navegación suave vuelve a entrar al mismo árbol roto.
                Aquí hace falta una recarga completa del documento. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a href="/dashboard" style={{ fontSize: '1rem', fontWeight: 500, color: '#6b7280', textDecoration: 'none' }}>
              Ir al panel
            </a>
          </div>
          {error.digest && (
            <p style={{ marginTop: '2rem', fontSize: '0.75rem', color: '#9ca3af', userSelect: 'all' }}>
              Código del incidente:{' '}
              <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 500 }}>{error.digest}</span>
            </p>
          )}
        </div>

        <p style={{ fontSize: '0.75rem', color: '#9ca3af', margin: 0 }}>
          Likida · Liquidación de viajes por WhatsApp
        </p>
      </body>
    </html>
  );
}
