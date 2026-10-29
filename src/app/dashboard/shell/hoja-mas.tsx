'use client';

import type { PerfilTenant } from '@/lib/auth/visibilidad';
import { Drawer } from '../../ui-v2/componentes/overlay';
import { ArbolMenu, PieMenu, useMenuV2 } from './navegacion-v2';

/**
 * La hoja «Más» del móvil: el árbol COMPLETO de navegación (todo a la vista, sin acordeón) y el pie (tema + cuenta) en el
 * Drawer del sistema de overlays (`ui-v2/componentes/overlay.tsx`, <820 px = hoja inferior con grabber; el único lugar con
 * `<dialog>`). Se abre desde la cabecera móvil; cerrada no hay ítems en el DOM, así que NUNCA hay dos navegaciones visibles.
 *
 * NO VERIFICADO en Safari iOS real (el plan lo lista como riesgo): `showModal()` es estándar desde iOS 15.4.
 */
export default function HojaMas({ abierta, alCerrar, rol, rolEtiqueta, nombre, perfil, usoIa, cerrarSesion, insignias }: {
  abierta: boolean; alCerrar: () => void; rol: string; rolEtiqueta: string; nombre: string | null; perfil?: PerfilTenant | null;
  usoIa?: { pct: number } | null; cerrarSesion?: () => Promise<void>; insignias?: Record<string, string>;
}) {
  const { pathname, sufijo, menu } = useMenuV2(rol, perfil);
  return (
    <Drawer abierto={abierta} onCerrar={alCerrar} titulo="Menú" pie={abierta ? (
      <PieMenu menu={menu} sufijo={sufijo} pathname={pathname} perfil={perfil} rol={rol} rolEtiqueta={rolEtiqueta} nombre={nombre}
        usoIa={usoIa} cerrarSesion={cerrarSesion} insignias={insignias} alNavegar={alCerrar} />
    ) : undefined}>
      {/* El árbol solo existe mientras la hoja está abierta: cerrada no duplica los enlaces del sidebar en el DOM. */}
      {abierta && (
        <nav aria-label="Menú completo" className="rv-hoja__nav">
          <ArbolMenu menu={menu} sufijo={sufijo} pathname={pathname} perfil={perfil} insignias={insignias} alNavegar={alCerrar} plano />
        </nav>
      )}
    </Drawer>
  );
}
