'use client';

import type { PerfilTenant } from '@/lib/auth/visibilidad';
import { shell as shellEs } from '@/lib/i18n/es/shell';
import { useT } from '@/lib/i18n/proveedor';
import { Drawer } from '../../ui-v2/componentes/overlay';
import { ArbolMenu, PieMenu, useMenuV2 } from './navegacion-v2';
import type { MenuV2 } from './menu-por-perfil';

/**
 * La hoja «Más» del móvil: el árbol COMPLETO de navegación (todo a la vista, sin acordeón) y el pie (organización, avisos, tema y cuenta) en el
 * Drawer del sistema de overlays (`ui-v2/componentes/overlay.tsx`, <820 px = hoja inferior con grabber; el único lugar con
 * `<dialog>`). Se abre desde la cabecera móvil; cerrada no hay ítems en el DOM, así que NUNCA hay dos navegaciones visibles.
 *
 * NO VERIFICADO en Safari iOS real (el plan lo lista como riesgo): `showModal()` es estándar desde iOS 15.4.
 */
export default function HojaMas({ abierta, alCerrar, rol, rolEtiqueta, nombre, perfil, usoIa, cerrarSesion, insignias, organizacion, flotas }: {
  abierta: boolean; alCerrar: () => void; rol: string; rolEtiqueta: string; nombre: string | null; perfil?: PerfilTenant | null;
  usoIa?: { pct: number } | null; cerrarSesion?: () => Promise<void>; insignias?: Record<string, string>;
  organizacion?: { id: string; nombre: string } | null;
  /** Solo el superadmin: las flotas (para resolver `?tenant=` en el pie). `null` = lectura caída; ausente = no aplica. */
  flotas?: Array<{ id: string; nombre: string }> | null;
}) {
  const { pathname, sufijo, menu } = useMenuV2(rol, perfil);
  return (
    <HojaMasVista abierta={abierta} alCerrar={alCerrar} menu={menu} sufijo={sufijo} pathname={pathname} perfil={perfil} insignias={insignias}
      pie={<PieMenu menu={menu} sufijo={sufijo} pathname={pathname} perfil={perfil} rol={rol} rolEtiqueta={rolEtiqueta} nombre={nombre}
        usoIa={usoIa} cerrarSesion={cerrarSesion} insignias={insignias} alNavegar={alCerrar} organizacion={organizacion} flotas={flotas} />} />
  );
}

/** El dibujo de la hoja, sin saber de qué panel es (lo comparten /dashboard y /admin): el árbol sale del `menu` recibido y el pie lo pone quien llama. */
export function HojaMasVista({ abierta, alCerrar, menu, sufijo, pathname, perfil, insignias, pie }: {
  abierta: boolean; alCerrar: () => void; menu: MenuV2; sufijo: string; pathname: string; perfil?: PerfilTenant | null;
  insignias?: Record<string, string>; pie: React.ReactNode;
}) {
  const { t } = useT('shell', shellEs);
  return (
    <Drawer abierto={abierta} onCerrar={alCerrar} titulo={t('nav.completo')} pie={abierta ? pie : undefined}>
      {/* El árbol solo existe mientras la hoja está abierta: cerrada no duplica los enlaces del sidebar en el DOM. */}
      {abierta && (
        <nav aria-label={t('nav.completo')} className="rv-hoja__nav">
          <ArbolMenu menu={menu} sufijo={sufijo} pathname={pathname} perfil={perfil} insignias={insignias} alNavegar={alCerrar} plano />
        </nav>
      )}
    </Drawer>
  );
}
