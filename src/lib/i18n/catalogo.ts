import type { Idioma } from './idioma';
import type { shell as shellEs } from './es/shell';
import type { errores as erroresEs } from './es/errores';
import type { graficas as graficasEs } from './es/graficas';
import type { avisos as avisosEs } from './es/avisos';
import type { monitoreo as monitoreoEs } from './es/monitoreo';
import type { fuentes as fuentesEs } from './es/fuentes';
import type { login as loginEs } from './es/login';
import type { operacion as operacionEs } from './es/operacion';
import type { dinero as dineroEs } from './es/dinero';
import type { agentes as agentesEs } from './es/agentes';

// ═══════════════════════════════════════════════════════════════════════════
// CATÁLOGO DE NAMESPACES — el único lugar donde se registra un diccionario nuevo.
//
// Un namespace = una pareja de archivos `es/<ns>.ts` + `en/<ns>.ts` (por superficie, p. ej. `shell`, `inicio`, `viajes`) para
// no mandar al navegador más texto del que una pantalla usa. Se carga SOLO el idioma activo (`import()` por idioma), nunca
// los dos. `i18n_paridad.test.ts` recorre este catálogo y además exige que no haya archivos sueltos fuera de él.
//
// Para agregar uno: 1) crear es/<ns>.ts (`as const`) y en/<ns>.ts (`Record<keyof typeof es, string>`); 2) sumarlo en
// `Diccionarios`, en `NAMESPACES` y en los dos cargadores de abajo.
// ═══════════════════════════════════════════════════════════════════════════

/** El tipo de cada namespace, según el diccionario en español (la fuente de verdad). */
export interface Diccionarios {
  shell: typeof shellEs;
  errores: typeof erroresEs;
  graficas: typeof graficasEs;
  avisos: typeof avisosEs;
  monitoreo: typeof monitoreoEs;
  fuentes: typeof fuentesEs;
  login: typeof loginEs;
  operacion: typeof operacionEs;
  dinero: typeof dineroEs;
  agentes: typeof agentesEs;
}
export type Namespace = keyof Diccionarios;

/** Forma común a es y en: las MISMAS claves, valores de texto. */
export type DiccionarioDe<N extends Namespace> = { readonly [K in keyof Diccionarios[N]]: string };
export type ClaveDe<N extends Namespace> = keyof Diccionarios[N] & string;

export const NAMESPACES = ['shell', 'errores', 'graficas', 'avisos', 'monitoreo', 'fuentes', 'login', 'operacion', 'dinero', 'agentes'] as const satisfies readonly Namespace[];

type Cargadores = { [I in Idioma]: { [N in Namespace]: () => Promise<DiccionarioDe<N>> } };

export const CARGADORES: Cargadores = {
  es: { shell: () => import('./es/shell').then((m) => m.shell), errores: () => import('./es/errores').then((m) => m.errores),
    graficas: () => import('./es/graficas').then((m) => m.graficas), avisos: () => import('./es/avisos').then((m) => m.avisos),
    monitoreo: () => import('./es/monitoreo').then((m) => m.monitoreo),
    fuentes: () => import('./es/fuentes').then((m) => m.fuentes),
    login: () => import('./es/login').then((m) => m.login),
    operacion: () => import('./es/operacion').then((m) => m.operacion),
    dinero: () => import('./es/dinero').then((m) => m.dinero),
    agentes: () => import('./es/agentes').then((m) => m.agentes) },
  en: { shell: () => import('./en/shell').then((m) => m.shell), errores: () => import('./en/errores').then((m) => m.errores),
    graficas: () => import('./en/graficas').then((m) => m.graficas), avisos: () => import('./en/avisos').then((m) => m.avisos),
    monitoreo: () => import('./en/monitoreo').then((m) => m.monitoreo),
    fuentes: () => import('./en/fuentes').then((m) => m.fuentes),
    login: () => import('./en/login').then((m) => m.login),
    operacion: () => import('./en/operacion').then((m) => m.operacion),
    dinero: () => import('./en/dinero').then((m) => m.dinero),
    agentes: () => import('./en/agentes').then((m) => m.agentes) },
};

/** Carga SOLO los namespaces pedidos, y SOLO en el idioma pedido. */
export async function cargarDiccionarios<N extends Namespace>(idioma: Idioma, namespaces: readonly N[]): Promise<Pick<{ [K in Namespace]: DiccionarioDe<K> }, N>> {
  const pares = await Promise.all(namespaces.map(async (ns) => [ns, await CARGADORES[idioma][ns]()] as const));
  return Object.fromEntries(pares) as Pick<{ [K in Namespace]: DiccionarioDe<K> }, N>;
}
