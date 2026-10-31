import { describe, it, expect } from 'vitest';
import {
  inicioDe, puedeVerRuta, MODULOS_PROXIMAMENTE_PERFIL, RUTAS_PERFIL_CINCO_AGENTES, RUTAS_STAND_BY_PERFIL_CINCO_AGENTES, rutaProximamente, moduloProximamenteDeRuta,
} from '@/lib/auth/visibilidad';
import { OPERACION, DINERO_FISCAL, AUTOMATIZACIONES, SISTEMA, ABAJO, TODAS_LAS_RUTAS } from '../rutas';
import { menuPorPerfil, hrefsDelMenu, hrefActivo } from './menu-por-perfil';

// Contrato del menú v2: mismas rutas y nombres que hoy, todo enlace abre, nada de stand-by, sin duplicados.
// Datos: solo roles y rutas del producto (ningún dato de cliente).

const ROLES = ['flota_admin', 'encargado', 'contador', 'superadmin'] as const;
const nombrePorHref = new Map(TODAS_LAS_RUTAS.map((i) => [i.href, i.nombre]));

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

  it('los nombres son los de siempre (nada se renombra durante la validación)', () => {
    const todos = [...menu.resumen, ...menu.grupos.flatMap((g) => g.items), ...menu.pie];
    for (const i of todos) expect(i.nombre, i.href).toBe(nombrePorHref.get(i.href));
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
    // AGENTES es el único grupo estático (sin acordeón); «Puesta en marcha» abre «Cuenta y conexiones».
    const g = menuPorPerfil('flota_admin', 'cinco_agentes').grupos;
    expect(g.filter((x) => x.estatico).map((x) => x.titulo)).toEqual(['Agentes']);
    expect(g.find((x) => x.id === 'cuenta')?.items[0]?.href).toBe('/dashboard/puesta-en-marcha');
  });
});

describe('sin perfil: el menú genérico de siempre', () => {
  it('el dueño ve exactamente lo que el menú v1 ofrece (más el Resumen y el chat)', () => {
    const menu = menuPorPerfil('flota_admin', null);
    const esperado = new Set([
      '/dashboard', '/dashboard/chat',
      ...[...OPERACION, ...DINERO_FISCAL, ...AUTOMATIZACIONES, ...SISTEMA, ...ABAJO]
        .filter((i) => puedeVerRuta('flota_admin', i.href, null)).map((i) => i.href),
    ]);
    expect(new Set(hrefsDelMenu(menu))).toEqual(esperado);
    expect(menu.grupos.map((g) => g.titulo)).toEqual(['Operación', 'Dinero y fiscal', 'Automatizaciones', 'Sistema']);
  });
});

describe('hrefActivo', () => {
  const menu = menuPorPerfil('flota_admin', 'cinco_agentes');
  it('gana el href más largo', () => {
    expect(hrefActivo('/dashboard/carta-porte/documentos/abc', menu)).toBe('/dashboard/carta-porte/documentos');
    expect(hrefActivo('/dashboard/carta-porte', menu)).toBe('/dashboard/carta-porte');
    expect(hrefActivo('/dashboard/agentes/peajes/configuracion', menu)).toBe('/dashboard/agentes/peajes');
  });
  it('/dashboard solo es activo en la raíz exacta', () => {
    expect(hrefActivo('/dashboard', menu)).toBe('/dashboard');
    expect(hrefActivo('/dashboard/lo-que-sea', menu)).toBeNull();
  });
});
