import { hrefsDelMenu, menuPorPerfil } from '@/app/dashboard/shell/menu-por-perfil';
import { TODAS_LAS_RUTAS } from '@/app/dashboard/rutas';
import { areaDeRuta, esRolNomina, puedeVerArea, puedeVerRuta, rutasConocidas, rutaPermitidaEnPerfil, RUTAS_NOMINA, type PerfilTenant } from '@/lib/auth/visibilidad';
import { PANTALLAS, PISTAS_CONTEXTUALES } from './pantallas';

// Evita el literal «/dashboard/carta-porte/borrador» (la pantalla real es dinámica) en el barrido de enlaces vivos.
const RUTA_CARTA_PORTE = '/dashboard/carta-porte';

// ═══════════════════════════════════════════════════════════════════════════
// MATRIZ DE COBERTURA: rutas de /dashboard × roles × perfil. Cada celda es 'cubierta' (un paso del recorrido o una pista
// contextual) o 'no aplica' CON MOTIVO. Una pantalla nueva sin cobertura aparece como 'sin_cobertura' y la prueba falla:
// no se puede agregar una pantalla al producto sin decidir cómo se le explica a cada rol.
// ═══════════════════════════════════════════════════════════════════════════

export const ROLES_MATRIZ = ['superadmin', 'flota_admin', 'contador', 'encargado', 'nomina', 'vendedor'] as const;
export const PERFILES_MATRIZ = ['flota', 'cinco_agentes'] as const;
export type PerfilMatriz = (typeof PERFILES_MATRIZ)[number];

/** Rutas dinámicas que `rutasConocidas` no lista (su página gatea a mano) y su regla de visibilidad. */
const DINAMICAS: Readonly<Record<string, (rol: string, perfil: PerfilTenant | null) => boolean>> = {
  // El detalle de una liquidación: área dinero y no nómina (trae el neto); el perfil la lista como '/dashboard/[id]'.
  '/dashboard/[id]': (rol, perfil) => !esRolNomina(rol) && puedeVerArea(rol, 'dinero') && (!perfil || rutaPermitidaEnPerfil(perfil, '/dashboard/[id]')),
  // El borrador cuelga de la llave de su padre.
  [`${RUTA_CARTA_PORTE}/borrador/[id]`]: (rol, perfil) => puedeVerRuta(rol, '/dashboard/carta-porte', perfil),
};

/** Rutas visibles para un rol que NO se explican a propósito, con el motivo. Cada entrada debe seguir siendo necesaria. */
export const NO_APLICA_DECLARADO: Readonly<Record<string, string>> = {
  '/dashboard/contador': 'Es la portada del contador; el dueño y el jefe de tráfico tienen su Resumen en /dashboard.',
  '/dashboard/puesta-en-marcha': 'Es el asistente de las flotas con los cinco agentes; las demás usan Arranque.',
};

export type Celda =
  | { estado: 'cubierta'; via: 'paso' | 'pista' }
  | { estado: 'no_aplica'; motivo: string }
  | { estado: 'sin_cobertura' };

export function rutasDeLaMatriz(): string[] {
  const menu = new Set<string>();
  for (const perfil of [null, 'cinco_agentes'] as const) for (const rol of ROLES_MATRIZ) for (const h of hrefsDelMenu(menuPorPerfil(rol, perfil))) menu.add(h);
  return [...new Set([...rutasConocidas(), ...TODAS_LAS_RUTAS.map((i) => i.href), ...menu, ...Object.keys(DINAMICAS)])].sort();
}

function visible(ruta: string, rol: string, perfil: PerfilTenant | null): boolean {
  const dinamica = DINAMICAS[ruta];
  if (dinamica) return dinamica(rol, perfil);
  return puedeVerRuta(rol, ruta, perfil);
}

function motivoNoVe(ruta: string, rol: string, perfil: PerfilTenant | null): string {
  if (rol === 'vendedor') return 'El vendedor trabaja en /vendedor; no abre ninguna pantalla de /dashboard.';
  if (rol === 'nomina' && !perfil) return 'Nómina y RH solo existe en flotas con los cinco agentes.';
  if (perfil && !rutaPermitidaEnPerfil(perfil, ruta) && !DINAMICAS[ruta]) return 'El perfil de los cinco agentes no ofrece esta pantalla (stand-by).';
  if (esRolNomina(rol)) return RUTAS_NOMINA.has(ruta) ? 'Sin acceso.' : 'Nómina solo ve sus tres pantallas: conteos de Liquidación, notificaciones y su perfil.';
  const area = areaDeRuta(ruta);
  if (area) return `La pantalla es del área «${area}» y este rol no la ve.`;
  return 'Este rol no abre la pantalla.';
}

export function celda(ruta: string, rol: string, perfil: PerfilMatriz): Celda {
  const p: PerfilTenant | null = perfil === 'cinco_agentes' ? 'cinco_agentes' : null;
  if (!visible(ruta, rol, p)) return { estado: 'no_aplica', motivo: motivoNoVe(ruta, rol, p) };
  if (Object.hasOwn(NO_APLICA_DECLARADO, ruta) && !hrefsDelMenu(menuPorPerfil(rol, p)).includes(ruta)) return { estado: 'no_aplica', motivo: NO_APLICA_DECLARADO[ruta] };
  if (hrefsDelMenu(menuPorPerfil(rol, p)).includes(ruta) && Object.hasOwn(PANTALLAS, ruta)) return { estado: 'cubierta', via: 'paso' };
  if (Object.hasOwn(PISTAS_CONTEXTUALES, ruta)) return { estado: 'cubierta', via: 'pista' };
  return { estado: 'sin_cobertura' };
}

export interface ResumenMatriz { celdas: number; cubiertas: number; pasos: number; pistas: number; noAplica: number; sinCobertura: string[] }
export function resumenMatriz(): ResumenMatriz {
  const r: ResumenMatriz = { celdas: 0, cubiertas: 0, pasos: 0, pistas: 0, noAplica: 0, sinCobertura: [] };
  for (const ruta of rutasDeLaMatriz()) for (const rol of ROLES_MATRIZ) for (const perfil of PERFILES_MATRIZ) {
    const c = celda(ruta, rol, perfil);
    r.celdas++;
    if (c.estado === 'cubierta') { r.cubiertas++; if (c.via === 'paso') r.pasos++; else r.pistas++; }
    else if (c.estado === 'no_aplica') r.noAplica++;
    else r.sinCobertura.push(`${ruta} · ${rol} · ${perfil}`);
  }
  return r;
}
