/* eslint-disable security/detect-non-literal-fs-filename -- lee archivos del propio repo */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AGENTES, NEGOCIO, CONTROL, SISTEMA, SECCIONES, FUERA_DEL_MENU, TODAS_LAS_RUTAS, entradaDeRuta, pestanaActiva, coincideBusqueda, planoBusqueda } from './rutas';
import { REDIRECCIONES_308 } from './guardas/redirecciones_308';

// El menú de /admin pasó de 43 a 16 entradas SIN perder pantallas: cada página sigue siendo una ruta propia, agrupada como pestaña.
const ENTRADAS = [...AGENTES, ...NEGOCIO, ...CONTROL, ...SISTEMA];
const paginaExiste = (href: string) => existsSync(join(__dirname, href.replace('/admin', '') || '', 'page.tsx')) || href === '/admin';

describe('menú de /admin agrupado en pestañas', () => {
  it('tiene 15 entradas más el Resumen (16 en el sidebar; antes 43)', () => { expect(ENTRADAS).toHaveLength(15); });

  it('conserva lo que el dueño pidió que se quede: Copiloto, Cerebro de ventas y los paneles de cada agente', () => {
    const todas = TODAS_LAS_RUTAS.map((r) => r.href);
    for (const h of ['/admin/copiloto', '/admin/mapa-prospectos', '/admin/agente-ocr', '/admin/agente-cuadre', '/admin/agente-whatsapp', '/admin/model-ops', '/admin/evals', '/admin/qa', '/admin/agentes']) {
      expect(todas, h).toContain(h);
    }
  });

  it('cada ruta del menú y de las pestañas es una página que existe (sin enlaces muertos)', () => {
    const rotas = TODAS_LAS_RUTAS.filter((r) => !paginaExiste(r.href)).map((r) => r.href);
    expect(rotas).toEqual([]);
  });

  it('el árbol final 3.1: cuatro secciones y, por entrada, las pestañas que fijó el plan maestro', () => {
    expect(SECCIONES.map((s) => s.titulo)).toEqual(['Agentes', 'Negocio', 'Control', 'Sistema']);
    const mapa = Object.fromEntries(ENTRADAS.map((e) => [e.nombre, { href: e.href, pestanas: (e.pestanas ?? []).map((p) => p.nombre) }]));
    expect(mapa).toEqual({
      Copiloto: { href: '/admin/copiloto', pestanas: [] },
      Agentes: { href: '/admin/agentes', pestanas: ['Panel', 'OCR', 'Cuadre', 'WhatsApp', 'Conversaciones', 'Modelos'] },
      Calidad: { href: '/admin/evals', pestanas: ['Exámenes', 'Pruebas reales', 'Resumen'] },
      Bandeja: { href: '/admin/tu-turno', pestanas: ['Tu turno', 'Aprobaciones', 'Escalaciones'] },
      Ventas: { href: '/admin/mapa-prospectos', pestanas: ['Cerebro de ventas', 'Vendedores'] },
      Clientes: { href: '/admin/flotas', pestanas: [] },
      'Consumo de IA': { href: '/admin/consumo', pestanas: ['Consumo', 'Techos'] },
      Facturación: { href: '/admin/cobranza', pestanas: ['Cobranza', 'Planes y cobro', 'Facturas'] },
      Crecimiento: { href: '/admin/crecimiento', pestanas: ['Adquisición', 'Estudio'] },
      'Seguridad y datos': { href: '/admin/compliance', pestanas: ['Compliance y datos', 'Trust & Safety', 'Clientes MCP'] },
      Equipo: { href: '/admin/equipo', pestanas: ['Personas', 'Nuevo acceso'] },
      Salud: { href: '/admin/salud-sistema', pestanas: ['Estado', 'Relojes', 'Observabilidad', 'Corridas', 'Capacidad'] },
      Soporte: { href: '/admin/soporte', pestanas: [] },
      Integraciones: { href: '/admin/integraciones', pestanas: ['Integraciones', 'WhatsApp'] },
      Desarrollo: { href: '/admin/dev', pestanas: ['Vistas de rol', 'Código'] },
    });
  });

  it('la sección «Plataforma» ya no existe y Integraciones vive en Sistema', () => {
    expect(SECCIONES.some((s) => s.titulo === 'Plataforma')).toBe(false);
    expect(SISTEMA.map((i) => i.nombre)).toContain('Integraciones');
  });

  it('ninguna entrada pasa de 6 pestañas (criterio de diseño del plan, 3.3 regla 1)', () => {
    for (const it of ENTRADAS) expect((it.pestanas ?? []).length, it.nombre).toBeLessThanOrEqual(6);
  });

  it('el href de cada entrada con pestañas es el de su primera pestaña (la entrada abre lo primero que se ve)', () => {
    for (const it of ENTRADAS.filter((e) => e.pestanas)) expect(it.href, it.nombre).toBe(it.pestanas![0].href);
  });

  it('Corridas deja de ser huérfana: /admin/corridas/<id> cuelga de Salud › Corridas', () => {
    const e = entradaDeRuta('/admin/corridas/abc-123');
    expect(e?.nombre).toBe('Salud');
    expect(pestanaActiva(e!, '/admin/corridas/abc-123')?.nombre).toBe('Corridas');
  });

  it('Equipo agrupa Personas y Nuevo acceso; Bandeja y Ventas abren en su primera pestaña', () => {
    expect(entradaDeRuta('/admin/usuarios/nuevo')?.nombre).toBe('Equipo');
    expect(entradaDeRuta('/admin/tu-turno')?.nombre).toBe('Bandeja');
    expect(entradaDeRuta('/admin/escalaciones')?.nombre).toBe('Bandeja');
    expect(entradaDeRuta('/admin/mapa-prospectos/xyz')?.nombre).toBe('Ventas');
  });

  it('⌘K lista las tres pantallas fuera del menú y ningún stub 308', () => {
    const hrefs = TODAS_LAS_RUTAS.map((r) => r.href);
    for (const f of FUERA_DEL_MENU) expect(hrefs).toContain(f.href);
    expect(FUERA_DEL_MENU.map((f) => f.href).sort()).toEqual(['/admin/elegir-flota', '/admin/mi-perfil', '/admin/notificaciones']);
    for (const vieja of Object.keys(REDIRECCIONES_308)) expect(hrefs).not.toContain(vieja);
  });

  it('⌘K: cada pestaña se encuentra como «Entrada · Pestaña» y las llaves de la lista son únicas', () => {
    const nombres = TODAS_LAS_RUTAS.map((r) => r.nombre);
    for (const n of ['Agentes · OCR', 'Salud · Corridas', 'Equipo · Nuevo acceso', 'Facturación · Planes y cobro', 'Facturación · Facturas', 'Consumo de IA · Techos']) expect(nombres).toContain(n);
    const hrefs = TODAS_LAS_RUTAS.map((r) => r.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  const busca = (q: string) => TODAS_LAS_RUTAS.filter((r) => coincideBusqueda(r.nombre, r.alias, planoBusqueda(q))).map((r) => r.href);
  it('⌘K: los alias del plan encuentran su pantalla («kill switch», «apagar», ARCO, techo, invitar, traza)', () => {
    expect(busca('kill switch')).toContain('/admin/agentes');
    expect(busca('apagar')).toContain('/admin/agentes');
    expect(busca('ARCO')).toContain('/admin/compliance');
    expect(busca('techo')).toContain('/admin/techo-ia');
    expect(busca('invitar')).toContain('/admin/usuarios/nuevo');
    expect(busca('traza')).toContain('/admin/corridas');
  });
  it('⌘K: la primera pestaña se encuentra por su nombre aunque comparta dirección con su entrada, y no importan los acentos', () => {
    expect(busca('tu turno')).toContain('/admin/tu-turno');
    expect(busca('cerebro')).toContain('/admin/mapa-prospectos');
    expect(busca('examenes')).toContain('/admin/evals');
    expect(busca('bitacora')).toEqual([]); // la pestaña Bitácora llega en la Fase 7: hoy no se promete.
  });

  it('ninguna ruta aparece en dos entradas distintas', () => {
    const vistas = new Map<string, string>();
    for (const it of ENTRADAS) {
      for (const h of new Set([it.href, ...(it.pestanas ?? []).map((p) => p.href)])) {
        expect(vistas.get(h), `${h} repetida`).toBeUndefined();
        vistas.set(h, it.nombre);
      }
    }
  });

  it('una ruta pertenece a su grupo aunque sea una pestaña o lleve parámetro', () => {
    expect(entradaDeRuta('/admin/agente-ocr')?.nombre).toBe('Agentes');
    expect(entradaDeRuta('/admin/qa/abc-123')?.nombre).toBe('Calidad');
    expect(entradaDeRuta('/admin/flotas/xyz')?.nombre).toBe('Clientes');
    expect(entradaDeRuta('/admin/mapa-prospectos')?.nombre).toBe('Ventas');
    expect(entradaDeRuta('/admin')).toBeNull();
    expect(entradaDeRuta('/admin/mi-perfil')).toBeNull();
  });

  it('la pestaña activa es la de href más largo que coincide', () => {
    const calidad = entradaDeRuta('/admin/qa/abc')!;
    expect(pestanaActiva(calidad, '/admin/qa/abc')?.nombre).toBe('Pruebas reales');
    expect(pestanaActiva(calidad, '/admin/evals')?.nombre).toBe('Exámenes');
  });

  it('cada pestaña tiene nombre corto y no se repite dentro de su grupo', () => {
    for (const it of ENTRADAS) {
      const nombres = (it.pestanas ?? []).map((p) => p.nombre);
      expect(new Set(nombres).size).toBe(nombres.length);
      for (const n of nombres) expect(n.length).toBeLessThanOrEqual(18);
    }
  });
});
