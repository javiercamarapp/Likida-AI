import { Route, Scale, ScrollText, UsersRound, MessagesSquare } from 'lucide-react';
import type { AgenteConCorridas } from '@/lib/likida/agentes/corridas';
import type { AgenteInsight } from '@/lib/likida/insights/tipos';

// Las fichas de los cinco agentes del perfil `cinco_agentes`. Viven aparte de `inicio-cinco-agentes.tsx` para que el Inicio v2
// (`inicio-cinco-v2.tsx`) y el v1 compartan UNA sola fuente sin importarse en círculo.

export interface FichaAgente {
  clave: string;
  nombre: string;
  descripcion: string;
  href: string;
  Icono: typeof Route;
  /** Qué agente de `agente_corrida` lo representa; `null` si no registra corridas. */
  corridas: AgenteConCorridas | null;
  /** Con qué clave lo nombra el marco de insights (T-INS-02). */
  insight: AgenteInsight;
}

/** Los cinco, en el orden en que los nombra el producto. Una sola fuente para el Resumen. */
export const FICHAS_CINCO_AGENTES: readonly FichaAgente[] = [
  { clave: 'liquidacion', nombre: 'Liquidación automática', href: '/dashboard/agentes/liquidacion', Icono: Route, corridas: 'liquidacion',
    descripcion: 'Arma la liquidación de cada viaje y marca lo que no cuadra.' , insight: 'liquidacion' },
  { clave: 'peajes', nombre: 'Conciliación de peajes', href: '/dashboard/agentes/peajes', Icono: Scale, corridas: 'peajes',
    descripcion: 'Cruza el estado de cuenta de casetas contra los viajes.' , insight: 'peajes' },
  { clave: 'carta_porte', nombre: 'Carta Porte en automático', href: '/dashboard/agentes/carta-porte', Icono: ScrollText, corridas: 'carta_porte',
    descripcion: 'Prepara el borrador del complemento y pide lo que falta.' , insight: 'carta-porte' },
  { clave: 'vigia', nombre: 'Servicio al cliente', href: '/dashboard/agentes/vigia', Icono: UsersRound, corridas: null,
    descripcion: 'Atiende a los clientes de la flota; una persona aprueba.' , insight: 'vigia' },
  { clave: 'conductor', nombre: 'Comunicación con operadores', href: '/dashboard/agentes/conductores', Icono: MessagesSquare, corridas: 'conductores',
    descripcion: 'Sigue los hitos del viaje y avisa cuando algo no se reporta.' , insight: 'conductores' },
];

