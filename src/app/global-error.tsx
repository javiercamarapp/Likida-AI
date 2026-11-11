'use client';

import { useEffect } from 'react';
import { errores as t } from '@/lib/i18n/es/errores';
import { useRecuperacionChunk } from './ui-v2/componentes/recuperar-chunk';

// ═══════════════════════════════════════════════════════════════════════════
// LA ÚLTIMA RED: un fallo en el layout raíz.
//
// `dashboard/error.tsx` solo atrapa lo que pasa DENTRO del segmento. Si truena el layout raíz —o cualquier superficie fuera del
// panel— no hay boundary y Next serviría su pantalla por defecto: fondo blanco, en inglés y sin salida (auditoría 5, operabilidad).
//
// Este archivo REEMPLAZA el <html> entero, así que va con sus propias etiquetas y sin depender de nada del layout que acaba de fallar:
// ni `globals.css` ni las fuentes de `next/font` tienen por qué haber llegado. Por eso los estilos van en línea y los colores son
// literales: son los mismos valores del sistema (`ui-v2/tokens.css`, tema claro, la versión que sobrevive a una hoja de estilos que
// no cargó) con su misma jerarquía: rótulo mono, título sans 600, botón primario negro, botón de borde y código del incidente.
// El logo va como <img> del asset estático. Reusa la recuperación de ChunkLoadError del resto de las pantallas de error.
//
// Lo que sí conserva es lo único que importa a las 3 a.m.: el `digest` en pantalla (seleccionable) y una línea en el log con ese
// mismo digest. Nunca pinta `error.message`.
// ═══════════════════════════════════════════════════════════════════════════
const BG = '#f6f6f7', SUPERFICIE = '#ffffff', TINTA = '#0e0e10', GRIS = '#5a5a61', LINEA = '#e6e6e8';
const SANS = 'Inter, -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", system-ui, sans-serif';
const MONO = '"IBM Plex Mono", ui-monospace, Menlo, monospace';
const BOTON: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 8, minHeight: 36,
  padding: '0 16px', fontFamily: SANS, fontSize: 14, fontWeight: 500, border: '1px solid transparent', cursor: 'pointer', textDecoration: 'none',
};

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { chunk, reintentar } = useRecuperacionChunk(error, reset);

  useEffect(() => {
    void import('@/lib/logger').then(({ logger }) => logger.error('app.global_error', { digest: error.digest ?? 'sin-digest', err: error.name }));
  }, [error]);

  return (
    <html lang="es">
      <body style={{ margin: 0, minHeight: '100vh', display: 'flex', flexDirection: 'column', background: BG, color: TINTA, fontFamily: SANS, lineHeight: 1.6 }}>
        <header style={{ padding: '16px clamp(16px, 4vw, 40px)', borderBottom: `1px solid ${LINEA}` }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/images/logo.png" alt="Likida" style={{ height: 20, width: 'auto', display: 'block' }} />
        </header>

        <main style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: 'clamp(28px, 6vw, 64px) clamp(16px, 4vw, 40px)' }}>
          <div role="alert" style={{ width: '100%', maxWidth: 680, margin: '0 auto' }}>
            <p style={{ margin: 0, fontFamily: MONO, fontSize: 11, fontWeight: 500, letterSpacing: '0.14em', textTransform: 'uppercase', color: GRIS }}>
              {t['raiz.rotulo']}
            </p>
            <h1 style={{ margin: '8px 0 0', fontSize: 'clamp(24px, 4vw, 32px)', fontWeight: 600, lineHeight: 1.15, letterSpacing: '-0.025em' }}>
              {chunk ? t['chunk.titulo'] : t['raiz.titulo']}
            </h1>
            <p style={{ margin: '12px 0 0', maxWidth: '60ch', fontSize: 16, color: GRIS }}>
              {chunk ? t['chunk.apoyo'] : t['raiz.apoyo']}
            </p>
            <div style={{ marginTop: 24, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
              <button type="button" onClick={reintentar} style={{ ...BOTON, background: TINTA, color: SUPERFICIE }}>
                {chunk ? t['accion.recargar'] : t['accion.reintentar']}
              </button>
              {/* `<a>` y no `<Link>` a propósito: lo que falló es el layout raíz, así que una navegación suave vuelve a entrar al mismo
                  árbol roto. Aquí hace falta una recarga completa del documento. */}
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
              <a href="/" style={{ ...BOTON, background: SUPERFICIE, borderColor: LINEA, color: TINTA }}>{t['accion.inicio']}</a>
            </div>
            {error.digest && (
              <p style={{ margin: '24px 0 0', fontSize: 12, color: GRIS, userSelect: 'all' }}>
                {t['codigo.rotulo']}: <span style={{ fontFamily: MONO, fontVariantNumeric: 'tabular-nums' }}>{error.digest}</span>
              </p>
            )}
          </div>
        </main>

        <footer style={{ padding: '16px clamp(16px, 4vw, 40px)', borderTop: `1px solid ${LINEA}`, fontSize: 12, color: GRIS }}>
          <p style={{ margin: 0 }}>{t['raiz.pie']}</p>
        </footer>
      </body>
    </html>
  );
}
