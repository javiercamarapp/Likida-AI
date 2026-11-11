import { describe, it, expect } from 'vitest';
import { shell as es } from './es/shell';
import { shell as en } from './en/shell';
import { claveNav, etiquetaNav, etiquetaRol, slugNav } from './nav';
import { crearTraductor } from './traducir';
import { ENTRADAS_DASHBOARD } from '../../app/dashboard/rutas';
import { menuPorPerfil } from '../../app/dashboard/shell/menu-por-perfil';
import { ETIQUETA_CORTA } from '../../app/dashboard/shell/barra-inferior-destinos';
import { SECCIONES, FUERA_DEL_MENU, TODAS_LAS_RUTAS } from '../../app/admin/rutas';

// ═══════════════════════════════════════════════════════════════════════════
// Todo NOMBRE que el shell enseña (entradas y pestañas del dashboard, grupos, etiquetas de la barra móvil, secciones y pantallas de
// /admin) tiene su traducción en el diccionario `shell` (`nav.n.<slug>`): una entrada nueva del menú sin traducir rompe AQUÍ, no en
// la pantalla de una persona que lee inglés.
// ═══════════════════════════════════════════════════════════════════════════

function nombresDelShell(): Set<string> {
  const n = new Set<string>(['Resumen', 'Inicio', 'Cuenta']);
  for (const e of ENTRADAS_DASHBOARD) { n.add(e.nombre); e.pestanas.forEach((p) => n.add(p.nombre)); }
  for (const rol of ['superadmin', 'flota_admin', 'contador', 'encargado', 'nomina']) {
    for (const perfil of [undefined, 'cinco_agentes' as const]) {
      const m = menuPorPerfil(rol, perfil);
      [...m.resumen, ...m.pie].forEach((i) => n.add(i.nombre));
      m.grupos.forEach((g) => { n.add(g.titulo); g.items.forEach((i) => { n.add(i.nombre); (i.pestanas ?? []).forEach((p) => n.add(p.nombre)); }); });
    }
  }
  Object.values(ETIQUETA_CORTA).forEach((e) => n.add(e));
  for (const s of SECCIONES) { n.add(s.titulo); for (const i of s.items) { n.add(i.nombre); (i.pestanas ?? []).forEach((p) => n.add(p.nombre)); } }
  FUERA_DEL_MENU.forEach((f) => n.add(f.nombre));
  return n;
}

describe('nombres de navegación traducidos', () => {
  it('cada nombre del menú, las pestañas y las barras tiene clave en es y en en', () => {
    const faltan = [...nombresDelShell()].filter((n) => !(claveNav(n) in es) || !(claveNav(n) in en));
    expect(faltan, `sin traducción en el diccionario shell: ${faltan.join(' | ')}`).toEqual([]);
  });

  it('la clave en español es el propio nombre (sin proveedor se ve lo de siempre)', () => {
    for (const n of nombresDelShell()) expect((es as Record<string, string>)[claveNav(n)], n).toBe(n);
  });

  it('todo nombre de la lista plana de ⌘K de /admin se arma con nombres que existen', () => {
    for (const r of TODAS_LAS_RUTAS) for (const parte of r.nombre.split(' · ')) expect(claveNav(parte) in es, parte).toBe(true);
  });

  it('cada rol del catálogo tiene su rótulo en inglés', () => {
    for (const rol of ['superadmin', 'flota_admin', 'contador', 'encargado', 'nomina', 'vendedor']) expect(`rol.${rol}` in en, rol).toBe(true);
  });

  it('el traductor devuelve el inglés con idioma en y el español sin él; un nombre sin clave se queda como está', () => {
    const tEn = crearTraductor<typeof es>('en', en, es);
    const tEs = crearTraductor<typeof es>('es', es, es);
    expect(etiquetaNav(tEn, 'Viajes')).toBe('Trips');
    expect(etiquetaNav(tEs, 'Viajes')).toBe('Viajes');
    expect(etiquetaNav(tEn, 'Una pantalla nueva')).toBe('Una pantalla nueva');
    expect(etiquetaRol(tEn, 'encargado', 'Jefe de tráfico')).toBe('Dispatch manager');
    expect(etiquetaRol(tEn, 'rol_nuevo', 'Rol nuevo')).toBe('Rol nuevo');
    expect(slugNav('Trust & Safety')).toBe('trust-safety');
  });
});
