import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  PLANTILLAS_ID, PLANTILLAS, CATALOGO, CONCEPTOS_VIGILABLES, DOCUMENTOS_VIGILABLES,
  plantillasPara, esPlantilla, validarParams, fraseDe, loQueSiSeVigila,
  type PlantillaId,
} from './catalogo';

// ═══════════════════════════════════════════════════════════════════════════
// A19 — EL CATÁLOGO CERRADO. Lo que estas pruebas fijan:
//
//   1. CERRADO DE VERDAD, en los cuatro sitios donde la lista existe: el
//      catálogo de TS, el `switch` de los lectores, el CHECK de la migración
//      y el bloque de verificaciones. Si divergen, se puede guardar una regla
//      que nadie sabe correr — o al revés, una plantilla que la base rechaza.
//   2. Los parámetros tienen DOMINIO y RANGO: un tope de siete cifras o unos
//      "días" negativos no son una regla, son una regla muerta que el dueño
//      va a creer viva.
//   3. La frase que la persona confirma la arma el CATÁLOGO, con los números
//      que ella dio — no un modelo.
// ═══════════════════════════════════════════════════════════════════════════

const SQL = readFileSync('supabase/migrations/0229_reglas_naturales.sql', 'utf8');
const LECTORES = readFileSync('src/lib/likida/reglas/lectores.ts', 'utf8');

describe('el catálogo es el mismo en TS, en el lector y en la base', () => {
  it('cada plantilla del catálogo tiene ficha completa', () => {
    for (const id of PLANTILLAS_ID) {
      const p = CATALOGO[id];
      expect(p.id, id).toBe(id);
      expect(p.titulo.length, id).toBeGreaterThan(10);
      expect(p.queVigila.length, id).toBeGreaterThan(30);
      expect(p.ejemplos.length, id).toBeGreaterThan(0);
      // Sin ejemplo no hay prompt que alimentar ni chip que enseñar.
      for (const e of p.ejemplos) expect(e.length, `${id}:${e}`).toBeGreaterThan(15);
    }
  });

  it('el CHECK de la 0229 enumera EXACTAMENTE las mismas plantillas', () => {
    const bloque = SQL.match(/regla_vigilancia_plantilla_dominio check \(plantilla in \(([\s\S]*?)\)\)/);
    expect(bloque, 'el CHECK del dominio tiene que existir en la migración').toBeTruthy();
    const enSql = [...bloque![1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
    expect(enSql).toEqual([...PLANTILLAS_ID].sort());
  });

  it('el despachador de lectores tiene una rama por plantilla — ninguna sin motor', () => {
    for (const id of PLANTILLAS_ID) {
      expect(LECTORES, `${id} no tiene case en evaluar()`).toContain(`case '${id}':`);
    }
  });

  it('el dominio de objetos vigilados de la base cubre los del catálogo', () => {
    const bloque = SQL.match(/regla_disparo_objeto_dominio check \(objeto in \(([\s\S]*?)\)\)/);
    const enSql = new Set([...bloque![1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]));
    for (const p of PLANTILLAS) expect(enSql.has(p.objeto), `${p.id} → ${p.objeto}`).toBe(true);
  });

  it('esPlantilla rechaza lo que no está en la lista', () => {
    expect(esPlantilla('gasto_de_concepto_mayor_a')).toBe(true);
    expect(esPlantilla('avisame_de_todo')).toBe(false);
    expect(esPlantilla(null)).toBe(false);
    expect(esPlantilla(42)).toBe(false);
  });
});

describe('quién puede declarar qué', () => {
  it('el costo de IA es de la PLATAFORMA: el dueño de la flota ni lo ve', () => {
    const dueño = plantillasPara('flota_admin').map((p) => p.id);
    expect(dueño).not.toContain('costo_ia_dia_mayor_a');
    expect(plantillasPara('contador').map((p) => p.id)).not.toContain('costo_ia_dia_mayor_a');
    expect(plantillasPara('superadmin').map((p) => p.id)).toContain('costo_ia_dia_mayor_a');
  });

  it('la lista de "esto sí sé vigilar" trae un ejemplo por plantilla y respeta el rol', () => {
    const dueño = loQueSiSeVigila('flota_admin');
    expect(dueño).toHaveLength(PLANTILLAS_ID.length - 1);
    expect(dueño.join('\n')).toContain('avísame si un gasto de caseta pasa de $3,000');
    expect(loQueSiSeVigila('superadmin')).toHaveLength(PLANTILLAS_ID.length);
  });
});

describe('validarParams — el dominio y el rango, no solo el tipo', () => {
  it('acepta lo que la persona de verdad escribiría', () => {
    expect(validarParams('gasto_de_concepto_mayor_a', { concepto: 'caseta', monto: 3000 }))
      .toEqual({ ok: true, params: { concepto: 'caseta', monto: 3000 } });
    expect(validarParams('chofer_con_viajes_sin_liquidar', { n: 2 }).ok).toBe(true);
    expect(validarParams('estadia_mayor_a', { horas: 4.5 }).ok).toBe(true);
  });

  it('un concepto fuera del catálogo de gasto rebota', () => {
    const r = validarParams('gasto_de_concepto_mayor_a', { concepto: 'mordidas', monto: 100 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('concepto');
  });

  it('un tope de siete cifras rebota: un cero de más es una regla que no dispara nunca', () => {
    expect(validarParams('gasto_de_concepto_mayor_a', { concepto: 'diesel', monto: 3_000_000 }).ok).toBe(false);
    expect(validarParams('gasto_de_concepto_mayor_a', { concepto: 'diesel', monto: 15_000 }).ok).toBe(true);
  });

  it('cero y negativos no son reglas', () => {
    expect(validarParams('gasto_sin_cfdi_mayor_a', { monto: 0 }).ok).toBe(false);
    expect(validarParams('factura_sin_cobrar_mas_de', { dias: -30 }).ok).toBe(false);
    expect(validarParams('incidencia_abierta_mas_de', { horas: 0 }).ok).toBe(false);
  });

  it('"un chofer con 1 viaje sin liquidar" no es una alerta: el mínimo es 2', () => {
    expect(validarParams('chofer_con_viajes_sin_liquidar', { n: 1 }).ok).toBe(false);
    expect(validarParams('chofer_con_viajes_sin_liquidar', { n: 2 }).ok).toBe(true);
    // Y tampoco fracciones de viaje.
    expect(validarParams('chofer_con_viajes_sin_liquidar', { n: 2.5 }).ok).toBe(false);
  });

  it('un parámetro de más no cuela y uno de menos rebota', () => {
    expect(validarParams('estadia_mayor_a', {}).ok).toBe(false);
    // zod ignora los extras por defecto: lo que importa es que el guardado
    // sea el objeto validado, no el crudo.
    const r = validarParams('estadia_mayor_a', { horas: 6, monto: 999 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.params).toEqual({ horas: 6 });
  });

  it('null y undefined no son valores válidos de ningún parámetro', () => {
    expect(validarParams('gasto_sin_cfdi_mayor_a', { monto: null }).ok).toBe(false);
    expect(validarParams('gasto_sin_cfdi_mayor_a', null).ok).toBe(false);
    expect(validarParams('documento_por_vencer', { documento: 'poliza', dias: undefined }).ok).toBe(false);
  });

  it('los dominios cerrados son los del producto, no una lista suelta', () => {
    for (const c of CONCEPTOS_VIGILABLES) {
      expect(validarParams('gasto_de_concepto_mayor_a', { concepto: c, monto: 10 }).ok, c).toBe(true);
    }
    for (const d of DOCUMENTOS_VIGILABLES) {
      expect(validarParams('documento_por_vencer', { documento: d, dias: 30 }).ok, d).toBe(true);
    }
    // La licencia es de OPERADOR: no aplica al despacho de una unidad.
    expect(validarParams('unidad_sin_papel_vigente_al_despachar', { documento: 'licencia' }).ok).toBe(false);
  });
});

describe('la frase que la persona confirma', () => {
  it('trae el número que ella dio, formateado por el motor de cifras', () => {
    expect(fraseDe('gasto_de_concepto_mayor_a', { concepto: 'caseta', monto: 3000 }))
      .toBe('Voy a avisarte cuando entre un comprobante de casetas por más de $3,000.00.');
  });

  it('no dice "1 días" ni "1 horas" — un rótulo torpe se lee como máquina', () => {
    expect(fraseDe('factura_sin_cobrar_mas_de', { dias: 1 })).toContain('1 día ');
    expect(fraseDe('factura_sin_cobrar_mas_de', { dias: 30 })).toContain('30 días');
    expect(fraseDe('incidencia_abierta_mas_de', { horas: 1 })).toContain('1 hora ');
    expect(fraseDe('incidencia_abierta_mas_de', { horas: 12 })).toContain('12 horas');
  });

  it('la de la póliza DICE que un papel sin capturar también avisa', () => {
    // Es la promesa de `null ≠ 0` hecha texto: si la frase no lo dijera, el
    // primer aviso por una unidad sin captura se leería como un falso
    // positivo y alguien pausaría la regla.
    const f = fraseDe('unidad_sin_papel_vigente_al_despachar', { documento: 'poliza' });
    expect(f).toContain('póliza');
    expect(f).toMatch(/sin fecha capturada/i);
  });

  it('toda plantilla arma una frase que empieza con la promesa y termina en punto', () => {
    const muestra: Record<PlantillaId, unknown> = {
      unidad_sin_papel_vigente_al_despachar: { documento: 'verificacion' },
      gasto_de_concepto_mayor_a: { concepto: 'diesel', monto: 15000 },
      gasto_sin_cfdi_mayor_a: { monto: 2000 },
      chofer_con_viajes_sin_liquidar: { n: 3 },
      documento_por_vencer: { documento: 'licencia', dias: 45 },
      factura_sin_cobrar_mas_de: { dias: 30 },
      estadia_mayor_a: { horas: 4 },
      incidencia_abierta_mas_de: { horas: 12 },
      viaje_abierto_sin_comprobantes_mas_de: { dias: 5 },
      costo_ia_dia_mayor_a: { usd: 5 },
    };
    for (const id of PLANTILLAS_ID) {
      const v = validarParams(id, muestra[id]);
      expect(v.ok, id).toBe(true);
      if (!v.ok) continue;
      const frase = fraseDe(id, v.params);
      expect(frase, id).toMatch(/^Voy a avisarte cuando /);
      expect(frase.endsWith('.'), `${id}: «${frase}»`).toBe(true);
      // El CHECK `regla_vigilancia_texto_acotado` corta en 400.
      expect(frase.length, id).toBeLessThanOrEqual(400);
    }
  });
});
