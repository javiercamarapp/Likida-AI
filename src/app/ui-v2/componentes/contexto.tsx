'use client';

import { createContext, useContext } from 'react';

// El layout (carril A) envuelve el chrome v2 en este proveedor. Sirve solo para
// las pocas piezas cuya ESTRUCTURA cambia entre v1 y v2 (PLAN §2.4); lo demás se
// resuelve por CSS bajo [data-ui="v2"] y no necesita contexto.
const UiV2 = createContext(false);

export const UiV2Provider = UiV2.Provider;
export function useUiV2(): boolean {
  return useContext(UiV2);
}
