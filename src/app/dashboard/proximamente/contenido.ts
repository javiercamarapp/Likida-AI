import type { ModuloPerfil } from '@/lib/auth/visibilidad';
import type { ContenidoProximamente } from './proximamente';

/**
 * Qué enseña la pantalla «Próximamente» de cada módulo en fase 2, y a qué
 * pantalla real corresponde (la que se enciende cuando el módulo sale de
 * `MODULOS_PROXIMAMENTE_PERFIL`). Texto fijo: ningún dato de la flota.
 */
export const CONTENIDO_PROXIMAMENTE: Readonly<Partial<Record<ModuloPerfil, ContenidoProximamente & { rutaReal: string }>>> = {};
