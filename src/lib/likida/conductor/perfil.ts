import type { PerfilSeguimiento } from './config';
import { TIPOS_HITO, type HitoFila, type TipoHito } from './tipos';

// ═══════════════════════════════════════════════════════════════════════════
// EL PERFIL DE SEGUIMIENTO decide QUÉ hitos del ciclo sigue el agente (T-A5-08, migración 0801).
//
//   completo    los 5 hitos de siempre. Es el comportamiento de antes, bit a bit: aquí nada cambia.
//   esenciales  solo «ya cargó» (`salida_carga`). «Dónde está» y «no se ha reportado» viven FUERA de los hitos (la última
//               posición y la escalera de señal de vida), así que siguen funcionando sin ningún hito más. Los otros cuatro
//               hitos NACEN `omitido` con motivo `fuera_de_perfil`: no se piden, no se persiguen, no se detectan por GPS y
//               no cuentan como «atrasado» ni «sin reporte». El ciclo de descarga y regreso queda construido y apagado,
//               no borrado: pasar la flota a `completo` los reactiva.
//
// Lo comparten la siembra (SQL y `asegurarHitos`), el planificador, el ciclo por geocerca y el tablero: un solo sitio donde
// se dice qué hitos están dentro de cada perfil. Sin I/O.
// ═══════════════════════════════════════════════════════════════════════════

/** Motivo con que se omite un hito que el perfil de la flota no sigue (el CHECK `viaje_hito_omitido_motivo` exige un motivo). */
export const MOTIVO_FUERA_DE_PERFIL = 'fuera_de_perfil';

/** Los hitos que cada perfil persigue. Espejo exacto de la lista que usa `sembrar_hitos_conductor` (0801). */
export const HITOS_DEL_PERFIL: Readonly<Record<PerfilSeguimiento, readonly TipoHito[]>> = {
  completo: TIPOS_HITO,
  esenciales: ['salida_carga'],
};

export function hitoEnPerfil(perfil: PerfilSeguimiento, tipo: TipoHito): boolean {
  return HITOS_DEL_PERFIL[perfil].includes(tipo);
}

/** Un hito que el perfil dejó fuera (omitido con el motivo `fuera_de_perfil`). */
export function estaFueraDePerfil(h: Pick<HitoFila, 'estado' | 'omitidoMotivo'>): boolean {
  return h.estado === 'omitido' && h.omitidoMotivo === MOTIVO_FUERA_DE_PERFIL;
}

/**
 * Los hitos tal como los ve el motor con el perfil VIGENTE de la flota. Un hito pendiente que el perfil no sigue se lee como
 * omitido aunque la base todavía lo traiga `esperado` (el perfil se cambió y la siembra no ha corrido): así el cron no persigue
 * ni detecta nada fuera del perfil en esa ventana. Los ya registrados (recibido/validado) se conservan siempre. Con `completo`
 * devuelve la MISMA lista, sin tocar nada.
 */
export function aplicarPerfil(hitos: readonly HitoFila[], perfil: PerfilSeguimiento): readonly HitoFila[] {
  if (perfil === 'completo') return hitos;
  return hitos.map((h) => (
    !hitoEnPerfil(perfil, h.tipo) && (h.estado === 'esperado' || h.estado === 'escalado')
      ? { ...h, estado: 'omitido' as const, omitidoMotivo: MOTIVO_FUERA_DE_PERFIL }
      : h
  ));
}

/** El estado con que nace cada hito de un viaje nuevo según el perfil (lo que debe espejar la siembra de SQL). */
export function hitosDeSiembra(perfil: PerfilSeguimiento): Array<{ tipo: TipoHito; estado: 'esperado' | 'omitido'; omitidoMotivo: string | null }> {
  return TIPOS_HITO.map((tipo) => (hitoEnPerfil(perfil, tipo)
    ? { tipo, estado: 'esperado' as const, omitidoMotivo: null }
    : { tipo, estado: 'omitido' as const, omitidoMotivo: MOTIVO_FUERA_DE_PERFIL }));
}
