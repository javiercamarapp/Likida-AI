'use client';

import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { IDIOMA_POR_OMISION, LANG_HTML, type Idioma } from './idioma';
import type { DiccionarioDe, Namespace } from './catalogo';
import { crearTraductor, type Traductor } from './traducir';
import {
  fechaCorta, fechaHoraMx, fechaMx, horaMx, litros, mxn, mxnCompacto, mxnEntero, numero, porcentaje,
} from '../formato';

// ═══════════════════════════════════════════════════════════════════════════
// PROVEEDOR Y HOOKS PARA CLIENT COMPONENTS (también funcionan en Server Components que se renderizan como parte de un árbol
// cliente, y en pruebas de render estático).
//
// SIN PROVEEDOR = ESPAÑOL. `useIdioma()` devuelve 'es' y `useT(ns, base)` traduce con el diccionario es que el propio componente
// importa (`base`), exactamente lo que hoy dicen sus literales: por eso las pruebas actuales no cambian. Con proveedor, el layout
// (servidor) manda SOLO el idioma activo y SOLO los namespaces de la ruta; el es viaja con el componente (igual que sus literales
// de hoy) y el en solo viaja cuando está activo.
// ═══════════════════════════════════════════════════════════════════════════

type Diccionarios = { [N in Namespace]?: DiccionarioDe<N> };
interface Contexto { idioma: Idioma; diccionarios: Diccionarios }

const Ctx = createContext<Contexto | null>(null);

export function IdiomaProvider({ idioma, diccionarios = {}, children }: { idioma: Idioma; diccionarios?: Diccionarios; children: ReactNode }) {
  // El layout raíz no lee cookies (rutas públicas estáticas): el `lang` de <html> lo ajusta el proveedor.
  useEffect(() => { document.documentElement.lang = LANG_HTML[idioma]; }, [idioma]);
  const valor = useMemo(() => ({ idioma, diccionarios }), [idioma, diccionarios]);
  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}

/** El idioma activo; 'es' si no hay proveedor. */
export function useIdioma(): Idioma {
  return useContext(Ctx)?.idioma ?? IDIOMA_POR_OMISION;
}

/**
 * El traductor de un namespace. `base` = el diccionario es del namespace (el componente lo importa de `@/lib/i18n/es/<ns>`):
 * es el respaldo y lo que se usa sin proveedor.
 */
export function useT<N extends Namespace>(ns: N, base: DiccionarioDe<N>): Traductor<DiccionarioDe<N>> {
  const ctx = useContext(Ctx);
  const idioma = ctx?.idioma ?? IDIOMA_POR_OMISION;
  const dic = ctx?.diccionarios[ns] as DiccionarioDe<N> | undefined;
  return useMemo(() => crearTraductor<DiccionarioDe<N>>(idioma, dic ?? base, base), [idioma, dic, base]);
}

/** Las funciones de `formato.ts` ya ligadas al idioma activo: `const f = useFormato(); f.mxn(1234.5)`. */
export function useFormato() {
  const idioma = useIdioma();
  return useMemo(() => ({
    idioma,
    mxn: (n: number) => mxn(n, idioma),
    mxnCompacto: (n: number) => mxnCompacto(n, idioma),
    mxnEntero: (n: number) => mxnEntero(n, idioma),
    numero: (n: number) => numero(n, idioma),
    porcentaje: (n: number, decimales?: number) => porcentaje(n, decimales, idioma),
    litros: (n: number) => litros(n, idioma),
    fechaMx: (iso?: string | null) => fechaMx(iso, idioma),
    fechaCorta: (iso?: string | null) => fechaCorta(iso, idioma),
    fechaHoraMx: (iso?: string | null) => fechaHoraMx(iso, idioma),
    horaMx: (iso?: string | null) => horaMx(iso, idioma),
  }), [idioma]);
}
