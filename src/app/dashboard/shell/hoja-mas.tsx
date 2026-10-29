'use client';

import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import type { PerfilTenant } from '@/lib/auth/visibilidad';
import { ArbolMenu, PieMenu, useMenuV2 } from './navegacion-v2';

/**
 * La hoja «Más» del móvil: el árbol COMPLETO de navegación en una hoja inferior sobre `<dialog>` nativo (modal: foco
 * atrapado, Esc cierra y devuelve el foco, el resto de la página queda inerte). Se abre desde la cabecera móvil; cerrada
 * no existe para nadie (un `<dialog>` sin `open` es `display: none`), así que NUNCA hay dos navegaciones visibles.
 *
 * NO VERIFICADO en Safari iOS real (el plan lo lista como riesgo): `showModal()` es estándar desde iOS 15.4.
 */
export default function HojaMas({ abierta, alCerrar, rol, rolEtiqueta, nombre, perfil, usoIa, cerrarSesion, insignias }: {
  abierta: boolean; alCerrar: () => void; rol: string; rolEtiqueta: string; nombre: string | null; perfil?: PerfilTenant | null;
  usoIa?: { pct: number } | null; cerrarSesion?: () => Promise<void>; insignias?: Record<string, string>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const { pathname, sufijo, menu } = useMenuV2(rol, perfil);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (abierta && !d.open) d.showModal();
    if (!abierta && d.open) d.close();
  }, [abierta]);

  return (
    <dialog
      ref={ref}
      className="rv-hoja"
      aria-label="Menú completo"
      onClose={alCerrar}
      // Clic en el fondo (el propio <dialog>, no su contenido) = cerrar.
      onClick={(e) => { if (e.target === ref.current) alCerrar(); }}
    >
      <div className="rv-hoja__cab">
        <span className="rv-hoja__t">Menú</span>
        <button type="button" className="rv-icono-boton" onClick={alCerrar} aria-label="Cerrar menú">
          <X width={16} height={16} strokeWidth={1.75} aria-hidden />
        </button>
      </div>
      {/* El árbol solo existe mientras la hoja está abierta: cerrada no duplica los enlaces del sidebar en el DOM. */}
      {abierta && (
        <>
          <nav aria-label="Menú completo" className="rv-hoja__nav">
            <ArbolMenu menu={menu} sufijo={sufijo} pathname={pathname} perfil={perfil} insignias={insignias} alNavegar={alCerrar} />
          </nav>
          <div className="rv-hoja__pie">
            <PieMenu menu={menu} sufijo={sufijo} pathname={pathname} perfil={perfil} rol={rol} rolEtiqueta={rolEtiqueta} nombre={nombre}
              usoIa={usoIa} cerrarSesion={cerrarSesion} insignias={insignias} alNavegar={alCerrar} />
          </div>
        </>
      )}
    </dialog>
  );
}
