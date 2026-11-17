import { describe, expect, it } from 'vitest';
import { validarRecorrido, MAX_TITULO, MAX_TEXTO } from '@/app/ui-v2/movimiento/tour/validar';
import { hrefsDelMenu, menuPorPerfil } from '@/app/dashboard/shell/menu-por-perfil';
import { ROLES_MATRIZ } from '../cobertura';
import { CASOS, CASOS_EN } from './index';
import { ETAPAS_CASO } from './tipos';
import { construirRecorridoCaso, idRecorridoCaso, recorridosDeCasos } from './recorrido';

const ESPANOL = /[áéíóúñ¿¡«»]/;
const LIQ = '/dashboard/agentes/liquidacion';

describe('casos por pantalla: contenido', () => {
  it('hay casos y cada uno tiene versión en inglés con las mismas rutas', () => {
    expect(Object.keys(CASOS).length).toBeGreaterThan(0);
    expect(Object.keys(CASOS_EN).sort()).toEqual(Object.keys(CASOS).sort());
  });
  for (const [href, caso] of Object.entries(CASOS)) {
    describe(href, () => {
      it('es una pantalla del dashboard y su caso se rotula «Ejemplo:»', () => {
        expect(href === '/dashboard' || href.startsWith('/dashboard/')).toBe(true);
        expect(caso.titulo.startsWith('Ejemplo:')).toBe(true);
        expect(CASOS_EN[href].titulo.startsWith('Example:')).toBe(true);
      });
      it('tiene las cuatro etapas, en orden, y respeta los topes', () => {
        expect([...new Set(caso.pasos.map((p) => p.etapa))]).toEqual([...ETAPAS_CASO]);
        for (const c of [caso, CASOS_EN[href]]) for (const p of c.pasos) {
          expect(p.titulo.length, p.titulo).toBeLessThanOrEqual(MAX_TITULO);
          expect(p.texto.length, p.texto).toBeLessThanOrEqual(MAX_TEXTO);
          if (p.persona) expect(p.persona.length, p.persona).toBeLessThanOrEqual(MAX_TEXTO);
        }
      });
      it('la versión en inglés calca la estructura y no lleva español', () => {
        const en = CASOS_EN[href];
        expect(en.pasos.map((p) => [p.etapa, p.ancla, Boolean(p.persona)])).toEqual(caso.pasos.map((p) => [p.etapa, p.ancla, Boolean(p.persona)]));
        expect(ESPANOL.test(JSON.stringify(en))).toBe(false);
      });
      it('no escribe cifras a mano', () => {
        expect(/\d/.test(JSON.stringify([caso, CASOS_EN[href]]))).toBe(false);
      });
    });
  }
});

describe('construirRecorridoCaso', () => {
  it('arma ir + un paso por cada paso del caso (más uno por persona) + cierre, y es válido en es y en en', () => {
    for (const idioma of ['es', 'en'] as const) {
      const r = construirRecorridoCaso(LIQ, 'flota_admin', 'cinco_agentes', idioma)!;
      expect(r).not.toBeNull();
      expect(r.id).toBe(idRecorridoCaso(LIQ));
      expect(r.pista).toBe('caso');
      expect(validarRecorrido(r), idioma).toEqual([]);
      const caso = CASOS[LIQ];
      expect(r.pasos).toHaveLength(1 + caso.pasos.length + caso.pasos.filter((p) => p.persona).length + 1);
      expect(r.pasos[0].tipo).toBe('ir');
      expect(r.pasos.at(-1)!.tipo).toBe('cierre');
      expect(r.pasos[1].ruta).toBe(LIQ);
    }
  });
  it('antepone la etapa al título y usa el ancla por omisión', () => {
    const r = construirRecorridoCaso(LIQ, 'flota_admin', 'cinco_agentes')!;
    expect(r.pasos[1].titulo.startsWith('Entra: ')).toBe(true);
    expect(r.pasos[2].ancla).toBe('pantalla.primer-bloque');
    expect(construirRecorridoCaso(LIQ, 'flota_admin', 'cinco_agentes', 'en')!.pasos[1].titulo.startsWith('In: ')).toBe(true);
  });
  it('todo caso, ya armado con su etapa, pasa la validación del motor en es y en en', () => {
    for (const href of Object.keys(CASOS)) for (const idioma of ['es', 'en'] as const) {
      const r = construirRecorridoCaso(href, 'flota_admin', 'cinco_agentes', idioma);
      if (r) expect(validarRecorrido(r), `${href} ${idioma}`).toEqual([]);
    }
  });
  it('devuelve null sin caso o si el rol no abre la pantalla', () => {
    expect(construirRecorridoCaso('/dashboard/no-existe', 'flota_admin', 'cinco_agentes')).toBeNull();
    for (const rol of ROLES_MATRIZ) for (const perfil of [null, 'cinco_agentes'] as const) {
      const abre = hrefsDelMenu(menuPorPerfil(rol, perfil)).includes(LIQ);
      expect(construirRecorridoCaso(LIQ, rol, perfil) !== null, `${rol} ${perfil}`).toBe(abre);
    }
  });
  it('recorridosDeCasos solo incluye pantallas que el rol abre', () => {
    for (const rol of ROLES_MATRIZ) {
      const hrefs = hrefsDelMenu(menuPorPerfil(rol, 'cinco_agentes'));
      for (const r of recorridosDeCasos(rol, 'cinco_agentes')) expect(hrefs.some((h) => idRecorridoCaso(h) === r.id), `${rol} ${r.id}`).toBe(true);
    }
  });
});
