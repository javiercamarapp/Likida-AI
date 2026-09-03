import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { calificar, extraerBloques, extraerMensaje, esRaiseDelPropioBloque } from './calificar-verificacion.mjs';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 24 · PRU-1 (CRÍTICO) — la batería SQL imprimía la fuga y contestaba
// «La batería pasó».
//
// El runner solo califica cuando el número de claves del `raise` coincide con
// el de valores del `(esperado …)`; 19 bloques con veredicto en prosa caían en
// una lista de «conocidos» que en la práctica los apagaba. La mutación de la
// auditoría —`alter policy tenant_finanzas on tarifa` para que el encargado
// vea precios— salía como `FINANZAS_RLS clientes=0 tarifas=1 …` ▲ SIN
// CALIFICAR, exit 0. Esta prueba alimenta ESA salida al calificador y exige
// `falla`; y recorre los 19 `raise` reescritos en `verificaciones.sql` para
// que, sustituyendo cada `%` por un valor, ninguno vuelva a caer en
// `sin_calificar`. Que el runner haga `exit 1` con cualquier `sin_calificar`
// se fija leyendo su fuente: la lista de excepciones ya no existe.
// ═══════════════════════════════════════════════════════════════════════════

const stderrDe = (mensaje: string) =>
  `psql:<stdin>:1: ERROR:  ${mensaje}\nCONTEXT:  PL/pgSQL function inline_code_block line 40 at RAISE\n`;

describe('PRU-1: la fuga de FINANZAS_RLS reprueba, no queda «sin calificar»', () => {
  it('tarifas=1 contra esperado 0 es FALLA con la clave señalada', () => {
    const msg = 'FINANZAS_RLS  clientes=0  tarifas=1  facturas=0  pagos=0  cotizaciones=0  factura_viaje=0   (esperado 0 / 0 / 0 / 0 / 0 / 0 — cualquier otra cosa le abre precios y saldos al encargado)';
    const r = calificar(msg);
    expect(r.tipo).toBe('falla');
    expect(r.falla?.map((f: { clave: string }) => f.clave)).toEqual(['tarifas']);
  });

  it('las seis en cero pasan', () => {
    const msg = 'FINANZAS_RLS  clientes=0  tarifas=0  facturas=0  pagos=0  cotizaciones=0  factura_viaje=0   (esperado 0 / 0 / 0 / 0 / 0 / 0 — cualquier otra cosa le abre precios y saldos al encargado)';
    expect(calificar(msg).tipo).toBe('ok');
  });

  it('un bloque con esperado en prosa («4x true») ya no existe: la prosa cae en sin_calificar, y eso es falla en el runner', () => {
    const r = calificar('FALTA_PARA_OPERAR  rechaza-contrasena=t  rls=t  sin-politicas=t  cola-usa-indice=t   (esperado 4x true)');
    expect(r.tipo).toBe('sin_calificar');
    expect(calificar('FALTA_PARA_OPERAR  rechaza-contrasena=t  rls=t  sin-politicas=t  cola-usa-indice=f   (esperado t / t / t / t)').tipo).toBe('falla');
  });

  it('INDICES_PAGINACION e INDICE_FACTURACION son REPORTES declarados: sin (esperado), listados aparte, nunca «ok»', () => {
    const r = calificar('INDICES_PAGINACION  [reporte: depende del volumen y del planeador — ver nota]  usados=2  total=9  fallos=· gasto/id NO usa gasto_paginacion_idx -> Limit (cost=1..2 rows=1000 width=16)');
    expect(r.tipo).toBe('reporte');
  });

  it('el mensaje de psql se extrae y se distingue del error genuino de Postgres', () => {
    expect(esRaiseDelPropioBloque(stderrDe('X a=1 (esperado 1)'))).toBe(true);
    expect(esRaiseDelPropioBloque('ERROR:  relation "x" does not exist\nCONTEXT:  PL/pgSQL function inline_code_block line 3 at SQL statement')).toBe(false);
    expect(extraerMensaje(stderrDe('X a=1 (esperado 1)'))).toBe('X a=1 (esperado 1)');
  });
});

describe('PRU-1: los 19 `raise` reescritos se alinean clave por clave', () => {
  const NOMBRES = [
    'CLAIM ', 'FINANZAS_RLS', 'INDICE_FACTURACION', 'INDICES_PAGINACION', 'RESUMEN_COSTO_IA',
    'FALTA_PARA_OPERAR', 'RESUMEN_POR_TENANT', '45 ', '48 ', '49 ', '50 ', '52 ', 'RETENCION_0104',
    'DESGLOSE_0106', 'REGISTRO_0154', 'FISCAL_AGREGADO_0151', 'AGREGADOS_0150', 'PURGAS_0155',
    'RPCS_0159', 'STRIPE_0163',
  ];
  const sql = readFileSync('supabase/verificaciones.sql', 'utf8');
  const bloques = extraerBloques(sql, 'verificaciones.sql');

  /** El texto del `raise exception E'…'` final de un bloque, con cada `%` sustituido. */
  function mensajeSimulado(bloqueSql: string, valor: string): string | null {
    const m = /raise exception E'((?:[^'\\]|\\.)*)'/g;
    let ultimo: string | null = null;
    let x: RegExpExecArray | null;
    while ((x = m.exec(bloqueSql))) ultimo = x[1];
    if (ultimo === null) return null;
    return ultimo.replace(/\\n/g, ' ').replace(/%/g, valor).replace(/\s+/g, ' ').trim();
  }

  for (const nombre of NOMBRES) {
    it(`${nombre.trim()}: mismas claves que esperados`, () => {
      const bloque = bloques.find((b) => {
        const msg = mensajeSimulado(b.sql, 't');
        return msg !== null && msg.startsWith(nombre);
      });
      expect(bloque, `no encontré el bloque ${nombre}`).toBeDefined();
      const r = calificar(mensajeSimulado(bloque!.sql, 't')!);
      expect(r.tipo, `${nombre}: ${JSON.stringify(r)}`).not.toBe('sin_calificar');
      // Los dos bloques de planeador se declaran reporte a propósito (ver su
      // nota en verificaciones.sql); los otros 17 son aserciones.
      if (nombre === 'INDICE_FACTURACION' || nombre === 'INDICES_PAGINACION') expect(r.tipo).toBe('reporte');
      else expect(r.tipo).not.toBe('reporte');
    });
  }

  it('el runner ya no tiene lista de «sin calificar conocidos»: cualquiera es falla', () => {
    const runner = readFileSync('scripts/ci/correr-verificaciones.mjs', 'utf8');
    expect(runner).not.toMatch(/const SIN_CALIFICAR_CONOCIDOS\s*=/);
    expect(runner).toMatch(/if \(sinCalificar > 0\) \{[\s\S]*?process\.exit\(1\)/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 25 · PRU-ALTO1 — el bloque 50 traía CUATRO grupos `(esperado …)`
// intercalados (el único de los 226 con más de uno): `partirEnClavesYEsperado`
// solo lee el PRIMER `(esperado`, así que las tres mediciones restantes caían
// dentro del "valor esperado" del primer grupo como un solo string con
// espacios → comodín de prosa → `ok: true` incondicional. Medido contra
// Postgres 16 real: con las CUATRO mediciones rotas (`quedan=999`, las dos
// constraints desvalidadas, la falsificación sin FK que no reprodujo la fuga)
// el bloque calificaba `✓ ok`.
//
// El arreglo está en `verificaciones.sql`, no aquí: el `raise` se reescribió
// a la forma de los otros 17 bloques con FALSIFICACIÓN (un solo `(esperado
// …)` al final, cada valor real en su propio `%`). Esta prueba fija esa
// forma leyendo el bloque real del archivo y calificándolo con los valores
// medidos — sanos y rotos — para que una futura reescritura no reintroduzca
// el grupo múltiple.
// ═══════════════════════════════════════════════════════════════════════════
describe('PRU-ALTO1: el bloque 50 (candado del viaje) reprueba con sus valores medidos mal', () => {
  const sql = readFileSync('supabase/verificaciones.sql', 'utf8');
  const bloque50 = extraerBloques(sql, 'verificaciones.sql').find((b) => /raise exception E'50 /.test(b.sql));

  it('el bloque existe y trae un solo grupo `(esperado …)`', () => {
    expect(bloque50, 'no encontré el bloque 50').toBeDefined();
    const m = bloque50!.sql.match(/\(esperado/g) ?? [];
    expect(m.length, 'volvió a tener más de un grupo (esperado …)').toBe(1);
  });

  /** Sustituye los `%` del `raise` del bloque 50 en orden, como psql. */
  function mensajeBloque50(valores: string[]): string {
    const m = /raise exception E'((?:[^'\\]|\\.)*)'/.exec(bloque50!.sql);
    if (!m) throw new Error('bloque 50 sin raise');
    let i = 0;
    return m[1].replace(/\\n/g, ' ').replace(/%/g, () => valores[i++]).replace(/\s+/g, ' ').trim();
  }

  it('sano (candado borrado con su viaje, las dos constraints validadas): ok', () => {
    const r = calificar(mensajeBloque50(['0', 't', 't', '1', 'f']));
    expect(r.tipo).toBe('ok');
  });

  it('roto — los valores medidos de la auditoría 25 (candado huérfano sobrevive, constraints sin validar): falla, con las tres claves reales señaladas', () => {
    const r = calificar(mensajeBloque50(['999', 'f', 'f', '0', 't']));
    expect(r.tipo).toBe('falla');
    expect(r.falla?.map((f: { clave: string }) => f.clave).sort()).toEqual(
      ['candado-borrado-con-el-viaje', 'viaje_ingreso_no_negativo', 'viaje_km_sanos'].sort(),
    );
  });
});
