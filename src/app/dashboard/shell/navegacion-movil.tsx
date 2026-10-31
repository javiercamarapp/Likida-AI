'use client';

import { useState } from 'react';
import type { PerfilTenant } from '@/lib/auth/visibilidad';
import HojaMas from './hoja-mas';
import BarraInferior from './barra-inferior';

/**
 * La navegación móvil de abajo (<768 px): la barra inferior flotante (4 destinos del rol + «Más») y la hoja «Más» (árbol completo, tema y
 * cuenta). La hoja la abre la barra; el estado vive aquí. Va al FINAL del marco, después del sidebar y del contenido: en el DOM los
 * enlaces del sidebar quedan primero y la barra (oculta en escritorio) nunca se interpone en un `a[href]` que toma el primero.
 */
export default function NavegacionMovil({ rol, rolEtiqueta, nombre, perfil, usoIa, cerrarSesion, insignias }: {
  rol: string; rolEtiqueta: string; nombre: string | null; perfil?: PerfilTenant | null; usoIa?: { pct: number } | null;
  cerrarSesion?: () => Promise<void>; insignias?: Record<string, string>;
}) {
  const [abierta, setAbierta] = useState(false);
  return (
    <>
      <BarraInferior rol={rol} perfil={perfil} masAbierta={abierta} alAbrirMas={() => setAbierta(true)} />
      <HojaMas abierta={abierta} alCerrar={() => setAbierta(false)} rol={rol} rolEtiqueta={rolEtiqueta} nombre={nombre} perfil={perfil}
        usoIa={usoIa} cerrarSesion={cerrarSesion} insignias={insignias} />
    </>
  );
}
