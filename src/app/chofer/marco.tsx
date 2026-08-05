import NavInferior from './nav';
import { Logo } from '../logo';

// ═══════════════════════════════════════════════════════════════════════════
// EL MARCO DEL PANEL DEL CHOFER — barra de arriba, columna y pestañas.
//
// Separado de `layout.tsx` por lo mismo que `vista.tsx` está separado de las
// páginas: el layout empieza por `requireOperador()` y no se puede renderizar
// sin sesión, así que el preview temporal tendría que copiarlo para poder
// mirarlo — y una copia solo se verifica a sí misma. Aquí la autorización
// queda de un lado y el marco del otro, y lo que se mira es lo que se sirve.
//
// AUDITORÍA 10, BAJO (frontend) — el header traía un `<span>` de texto plano
// "Likida" en vez del lockup `<Logo/>` que ya pintan `/admin` (`layout.tsx`) y
// `/dashboard` (`chrome.tsx`): la única de las tres consolas sin ícono ni la
// tipografía de marca. Mismo componente, no una copia — una copia diverge la
// próxima vez que alguien retoque el logo.
// ═══════════════════════════════════════════════════════════════════════════

export function MarcoChofer({
  nombre,
  cerrarSesion,
  ruta,
  children,
}: {
  nombre: string | null;
  cerrarSesion: () => Promise<void>;
  /** Solo para el preview: en producción la pestaña activa sale de la URL. */
  ruta?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen" style={{ background: 'var(--bg)', color: 'var(--ink)' }}>
      <header
        className="sticky top-0 z-10 border-b"
        style={{
          background: 'var(--surface)',
          borderColor: 'var(--line)',
          paddingTop: 'env(safe-area-inset-top)',
        }}
      >
        <div className="px-4 h-14 flex items-center justify-between gap-3">
          <Logo alto="h-5" />
          <div className="flex items-center gap-3 min-w-0">
            <span className="text-base truncate" style={{ color: 'var(--muted)' }}>
              {nombre ?? 'Mi cuenta'}
            </span>
            <form action={cerrarSesion}>
              <button
                type="submit"
                className="text-base font-medium px-3 rounded-lg"
                style={{ minHeight: 44, background: 'var(--canvas)', border: '1px solid var(--line)' }}
              >
                Salir
              </button>
            </form>
          </div>
        </div>
      </header>

      {/* UNA SOLA COLUMNA. El `max-w-md` no es para el teléfono —ahí no aplica—
          sino para que abrirlo en una tablet no estire una lista de tickets a
          lo ancho de la pantalla. El `pb-28` deja libre la barra de pestañas. */}
      <main className="px-4 py-5 pb-28 max-w-md mx-auto flex flex-col gap-4">{children}</main>

      <NavInferior ruta={ruta} />
    </div>
  );
}
