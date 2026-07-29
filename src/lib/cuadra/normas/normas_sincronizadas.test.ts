import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { NORMAS, IDS_NORMA, esVinculante, type Jerarquia } from './indice';

// ═══════════════════════════════════════════════════════════════════════════
// EL ÍNDICE Y LAS FICHAS NO PUEDEN SEPARARSE.
//
// La fuente de verdad son los YAML de `normas/`: traen el texto vigente
// transcrito y la trazabilidad de verificación. El índice de TS es una copia
// compacta para runtime, y una copia sin verificación es exactamente el patrón
// que ya falló dos veces en este repo con las etiquetas de concepto.
//
// Si alguien añade una ficha, cambia un `estado_verificacion` tras verificarla,
// o corrige una jerarquía, esto falla hasta que el índice lo refleje.
// ═══════════════════════════════════════════════════════════════════════════
const DIR = new URL('../../../../normas/', import.meta.url);

function campo(txt: string, n: string): string | undefined {
  const m = new RegExp(`^${n}:\\s*(.+)$`, 'm').exec(txt);
  const v = m?.[1]?.trim().replace(/^["']|["']$/g, '');
  return v && v !== 'null' ? v : undefined;
}

const archivos = readdirSync(DIR).filter((f) => f.endsWith('.yaml'));
const fichas = archivos.map((f) => {
  const txt = readFileSync(new URL(f, DIR), 'utf8');
  return { archivo: f, txt, id: campo(txt, 'id'), estado: campo(txt, 'estado_verificacion'), jerarquia: campo(txt, 'jerarquia') };
});

describe('índice de normas vs fichas', () => {
  it('hay al menos una ficha por cada entrada del índice', () => {
    const idsFicha = new Set(fichas.map((f) => f.id));
    for (const id of IDS_NORMA) {
      expect(idsFicha.has(id), `el índice tiene "${id}" y no hay ficha con ese id`).toBe(true);
    }
  });

  it('no hay fichas fuera del índice', () => {
    // Una ficha que el código no puede citar es trabajo que no llega a nadie.
    for (const f of fichas) {
      expect(IDS_NORMA, `la ficha ${f.archivo} (id "${f.id}") no está en el índice`).toContain(f.id!);
    }
  });

  it('el estado de verificación coincide, ficha por ficha', () => {
    // Es el campo que decide si el producto puede afirmar algo o tiene que
    // condicionarlo. Desincronizarlo significa afirmar sobre algo sin verificar.
    for (const f of fichas) {
      expect(NORMAS[f.id!].estado, `estado distinto en ${f.archivo}`).toBe(f.estado);
    }
  });

  it('la jerarquía coincide: confundirla es "el error más caro del dominio"', () => {
    for (const f of fichas) {
      expect(NORMAS[f.id!].jerarquia, `jerarquía distinta en ${f.archivo}`).toBe(Number(f.jerarquia));
    }
  });

  it('toda norma tiene al menos una forma de citarse', () => {
    // Sin `citas`, la guardia no puede reconocerla en un texto ni sustituirla.
    for (const id of IDS_NORMA) {
      expect(NORMAS[id].citas.length, `"${id}" no tiene citas_en_codigo`).toBeGreaterThan(0);
    }
  });

  it('las CITAS coinciden con las de la ficha, no solo su cantidad', () => {
    // Este test solo comprobaba que el arreglo no estuviera vacío, y por eso
    // `rlisr-57` pudo estar con `citas_en_codigo: []` en la ficha mientras el
    // índice decía ["RLISR 57"] sin que nada fallara. Las citas SON el patrón
    // con el que la guardia reconoce una norma en un mensaje: si se separan, la
    // guardia le quita al agente una cita legítima o le deja pasar una que no.
    for (const f of fichas) {
      const enFicha = campo(f.txt, 'citas_en_codigo') ?? '[]';
      let lista: string[] = [];
      try { lista = JSON.parse(enFicha.replace(/'/g, '"')); } catch { /* mal formada → [] */ }
      expect(NORMAS[f.id!].citas, `citas distintas en ${f.archivo}`).toEqual(lista);
    }
  });

  it('la ruta de la ficha existe de verdad', () => {
    for (const id of IDS_NORMA) {
      expect(archivos, `${NORMAS[id].ficha} no existe`).toContain(NORMAS[id].ficha.replace('normas/', ''));
    }
  });

  it('la FECHA DE EXIGIBILIDAD del índice es la de la ficha, no la del código', () => {
    // Es el campo que enciende o apaga un veredicto DURO. `config.ts` traía
    // `vigenteDesde: '2026-04-24'` fundado en una cita sin ficha (RMF 2.7.1.8) y
    // el motor tiraba con ella una deducción entera más su IVA acreditable. La
    // única fuente admisible de esa fecha es `fecha_vigencia_desde` de la ficha:
    // si nadie la confirmó, es `null` y el motor no puede afirmar vigencia.
    for (const f of fichas) {
      const enFicha = campo(f.txt, 'fecha_vigencia_desde') ?? null;
      const enIndice = NORMAS[f.id!].exigibleDesde ?? null;
      expect(enIndice, `fecha_vigencia_desde distinta en ${f.archivo}`).toBe(enFicha);
    }
  });
});

describe('esVinculante', () => {
  it('ley, reglamento, regla general y anexo obligan', () => {
    for (const j of [1, 2, 3, 4] as Jerarquia[]) expect(esVinculante(j)).toBe(true);
  });

  it('un criterio NO vinculativo y la política de un tercero NO obligan', () => {
    // Presentar el plazo de facturación de una gasolinera como obligación fiscal
    // es el error de nivel 6 que el README señala explícitamente.
    for (const j of [5, 6] as Jerarquia[]) expect(esVinculante(j)).toBe(false);
  });
});
