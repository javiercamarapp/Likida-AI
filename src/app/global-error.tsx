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

  return (
    <html lang="es">
      <body style={{
        margin: 0, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#fbfbfd', color: '#0b0b0f', padding: '1rem',
        fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", Inter, system-ui, sans-serif',
      }}>
        <div style={{
          background: '#ffffff', border: '1px solid #ececef', borderRadius: '1rem',
          padding: '2.5rem', textAlign: 'center', maxWidth: '28rem',
          boxShadow: '0 1px 2px rgba(0,0,0,0.04), 0 8px 24px -12px rgba(0,0,0,0.12)',
        }}>
          <p style={{ fontSize: '1.25rem', fontWeight: 600, letterSpacing: '-0.02em', margin: 0 }}>
            Algo se rompió
          </p>
          <p style={{ marginTop: '0.5rem', fontSize: '1rem', color: '#6b7280' }}>
            La aplicación no pudo continuar. Vuelve a intentarlo en un momento.
          </p>
          <div style={{ marginTop: '1.5rem', display: 'flex', gap: '0.75rem', justifyContent: 'center' }}>
            <button onClick={reset} style={{
              padding: '0.5rem 1rem', borderRadius: '0.5rem', fontSize: '0.875rem', fontWeight: 500,
              background: '#0e7c66', color: '#ffffff', border: 'none', cursor: 'pointer',
            }}>Reintentar</button>
            {/* `<a>` y no `<Link>` a propósito: lo que falló es el layout raíz,
                así que una navegación suave vuelve a entrar al mismo árbol roto.
                Aquí hace falta una recarga completa del documento. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a href="/dashboard" style={{
              padding: '0.5rem 1rem', borderRadius: '0.5rem', fontSize: '0.875rem', fontWeight: 500,
              border: '1px solid #ececef', color: '#0b0b0f', textDecoration: 'none',
            }}>Ir al panel</a>
          </div>
          {error.digest && (
            <p style={{
              marginTop: '1.5rem', paddingTop: '1rem', borderTop: '1px solid #ececef',
              fontSize: '0.75rem', color: '#6b7280', userSelect: 'all',
            }}>
              Código del incidente:{' '}
              <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 500 }}>{error.digest}</span>
            </p>
          )}
        </div>
      </body>
    </html>
  );
}
