/* eslint-disable security/detect-non-literal-fs-filename -- pruebas que leen el árbol de FUENTE del propio repo; ninguna ruta ni patrón viene de entrada de usuario. */
import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  RUTAS_PERFIL_CINCO_AGENTES, RUTAS_STAND_BY_PERFIL_CINCO_AGENTES, API_PERFIL_CINCO_AGENTES,
  rutasConocidas, rutaPermitidaEnPerfil, claveRutaPerfil, puedeVerRuta, apiPermitidaEnPerfil, areaDeRuta,
} from './visibilidad';

// ═══════════════════════════════════════════════════════════════════════════
// EL PERFIL `cinco_agentes` — LA LISTA CERRADA, SIN BASE DE DATOS.
//
// Estas pruebas no mockean nada: leen el mapa real de rutas y el árbol real de
// páginas. Si alguien agrega una pantalla y no la clasifica, aquí se pone rojo
// (y en runtime esa pantalla ya se niega bajo el perfil: falla cerrado).
// ═══════════════════════════════════════════════════════════════════════════

const permitidas = Object.keys(RUTAS_PERFIL_CINCO_AGENTES);

describe('clasificación de rutas', () => {
  it('cada ruta de AREA_POR_RUTA está clasificada: permitida o stand-by (ninguna sin dueño)', () => {
    const sinClasificar = rutasConocidas().filter(
      (r) => !permitidas.includes(r) && !RUTAS_STAND_BY_PERFIL_CINCO_AGENTES.includes(r),
    );
    expect(sinClasificar).toEqual([]);
  });

  it('A37-TRANSVERSAL-06: las solicitudes ARCO son una obligación legal de la flota: permitidas bajo el perfil, junto a /dashboard/legal', () => {
    expect(rutaPermitidaEnPerfil('cinco_agentes', '/dashboard/arco')).toBe(true);
    expect(RUTAS_STAND_BY_PERFIL_CINCO_AGENTES).not.toContain('/dashboard/arco');
  });

  it('ninguna ruta está a la vez permitida y en stand-by', () => {
    expect(permitidas.filter((r) => RUTAS_STAND_BY_PERFIL_CINCO_AGENTES.includes(r))).toEqual([]);
  });

  it('toda ruta permitida (salvo la dinámica) existe en AREA_POR_RUTA y tiene su page.tsx', () => {
    for (const r of permitidas) {
      if (r === '/dashboard/[id]') {
        expect(existsSync(join(process.cwd(), 'src/app/dashboard/[id]/page.tsx'))).toBe(true);
        continue;
      }
      expect(areaDeRuta(r), `${r} no está en AREA_POR_RUTA`).toBeDefined();
      const pagina = join(process.cwd(), 'src/app', r === '/dashboard' ? 'dashboard' : r.slice(1), 'page.tsx');
      expect(existsSync(pagina), `${r} no tiene página en ${pagina}`).toBe(true);
    }
  });

  it('toda ruta en stand-by existe en AREA_POR_RUTA (la lista de stand-by no se pudre)', () => {
    for (const r of RUTAS_STAND_BY_PERFIL_CINCO_AGENTES) expect(areaDeRuta(r), r).toBeDefined();
  });

  it('cada page.tsx estático bajo /dashboard está en una de las dos listas (una pantalla nueva sin clasificar rompe esta prueba)', () => {
    const raiz = join(process.cwd(), 'src/app/dashboard');
    const rutas: string[] = [];
    const recorre = (dir: string, ruta: string) => {
      for (const nombre of readdirSync(dir)) {
        const p = join(dir, nombre);
        if (statSync(p).isDirectory()) {
          if (nombre.startsWith('[')) continue; // dinámicas: se gatean con la llave de su padre
          recorre(p, `${ruta}/${nombre}`);
        } else if (nombre === 'page.tsx') rutas.push(ruta);
      }
    };
    recorre(raiz, '/dashboard');
    const sinClasificar = rutas.filter((r) => !permitidas.includes(r) && !RUTAS_STAND_BY_PERFIL_CINCO_AGENTES.includes(r));
    expect(sinClasificar).toEqual([]);
    expect(rutas.length).toBeGreaterThan(40);
  });

  it('la lista permitida cubre a los cinco agentes y no deja entrar nada de dinero fiscal', () => {
    const modulos = new Set(Object.values(RUTAS_PERFIL_CINCO_AGENTES));
    for (const m of ['liquidacion', 'peajes', 'carta_porte', 'vigia', 'conductor', 'base']) expect(modulos.has(m as never)).toBe(true);
    for (const r of ['/dashboard/chat', '/dashboard/facturacion', '/dashboard/suscripcion', '/dashboard/llaves-api',
      '/dashboard/sesiones-mcp', '/dashboard/usuarios', '/dashboard/timbrado', '/dashboard/descarga-sat']) {
      expect(permitidas).not.toContain(r);
    }
  });
});

describe('puedeVerRuta con perfil', () => {
  it('SIN perfil nada cambia: el dueño sigue viendo todas las rutas que veía', () => {
    for (const r of rutasConocidas()) {
      expect(puedeVerRuta('flota_admin', r)).toBe(puedeVerRuta('flota_admin', r, null));
      expect(puedeVerRuta('flota_admin', r)).toBe(puedeVerRuta('flota_admin', r, undefined));
    }
    expect(puedeVerRuta('flota_admin', '/dashboard/chat')).toBe(true);
    expect(puedeVerRuta('flota_admin', '/dashboard/suscripcion')).toBe(true);
  });

  it('CON perfil el dueño ve exactamente las permitidas que su rol ya veía', () => {
    for (const r of rutasConocidas()) {
      const esperado = permitidas.includes(r) && puedeVerRuta('flota_admin', r);
      expect(puedeVerRuta('flota_admin', r, 'cinco_agentes'), r).toBe(esperado);
    }
  });

  it('el perfil solo QUITA: nunca da una ruta que el rol no veía', () => {
    // El encargado no ve dinero: bajo el perfil sigue sin ver la liquidación.
    expect(puedeVerRuta('encargado', '/dashboard/agentes/liquidacion')).toBe(false);
    expect(puedeVerRuta('encargado', '/dashboard/agentes/liquidacion', 'cinco_agentes')).toBe(false);
    // Un rol desconocido no ve nada con ni sin perfil.
    expect(puedeVerRuta('chofer', '/dashboard', 'cinco_agentes')).toBe(false);
  });

  it('una ruta nueva sin clasificar se niega bajo el perfil', () => {
    expect(rutaPermitidaEnPerfil('cinco_agentes', '/dashboard/modulo-nuevo')).toBe(false);
    expect(puedeVerRuta('superadmin', '/dashboard/modulo-nuevo', 'cinco_agentes')).toBe(false);
  });

  it('un perfil que el código no conoce niega todo (falla cerrado)', () => {
    expect(rutaPermitidaEnPerfil('otro', '/dashboard')).toBe(false);
    expect(apiPermitidaEnPerfil('otro', '/api/v1/viajes')).toBe(false);
  });

  it('el detalle de liquidación (/dashboard/<uuid>) se pliega a su llave y la query no cuenta', () => {
    const id = '0f8fad5b-d9cb-469f-a165-70867728950e';
    expect(claveRutaPerfil(`/dashboard/${id}`)).toBe('/dashboard/[id]');
    expect(rutaPermitidaEnPerfil('cinco_agentes', `/dashboard/${id}?tenant=x`)).toBe(true);
    expect(rutaPermitidaEnPerfil('cinco_agentes', '/dashboard/agentes/peajes/')).toBe(true);
    expect(rutaPermitidaEnPerfil('cinco_agentes', '/dashboard/agentes/peajes/../../chat')).toBe(false);
  });

  it('los prefijos no abren hermanas: carta-porte no deja pasar carta-porte-x ni timbrado', () => {
    expect(rutaPermitidaEnPerfil('cinco_agentes', '/dashboard/carta-porte-x')).toBe(false);
    expect(rutaPermitidaEnPerfil('cinco_agentes', '/dashboard/timbrado')).toBe(false);
    expect(rutaPermitidaEnPerfil('cinco_agentes', '/dashboard/timbrado/abc')).toBe(false);
    expect(rutaPermitidaEnPerfil('cinco_agentes', '/dashboard/__proto__')).toBe(false);
    expect(rutaPermitidaEnPerfil('cinco_agentes', '/dashboard/constructor')).toBe(false);
  });
});

describe('API bajo el perfil', () => {
  it('v1: pasan los recursos de los cinco agentes y la base; el resto no', () => {
    for (const r of API_PERFIL_CINCO_AGENTES.v1) expect(apiPermitidaEnPerfil('cinco_agentes', `/api/v1/${r}`)).toBe(true);
    expect(apiPermitidaEnPerfil('cinco_agentes', '/api/v1/viajes/abc/citas')).toBe(true);
    expect(apiPermitidaEnPerfil('cinco_agentes', '/api/v1/clientes')).toBe(false);
    expect(apiPermitidaEnPerfil('cinco_agentes', '/api/v1/recurso-nuevo')).toBe(false);
  });
  it('v1: una subruta de stand-by bajo un segmento permitido se niega (contribución = margen y cobro)', () => {
    const id = '11111111-1111-4111-8111-111111111111';
    expect(apiPermitidaEnPerfil('cinco_agentes', `/api/v1/viajes/${id}/contribucion`)).toBe(false);
    expect(apiPermitidaEnPerfil('cinco_agentes', `/api/v1/viajes/${id}/contribucion?x=1`)).toBe(false);
    // Las hermanas logísticas y el recurso base siguen vivos.
    expect(apiPermitidaEnPerfil('cinco_agentes', `/api/v1/viajes/${id}`)).toBe(true);
    expect(apiPermitidaEnPerfil('cinco_agentes', `/api/v1/viajes/${id}/citas`)).toBe(true);
    expect(apiPermitidaEnPerfil('cinco_agentes', `/api/v1/viajes/${id}/sitios`)).toBe(true);
  });
  it('export: los de stand-by se niegan', () => {
    for (const n of ['poliza', 'jornada', 'convenios', 'facturas-proveedor', 'nuevo']) {
      expect(apiPermitidaEnPerfil('cinco_agentes', `/api/export/${n}`), n).toBe(false);
    }
    expect(apiPermitidaEnPerfil('cinco_agentes', '/api/export/liquidaciones')).toBe(true);
    expect(apiPermitidaEnPerfil('cinco_agentes', '/api/export/pdf/123')).toBe(true);
  });
  it('dashboard: el chat y sus hermanas se niegan; solo el pageview pasa', () => {
    for (const n of ['chat', 'archivo', 'ingesta', 'conversaciones', 'onboarding-chat']) {
      expect(apiPermitidaEnPerfil('cinco_agentes', `/api/dashboard/${n}`), n).toBe(false);
    }
    expect(apiPermitidaEnPerfil('cinco_agentes', '/api/dashboard/evento')).toBe(true);
  });
  it('otras raíces (/api/mcp, /api/cron) no son de esta lista: se niegan', () => {
    expect(apiPermitidaEnPerfil('cinco_agentes', '/api/mcp')).toBe(false);
    expect(apiPermitidaEnPerfil('cinco_agentes', '/api/cron/vigia')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// A3 (T-A3-40) · timbrado, descarga SAT y borrador de Carta Porte: stand-by.
// Solo casos agregados; ninguno de arriba se tocó.
// ═══════════════════════════════════════════════════════════════════════════
describe('A3: superficies de timbrado y viaje inalcanzables bajo el perfil', () => {
  const viaje = '0f8fad5b-d9cb-469f-a165-70867728950e';
  const NEGADAS_A3 = [
    '/dashboard/timbrado', `/dashboard/timbrado/${viaje}`,
    '/dashboard/descarga-sat', '/dashboard/descarga-sat/bandeja',
    '/dashboard/carta-porte/borrador', `/dashboard/carta-porte/borrador/${viaje}`,
  ];

  it('la ruta se niega bajo el perfil: timbrado, descarga SAT y el borrador por viaje', () => {
    for (const r of NEGADAS_A3) expect(rutaPermitidaEnPerfil('cinco_agentes', r), r).toBe(false);
  });

  it('se niega incluso al superadmin y al dueño (el perfil quita, no depende del rol)', () => {
    for (const r of NEGADAS_A3) {
      expect(puedeVerRuta('superadmin', r, 'cinco_agentes'), `superadmin ${r}`).toBe(false);
      expect(puedeVerRuta('flota_admin', r, 'cinco_agentes'), `flota_admin ${r}`).toBe(false);
    }
  });

  it('están en la lista de stand-by (ocultas, no borradas) y no en la permitida', () => {
    for (const r of ['/dashboard/timbrado', '/dashboard/descarga-sat', '/dashboard/descarga-sat/bandeja']) {
      expect(RUTAS_STAND_BY_PERFIL_CINCO_AGENTES, r).toContain(r);
      expect(permitidas, r).not.toContain(r);
    }
  });

  it('SIN perfil el dueño sigue entrando a timbrado y descarga SAT (nada cambia para las demás flotas)', () => {
    for (const r of ['/dashboard/timbrado', '/dashboard/descarga-sat']) {
      expect(puedeVerRuta('flota_admin', r), r).toBe(puedeVerRuta('flota_admin', r, null));
    }
  });

  it('lo de A3 que sí es del cliente sigue permitido: el visor de documentos y la bandeja', () => {
    for (const r of ['/dashboard/carta-porte', '/dashboard/carta-porte/documentos', '/dashboard/agentes/carta-porte']) {
      expect(rutaPermitidaEnPerfil('cinco_agentes', r), r).toBe(true);
    }
  });

  it('el cron y la exportación de documentos de A3 están clasificados como permitidos; el XML del timbre no abre la puerta del PAC', () => {
    expect(API_PERFIL_CINCO_AGENTES.export).toContain('carta-porte-docs');
    expect(apiPermitidaEnPerfil('cinco_agentes', '/api/export/carta-porte-docs')).toBe(true);
    expect(apiPermitidaEnPerfil('cinco_agentes', '/api/export/timbrado')).toBe(false);
    expect(apiPermitidaEnPerfil('cinco_agentes', '/api/v1/clientes')).toBe(false);
  });
});
