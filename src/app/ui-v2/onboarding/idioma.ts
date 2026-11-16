import { crearTraductor, type Variables } from '@/lib/i18n/traducir';
import type { Idioma } from '@/lib/i18n/idioma';
import { etiquetaNav, etiquetaRol } from '@/lib/i18n/nav';
import { onboarding as onbEs } from '@/lib/i18n/es/onboarding';
import { onboarding as onbEn } from '@/lib/i18n/en/onboarding';
import { shell as shellEs } from '@/lib/i18n/es/shell';
import { shell as shellEn } from '@/lib/i18n/en/shell';
import { PANTALLAS } from './pantallas';
import { PANTALLAS_EN } from './en/pantallas';
import type { Pantalla } from './tipos';

// ═══════════════════════════════════════════════════════════════════════════
// IDIOMA DEL RECORRIDO — SOLO SERVIDOR. El recorrido, las pistas y el asistente se CONSTRUYEN en el servidor (`recorridos/index.ts`)
// y llegan al navegador ya armados; por eso aquí se importan los dos diccionarios (el navegador nunca importa este archivo: el
// proveedor del recorrido solo importa `pista.ts`). Sin contexto (pruebas, llamadas viejas) todo sale en español, idéntico a antes.
// ═══════════════════════════════════════════════════════════════════════════

export interface CtxOnb {
  idioma: Idioma;
  t: (clave: keyof typeof onbEs, variables?: Variables) => string;
  /** El nombre de una entrada del menú en el idioma activo (sin clave, el propio nombre). */
  nav: (nombre: string) => string;
  /** El rótulo de un rol en el idioma activo. */
  rol: (rol: string, rotulo: string) => string;
}

export function ctxOnb(idioma: Idioma = 'es'): CtxOnb {
  const tr = crearTraductor(idioma, idioma === 'en' ? onbEn : onbEs, onbEs);
  const sh = crearTraductor(idioma, idioma === 'en' ? shellEn : shellEs, shellEs);
  return {
    idioma,
    t: (clave, variables) => tr.t(clave, variables),
    nav: (nombre) => (idioma === 'es' ? nombre : etiquetaNav(sh, nombre)),
    rol: (rol, rotulo) => (idioma === 'es' ? rotulo : etiquetaRol(sh, rol, rotulo)),
  };
}

/** La pantalla del catálogo en el idioma pedido: la española, con sus textos sustituidos por los ingleses si los hay. */
export function pantallaEn(href: string, idioma: Idioma): Pantalla {
  const base = PANTALLAS[href];
  const en = idioma === 'en' ? PANTALLAS_EN[href] : undefined;
  if (!base || !en) return base;
  return {
    ...base,
    que: en.que,
    clave: { ...base.clave, titulo: en.claveTitulo, texto: en.claveTexto },
    ...(base.accion && en.accion ? { accion: { ...base.accion, ...en.accion } } : {}),
    ...(base.variantes ? { variantes: en.variantes ?? {} } : {}),
  };
}
