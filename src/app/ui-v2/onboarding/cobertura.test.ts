import { describe, expect, it } from 'vitest';
import { celda, motivoEsConocido, NO_APLICA_DECLARADO, PERFILES_MATRIZ, resumenMatriz, ROLES_MATRIZ, rutasDeLaMatriz } from './cobertura';
import { PANTALLAS } from './pantallas';
import { PISTAS_CONTEXTUALES } from './pistas';
import { hrefsDelMenu, menuPorPerfil } from '@/app/dashboard/shell/menu-por-perfil';

describe('matriz de cobertura del onboarding', () => {
  it('ninguna celda queda sin cobertura: cada pantalla visible tiene un paso, una pista o un «no aplica» con motivo', () => {
    expect(resumenMatriz().sinCobertura).toEqual([]);
  });

  it('todo «no aplica» trae un motivo de la derivación o de la lista cerrada', () => {
    for (const ruta of rutasDeLaMatriz()) for (const rol of ROLES_MATRIZ) for (const perfil of PERFILES_MATRIZ) {
      const c = celda(ruta, rol, perfil);
      if (c.estado === 'no_aplica') expect(motivoEsConocido(c.motivo), `${ruta} ${rol} ${perfil}: «${c.motivo}»`).toBe(true);
    }
  });

  it('el vendedor no recibe ninguna cobertura en /dashboard', () => {
    for (const ruta of rutasDeLaMatriz()) for (const perfil of PERFILES_MATRIZ) expect(celda(ruta, 'vendedor', perfil).estado).toBe('no_aplica');
  });

  it('nómina solo tiene cobertura en sus tres pantallas', () => {
    const cubiertas = rutasDeLaMatriz().filter((r) => celda(r, 'nomina', 'cinco_agentes').estado === 'cubierta');
    expect(cubiertas.sort()).toEqual(['/dashboard/agentes/liquidacion', '/dashboard/mi-perfil', '/dashboard/notificaciones']);
  });

  it('todo ítem de menú de cualquier rol y perfil tiene contenido de recorrido', () => {
    const faltan = new Set<string>();
    for (const perfil of [null, 'cinco_agentes'] as const) for (const rol of ROLES_MATRIZ) {
      for (const h of hrefsDelMenu(menuPorPerfil(rol, perfil))) if (!Object.hasOwn(PANTALLAS, h)) faltan.add(h);
    }
    expect([...faltan]).toEqual([]);
  });

  it('no hay contenido huérfano: cada pantalla del catálogo y cada pista existen en la matriz', () => {
    const rutas = new Set(rutasDeLaMatriz());
    expect(Object.keys(PANTALLAS).filter((r) => !rutas.has(r))).toEqual([]);
    expect(Object.keys(PISTAS_CONTEXTUALES).filter((r) => !rutas.has(r))).toEqual([]);
    expect(Object.keys(NO_APLICA_DECLARADO).filter((r) => !rutas.has(r))).toEqual([]);
  });

  it('cada «no aplica declarado» sigue siendo necesario (alguna celda lo usa)', () => {
    const motivos = new Set<string>();
    for (const ruta of rutasDeLaMatriz()) for (const rol of ROLES_MATRIZ) for (const perfil of PERFILES_MATRIZ) {
      const c = celda(ruta, rol, perfil);
      if (c.estado === 'no_aplica') motivos.add(c.motivo);
    }
    for (const [ruta, motivo] of Object.entries(NO_APLICA_DECLARADO)) expect(motivos.has(motivo), ruta).toBe(true);
  });
});
