import { describe, expect, it } from 'vitest';
import { validarRecorrido } from '@/app/ui-v2/movimiento/tour/validar';
import { hrefsDelMenu, menuPorPerfil } from '@/app/dashboard/shell/menu-por-perfil';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import { PANTALLAS } from './pantallas';
import { AGENTES, construirRecorridoAgente } from './agentes';
import { construirRecorrido, contarPasos, pantallasDeRecorrido } from './tour';
import { pistaDeRol, rolTienePermiso } from './roles';
import { puedeFirmarLiquidacion } from '@/lib/likida/revision';
import { ROLES_MATRIZ } from './cobertura';

const COMBOS = ROLES_MATRIZ.flatMap((rol) => ([null, 'cinco_agentes'] as const).map((perfil) => ({ rol, perfil })));

describe('recorrido derivado del menú', () => {
  for (const { rol, perfil } of COMBOS) {
    const etiqueta = `${rol} / ${perfil ?? 'flota'}`;
    it(`${etiqueta}: válido, o sin recorrido si el rol no tiene panel`, () => {
      const r = construirRecorrido(rol, perfil, 'completo');
      const sinPanel = !pistaDeRol(rol) || hrefsDelMenu(menuPorPerfil(rol, perfil)).length === 0;
      if (sinPanel) { expect(r).toBeNull(); return; }
      expect(validarRecorrido(r!)).toEqual([]);
      expect(r!.pasos.at(-1)!.tipo).toBe('cierre');
    });
  }

  it('cada paso con ruta apunta a una pantalla que el rol puede abrir (puedeVerRuta) y que su menú muestra', () => {
    for (const { rol, perfil } of COMBOS) {
      const r = construirRecorrido(rol, perfil, 'completo');
      if (!r) continue;
      const menu = hrefsDelMenu(menuPorPerfil(rol, perfil));
      for (const p of r.pasos) {
        if (p.pantalla) {
          expect(puedeVerRuta(rol, p.pantalla, perfil), `${rol} ${p.id}`).toBe(true);
          expect(menu, `${rol} ${p.id}`).toContain(p.pantalla);
        }
      }
    }
  });

  it('un paso de acción solo existe si el rol tiene el permiso', () => {
    for (const { rol, perfil } of COMBOS) {
      const r = construirRecorrido(rol, perfil, 'completo');
      if (!r) continue;
      for (const p of r.pasos.filter((x) => x.id.endsWith('.accion'))) {
        const def = Object.entries(PANTALLAS).find(([h]) => h === p.pantalla)![1];
        expect(rolTienePermiso(rol, def.accion!.permiso), `${rol} ${p.id}`).toBe(true);
      }
    }
  });

  it('firmar usa el mismo criterio que puedeFirmarLiquidacion', () => {
    for (const rol of [...ROLES_MATRIZ, 'x']) expect(rolTienePermiso(rol, 'firmar')).toBe(puedeFirmarLiquidacion(rol));
  });

  it('el encargado no recibe pasos de dinero ni de timbrado', () => {
    const r = construirRecorrido('encargado', null, 'completo')!;
    const dinero = ['facturacion', 'timbrado', 'rentabilidad', 'clientes', 'cotizaciones', 'suscripcion', 'agentes-liquidacion'];
    for (const p of r.pasos) expect(dinero.some((d) => p.id.startsWith(`${d}.`)), p.id).toBe(false);
  });

  it('nómina solo recorre sus tres pantallas', () => {
    const r = construirRecorrido('nomina', 'cinco_agentes', 'completo')!;
    expect(pantallasDeRecorrido(r).map((g) => g.href)).toEqual(['/dashboard/agentes/liquidacion', '/dashboard/notificaciones', '/dashboard/mi-perfil']);
    const liq = r.pasos.find((p) => p.id === 'agentes-liquidacion.que')!;
    expect(liq.texto).toMatch(/conteos/i);
    expect(r.pasos.some((p) => p.id.endsWith('.accion'))).toBe(false);
  });

  it('el modo corto usa ids del completo, es más corto y tiene ~12 pasos para el dueño de cinco agentes', () => {
    for (const { rol, perfil } of COMBOS) {
      const c = construirRecorrido(rol, perfil, 'corto'), f = construirRecorrido(rol, perfil, 'completo');
      if (!c || !f) continue;
      const idsF = new Set(f.pasos.map((p) => p.id));
      for (const p of c.pasos) expect(idsF.has(p.id), `${rol} ${p.id}`).toBe(true);
      expect(c.pasos.length).toBeLessThanOrEqual(f.pasos.length);
    }
    const dueno = construirRecorrido('flota_admin', 'cinco_agentes', 'corto')!;
    expect(dueno.pasos.length).toBeGreaterThanOrEqual(10);
    expect(dueno.pasos.length).toBeLessThanOrEqual(16);
  });

  it('reporta los conteos por rol (cinco agentes): dueño ≈ 25 pantallas, encargado 18, contador 5, nómina 3', () => {
    const n = (rol: string) => pantallasDeRecorrido(construirRecorrido(rol, 'cinco_agentes', 'completo')!).length;
    expect([n('flota_admin'), n('encargado'), n('contador'), n('nomina')]).toEqual([25, 18, 5, 3]);
    // Pasos sin contar los saltos de menú: lo que muestra la tarjeta.
    expect(contarPasos(construirRecorrido('flota_admin', 'cinco_agentes', 'completo')!.pasos)).toBeGreaterThan(50);
  });

  it('el cierre ofrece el asistente que el rol ve', () => {
    const cinco = construirRecorrido('flota_admin', 'cinco_agentes', 'completo')!.pasos.at(-1)!;
    expect(cinco.cta?.ruta).toBe('/dashboard/puesta-en-marcha');
    const flota = construirRecorrido('flota_admin', null, 'completo')!.pasos.at(-1)!;
    expect(flota.cta?.ruta).toBe('/dashboard/arranque');
    expect(construirRecorrido('contador', 'cinco_agentes', 'completo')!.pasos.at(-1)!.cta).toBeUndefined();
  });

  it('textos sin emojis ni signos de exclamación', () => {
    for (const { rol, perfil } of COMBOS) {
      const r = construirRecorrido(rol, perfil, 'completo');
      for (const p of r?.pasos ?? []) expect(`${p.titulo} ${p.texto}`, p.id).not.toMatch(/[!¡]|\p{Extended_Pictographic}/u);
    }
  });
});

describe('recorridos por agente (perfil cinco_agentes)', () => {
  it('cada agente tiene 4 pasos y un cierre para quien ve su pantalla', () => {
    for (const ag of AGENTES) {
      const r = construirRecorridoAgente(ag, 'flota_admin', 'cinco_agentes')!;
      expect(validarRecorrido(r)).toEqual([]);
      expect(r.pasos).toHaveLength(5);
    }
  });
  it('no existen sin el perfil ni para un rol que no ve el agente', () => {
    expect(construirRecorridoAgente(AGENTES[0], 'flota_admin', null)).toBeNull();
    const peajes = AGENTES.find((a) => a.id === 'peajes')!;
    expect(construirRecorridoAgente(peajes, 'encargado', 'cinco_agentes')).toBeNull();
    expect(construirRecorridoAgente(AGENTES[0], 'nomina', 'cinco_agentes')).toBeNull();
  });
});
