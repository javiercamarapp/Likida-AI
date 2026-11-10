import { describe, it, expect } from 'vitest';
import {
  inicioDe, puedeVerRuta, MODULOS_PROXIMAMENTE_PERFIL, RUTAS_PERFIL_CINCO_AGENTES, RUTAS_STAND_BY_PERFIL_CINCO_AGENTES, rutaProximamente, moduloProximamenteDeRuta,
} from '@/lib/auth/visibilidad';
import { OPERACION, DINERO_FISCAL, AUTOMATIZACIONES, SISTEMA, ABAJO, ENTRADAS_DASHBOARD } from '../rutas';
import { menuPorPerfil, hrefsDelMenu, hrefsConPestanas, hrefActivo } from './menu-por-perfil';

// Contrato del menú v2: mismas rutas y nombres que hoy, todo enlace abre, nada de stand-by, sin duplicados.
// Datos: solo roles y rutas del producto (ningún dato de cliente).

const ROLES = ['flota_admin', 'encargado', 'contador', 'superadmin'] as const;
// Cada ruta de pestaña responde por el nombre de SU ENTRADA (la entrada se llama como el menú).
const nombrePorHref = new Map(ENTRADAS_DASHBOARD.flatMap((e) => e.pestanas.map((p) => [p.href, e.nombre] as const)));

describe.each(ROLES)('menú v2 de %s bajo cinco_agentes', (rol) => {
  const menu = menuPorPerfil(rol, 'cinco_agentes');
  const hrefs = hrefsDelMenu(menu);

  it('trae enlaces y ninguno repetido', () => {
    expect(hrefs.length).toBeGreaterThan(3);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it('todo href cae en la lista cerrada del perfil (o es el Resumen del contador)', () => {
    const cerrada = new Set(Object.keys(RUTAS_PERFIL_CINCO_AGENTES));
    for (const h of hrefs) {
      expect(cerrada.has(h) || h === '/dashboard/contador', `${rol} → ${h}`).toBe(true);
    }
  });

  it('ningún href es de stand-by (PROHIBIDAS) y el rol puede ver cada destino', () => {
    for (const h of hrefs) {
      expect(RUTAS_STAND_BY_PERFIL_CINCO_AGENTES, `${rol} → ${h}`).not.toContain(h);
      expect(puedeVerRuta(rol, h, 'cinco_agentes'), `${rol} → ${h}`).toBe(true);
    }
  });

  it('cada entrada se llama como su definición en rutas.ts (el contador ve su panel como «Resumen»)', () => {
    const todos = [...menu.resumen, ...menu.grupos.flatMap((g) => g.items), ...menu.pie];
    for (const i of todos) {
      const esperado = i.href === '/dashboard/contador' ? 'Resumen' : nombrePorHref.get(i.href);
      expect(i.nombre, i.href).toBe(esperado);
    }
  });

  it('toda pestaña ofrecida cae en la lista cerrada del perfil y el rol la abre (ninguna rebota)', () => {
    const cerrada = new Set(Object.keys(RUTAS_PERFIL_CINCO_AGENTES));
    for (const h of hrefsConPestanas(menu)) {
      expect(cerrada.has(h) || h === '/dashboard/contador', `${rol} → ${h}`).toBe(true);
      expect(puedeVerRuta(rol, h, 'cinco_agentes'), `${rol} → ${h}`).toBe(true);
    }
  });

  it('el Resumen es uno solo, o ninguno (el contador bajo el perfil no tiene Resumen: aterriza en su agente)', () => {
    expect(menu.resumen.filter((i) => i.nombre === 'Resumen').length).toBeLessThanOrEqual(1);
  });
});

describe('contenido por rol', () => {
  it('el contador aterriza en Liquidación (inicioDe) y ese enlace está en su menú; sin Resumen ni stand-by', () => {
    const menu = menuPorPerfil('contador', 'cinco_agentes');
    const h = hrefsDelMenu(menu);
    expect(inicioDe('contador', 'cinco_agentes')).toBe('/dashboard/agentes/liquidacion');
    expect(h).toContain('/dashboard/agentes/liquidacion');
    expect(menu.resumen).toHaveLength(0);
    expect(h).not.toContain('/dashboard');
    expect(h).not.toContain('/dashboard/contador');
  });

  it('el dueño ve Puesta en marcha, Conexiones, Usuarios y los cinco agentes; el encargado no ve lo de administración', () => {
    const dueno = hrefsDelMenu(menuPorPerfil('flota_admin', 'cinco_agentes'));
    for (const h of ['/dashboard/puesta-en-marcha', '/dashboard/conexiones', '/dashboard/usuarios', '/dashboard/agentes/liquidacion',
      '/dashboard/agentes/peajes', '/dashboard/agentes/carta-porte', '/dashboard/agentes/vigia', '/dashboard/agentes/conductores']) {
      expect(dueno, h).toContain(h);
    }
    const encargado = hrefsDelMenu(menuPorPerfil('encargado', 'cinco_agentes'));
    expect(encargado).not.toContain('/dashboard/puesta-en-marcha');
    expect(encargado).not.toContain('/dashboard/usuarios');
  });

  it('A4 y A5 están en el menú (hoy el perfil los tiene encendidos: MODULOS_PROXIMAMENTE_PERFIL vacío) y, si vuelven a «Próximamente», su enlace va al anuncio', () => {
    const h = hrefsDelMenu(menuPorPerfil('flota_admin', 'cinco_agentes'));
    expect(h).toContain('/dashboard/agentes/vigia');
    expect(h).toContain('/dashboard/agentes/conductores');
    for (const href of h) {
      const m = moduloProximamenteDeRuta('cinco_agentes', href);
      if (m) expect(rutaProximamente(m)).toMatch(/^\/dashboard\/proximamente\//);
    }
    expect(MODULOS_PROXIMAMENTE_PERFIL).toBeDefined();
  });

  it('el orden de los grupos es el del plan', () => {
    const t = menuPorPerfil('flota_admin', 'cinco_agentes').grupos.map((g) => g.titulo);
    expect(t).toEqual(['Agentes', 'Operación', 'Cuenta y conexiones']);
    expect(menuPorPerfil('flota_admin', 'cinco_agentes').grupos[0].items.map((i) => i.nombre)).toEqual([
      'Liquidación automática', 'Conciliación de peajes', 'Carta Porte automática', 'Servicio al cliente', 'Comunicación con operadores',
    ]);
    // AGENTES es el único grupo estático (sin acordeón); «Puesta en marcha» abre «Cuenta y conexiones».
    const g = menuPorPerfil('flota_admin', 'cinco_agentes').grupos;
    expect(g.filter((x) => x.estatico).map((x) => x.titulo)).toEqual(['Agentes']);
    expect(g.find((x) => x.id === 'cuenta')?.items[0]?.href).toBe('/dashboard/puesta-en-marcha');
  });
});

describe('sin perfil: el menú de entradas con pestañas', () => {
  it('el dueño alcanza TODA pantalla que el menú v1 le ofrecía (como entrada o como pestaña): no se pierde ninguna', () => {
    const menu = menuPorPerfil('flota_admin', null);
    const alcanzables = new Set(hrefsConPestanas(menu));
    const antes = [...OPERACION, ...DINERO_FISCAL, ...AUTOMATIZACIONES, ...SISTEMA, ...ABAJO]
      .filter((i) => puedeVerRuta('flota_admin', i.href, null)).map((i) => i.href);
    // «Integraciones» ya no es pantalla: es redirección permanente a Conexiones (no está en los listados de v1 desde agosto).
    for (const h of [...antes, '/dashboard', '/dashboard/chat']) expect(alcanzables.has(h), h).toBe(true);
    expect(menu.grupos.map((g) => g.titulo)).toEqual(['Operación', 'Dinero y fiscal', 'Automatización', 'Cuenta']);
    expect(menu.pie.map((i) => i.nombre)).toEqual(['Notificaciones', 'Mi perfil', 'Centro de ayuda', 'Plan y facturación']);
  });

  it('el dueño cuenta 25 entradas visibles (las 26 del catálogo menos «Contador», que es su Resumen solo para quien no ve /dashboard)', () => {
    const menu = menuPorPerfil('flota_admin', null);
    expect(hrefsDelMenu(menu)).toHaveLength(25);
    expect(ENTRADAS_DASHBOARD).toHaveLength(26);
  });
});

describe('hrefActivo', () => {
  const menu = menuPorPerfil('flota_admin', 'cinco_agentes');
  it('gana el prefijo más largo, y devuelve el href de la ENTRADA que lo contiene', () => {
    // «Documentos» es pestaña de Carta Porte (entrada con href /dashboard/carta-porte), no de Carta Porte automática.
    expect(hrefActivo('/dashboard/carta-porte/documentos/abc', menu)).toBe('/dashboard/carta-porte');
    expect(hrefActivo('/dashboard/carta-porte', menu)).toBe('/dashboard/carta-porte');
    expect(hrefActivo('/dashboard/agentes/carta-porte/catalogo', menu)).toBe('/dashboard/agentes/carta-porte');
    expect(hrefActivo('/dashboard/agentes/peajes/configuracion', menu)).toBe('/dashboard/agentes/peajes');
    // Una pestaña activa a su entrada aunque la entrada apunte a otra pantalla (Registro → Viajes, cuyo href es Despacho).
    expect(hrefActivo('/dashboard/viajes', menu)).toBe('/dashboard/despacho');
    expect(hrefActivo('/dashboard/llaves-api', menu)).toBe('/dashboard/conexiones');
  });
  it('/dashboard solo es activo en la raíz exacta', () => {
    expect(hrefActivo('/dashboard', menu)).toBe('/dashboard');
    expect(hrefActivo('/dashboard/lo-que-sea', menu)).toBeNull();
  });
});
