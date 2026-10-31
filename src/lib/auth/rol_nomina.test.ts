/* eslint-disable security/detect-non-literal-fs-filename -- pruebas que leen el árbol de FUENTE del propio repo; ninguna ruta viene de entrada de usuario. */
import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  puedeVerRuta, inicioDe, areasDe, puedeVerArea, rutasConocidas, areaDeRuta, rutaPermitidaEnPerfil, apiPermitidaEnPerfil,
  RUTAS_NOMINA, RUTAS_PERFIL_CINCO_AGENTES, INICIO_NOMINA, rolEfectivo, puertaDeEntrada, type Area,
} from './visibilidad';
import { puedeAdministrar, puedeAsignar, puedeExportar, puedeTimbrar } from './permisos';
import { menuPorPerfil, hrefsDelMenu } from '@/app/dashboard/shell/menu-por-perfil';
import { ROTULOS_ROL, nombreDeRol, esRolNomina } from './roles';
import { ROL_LABEL, ROL_BADGE } from './provisionar';
import { ROLES_INVITABLES, rolesInvitablesPara, validarInvitacion } from './invitar';

// ═══════════════════════════════════════════════════════════════════════════
// EL ROL `nomina` (0949) — MATRIZ ROL × RUTA, sin base de datos.
//
// Tres garantías:
//   1. DENY-BY-DEFAULT: de TODAS las rutas del inventario (el árbol real de /dashboard, /admin, /vendedor, /chofer, la raíz, el
//      login y cada route.ts de /api, más las del mapa de áreas y del perfil), `nomina` solo pasa a la lista cerrada de cuatro.
//   2. NADA CAMBIA PARA LOS DEMÁS: para superadmin, flota_admin, encargado, contador, vendedor y un rol desconocido, `puedeVerRuta`
//      da EXACTAMENTE lo mismo que la función de antes de esta rama (se reimplementa abajo, tal cual, como referencia).
//   3. El menú, el aterrizaje y las puertas auxiliares (permisos, áreas, invitación) siguen la misma lista.
// ═══════════════════════════════════════════════════════════════════════════

const PERMITIDAS_NOMINA = [
  '/dashboard/agentes/liquidacion', '/dashboard/notificaciones', '/dashboard/mi-perfil', '/dashboard/soporte',
] as const;
const UUID = '0b6f2c1e-7d3a-4c8e-9f10-123456789abc';

/** El árbol real de páginas bajo `raiz`, como rutas (los segmentos `[x]` se dejan literales y además se instancian). */
function paginas(raiz: string, prefijo: string, archivo: 'page.tsx' | 'route.ts'): string[] {
  const fuera: string[] = [];
  const recorre = (dir: string, ruta: string) => {
    for (const nombre of readdirSync(dir)) {
      const p = join(dir, nombre);
      if (statSync(p).isDirectory()) recorre(p, `${ruta}/${nombre}`);
      else if (nombre === archivo) fuera.push(ruta || '/');
    }
  };
  if (existsSync(raiz)) recorre(raiz, prefijo);
  return fuera;
}
const instanciar = (r: string) => r.replace(/\[[^\]]+\]/g, UUID);

const RUTAS_DASHBOARD = paginas(join(process.cwd(), 'src/app/dashboard'), '/dashboard', 'page.tsx');
const RUTAS_ADMIN = paginas(join(process.cwd(), 'src/app/admin'), '/admin', 'page.tsx');
const RUTAS_API = paginas(join(process.cwd(), 'src/app/api'), '/api', 'route.ts');
const OTRAS = ['/', '/login', '/vendedor', '/chofer', '/mis-viajes', '/cuenta', '/sin-acceso', '/mcp/autorizar', '/auth/callback', '/demo', '/estado'];

const UNIVERSO: string[] = [
  ...new Set([
    ...RUTAS_DASHBOARD, ...RUTAS_DASHBOARD.map(instanciar), ...RUTAS_ADMIN, ...RUTAS_ADMIN.map(instanciar), ...RUTAS_API,
    ...RUTAS_API.map(instanciar), ...OTRAS, ...rutasConocidas(), ...Object.keys(RUTAS_PERFIL_CINCO_AGENTES),
    // Intentos de colarse por la forma de la URL.
    '/dashboard/agentes/liquidacion/formato', '/dashboard/agentes/liquidacion/configuracion', '/dashboard/agentes/liquidacionx',
    '/dashboard/agentes/liquidacion/../peajes', '/dashboard/agentes/liquidacion%2Fformato', '/Dashboard/agentes/liquidacion',
    '/dashboard/agentes', '/dashboard/agentes/', '/dashboard//agentes/liquidacion', `/dashboard/${UUID}`, '/dashboard/[id]',
    '/dashboard/proximamente/vigia', '/dashboard/carta-porte/borrador/' + UUID, '/dashboard/timbrado/' + UUID,
  ]),
];

describe('inventario de la matriz', () => {
  it('el inventario es real (si el árbol cambia de sitio, esta prueba no puede quedar vacía)', () => {
    expect(RUTAS_DASHBOARD.length).toBeGreaterThan(40);
    expect(RUTAS_ADMIN.length).toBeGreaterThan(30);
    expect(RUTAS_API.length).toBeGreaterThan(80);
    for (const r of PERMITIDAS_NOMINA) expect(UNIVERSO).toContain(r);
  });

  it('la lista cerrada del código es exactamente la acordada (cuatro rutas)', () => {
    expect([...RUTAS_NOMINA].sort()).toEqual([...PERMITIDAS_NOMINA].sort());
    expect(INICIO_NOMINA).toBe('/dashboard/agentes/liquidacion');
  });

  it('cada ruta permitida existe como página y está en la lista cerrada del perfil cinco_agentes', () => {
    for (const r of PERMITIDAS_NOMINA) {
      expect(RUTAS_DASHBOARD, r).toContain(r);
      expect(rutaPermitidaEnPerfil('cinco_agentes', r), r).toBe(true);
    }
  });
});

describe('nomina — deny-by-default sobre TODO el inventario', () => {
  for (const perfil of ['cinco_agentes', null, undefined] as const) {
    it(`con perfil=${String(perfil)}: solo pasa a las cuatro rutas permitidas, a ninguna otra`, () => {
      const pasa = UNIVERSO.filter((r) => puedeVerRuta('nomina', r, perfil));
      expect(pasa.sort()).toEqual([...PERMITIDAS_NOMINA].sort());
    });
  }

  it('lo permitido sigue pasando con query, ancla y barra final; lo prohibido sigue prohibido con ellas', () => {
    for (const r of PERMITIDAS_NOMINA) {
      expect(puedeVerRuta('nomina', `${r}?des_estado=retenido`, 'cinco_agentes')).toBe(true);
      expect(puedeVerRuta('nomina', `${r}/`, 'cinco_agentes')).toBe(true);
      expect(puedeVerRuta('nomina', `${r}#x`, 'cinco_agentes')).toBe(true);
    }
    for (const r of ['/dashboard/agentes/liquidacion/formato', '/dashboard/agentes/liquidacion/configuracion', '/dashboard/agentes/peajes', '/dashboard/agentes/carta-porte', '/dashboard/agentes/vigia', '/dashboard/agentes/conductores', '/dashboard', '/dashboard/viajes', '/dashboard/usuarios', '/dashboard/conexiones', '/dashboard/llaves-api']) {
      expect(puedeVerRuta('nomina', `${r}?x=1`, 'cinco_agentes'), r).toBe(false);
      expect(puedeVerRuta('nomina', `${r}/`, null), r).toBe(false);
    }
  });

  it('el detalle de una liquidación (/dashboard/<uuid>, trae el neto) NO se abre', () => {
    expect(puedeVerRuta('nomina', `/dashboard/${UUID}`, 'cinco_agentes')).toBe(false);
    expect(puedeVerRuta('nomina', '/dashboard/[id]', 'cinco_agentes')).toBe(false);
  });

  it('no tiene áreas: ninguna ruta clasificada por área le abre (ni operación, ni dinero, ni administración)', () => {
    expect(areasDe('nomina')).toEqual([]);
    for (const a of ['operacion', 'dinero', 'administracion'] as Area[]) expect(puedeVerArea('nomina', a)).toBe(false);
    const porArea = rutasConocidas().filter((r) => areaDeRuta(r) !== undefined && puedeVerRuta('nomina', r));
    expect(porArea.sort()).toEqual([...PERMITIDAS_NOMINA].sort());
  });

  it('una pantalla NUEVA, clasificada mañana en cualquier área, sigue prohibida: la lista no se amplía sola', () => {
    // Por construcción: `puedeVerRuta` consulta solo `RUTAS_NOMINA` para este rol, nunca `AREA_POR_RUTA`.
    expect(puedeVerRuta('nomina', '/dashboard/pantalla-nueva-de-nomina-2027', 'cinco_agentes')).toBe(false);
    expect(puedeVerRuta('nomina', '/dashboard/pantalla-nueva-de-nomina-2027')).toBe(false);
  });

  it('ni /admin, ni /vendedor, ni /chofer, ni ninguna API de /api están en su lista', () => {
    for (const r of [...RUTAS_ADMIN, ...RUTAS_API, '/vendedor', '/chofer', '/mis-viajes']) {
      expect(puedeVerRuta('nomina', r, 'cinco_agentes'), r).toBe(false);
    }
  });

  it('un superadmin NO puede previsualizar `nomina` (?rol=nomina se ignora): previsualizar solo QUITA y nomina no está en la lista', () => {
    expect(rolEfectivo('superadmin', 'nomina')).toBe('superadmin');
    expect(rolEfectivo('flota_admin', 'nomina')).toBe('flota_admin');
  });

  it('las APIs que el perfil deja vivas no se vuelven una vía para nomina: puedeVerRuta no las conoce y resolverTenantApi las niega por rol (ver tenant-api.test.ts)', () => {
    expect(apiPermitidaEnPerfil('cinco_agentes', '/api/v1/liquidaciones')).toBe(true); // el perfil las deja vivas a OTROS roles
    expect(puedeVerRuta('nomina', '/api/v1/liquidaciones', 'cinco_agentes')).toBe(false);
  });
});

// ── Referencia: la función de ANTES (copiada tal cual de master) ───────────────────────────────────────────────────────────────
const RUTAS_TODO_ROL = new Set(['/dashboard/notificaciones', '/dashboard/mi-perfil', '/dashboard/soporte']);
function puedeVerRutaDeAntes(rol: string, href: string, perfil?: 'cinco_agentes' | null): boolean {
  if (perfil && !rutaPermitidaEnPerfil(perfil, href)) return false;
  if (RUTAS_TODO_ROL.has(href)) return areasDe(rol).length > 0;
  const area = areaDeRuta(href);
  return area !== undefined && puedeVerArea(rol, area);
}

describe('los demás roles NO cambian de comportamiento', () => {
  const ROLES = ['superadmin', 'flota_admin', 'encargado', 'contador', 'vendedor', 'operador', 'sin_rol', 'basura', ''] as const;
  for (const rol of ROLES) {
    for (const perfil of ['cinco_agentes', null, undefined] as const) {
      it(`${rol || '(vacío)'} · perfil=${String(perfil)}: puedeVerRuta == la función de antes, en las ${UNIVERSO.length} rutas`, () => {
        const distintas = UNIVERSO.filter((r) => puedeVerRuta(rol, r, perfil) !== puedeVerRutaDeAntes(rol, r, perfil));
        expect(distintas).toEqual([]);
      });
    }
  }

  it('inicioDe de los roles de siempre es el de siempre', () => {
    expect(inicioDe('flota_admin')).toBe('/dashboard');
    expect(inicioDe('encargado')).toBe('/dashboard');
    expect(inicioDe('superadmin')).toBe('/dashboard');
    expect(inicioDe('contador')).toBe('/dashboard/contador');
    expect(inicioDe('contador', 'cinco_agentes')).toBe('/dashboard/agentes/liquidacion');
    expect(inicioDe('vendedor')).toBe('/vendedor');
    expect(inicioDe('basura')).toBe('/sin-acceso');
    expect(inicioDe('flota_admin', 'cinco_agentes')).toBe('/dashboard');
  });

  it('puertaDeEntrada no cambia: todo rol de oficina entra por /dashboard, y de ahí se reparte', () => {
    expect(puertaDeEntrada('nomina')).toBe('/dashboard');
    expect(puertaDeEntrada('superadmin')).toBe('/admin');
    expect(puertaDeEntrada('encargado')).toBe('/dashboard');
  });

  it('el dominio de áreas de los demás roles no cambió', () => {
    expect(areasDe('flota_admin')).toEqual(['operacion', 'dinero', 'administracion']);
    expect(areasDe('superadmin')).toEqual(['operacion', 'dinero', 'administracion']);
    expect(areasDe('encargado')).toEqual(['operacion']);
    expect(areasDe('contador')).toEqual(['dinero']);
    expect(areasDe('vendedor')).toEqual([]);
  });
});

describe('aterrizaje y menú de nomina', () => {
  it('inicioDe(nomina) es la vista de conteos, con o sin perfil, y esa ruta SÍ es suya (sin bucle de redirects)', () => {
    expect(inicioDe('nomina')).toBe(INICIO_NOMINA);
    expect(inicioDe('nomina', 'cinco_agentes')).toBe(INICIO_NOMINA);
    expect(puedeVerRuta('nomina', inicioDe('nomina', 'cinco_agentes'), 'cinco_agentes')).toBe(true);
    expect(puedeVerRuta('nomina', inicioDe('nomina'))).toBe(true);
  });

  it('el menú con perfil muestra SOLO Liquidaciones (y lo de la persona): ni Resumen, ni chat, ni otros agentes, ni Cuenta', () => {
    const menu = menuPorPerfil('nomina', 'cinco_agentes');
    expect(menu.resumen).toEqual([]);
    expect(menu.grupos.map((g) => g.id)).toEqual(['agentes']);
    expect(menu.grupos[0].items.map((i) => i.href)).toEqual(['/dashboard/agentes/liquidacion']);
    expect(menu.pie.map((i) => i.href).sort()).toEqual(['/dashboard/mi-perfil', '/dashboard/notificaciones', '/dashboard/soporte']);
    const todos = hrefsDelMenu(menu);
    expect(todos.every((h) => (PERMITIDAS_NOMINA as readonly string[]).includes(h))).toBe(true);
  });

  it('sin perfil el menú genérico no le ofrece ninguna pantalla de negocio', () => {
    const todos = hrefsDelMenu(menuPorPerfil('nomina', null));
    expect(todos.every((h) => (PERMITIDAS_NOMINA as readonly string[]).includes(h))).toBe(true);
    expect(todos).not.toContain('/dashboard');
  });

  it('el menú de los demás roles con perfil sigue ofreciendo lo de siempre', () => {
    const dueno = hrefsDelMenu(menuPorPerfil('flota_admin', 'cinco_agentes'));
    expect(dueno).toContain('/dashboard');
    expect(dueno).toContain('/dashboard/agentes/liquidacion');
    expect(dueno).toContain('/dashboard/agentes/peajes');
    expect(dueno).toContain('/dashboard/usuarios');
    const conta = hrefsDelMenu(menuPorPerfil('contador', 'cinco_agentes'));
    expect(conta).toContain('/dashboard/agentes/liquidacion');
    expect(conta).not.toContain('/dashboard/usuarios');
  });
});

describe('puertas auxiliares', () => {
  it('permisos: nomina no exporta, no asigna, no administra, no timbra', () => {
    expect(puedeExportar('nomina')).toBe(false);
    expect(puedeAsignar('nomina')).toBe(false);
    expect(puedeAdministrar('nomina')).toBe(false);
    expect(puedeTimbrar('nomina')).toBe(false);
  });

  it('rótulos: tiene nombre propio y no cae al rol crudo (rol_label_unico)', () => {
    expect(ROTULOS_ROL.nomina.nombre).toBe('Nómina y RH');
    expect(nombreDeRol('nomina')).toBe('Nómina y RH');
    expect(ROL_LABEL.nomina).toBeTruthy();
    expect(ROL_BADGE.nomina).toBeTruthy();
    expect(esRolNomina('nomina')).toBe(true);
    for (const r of ['flota_admin', 'contador', 'encargado', 'superadmin', 'vendedor', '', null, undefined]) expect(esRolNomina(r)).toBe(false);
  });

  it('el detalle del rótulo promete solo conteos y no promete lo que no tiene', () => {
    const d = ROTULOS_ROL.nomina.detalle.toLowerCase();
    expect(d).toContain('conteos');
    expect(d).not.toContain('exporta');
  });
});

describe('invitación: nomina solo con perfil cinco_agentes y solo por el dueño', () => {
  const dato = { email: 'rh@flota.test', nombre: 'RH', telefono: '' };

  it('la lista de siempre NO incluye nomina (es también la lista de roles asignables)', () => {
    expect(ROLES_INVITABLES.map((r) => r.valor)).toEqual(['contador', 'encargado', 'flota_admin']);
    expect(rolesInvitablesPara().map((r) => r.valor)).toEqual(['contador', 'encargado', 'flota_admin']);
  });

  it('el dueño de una flota con perfil puede invitar nomina', () => {
    const ctx = { rolInvitador: 'flota_admin', perfil: 'cinco_agentes' };
    expect(rolesInvitablesPara(ctx).map((r) => r.valor)).toContain('nomina');
    expect(validarInvitacion({ ...dato, rol: 'nomina' }, ctx).rol).toBe('nomina');
  });

  it('sin perfil, o invitando un superadmin / contador / encargado / rol desconocido: nomina se rechaza en el servidor', () => {
    const casos = [
      { rolInvitador: 'flota_admin', perfil: null }, { rolInvitador: 'flota_admin', perfil: undefined },
      { rolInvitador: 'flota_admin', perfil: 'otro_perfil' }, { rolInvitador: 'superadmin', perfil: 'cinco_agentes' },
      { rolInvitador: 'contador', perfil: 'cinco_agentes' }, { rolInvitador: 'encargado', perfil: 'cinco_agentes' },
      { rolInvitador: 'nomina', perfil: 'cinco_agentes' }, { rolInvitador: '', perfil: 'cinco_agentes' },
    ];
    for (const ctx of casos) {
      expect(rolesInvitablesPara(ctx).map((r) => r.valor), JSON.stringify(ctx)).not.toContain('nomina');
      expect(() => validarInvitacion({ ...dato, rol: 'nomina' }, ctx), JSON.stringify(ctx)).toThrow();
    }
    // y sin contexto (las llamadas de antes)
    expect(() => validarInvitacion({ ...dato, rol: 'nomina' })).toThrow();
  });

  it('los demás roles se siguen invitando igual con o sin contexto, y superadmin sigue sin poder invitarse', () => {
    const ctx = { rolInvitador: 'flota_admin', perfil: 'cinco_agentes' };
    for (const rol of ['contador', 'encargado', 'flota_admin']) {
      expect(validarInvitacion({ ...dato, rol }).rol).toBe(rol);
      expect(validarInvitacion({ ...dato, rol }, ctx).rol).toBe(rol);
    }
    expect(() => validarInvitacion({ ...dato, rol: 'superadmin' }, ctx)).toThrow();
    expect(() => validarInvitacion({ ...dato, rol: 'vendedor' }, ctx)).toThrow();
  });
});

describe('el código de la página del agente de Liquidaciones', () => {
  const fuente = readFileSync(join(process.cwd(), 'src/app/dashboard/agentes/liquidacion/page.tsx'), 'utf8');

  it('NINGUNA acción de servidor se gatea solo con puedeVerRuta: todas pasan por puedeOperarLiquidacion (nomina nunca opera por POST directo)', () => {
    expect(fuente).not.toMatch(/puedeVerRuta\(s\.rol, '\/dashboard\/agentes\/liquidacion'\)/);
    const acciones = fuente.split("'use server'").length - 1;
    const gateadas = fuente.split('puedeOperarLiquidacion(s.rol)').length - 1;
    expect(acciones).toBeGreaterThanOrEqual(9);
    expect(gateadas).toBeGreaterThanOrEqual(acciones);
  });

  it('la rama de nomina corta ANTES de leer el flash, el canal, los desgloses, los KPIs o la cola', () => {
    const iNomina = fuente.indexOf('if (esRolNomina(rol)) return <PaginaConteosNomina');
    expect(iNomina).toBeGreaterThan(0);
    for (const lectura of ['leerFlash(', 'canalDeLaFlota(tenantId)', 'getKpis(tenantId)', 'colaRevision(', 'cargarDesgloses(tenantId']) {
      const i = fuente.indexOf(lectura, fuente.indexOf('export default async function'));
      expect(i, lectura).toBeGreaterThan(iNomina);
    }
  });
});
