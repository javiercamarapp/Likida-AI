import * as React from 'react';
import { crearTraductor, type Variables } from '@/lib/i18n/traducir';
import { IDIOMA_POR_OMISION, idiomaValido, type Idioma } from '@/lib/i18n/idioma';
import { idiomaAmbiente } from '@/lib/i18n/ambiente';
import { useIdioma } from '@/lib/i18n/proveedor';
import { ui_comun as es } from '@/lib/i18n/es/ui_comun';
import { ui_comun as en } from '@/lib/i18n/en/ui_comun';

// Textos de los componentes compartidos. NO son 'use client' (los usan páginas de servidor y paneles de cliente), así que reciben
// `idioma` por prop (la prop explícita SIEMPRE gana) y, si no llega, lo resuelven solos con `idiomaUi`:
//   · en el navegador y en el SSR de un árbol cliente: el contexto del `IdiomaProvider` (sin proveedor, es);
//   · en un Server Component: el idioma que `idiomaActual()` dejó para la petición (`ambiente.ts`); si nadie lo fijó (páginas
//     públicas /login y legales, pruebas), es.
// Nunca lanza.
export type ClaveUi = keyof typeof es;

type InternosReact = { __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE?: { H?: unknown } | null };

/** El idioma efectivo: la prop si es válida; si no, el del contexto (cliente) o el de la petición (servidor); si no, es. */
export function idiomaUi(prop?: Idioma): Idioma {
  if (idiomaValido(prop)) return prop;
  try {
    // El `useContext` solo existe en el build de cliente de React, y solo se puede llamar DENTRO de un render (hay dispatcher);
    // fuera de uno (helpers llamados desde pruebas o scripts) no se toca, para no emitir «Invalid hook call».
    const internos = (React as unknown as InternosReact).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
    if (internos) {
      if (internos.H) {
        // eslint-disable-next-line react-hooks/rules-of-hooks -- se llama siempre igual dentro de un mismo render y un mismo entorno
        return useIdioma();
      }
      return IDIOMA_POR_OMISION;
    }
    return idiomaAmbiente() ?? IDIOMA_POR_OMISION;
  } catch {
    return IDIOMA_POR_OMISION;
  }
}

export function textoUi(idioma?: Idioma): (clave: ClaveUi, variables?: Variables) => string {
  const efectivo = idiomaUi(idioma);
  const tr = crearTraductor(efectivo, efectivo === 'en' ? en : es, es);
  return (clave, variables) => tr.t(clave, variables);
}
