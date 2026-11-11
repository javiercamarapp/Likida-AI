import { ENTRADAS_DASHBOARD, type Item } from '../rutas';
import { puedeVerRuta, type PerfilTenant } from '@/lib/auth/visibilidad';

// ═══════════════════════════════════════════════════════════════════════════
// ⌘K DEL DASHBOARD — datos puros, sin React.
//
// La lista sale del MISMO catálogo y del MISMO filtro que el menú (`ENTRADAS_DASHBOARD` + `puedeVerRuta(rol, href, perfil)`):
// el buscador nunca ofrece una pantalla que el rol o el perfil no abren (un resultado que rebota al hacer Enter es peor que un
// resultado ausente). Cada pestaña aparece como «Entrada · Pestaña»; una entrada de una sola pantalla, con su nombre. Las
// palabras alternas (alias) de cada entrada también encuentran la pantalla («grúa» → Emergencias, «arco» → Legal y privacidad).
// ═══════════════════════════════════════════════════════════════════════════

export interface DestinoPaleta {
  href: string;
  /** «Entrada · Pestaña», o solo la entrada si tiene una sola pantalla. */
  etiqueta: string;
  Icono: Item['Icono'];
  /** Nombre de la pestaña (o de la entrada): «ARCO» encuentra «Legal y privacidad · ARCO» aunque la etiqueta empiece con otra palabra. */
  nombre: string;
  /** Palabras extra con las que se encuentra (nombre de la entrada, de la pestaña y alias). */
  busca: string;
}

/** Minúsculas y sin acentos: «grúa» encuentra «grua» y al revés. */
export function normalizar(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/** Todas las pantallas que el rol abre bajo el perfil, en el orden del menú. */
export function paletaDelDashboard(rol: string, perfil?: PerfilTenant | null): DestinoPaleta[] {
  const salida: DestinoPaleta[] = [];
  const vistos = new Set<string>();
  for (const e of ENTRADAS_DASHBOARD) {
    for (const t of e.pestanas) {
      if (vistos.has(t.href) || (t.soloConPerfil && !perfil) || !puedeVerRuta(rol, t.href, perfil)) continue;
      vistos.add(t.href);
      const etiqueta = e.pestanas.length === 1 || t.nombre === e.nombre ? e.nombre : `${e.nombre} · ${t.nombre}`;
      salida.push({ href: t.href, etiqueta, nombre: t.nombre, Icono: e.Icono, busca: normalizar([e.nombre, t.nombre, ...(e.alias ?? [])].join(' ')) });
    }
  }
  return salida;
}

/** Filtra por la consulta: los que EMPIEZAN con ella primero, luego los que la contienen. Consulta vacía = todo en su orden. */
export function filtrarPaleta(lista: readonly DestinoPaleta[], consulta: string): DestinoPaleta[] {
  const q = normalizar(consulta);
  if (!q) return [...lista];
  const empieza: DestinoPaleta[] = [];
  const contiene: DestinoPaleta[] = [];
  for (const d of lista) {
    const et = normalizar(d.etiqueta);
    if (et.startsWith(q) || normalizar(d.nombre).startsWith(q)) empieza.push(d);
    else if (et.includes(q) || d.busca.includes(q)) contiene.push(d);
  }
  return [...empieza, ...contiene];
}
