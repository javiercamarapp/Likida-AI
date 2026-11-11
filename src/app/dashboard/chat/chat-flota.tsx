'use client';

import type { ReactNode } from 'react';
import type { DashboardKpis, Acreditables } from '@/lib/likida/analytics';
import AgenteConversacion from './agente-conversacion';
import type { TemaAgente } from './perfiles';

/**
 * «Pregunta a tus datos» — el modo `cliente` del agente de conversación (`agente-conversacion.tsx`). La lógica de datos, los permisos y
 * las rutas son las de siempre (`use-analista.ts`); la interfaz es la MISMA que usa el Copiloto de /admin. Solo cruzan datos: `kpis` y
 * `acred` ya calculados en el servidor y `cabecera` (un elemento, no una función).
 */
export default function ChatFlota({ kpis, acred, cabecera, temas }: { kpis: DashboardKpis | null; acred: Acreditables | null; cabecera?: ReactNode; temas?: TemaAgente[] }) {
  return <AgenteConversacion modo="cliente" kpis={kpis} acred={acred} cabecera={cabecera} temas={temas} />;
}
