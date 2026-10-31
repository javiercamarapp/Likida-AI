import { ProveedorNotificaciones } from '../../admin/ui/notificaciones';
import type { PerfilTenant } from '@/lib/auth/visibilidad';
import { ROL_BADGE, type RolAppUser } from '@/lib/auth/provisionar';
import { CLASES_V2 } from '../../marco-v2';
import AvisoRol from '../aviso-rol';
import SidebarV2 from './sidebar-v2';
import CabeceraEscritorio from './cabecera-escritorio';
import CabeceraMovil from './cabecera-movil';
import CapaCarga from './capa-carga';

/**
 * El marco visual de /dashboard v2. Mismo contrato de props que `DashboardChrome` (el de siempre, que NO se toca):
 * `layout.tsx` elige uno u otro según `versionUi`. Sin autorización adentro, puro dibujo.
 *
 * El div raíz lleva `data-ui="v2"` junto a `tema-neutro`, renderizado en el SERVIDOR (sin parpadeo ni desajuste de
 * hidratación). Todo el CSS nuevo cuelga de ese atributo, así que sin él v1 pinta idéntico.
 *
 * Una sola navegación visible a la vez, por breakpoints disjuntos en `ui-v2/shell.css`:
 *   · <768 px     cabecera sticky de 56 px + hoja «Más» (sin riel);
 *   · 768–1023 px riel de 72 px;
 *   · ≥1024 px    sidebar flotante de 232 px (riel de 72 si el usuario lo pliega) y topbar de 44 px.
 * La capa de carga única (`CapaCarga`) viaja en el HTML del servidor, visible desde el primer fotograma, y tapa todo el marco
 * hasta que el contenido está listo (ver `capa-carga.tsx` y `ui-v2/carga.css`). Sin `Fondo` (el shader): v2 es plano y el documento recibe el fondo por `html:root:has([data-ui="v2"])` (tokens.css).
 */
export default function DashboardChromeV2({
  nombre, rol, cerrarSesion, usoIa, perfil, insignias, children,
}: {
  nombre: string | null;
  rol: string;
  /** Server action. Opcional: el render de prueba no cierra sesión de nadie. */
  cerrarSesion?: () => Promise<void>;
  /** El % usado del presupuesto diario de análisis con IA; solo se pinta sin perfil. */
  usoIa?: { pct: number } | null;
  /** Perfil de la flota (0770): recorta el menú. */
  perfil?: PerfilTenant | null;
  /** Insignias por href del menú (p. ej. el avance de «Puesta en marcha»); las llena quien conoce el avance. */
  insignias?: Record<string, string>;
  children: React.ReactNode;
}) {
  // `provisionar.ts` toca la base: la etiqueta del rol se resuelve AQUÍ (servidor) y baja como texto a los componentes cliente.
  const rolEtiqueta = ROL_BADGE[rol as RolAppUser] ?? rol.toUpperCase();
  return (
    <ProveedorNotificaciones>
      <div className={CLASES_V2.raiz} data-ui="v2" style={{ fontFamily: 'var(--font-sans-ui), var(--font-sans)' }}>
        <CapaCarga />
        <a href="#contenido-principal" className={CLASES_V2.saltar}>Saltar al contenido</a>
        <CabeceraMovil rol={rol} rolEtiqueta={rolEtiqueta} nombre={nombre} perfil={perfil} usoIa={usoIa} cerrarSesion={cerrarSesion} insignias={insignias} />
        <div className={CLASES_V2.fila}>
          <SidebarV2 rol={rol} rolEtiqueta={rolEtiqueta} nombre={nombre} perfil={perfil} usoIa={usoIa} cerrarSesion={cerrarSesion} insignias={insignias} />
          <div className={CLASES_V2.columna}>
            <CabeceraEscritorio rol={rol} perfil={perfil} />
            {/* `tabIndex={-1}`: el enlace «Saltar al contenido» mueve el foco AQUÍ. */}
            <div id="contenido-principal" tabIndex={-1} className={CLASES_V2.contenido}>
              <AvisoRol rolReal={rol} />
              {children}
            </div>
          </div>
        </div>
      </div>
    </ProveedorNotificaciones>
  );
}
