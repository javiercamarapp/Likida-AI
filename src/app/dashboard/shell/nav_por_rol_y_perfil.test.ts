import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { puedeVerRuta, rutasConocidas, RUTAS_NOMINA, type PerfilTenant } from '@/lib/auth/visibilidad';
import { ENTRADAS_DASHBOARD } from '../rutas';
import { menuPorPerfil, hrefsDelMenu, hrefsConPestanas, hrefActivo } from './menu-por-perfil';
import { paletaDelDashboard, filtrarPaleta } from './paleta-datos';

// ═══════════════════════════════════════════════════════════════════════════
// LA NAVEGACIÓN DEL DASHBOARD POR ROL × PERFIL (Fase 8, P-DAS-NAV).
//
// Contrato: para cada rol y cada perfil (`cinco_agentes` incluido) el `href` de cada entrada es una pestaña que ESE rol abre
// bajo ESE perfil, ninguna pestaña ofrecida rebota (`puedeVerRuta`), el menú no esconde una pantalla que el rol sí abre, y ⌘K
// ofrece exactamente lo que el menú alcanza. Datos: solo roles y rutas del producto (ningún dato de cliente).
// ═══════════════════════════════════════════════════════════════════════════

const ROLES = ['superadmin', 'flota_admin', 'encargado', 'contador', 'nomina', 'vendedor', 'rol_futuro'] as const;
const PERFILES: ReadonlyArray<PerfilTenant | null> = [null, 'cinco_agentes'];
const APP = join(process.cwd(), 'src', 'app');

describe('el catálogo de entradas', () => {
  it('son 26, con clave única y al menos una pestaña', () => {
    expect(ENTRADAS_DASHBOARD).toHaveLength(26);
    expect(new Set(ENTRADAS_DASHBOARD.map((e) => e.clave)).size).toBe(26);
    for (const e of ENTRADAS_DASHBOARD) expect(e.pestanas.length, e.clave).toBeGreaterThan(0);
  });

  it('el reparto por grupo es el del plan: Inicio 2, Operación 4, Dinero y fiscal 4, Automatización 6, Cuenta 5, Pie 4, Contador 1', () => {
    const cuenta = (g: string) => ENTRADAS_DASHBOARD.filter((e) => e.grupo === g).length;
    expect(['inicio', 'operacion', 'dinero', 'automatizacion', 'cuenta', 'pie', 'contador'].map(cuenta)).toEqual([2, 4, 4, 6, 5, 4, 1]);
  });

  it('máximo 6 pestañas por entrada (criterio de diseño: la fila cabe y desplaza a 360 px)', () => {
    for (const e of ENTRADAS_DASHBOARD) expect(e.pestanas.length, e.clave).toBeLessThanOrEqual(6);
  });

  it('el href de la entrada es su primera pestaña y ninguna ruta aparece en dos entradas', () => {
    const vistos = new Map<string, string>();
    for (const e of ENTRADAS_DASHBOARD) {
      expect(e.href, e.clave).toBe(e.pestanas[0].href);
      for (const t of e.pestanas) {
        expect(vistos.get(t.href), `${t.href} repetida en ${e.clave} y ${vistos.get(t.href)}`).toBeUndefined();
        vistos.set(t.href, e.clave);
      }
    }
  });

  it('toda pestaña es una pantalla real (page.tsx) y está clasificada por área (si no, puedeVerRuta la niega a todos)', () => {
    const conocidas = new Set(rutasConocidas());
    for (const e of ENTRADAS_DASHBOARD) {
      for (const t of e.pestanas) {
        const archivo = join(APP, ...t.href.split('/').filter(Boolean), 'page.tsx');
        // eslint-disable-next-line security/detect-non-literal-fs-filename -- la ruta sale del catálogo de rutas del propio repo (sin entrada de usuario).
        expect(existsSync(archivo), `${t.href} → ${archivo}`).toBe(true);
        expect(conocidas.has(t.href), `${t.href} sin área en visibilidad.ts`).toBe(true);
      }
    }
  });

  it('los nombres de pestaña son cortos (≤ 24 caracteres: caben en la fila a 360 px)', () => {
    for (const e of ENTRADAS_DASHBOARD) for (const t of e.pestanas) expect(t.nombre.length, `${e.clave}/${t.nombre}`).toBeLessThanOrEqual(24);
  });
});

describe.each(ROLES)('rol %s', (rol) => {
  describe.each(PERFILES)('perfil %s', (perfil) => {
    const menu = menuPorPerfil(rol, perfil);
    const entradas = [...menu.resumen, ...menu.grupos.flatMap((g) => g.items), ...menu.pie];

    it('el href de cada entrada es una de sus pestañas visibles y esa pestaña la abre el rol (no rebota)', () => {
      for (const it2 of entradas) {
        const tabs = (it2.pestanas ?? []).map((p) => p.href);
        expect(tabs, it2.nombre).toContain(it2.href);
        expect(puedeVerRuta(rol, it2.href, perfil), `${rol}/${perfil} → ${it2.href}`).toBe(true);
      }
    });

    it('ninguna pestaña ofrecida rebota, y el href de entrada es la PRIMERA visible del catálogo', () => {
      for (const it2 of entradas) {
        for (const p of it2.pestanas ?? []) expect(puedeVerRuta(rol, p.href, perfil), `${rol}/${perfil} → ${p.href}`).toBe(true);
      }
      const hrefs = hrefsDelMenu(menu);
      for (const e of ENTRADAS_DASHBOARD) {
        const primera = e.pestanas.find((t) => (!t.soloConPerfil || perfil) && puedeVerRuta(rol, t.href, perfil));
        // «Contador» es el Resumen del rol que no ve /dashboard; si el rol sí ve /dashboard, esa entrada no se pinta.
        if (primera && hrefs.includes(primera.href)) expect(hrefs.filter((h) => h === primera.href)).toHaveLength(1);
      }
    });

    it('sin repetidos: ni entradas ni pestañas', () => {
      expect(new Set(hrefsDelMenu(menu)).size).toBe(hrefsDelMenu(menu).length);
      const todas = entradas.flatMap((i) => (i.pestanas ?? []).map((p) => p.href));
      expect(new Set(todas).size).toBe(todas.length);
    });

    it('el menú no esconde ninguna pantalla que el rol abre (salvo el panel del contador —el Resumen de otro rol—, la redirección y el asistente de otro perfil)', () => {
      const alcanzables = new Set(hrefsConPestanas(menu));
      // `puesta-en-marcha` (Pasos) es el asistente de las flotas CON perfil; sin perfil la flota usa el Checklist (arranque).
      const exentas = new Set(['/dashboard/integraciones', '/dashboard/contador', ...(perfil ? [] : ['/dashboard/puesta-en-marcha'])]);
      const escondidas = rutasConocidas().filter((h) => puedeVerRuta(rol, h, perfil) && !alcanzables.has(h) && !exentas.has(h));
      expect(escondidas, `${rol}/${perfil}`).toEqual([]);
    });

    it('⌘K ofrece lo que el menú alcanza y nada que el rol no abra', () => {
      const palette = paletaDelDashboard(rol, perfil);
      const enPaleta = new Set(palette.map((d) => d.href));
      for (const h of hrefsConPestanas(menu)) expect(enPaleta.has(h), `${rol}/${perfil} ⌘K sin ${h}`).toBe(true);
      for (const d of palette) expect(puedeVerRuta(rol, d.href, perfil), `${rol}/${perfil} ⌘K ofrece ${d.href}`).toBe(true);
      expect(new Set(palette.map((d) => d.href)).size).toBe(palette.length);
    });

    it('cada pestaña del menú marca activa a su entrada (la entrada se enciende en todas sus pestañas)', () => {
      for (const it2 of entradas) {
        for (const p of it2.pestanas ?? []) expect(hrefActivo(p.href, menu), `${rol}/${perfil} ${p.href}`).toBe(it2.href);
      }
    });
  });
});

describe('contenido por rol y perfil', () => {
  it('nómina: SOLO sus tres rutas, con o sin perfil (lista cerrada)', () => {
    for (const perfil of PERFILES) {
      expect(hrefsConPestanas(menuPorPerfil('nomina', perfil)).sort()).toEqual([...RUTAS_NOMINA].sort());
      expect(paletaDelDashboard('nomina', perfil).map((d) => d.href).sort()).toEqual([...RUTAS_NOMINA].sort());
    }
  });

  it('el vendedor y un rol desconocido no ven ninguna pantalla del dashboard (fail closed)', () => {
    for (const rol of ['vendedor', 'rol_futuro']) for (const perfil of PERFILES) {
      const menu = menuPorPerfil(rol, perfil);
      expect(hrefsDelMenu(menu)).toEqual([]);
      expect(paletaDelDashboard(rol, perfil)).toEqual([]);
    }
  });

  it('el jefe de tráfico no ve dinero ni administración: ni Sin viaje, ni Rentabilidad, ni Usuarios, ni Llaves, ni Facturación', () => {
    for (const perfil of PERFILES) {
      const h = new Set(hrefsConPestanas(menuPorPerfil('encargado', perfil)));
      for (const prohibida of ['/dashboard/huerfanos', '/dashboard/rentabilidad', '/dashboard/facturacion', '/dashboard/usuarios', '/dashboard/llaves-api',
        '/dashboard/sesiones-mcp', '/dashboard/conversaciones', '/dashboard/timbrado', '/dashboard/legal', '/dashboard/politicas', '/dashboard/configuracion']) {
        expect(h.has(prohibida), prohibida).toBe(false);
      }
    }
  });

  it('el contador no ve operación ni administración: Despacho, Operadores, Usuarios y Llaves están fuera; su entrada de Viajes empieza en «Sin viaje»', () => {
    const menu = menuPorPerfil('contador', null);
    const h = new Set(hrefsConPestanas(menu));
    for (const prohibida of ['/dashboard/despacho', '/dashboard/operadores', '/dashboard/usuarios', '/dashboard/llaves-api', '/dashboard/arco']) expect(h.has(prohibida), prohibida).toBe(false);
    const viajes = menu.grupos.flatMap((g) => g.items).find((i) => i.nombre === 'Viajes');
    expect(viajes?.href).toBe('/dashboard/huerfanos');
    expect(menu.resumen[0]).toMatchObject({ href: '/dashboard/contador', nombre: 'Resumen' });
  });

  it('el dueño: la entrada «Legal y privacidad» junta Términos, ARCO y Normas; el contador solo Normas', () => {
    const legal = (rol: string) => menuPorPerfil(rol, null).grupos.flatMap((g) => g.items).find((i) => i.nombre === 'Legal y privacidad');
    expect(legal('flota_admin')?.pestanas?.map((p) => p.nombre)).toEqual(['Términos y mandato', 'ARCO', 'Normas']);
    expect(legal('contador')?.pestanas?.map((p) => p.nombre)).toEqual(['Normas']);
    expect(legal('contador')?.href).toBe('/dashboard/conocimiento');
    // ARCO (plazo legal de 20 días hábiles) lo abre el jefe de tráfico, no solo el dueño: la entrada nace en ARCO.
    expect(legal('encargado')?.href).toBe('/dashboard/arco');
  });

  it('cinco_agentes recorta pestañas, no entradas enteras: Viajes pierde Sin viaje; Equipo pierde Jornada y Conversaciones', () => {
    const menu = menuPorPerfil('flota_admin', 'cinco_agentes');
    const items = menu.grupos.flatMap((g) => g.items);
    expect(items.find((i) => i.nombre === 'Viajes')?.pestanas?.map((p) => p.nombre)).toEqual(['Despacho', 'En vivo', 'Mapa', 'Registro']);
    expect(items.find((i) => i.nombre === 'Equipo')?.pestanas?.map((p) => p.nombre)).toEqual(['Operadores', 'Unidades', 'Patios', 'WhatsApp']);
    expect(items.map((i) => i.nombre)).not.toContain('Facturación');
    expect(items.map((i) => i.nombre)).not.toContain('Margen y costos');
  });
});

describe('grupos por propósito del rol (sin perfil)', () => {
  const grupo = (rol: string, nombre: string) => menuPorPerfil(rol, null).grupos.find((g) => g.items.some((i) => i.nombre === nombre))?.titulo;

  it('el jefe de tráfico ve Carta Porte en Operación y no existe para él un grupo «Dinero y fiscal» con una sola entrada', () => {
    expect(grupo('encargado', 'Carta Porte')).toBe('Operación');
    expect(menuPorPerfil('encargado', null).grupos.map((g) => g.titulo)).not.toContain('Dinero y fiscal');
  });

  it('el contador ve «Sin viaje» (entrada Viajes) y Clientes en «Dinero y fiscal», sin grupo «Operación»', () => {
    expect(grupo('contador', 'Viajes')).toBe('Dinero y fiscal');
    expect(grupo('contador', 'Clientes')).toBe('Dinero y fiscal');
    expect(menuPorPerfil('contador', null).grupos.map((g) => g.titulo)).not.toContain('Operación');
  });

  it('el dueño y el superadmin conservan el reparto del catálogo (Carta Porte en Dinero y fiscal, Viajes en Operación)', () => {
    for (const rol of ['flota_admin', 'superadmin']) {
      expect(grupo(rol, 'Carta Porte'), rol).toBe('Dinero y fiscal');
      expect(grupo(rol, 'Viajes'), rol).toBe('Operación');
    }
  });

  it('ninguna entrada se pinta en dos grupos ni desaparece por moverla (mismas entradas que antes de reubicar)', () => {
    for (const rol of ['encargado', 'contador']) {
      const nombres = menuPorPerfil(rol, null).grupos.flatMap((g) => g.items.map((i) => i.nombre));
      expect(new Set(nombres).size, rol).toBe(nombres.length);
    }
  });
});

describe('⌘K', () => {
  it('cada pestaña aparece como «Entrada · Pestaña»; una entrada de una sola pantalla, con su nombre', () => {
    const p = paletaDelDashboard('flota_admin', null);
    const por = new Map(p.map((d) => [d.href, d.etiqueta]));
    expect(por.get('/dashboard/viajes')).toBe('Viajes · Registro');
    expect(por.get('/dashboard/huerfanos')).toBe('Viajes · Sin viaje');
    expect(por.get('/dashboard/facturacion')).toBe('Facturación');
    expect(por.get('/dashboard/arco')).toBe('Legal y privacidad · ARCO');
  });

  it('encuentra por alias y sin acentos, y pone primero lo que empieza con la consulta', () => {
    const p = paletaDelDashboard('flota_admin', null);
    expect(filtrarPaleta(p, 'grua').map((d) => d.href)).toContain('/dashboard/asistencia');
    expect(filtrarPaleta(p, 'ARCO')[0].href).toBe('/dashboard/arco');
    expect(filtrarPaleta(p, 'huerfanos').map((d) => d.href)).toContain('/dashboard/huerfanos');
    expect(filtrarPaleta(p, 'zzzz-no-existe')).toEqual([]);
    expect(filtrarPaleta(p, '  ')).toHaveLength(p.length);
  });

  it('no ofrece al jefe de tráfico lo que no abre aunque la consulta lo nombre (facturación, usuarios)', () => {
    const p = paletaDelDashboard('encargado', null);
    expect(filtrarPaleta(p, 'factur').map((d) => d.href)).not.toContain('/dashboard/facturacion');
    expect(filtrarPaleta(p, 'usuarios').map((d) => d.href)).not.toContain('/dashboard/usuarios');
  });

  it('bajo cinco_agentes tampoco ofrece el stand-by (rentabilidad, descarga del SAT) y SÍ ofrece «Pregunta a tus datos»', () => {
    const h = new Set(paletaDelDashboard('flota_admin', 'cinco_agentes').map((d) => d.href));
    for (const sb of ['/dashboard/rentabilidad', '/dashboard/descarga-sat', '/dashboard/facturacion']) expect(h.has(sb), sb).toBe(false);
    expect(h.has('/dashboard/chat')).toBe(true);
  });
});
