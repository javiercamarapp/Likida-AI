import { Route, Scale, ScrollText, UsersRound, MessagesSquare } from 'lucide-react';
import type { AgenteConCorridas } from '@/lib/likida/agentes/corridas';
import type { AgenteInsight } from '@/lib/likida/insights/tipos';
import { type TResto, T_RESTO_ES } from '@/lib/i18n/resto_tr';

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
export const fichasCincoAgentes = (t: TResto = T_RESTO_ES): readonly FichaAgente[] => ([
  { clave: 'liquidacion', nombre: t('op.liquidacion_automatica'), href: '/dashboard/agentes/liquidacion', Icono: Route, corridas: 'liquidacion',
    descripcion: t('op.arma_la_liquidacion_de_cada_viaje') , insight: 'liquidacion' },
  { clave: 'peajes', nombre: t('op.conciliacion_de_peajes'), href: '/dashboard/agentes/peajes', Icono: Scale, corridas: 'peajes',
    descripcion: t('op.cruza_el_estado_de_cuenta_de') , insight: 'peajes' },
  { clave: 'carta_porte', nombre: t('op.carta_porte_en_automatico'), href: '/dashboard/agentes/carta-porte', Icono: ScrollText, corridas: 'carta_porte',
    descripcion: t('op.prepara_el_borrador_del_complemento_y') , insight: 'carta-porte' },
  { clave: 'vigia', nombre: t('op.servicio_al_cliente'), href: '/dashboard/agentes/vigia', Icono: UsersRound, corridas: null,
    descripcion: t('op.atiende_a_los_clientes_de_la') , insight: 'vigia' },
  { clave: 'conductor', nombre: t('op.comunicacion_con_operadores'), href: '/dashboard/agentes/conductores', Icono: MessagesSquare, corridas: 'conductores',
    descripcion: t('op.sigue_los_hitos_del_viaje_y') , insight: 'conductores' },
]);
export const FICHAS_CINCO_AGENTES = fichasCincoAgentes();

