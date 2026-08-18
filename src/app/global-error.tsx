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

  // El MISMO lenguaje que el 404 (revisado el 17-ago-2026 contra la landing
  // nueva: papel, tinta, hairlines, kicker en mono, titular en serif,
  // píldoras), pero TODO EN LÍNEA y sin importar `editorial.tsx`: si esto se
  // pinta es porque el layout raíz murió, y ni `globals.css` ni el CSS que
  // `next/font` inyecta tienen por qué haber llegado. Un `var(--ink)` aquí se
  // resolvería a nada y la pantalla saldría en negro sobre negro.
  //
  // Por eso los hex son literales —y son los de la paleta clara, la única que
  // sobrevive a un fallo de carga de la hoja de estilos— y la serif se pide
  // por NOMBRE con su cascada: si Fraunces alcanzó a cargarse, se usa; si no,
  // cae en Georgia, exactamente la misma cascada que declara likida.ai.
  //
  // El logo va como <img> del asset estático: sobrevive al crash del árbol de
  // React, que es justo lo que el <Logo> enmascarado no garantiza aquí.
  const PAPEL = '#fbfbfd', TINTA = '#17100d', GRIS = '#6b7280', LINEA = '#ececef';
  const SERIF = 'Fraunces, Georgia, "Times New Roman", serif';
  const MONO = '"IBM Plex Mono", ui-monospace, Menlo, monospace';
  const PILDORA: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', borderRadius: 999,
    padding: '12px 22px', fontSize: 15, fontWeight: 600,
    border: '1px solid transparent', cursor: 'pointer', textDecoration: 'none',
  };

  return (
    <html lang="es">
      <body style={{
        margin: 0, minHeight: '100vh', display: 'flex', flexDirection: 'column',
        background: PAPEL, color: TINTA,
        fontFamily: '"Instrument Sans", Inter, -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif',
      }}>
        <header style={{ padding: '20px clamp(1.5rem, 4vw, 3rem)', borderBottom: `1px solid ${LINEA}` }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/images/logo.png" alt="Likida" style={{ height: 20, width: 'auto', display: 'block' }} />
        </header>

        <div style={{
          flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center',
          padding: 'clamp(3rem, 7vw, 5rem) clamp(1.5rem, 4vw, 3rem)',
        }}>
          <div style={{ maxWidth: '46rem' }}>
            <span style={{
              display: 'inline-block', fontFamily: MONO, fontSize: 11, textTransform: 'uppercase',
              letterSpacing: '0.14em', color: GRIS,
              border: `1px solid ${LINEA}`, borderRadius: 8, padding: '6px 12px', background: '#ffffff',
            }}>
              Algo se rompió
            </span>
            <h1 style={{
              margin: '1.75rem 0 0', fontFamily: SERIF, fontWeight: 400,
              fontSize: 'clamp(36px, 5.4vw, 74px)', lineHeight: 1.06, letterSpacing: '-0.015em',
            }}>
              La aplicación no pudo continuar.
            </h1>
            <p style={{ marginTop: '1.5rem', maxWidth: '34rem', color: GRIS, fontSize: 'clamp(16px, 1.3vw, 18.5px)', lineHeight: 1.65 }}>
              Vuelve a intentarlo en un momento. Si sigue igual, el código de abajo
              es exactamente lo que soporte necesita para encontrar qué pasó.
            </p>
            <div style={{ marginTop: '2.25rem', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
              <button onClick={reset} style={{ ...PILDORA, background: TINTA, color: PAPEL }}>
                Reintentar
              </button>
              {/* `<a>` y no `<Link>` a propósito: lo que falló es el layout raíz,
                  así que una navegación suave vuelve a entrar al mismo árbol roto.
                  Aquí hace falta una recarga completa del documento. */}
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
              <a href="/" style={{ ...PILDORA, background: 'transparent', borderColor: LINEA, color: TINTA }}>
                Volver al inicio
              </a>
            </div>
            {error.digest && (
              <p style={{ marginTop: '2rem', fontSize: '0.75rem', color: GRIS, userSelect: 'all' }}>
                Código del incidente:{' '}
                <span style={{ fontFamily: MONO, fontVariantNumeric: 'tabular-nums' }}>{error.digest}</span>
              </p>
            )}
          </div>
        </div>

        <footer style={{
          display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12,
          padding: '20px clamp(1.5rem, 4vw, 3rem)', borderTop: `1px solid ${LINEA}`,
          fontSize: '0.75rem', color: GRIS,
        }}>
          <p style={{ margin: 0 }}>Likida · Liquidación de viajes por WhatsApp</p>
          <p style={{ margin: 0, fontFamily: MONO, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.14em' }}>
            app.likida.ai
          </p>
        </footer>
      </body>
    </html>
  );
}
