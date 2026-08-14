import { describe, it, expect } from 'vitest';
import { readdirSync } from 'node:fs';
import { NORMAS } from './corpus';
import {
  buscarNormas, PUEDE_AFIRMARSE, JERARQUIA_ROTULO, type Norma,
} from './tipos';
// El generador exporta su lector para que ESTA prueba vuelva a leer los YAML.
// Si el índice generado se separa de la carpeta, aquí truena.
import { leerCorpus } from '../../../../scripts/generar-normas.mjs';

describe('el índice generado NO se puede separar de normas/', () => {
  it('tiene exactamente las mismas fichas que la carpeta', () => {
    const enDisco = readdirSync('normas').filter((f) => f.endsWith('.yaml') || f.endsWith('.yml')).sort();
    expect(NORMAS.map((n) => n.archivo)).toEqual(enDisco);
  });

  it('cada campo del índice coincide con su YAML — regenerar es obligatorio', () => {
    // El modo de falla que esto ataja: alguien corrige un `estado_verificacion`
    // en el YAML (que es donde se revisa en el PR) y el producto sigue
    // afirmando con el estado viejo, porque el índice es el que se despliega.
    expect(JSON.parse(JSON.stringify(NORMAS))).toEqual(leerCorpus('normas'));
  });

  it('ninguna ficha se queda sin identidad ni sin estado', () => {
    for (const n of NORMAS) {
      expect(n.id, n.archivo).toBeTruthy();
      expect(n.instrumento, n.archivo).toBeTruthy();
      expect(n.estado_verificacion, n.archivo).toBeTruthy();
      expect(Number.isFinite(n.jerarquia), n.archivo).toBe(true);
    }
  });

  it('todo estado de verificación que aparece tiene su regla de "¿se puede afirmar?"', () => {
    // Un estado sin regla caería a `undefined` y la pantalla no sabría si
    // Likida puede sostener lo que dice la ficha — el default silencioso más
    // caro de este corpus.
    for (const n of NORMAS) {
      expect(PUEDE_AFIRMARSE[n.estado_verificacion], `${n.archivo}: ${n.estado_verificacion}`).toBeDefined();
    }
  });

  it('toda jerarquía que aparece tiene rótulo', () => {
    for (const n of NORMAS) {
      expect(JERARQUIA_ROTULO[n.jerarquia], `${n.archivo}: jerarquía ${n.jerarquia}`).toBeDefined();
    }
  });

  it('los ids no se repiten', () => {
    const ids = NORMAS.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('buscarNormas — recuperación explicable, no "lo más parecido"', () => {
  it('encuentra el estímulo del 50% de peaje por su artículo', () => {
    const r = buscarNormas(NORMAS, '20-A');
    expect(r.length).toBeGreaterThan(0);
    expect(r[0].id).toBe('lif-2026-art-20-A');
  });

  it('lo encuentra también preguntando en palabras', () => {
    const r = buscarNormas(NORMAS, 'estimulo peaje');
    expect(r.map((n) => n.id)).toContain('lif-2026-art-20-A');
  });

  it('ignora los acentos en los dos sentidos', () => {
    expect(buscarNormas(NORMAS, 'estímulo').length).toBeGreaterThan(0);
    expect(buscarNormas(NORMAS, 'estimulo').length).toBeGreaterThan(0);
  });

  it('sin coincidencias devuelve VACÍO — no "lo más parecido"', () => {
    // Es la diferencia con un embedding, que siempre contesta algo. En materia
    // fiscal, contestar algo parecido es peor que no contestar.
    expect(buscarNormas(NORMAS, 'criptomonedas nft')).toEqual([]);
  });

  it('una consulta vacía o de puras letras sueltas no devuelve el corpus entero', () => {
    expect(buscarNormas(NORMAS, '')).toEqual([]);
    expect(buscarNormas(NORMAS, '   ')).toEqual([]);
    expect(buscarNormas(NORMAS, 'a')).toEqual([]);
  });

  it('el artículo pesa más que el título', () => {
    const soloTitulo: Norma = {
      archivo: 'x.yaml', id: 'x', tipo: 'ley', jerarquia: 1,
      instrumento: 'Instrumento X', articulo_o_regla: '999',
      titulo: 'algo sobre el artículo 30 de otra cosa',
      estado_verificacion: 'verificado_fuente_primaria', citasEnCodigo: [],
    };
    const conArticulo: Norma = { ...soloTitulo, id: 'y', archivo: 'y.yaml', articulo_o_regla: '30', titulo: 'otro tema' };
    const r = buscarNormas([soloTitulo, conArticulo], '30');
    expect(r[0].id).toBe('y');
  });

  it('empatados en texto, manda la jerarquía más alta (la ley antes que el criterio)', () => {
    const base = {
      instrumento: 'Mismo', titulo: 'mismo titulo diesel', articulo_o_regla: 'igual',
      estado_verificacion: 'verificado_fuente_primaria', citasEnCodigo: [] as string[],
    };
    const criterio: Norma = { ...base, archivo: 'c.yaml', id: 'c', tipo: 'criterio_no_vinculativo', jerarquia: 5 };
    const ley: Norma = { ...base, archivo: 'l.yaml', id: 'l', tipo: 'ley', jerarquia: 1 };
    expect(buscarNormas([criterio, ley], 'diesel')[0].id).toBe('l');
  });
});

describe('lo que el corpus declara sobre sí mismo', () => {
  it('la política de portales sigue SIN VERIFICAR — vino del blog de un competidor', () => {
    // Si algún día alguien la marca verificada sin entrar a los portales, esta
    // prueba lo obliga a justificarlo cambiándola a mano aquí.
    const p = NORMAS.find((n) => n.id === 'politica-portales-plazos-facturacion');
    expect(p).toBeDefined();
    expect(p!.estado_verificacion).toBe('sin_verificar');
    expect(PUEDE_AFIRMARSE[p!.estado_verificacion].puede).toBe(false);
  });

  it('el estímulo de peaje está verificado contra la fuente primaria', () => {
    const n = NORMAS.find((x) => x.id === 'lif-2026-art-20-A');
    expect(n!.estado_verificacion).toBe('verificado_fuente_primaria');
    expect(n!.fuente_url).toContain('diputados.gob.mx');
  });
});
