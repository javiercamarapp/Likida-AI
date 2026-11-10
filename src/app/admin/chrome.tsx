import { LogOut } from 'lucide-react';
import { CLASES_V2 } from '../marco-v2';
import SidebarNav, { PieAdmin, MarcaAdmin, AsideAdmin } from './sidebar-nav';
import CommandPalette from './command-palette';
import CabeceraAdmin from './cabecera-admin';
import ProveedorMarcoAdmin from './pestanas-admin';
import CapaCarga from '../dashboard/shell/capa-carga';
import CopilotoPanel from './copiloto-panel';
import { TRAZO_ICONO } from '../ui-v2/componentes/icono';

/**
 * El marco de /admin sobre el MISMO sistema que el dashboard (7-nov-2026, ronda R8): `.rv-app`, `.rv-fila`, `.rv-sb`, `.rv-col` y
 * `.rv-contenido` de `ui-v2/shell.css` (sidebar flotante de 232 px, riel de 72, tarjeta de contenido). Lo propio de /admin vive en
 * `admin-shell.css`. Puro dibujo, SIN autorización adentro (la puerta vive en `layout.tsx`), para poder verificar el marco real
 * en un render de prueba sin sesión.
 *
 * El Copiloto (⌘J, `copiloto-panel.tsx`) sigue siendo hermano de la columna dentro de la fila y cancela el gap con su margen -16.
 */
export default function AdminChrome({
  nombre, avatarUrl, cerrarSesion, flotas, flotaActual, children,
}: {
  nombre: string | null;
  avatarUrl: string | null;
  /** Server action. Opcional: el render de prueba no cierra sesión de nadie. */
  cerrarSesion?: () => Promise<void>;
  /** Las flotas para el selector del pie (`null` = no se pudo leer; ausente = no se pidió, p. ej. render de prueba). */
  flotas?: Array<{ id: string; nombre: string }> | null;
  /** La flota elegida (cookie firmada de `elegir-flota`), o `null`. */
  flotaActual?: string | null;
  children: React.ReactNode;
}) {
  // El <form> de salir se arma AQUÍ (servidor) y baja como elemento: ninguna función cruza al cliente.
  const salir = cerrarSesion ? (
    <form action={cerrarSesion} className="rv-cuenta__salir">
      <button type="submit" title="Cerrar sesión" aria-label="Cerrar sesión" className="rv-icono-boton">
        <LogOut width={16} height={16} strokeWidth={TRAZO_ICONO} aria-hidden />
      </button>
    </form>
  ) : null;
  return (
    <div className={CLASES_V2.raiz} data-ui="v2" style={{ fontFamily: 'var(--font-sans-ui), var(--font-sans)' }}>
      {/* El mismo telón de carga con el logo que el dashboard (una vez por sesión): /admin no lo montaba. */}
      <CapaCarga />
      <CommandPalette />
      <div className={`${CLASES_V2.fila} adm-fila`}>
        <AsideAdmin>
          <MarcaAdmin />
          <nav aria-label="Navegación de la consola" className="rv-sb__nav">
            <SidebarNav />
          </nav>
          <div className="rv-sb__pie">
            <PieAdmin nombre={nombre} avatarUrl={avatarUrl} flotas={flotas} flotaActual={flotaActual} salir={salir} />
          </div>
        </AsideAdmin>

        <div className={`${CLASES_V2.columna} columna-centro`}>
          <CabeceraAdmin />
          <div id="contenido-principal" tabIndex={-1} className={CLASES_V2.contenido}>
            <ProveedorMarcoAdmin>{children}</ProveedorMarcoAdmin>
          </div>
        </div>

        <CopilotoPanel />
      </div>
    </div>
  );
}
