import { describe, expect, it } from 'vitest';
import { INFO, INFO_CATALOGO, type InfoClave, type InfoTexto } from './info-catalogo';
import { INFO_ADMIN } from './info-textos/administracion';
import { INFO_AGENTES } from './info-textos/agentes';
import { INFO_AGENTES_CPV } from './info-textos/agentes_cpv';
import { INFO_LIQUIDACION } from './info-textos/liquidacion';
import { INFO_OPERACION } from './info-textos/operacion';
import { INFO_CATALOGO_EN } from './info-textos/en/catalogo';
import { INFO_ADMIN_EN } from './info-textos/en/administracion';
import { INFO_AGENTES_EN } from './info-textos/en/agentes';
import { INFO_AGENTES_CPV_EN } from './info-textos/en/agentes_cpv';
import { INFO_LIQUIDACION_EN } from './info-textos/en/liquidacion';
import { INFO_OPERACION_EN } from './info-textos/en/operacion';
import { cargarInfoEn, infoDeIdioma, sembrarInfoEnParaPruebas } from './info-idioma';

const GRUPOS: Array<[string, Record<string, InfoTexto>, Record<string, InfoTexto>]> = [
  ['catalogo', INFO_CATALOGO, INFO_CATALOGO_EN],
  ['administracion', INFO_ADMIN, INFO_ADMIN_EN],
  ['agentes', INFO_AGENTES, INFO_AGENTES_EN],
  ['agentes_cpv', INFO_AGENTES_CPV, INFO_AGENTES_CPV_EN],
  ['liquidacion', INFO_LIQUIDACION, INFO_LIQUIDACION_EN],
  ['operacion', INFO_OPERACION, INFO_OPERACION_EN],
];
const textos = (t: InfoTexto): string[] => [t.titulo, t.queEs, t.comoSeCalcula, t.fuente, t.queHacer, t.periodo, t.cobertura, ...(t.loQueNoSabemos ?? [])].filter((x): x is string => x !== undefined);
const digitos = (t: InfoTexto) => textos(t).join(' ').match(/\d+/g)?.sort().join(',') ?? '';
// En español se usan «»; en inglés van “ ” (misma cantidad de signos, otra forma).
const comillas = (t: InfoTexto) => (textos(t).join(' ').match(/[«»“”]/g) ?? []).length;

describe('ⓘ en inglés: paridad con el español', () => {
  for (const [nombre, es, en] of GRUPOS) {
    describe(nombre, () => {
      it('las claves coinciden exactamente (ninguna falta ni sobra)', () => {
        const ke = Object.keys(es).sort();
        const kn = Object.keys(en).sort();
        expect(kn.filter((k) => !ke.includes(k)), 'sobran en inglés').toEqual([]);
        expect(ke.filter((k) => !kn.includes(k)), 'faltan en inglés').toEqual([]);
      });
      it('ningún campo vacío y la forma coincide (estado, queHacer, opcionales, cifras y «»)', () => {
        for (const k of Object.keys(en)) {
          const t = en[k]!;
          const o = es[k]!;
          for (const c of [t.titulo, t.queEs, t.comoSeCalcula, t.fuente]) expect(c.trim().length, k).toBeGreaterThan(0);
          for (const c of textos(t)) expect(c.trim().length, k).toBeGreaterThan(0);
          expect(t.estado, k).toBe(o.estado);
          expect(Boolean(t.queHacer), `${k} queHacer`).toBe(Boolean(o.queHacer));
          expect(Boolean(t.periodo), `${k} periodo`).toBe(Boolean(o.periodo));
          expect(Boolean(t.cobertura), `${k} cobertura`).toBe(Boolean(o.cobertura));
          expect(t.loQueNoSabemos?.length ?? 0, `${k} loQueNoSabemos`).toBe(o.loQueNoSabemos?.length ?? 0);
          expect(t.clase, `${k} clase`).toBe(o.clase);
          expect(digitos(t), `${k} cifras`).toBe(digitos(o));
          // Una traducción puede entrecomillar un término («sin viaje» → “no trip”) que el español dejaba sin comillas; lo que no puede es PERDER las del original.
          expect(comillas(t), `${k} comillas «»`).toBeGreaterThanOrEqual(comillas(o));
        }
      });
    });
  }
  it('cada texto en inglés es de verdad inglés: no es idéntico al español (salvo marcas y siglas)', () => {
    const iguales: string[] = [];
    for (const [, es, en] of GRUPOS) for (const k of Object.keys(en)) if (en[k]!.queEs === es[k]!.queEs && en[k]!.queEs.length > 25) iguales.push(k);
    expect(iguales, 'entradas sin traducir').toEqual([]);
  });
});

describe('infoDeIdioma', () => {
  const clave = 'resumen.monto_comprobado' as InfoClave;
  it('sin idioma o en español devuelve el español', () => {
    expect(infoDeIdioma(clave)).toBe(INFO[clave]);
    expect(infoDeIdioma(clave, 'es')).toBe(INFO[clave]);
  });
  it('en inglés, antes de cargar, cae al español; ya cargado devuelve el inglés', async () => {
    sembrarInfoEnParaPruebas(null);
    expect(infoDeIdioma(clave, 'en')).toBe(INFO[clave]);
    const mapa = await cargarInfoEn();
    expect(infoDeIdioma(clave, 'en')).toBe(mapa[clave]);
    expect(infoDeIdioma(clave, 'en').titulo).not.toBe(INFO[clave].titulo);
    sembrarInfoEnParaPruebas(null);
  });
  it('una clave desconocida falla fuerte', () => {
    expect(() => infoDeIdioma('no.existe' as InfoClave, 'en')).toThrow(/desconocida/);
  });
});
