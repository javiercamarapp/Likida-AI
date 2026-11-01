import { describe, expect, it } from 'vitest';
import { AnfitrionFalso, ElementoFalso } from '@/app/ui-v2/movimiento/tour/anfitrion_falso';
import { ControladorTour } from '@/app/ui-v2/movimiento/tour/controlador';
import { leerGuardado } from '@/app/ui-v2/movimiento/tour/persistencia';
import type { Recorrido } from '@/app/ui-v2/movimiento/tour/tipos';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import { AGENTES, construirRecorridoAgente } from './agentes';
import { ROLES_MATRIZ } from './cobertura';
import { construirRecorrido } from './tour';

// ═══════════════════════════════════════════════════════════════════════════
// COMPORTAMIENTO REAL del recorrido (motor + recorrido construido), sin navegador: un anfitrión falso simula la app. Cada vez
// que el motor navega, «la página llega» y aparecen las anclas que esa página tendría (el menú siempre, el encabezado y el
// primer bloque en toda pantalla).
// ═══════════════════════════════════════════════════════════════════════════

type Perfil = 'cinco_agentes' | null;
const COMBOS = ROLES_MATRIZ.flatMap((rol) => ([null, 'cinco_agentes'] as const).map((perfil) => ({ rol, perfil })));

function montar(r: Recorrido, opciones: { conAnclas?: boolean } = {}) {
  const host = new AnfitrionFalso();
  host.ruta = '/dashboard';
  const conAnclas = opciones.conAnclas ?? true;
  const poner = () => {
    host.anclas.clear();
    if (!conAnclas) return;
    for (const p of r.pasos) if (p.ancla && (p.ancla.startsWith('nav-') || p.ancla.startsWith('pantalla.'))) host.anclas.set(p.ancla, new ElementoFalso());
  };
  poner();
  const c = new ControladorTour(r, host, { ambito: 'u1:t1' });
  /** La persona aprieta «Siguiente»; si el motor la mandó a otra página, la página llega. */
  const siguiente = () => {
    const antes = host.destinos.length;
    c.siguiente();
    if (host.destinos.length > antes) { host.llegarA(host.destinos.at(-1)!); poner(); c.alCambiarRuta(); }
    host.tic(0);
  };
  return { host, c, siguiente };
}

function recorrerHastaElFinal(r: Recorrido, opciones?: { conAnclas?: boolean }) {
  const { host, c, siguiente } = montar(r, opciones);
  const vistos: string[] = [];
  c.iniciar();
  host.tic(0);
  for (let i = 0; i < r.pasos.length + 5 && c.instantanea().fase === 'activo'; i++) {
    const s = c.instantanea();
    if (s.paso) vistos.push(s.paso.id);
    if (opciones?.conAnclas === false) host.tic(5000); // se agota la espera del ancla: degrada, no se rompe
    siguiente();
  }
  return { host, c, vistos };
}

describe('el recorrido llega al final por rol y perfil', () => {
  for (const { rol, perfil } of COMBOS) for (const modo of ['corto', 'completo'] as const) {
    const r = construirRecorrido(rol, perfil as Perfil, modo);
    if (!r) continue;
    it(`${rol} / ${perfil ?? 'flota'} / ${modo}: recorre todos los pasos y termina`, () => {
      const { c, vistos, host } = recorrerHastaElFinal(r);
      expect(c.instantanea().fase).toBe('terminado');
      expect(vistos).toEqual(r.pasos.map((p) => p.id));
      // Solo se navegó a pantallas que el rol puede abrir.
      for (const d of host.destinos) expect(puedeVerRuta(rol, d, perfil as Perfil), `${rol} navegó a ${d}`).toBe(true);
      expect(leerGuardado(host.almacen, 'u1:t1', r)?.estado).toBe('terminado');
    });
  }

  it('nómina no sale de sus tres pantallas', () => {
    const { host } = recorrerHastaElFinal(construirRecorrido('nomina', 'cinco_agentes', 'completo')!);
    expect(new Set(host.destinos)).toEqual(new Set(['/dashboard/agentes/liquidacion', '/dashboard/notificaciones', '/dashboard/mi-perfil']));
  });

  it('cada recorrido por agente también llega al final', () => {
    for (const ag of AGENTES) {
      const r = construirRecorridoAgente(ag, 'flota_admin', 'cinco_agentes')!;
      const { c, vistos } = recorrerHastaElFinal(r);
      expect(c.instantanea().fase).toBe('terminado');
      expect(vistos).toHaveLength(r.pasos.length);
    }
  });
});

describe('ancla ausente: salta con gracia, sin romper', () => {
  it('sin ninguna ancla en la página, cada paso se muestra centrado y el recorrido termina', () => {
    const r = construirRecorrido('flota_admin', 'cinco_agentes', 'completo')!;
    const { c, vistos } = recorrerHastaElFinal(r, { conAnclas: false });
    expect(c.instantanea().fase).toBe('terminado');
    expect(vistos).toHaveLength(r.pasos.length);
  });
  it('un paso cuya ancla no aparece avisa «ancla ausente» y deja seguir', () => {
    const r = construirRecorrido('encargado', null, 'corto')!;
    const { host, c } = montar(r, { conAnclas: false });
    c.iniciar();
    host.tic(5000);
    expect(c.instantanea().anclaLista).toBe(false);
    c.siguiente();
    expect(c.instantanea().indice).toBe(1);
  });
  it('un salto de menú que no se ve (celular) no espera 4 segundos: degrada en menos de 1', () => {
    const r = construirRecorrido('encargado', null, 'completo')!;
    const { host, c } = montar(r, { conAnclas: false });
    c.iniciar();
    expect(c.instantanea().paso?.tipo).toBe('ir');
    host.tic(1000);
    expect(c.instantanea().anclaLista).toBe(false);
  });
});

describe('saltar, retomar, saltar a una pantalla', () => {
  it('«Anterior» vuelve al paso previo (y no pasa del primero)', () => {
    const r = construirRecorrido('flota_admin', null, 'completo')!;
    const { c, siguiente } = montar(r);
    c.iniciar();
    c.atras();
    expect(c.instantanea().indice).toBe(0);
    siguiente(); siguiente();
    expect(c.instantanea().indice).toBe(2);
    c.atras();
    expect(c.instantanea().indice).toBe(1);
    expect(c.instantanea().esPrimero).toBe(false);
  });
  it('«Omitir recorrido» guarda «omitido» y cierra; Más tarde guarda el paso y reanudar vuelve a él', () => {
    const r = construirRecorrido('flota_admin', null, 'completo')!;
    const { host, c, siguiente } = montar(r);
    c.iniciar();
    for (let i = 0; i < 5; i++) siguiente();
    const idx = c.instantanea().indice;
    c.masTarde();
    expect(c.instantanea().fase).toBe('inactivo');
    expect(leerGuardado(host.almacen, 'u1:t1', r)).toMatchObject({ estado: 'en_curso', indice: idx });
    c.reanudar();
    expect(c.instantanea().indice).toBe(idx);
    c.saltar();
    expect(c.instantanea().fase).toBe('omitido');
    expect(leerGuardado(host.almacen, 'u1:t1', r)?.estado).toBe('omitido');
  });
  it('«Saltar a una pantalla» abre el recorrido en el primer paso de esa pantalla', () => {
    const r = construirRecorrido('flota_admin', 'cinco_agentes', 'completo')!;
    const { c } = montar(r);
    c.irAPantalla('/dashboard/operadores');
    const s = c.instantanea();
    expect(s.fase).toBe('activo');
    expect(s.paso?.id).toBe('operadores.ir');
    expect(c.pantallas().map((p) => p.href)).toContain('/dashboard/operadores');
    c.irAPantalla('/dashboard/no-existe');
    expect(c.instantanea().paso?.id).toBe('operadores.ir');
  });
  it('el progreso guardado del modo corto vale en el completo (mismos ids de paso)', () => {
    const corto = construirRecorrido('encargado', null, 'corto')!;
    const completo = construirRecorrido('encargado', null, 'completo')!;
    const ids = new Set(completo.pasos.map((p) => p.id));
    expect(corto.pasos.every((p) => ids.has(p.id))).toBe(true);
    expect(corto.pasos.length).toBeLessThan(completo.pasos.length);
  });
});

describe('los saltos de menú avanzan al hacer clic', () => {
  it('un clic en el ítem del menú pasa del «ir» al «que» de esa pantalla', () => {
    const r = construirRecorrido('encargado', null, 'completo')!;
    const { host, c } = montar(r);
    c.iniciar(); // resumen.ir, ancla nav-resumen
    const ir = c.instantanea().paso!;
    expect(ir.id).toBe('resumen.ir');
    host.anclas.get(ir.ancla!)!.disparar('click');
    host.tic(0);
    expect(c.instantanea().paso?.id).toBe('resumen.que');
  });
  it('los contadores no cuentan los saltos de menú', () => {
    const r = construirRecorrido('encargado', null, 'completo')!;
    const { c } = montar(r);
    c.iniciar();
    const s = c.instantanea();
    expect(s.pasoTotal).toBe(r.pasos.filter((p) => p.tipo !== 'ir').length);
    expect(s.grupoTotal).toBe(c.pantallas().length);
    expect(s.pasoN).toBe(1);
  });
});
