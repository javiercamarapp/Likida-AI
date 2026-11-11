'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { ConteosPestanas } from './conteos-pestanas';

const Contexto = createContext<ConteosPestanas | undefined>(undefined);

/** El layout (servidor) resuelve los conteos y los da por aquí: así `chrome.tsx` y las ~50 pantallas no necesitan props nuevas. */
export function ProveedorConteosPestanas({ valor, children }: { valor: ConteosPestanas; children: ReactNode }) {
  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

export function useConteosPestanas(): ConteosPestanas | undefined {
  return useContext(Contexto);
}
