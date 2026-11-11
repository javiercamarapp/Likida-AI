// X-02: planificador de la siembra del banco multi-tenant. Sin base de datos: prueba el muestreo de regex, la lectura de CHECK
// (pg_get_constraintdef) y la clasificacion de tablas no sembradas. El SQL que consume los candidatos lo corre el CI.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  BASES_EXPLICITAS,
  clasificarNoSembradas,
  construirCandidatos,
  consultaChecks,
  extraerChecks,
  muestraRegex,
  reporteCobertura,
  sqlBases,
  sqlCandidatos,
  validarNoSembrables,
} from './banco-tenant-siembra.mjs';

const col = (nombre: string, tipo = 'text', extra: Record<string, unknown> = {}) => ({ nombre, tipo, cat: 'S', notnull: true, ...extra });
const cands = (checks: unknown[], tabla: string, columna: string) =>
  construirCandidatos(checks).filter((c: { tabla: string; columna: string }) => c.tabla === tabla && c.columna === columna);

describe('muestra de regex', () => {
  const patrones: [string, boolean?][] = [
    ['^[0-9a-f]{64}$'],
    ['^[1-9][0-9]{7,14}$'],
    ['^[0-9]{10,15}$'],
    ['^sin-tel:[a-z]{20}$'],
    ['^[^\\s@]+@[^\\s@]+\\.[^\\s@]{2,}$'],
    ['^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'],
    ['^[A-ZÑ&0-9]{12,13}$'],
    ['^[A-ZÑ&]{3,4}[0-9]{6}[A-Z0-9]{3}$'],
    ['^https://[^[:space:]]+$'],
    ['^([0-9]{10,15}(,[0-9]{10,15}){0,2})?$'],
    ['^liqext_(ok|no):[0-9a-f-]{36}$'],
    ['^[abcdefghjkmnpqrstvwxyz2-9]{24}$'],
    ['^v1\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+$'],
    ['^https://(maps\\.app\\.goo\\.gl/[^[:space:]]+|(www\\.)?google\\.com/maps([/?#][^[:space:]]*)?)$'],
    ['^(52|521)[0-9]{10}$'],
    ['^[A-Z0-9]{4,40}$', true],
  ];
  it.each(patrones)('produce una cadena que cumple %s', (p) => {
    const a = muestraRegex(p, 0);
    const b = muestraRegex(p, 1);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(new RegExp(p.replace(/\[:space:\]/g, '\\s')).test(a as string)).toBe(true);
    expect(new RegExp(p.replace(/\[:space:\]/g, '\\s')).test(b as string)).toBe(true);
  });

  it('la flota B recibe un valor distinto cuando el patron lo permite (unicos globales como el telefono)', () => {
    expect(muestraRegex('^[0-9]{10,15}$', 0)).not.toBe(muestraRegex('^[0-9]{10,15}$', 1));
    expect(muestraRegex('^[1-9][0-9]{7,14}$', 0)).not.toBe(muestraRegex('^[1-9][0-9]{7,14}$', 1));
  });

  it('un regex fuera del subconjunto devuelve null en vez de inventar', () => {
    expect(muestraRegex('^(?=a)b$')).toBeNull();
    expect(muestraRegex('^[a-z]{3')).toBeNull();
  });
});

describe('candidatos desde los CHECK', () => {
  it('un dominio IN (...) ofrece sus literales, en orden, y luego el valor generico', () => {
    const r = cands(
      [{ tabla: 'public.t', restriccion: 'k', def: "CHECK ((tipo = ANY (ARRAY['preventivo'::text, 'correctivo'::text, 'dvir'::text])))", cols: [col('tipo')] }],
      'public.t',
      'tipo',
    );
    expect(r.map((x: { va: string }) => x.va)).toEqual(['preventivo', 'correctivo', 'dvir', '@V']);
  });

  it('una forma con regex da una muestra valida (telefono de operador con funcion de por medio)', () => {
    const def = "CHECK (((anonimizado_en IS NOT NULL) OR (telefono_normalizado(telefono) ~ '^[0-9]{10,15}$'::text) OR (telefono ~ '^sin-tel:[a-z]{20}$'::text)))";
    const r = cands([{ tabla: 'public.operador', restriccion: 'operador_telefono_forma', def, cols: [col('anonimizado_en', 'timestamptz', { cat: 'D', notnull: false }), col('telefono')] }], 'public.operador', 'telefono');
    expect(r[0].va).toMatch(/^[0-9]{10,15}$/);
    expect(r[0].vb).not.toBe(r[0].va);
    expect(r.map((x: { va: string }) => x.va)).toContain('sin-tel:abcdefghijklmnopqrst');
  });

  it('una coherencia entre columnas ofrece fechas relativas y nulo solo si la columna admite nulo', () => {
    const def = 'CHECK ((expira_en > creada_en))';
    const checks = [{ tabla: 'public.l', restriccion: 'k', def, cols: [col('expira_en', 'timestamptz', { cat: 'D' }), col('creada_en', 'timestamptz', { cat: 'D', notnull: false })] }];
    const exp = cands(checks, 'public.l', 'expira_en').map((x: { va: string }) => x.va);
    const cre = cands(checks, 'public.l', 'creada_en').map((x: { va: string }) => x.va);
    expect(exp).toContain("=now() + interval '1 day'");
    expect(exp).not.toContain('@N');
    expect(cre).toContain('@N');
  });

  it('los literales de otra columna del mismo CHECK no contaminan la columna', () => {
    const def = "CHECK (((tipo = ANY (ARRAY['a'::text, 'b'::text])) AND (estado = ANY (ARRAY['abierta'::text, 'cerrada'::text]))))";
    const checks = [{ tabla: 'public.t', restriccion: 'k', def, cols: [col('tipo'), col('estado')] }];
    expect(cands(checks, 'public.t', 'tipo').map((x: { va: string }) => x.va)).toEqual(['a', 'b', '@V']);
    expect(cands(checks, 'public.t', 'estado').map((x: { va: string }) => x.va)).toEqual(['abierta', 'cerrada', '@V']);
  });

  it('un rango numerico y una longitud de texto producen valores dentro de la cota', () => {
    const checks = [
      { tabla: 'public.g', restriccion: 'r', def: 'CHECK (((radio_m >= 25) AND (radio_m <= 100000)))', cols: [col('radio_m', 'numeric', { cat: 'N' })] },
      { tabla: 'public.m', restriccion: 'l', def: 'CHECK (((char_length(btrim(code_challenge)) >= 43) AND (char_length(code_challenge) <= 128)))', cols: [col('code_challenge')] },
    ];
    expect(cands(checks, 'public.g', 'radio_m')[0].va).toBe('25');
    expect(cands(checks, 'public.m', 'code_challenge')[0].va).toHaveLength(43);
  });

  it('json: arreglo no vacio y objeto con las llaves exigidas', () => {
    const checks = [
      { tabla: 'public.a', restriccion: 'c', def: "CHECK (((jsonb_typeof(conceptos) = 'array'::text) AND ((jsonb_array_length(conceptos) >= 1) AND (jsonb_array_length(conceptos) <= 100))))", cols: [col('conceptos', 'jsonb', { cat: 'U' })] },
      { tabla: 'public.b', restriccion: 'c', def: "CHECK (((jsonb_typeof(columnas) = 'object'::text) AND (columnas ? 'monto'::text) AND (columnas ? 'caseta'::text)))", cols: [col('columnas', 'jsonb', { cat: 'U' })] },
    ];
    expect(cands(checks, 'public.a', 'conceptos')[0].va).toBe('[1]');
    expect(JSON.parse(cands(checks, 'public.b', 'columnas')[0].va)).toEqual({ monto: 1, caseta: 1 });
  });

  it('un CHECK con una columna que revienta el planificador no tumba al resto', () => {
    const r = construirCandidatos([{ tabla: 'public.x', restriccion: 'k', def: 'CHECK (true)', cols: null }, { tabla: 'public.y', restriccion: 'k', def: "CHECK ((e = ANY (ARRAY['a'::text])))", cols: [col('e')] }]);
    expect(r.some((c: { tabla: string }) => c.tabla === 'public.y')).toBe(true);
  });

  it('no genera candidatos para tenant_id', () => {
    expect(cands([{ tabla: 'public.t', restriccion: 'k', def: 'CHECK ((tenant_id IS NOT NULL))', cols: [col('tenant_id', 'uuid')] }], 'public.t', 'tenant_id')).toEqual([]);
  });
});

describe('carga de candidatos y consulta de catalogo', () => {
  it('sqlCandidatos arma un INSERT con dollar-quote y vacio si no hay filas', () => {
    expect(sqlCandidatos([])).toBe('');
    const sql = sqlCandidatos([{ tabla: 'public.t', columna: 'c', ord: 0, va: "o'k", vb: "o'k" }]);
    expect(sql).toMatch(/jsonb_to_recordset\(\$cand\$/);
    expect(sql).toContain("o'k");
  });

  it('rechaza un candidato que rompe el delimitador', () => {
    expect(() => sqlCandidatos([{ tabla: 't', columna: 'c', ord: 0, va: '$cand$', vb: 'x' }])).toThrow(/delimitador/);
  });

  const A_BASES = BASES_EXPLICITAS as Record<string, { a: Record<string, string> }>;

  it('la consulta de catalogo valida los esquemas y la salida se extrae de su linea marcada', () => {
    expect(consultaChecks(['public'])).toMatch(/pg_get_constraintdef/);
    expect(() => consultaChecks(["public'; drop"])).toThrow(/esquema/);
    // El orden de los CHECK decide el de los candidatos: tiene que ser determinista, no el del heap/indice del catalogo.
    expect(consultaChecks(['public'])).toMatch(/order by n\.nspname, c\.relname, k\.oid/);
    expect(A_BASES['public.vigia_mensaje'].a).toEqual({ direccion: 'entrante', autor: 'cliente', estado: 'recibido' });
    expect(extraerChecks('ruido\nBANCO_CHECKS [{"tabla":"public.t"}]\n')).toEqual([{ tabla: 'public.t' }]);
    expect(() => extraerChecks('nada')).toThrow(/BANCO_CHECKS/);
  });
});

describe('tablas no sembrables', () => {
  const lista = { tablas: [{ tabla: 'public.a', motivo: 'Tabla que exige una estructura imposible de generar sin datos reales.' }] };

  it('una no sembrada sin motivo escrito es un fallo; con motivo, justificada; lo sembrado que sigue en la lista sobra', () => {
    const c = { tablas: 10, sembradas: 8, no_sembradas: [{ tabla: 'public.a', error: 'x' }, { tabla: 'public.b', error: '23514: y' }] };
    const r = clasificarNoSembradas(c, lista);
    expect(r.justificadas.map((t: { tabla: string }) => t.tabla)).toEqual(['public.a']);
    expect(r.sinJustificar.map((t: { tabla: string }) => t.tabla)).toEqual(['public.b']);
    expect(clasificarNoSembradas({ tablas: 3, sembradas: 3, no_sembradas: [] }, lista).sobrantes).toEqual(['public.a']);
    expect(reporteCobertura(c, r)).toMatch(/SIN JUSTIFICAR/);
  });

  it('valida nombre, duplicados y motivo', () => {
    expect(validarNoSembrables({ tablas: [{ tabla: 'x', motivo: 'corto' }, { tabla: 'public.a', motivo: 'm'.repeat(30) }, { tabla: 'public.a', motivo: 'm'.repeat(30) }] }).length).toBe(3);
  });

  it('el archivo real es valido', () => {
    const real = JSON.parse(readFileSync('scripts/ci/banco-tenant-no-sembrables.json', 'utf8'));
    expect(validarNoSembrables(real)).toEqual([]);
  });
});

describe('bases explicitas de las 9 tablas con CHECK acoplados (F2)', () => {
  const NUEVE = [
    'public.operador',
    'public.geocerca',
    'public.solicitud_arco',
    'public.api_idempotencia',
    'public.prospecto',
    'public.regla_vigilancia',
    'public.viaje_hito',
    'public.cp_documento',
    'public.liquidacion_entrega_correo',
  ];

  it('cada una tiene base para la flota A y para la B, y ya no figura como no sembrable', () => {
    const real = JSON.parse(readFileSync('scripts/ci/banco-tenant-no-sembrables.json', 'utf8'));
    const aunListadas = real.tablas.map((t: { tabla: string }) => t.tabla);
    for (const t of NUEVE) {
      const b = (BASES_EXPLICITAS as Record<string, { a: object; b: object }>)[t];
      expect(b, t).toBeDefined();
      expect(Object.keys(b.a).length, t).toBeGreaterThan(0);
      expect(Object.keys(b.b), t).toEqual(Object.keys(b.a));
      expect(aunListadas, t).not.toContain(t);
    }
  });

  const A = BASES_EXPLICITAS as Record<string, { a: Record<string, string>; b: Record<string, string> }>;

  it('los valores cumplen las formas de las migraciones (telefono, hex de 64, correo, dominios)', () => {
    for (const lado of ['a', 'b'] as const) {
      expect(A['public.operador'][lado].telefono).toMatch(/^[0-9]{10,15}$/);
      expect(A['public.operador'][lado].telefono).not.toMatch(/^521[0-9]{10}$/);
      expect(A['public.api_idempotencia'][lado].huella).toMatch(/^[0-9a-f]{64}$/);
      expect(A['public.cp_documento'][lado].sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(Number(A['public.cp_documento'][lado].bytes)).toBeGreaterThanOrEqual(1);
      expect(Number(A['public.cp_documento'][lado].bytes)).toBeLessThanOrEqual(12582912);
      expect(A['public.liquidacion_entrega_correo'][lado].correo).toMatch(/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/);
      expect(['origen', 'destino', 'patio', 'punto_interes', 'restringida']).toContain(A['public.geocerca'][lado].tipo);
      expect(Number(A['public.geocerca'][lado].radio_m)).toBeGreaterThanOrEqual(25);
      expect(Number(A['public.geocerca'][lado].radio_m)).toBeLessThanOrEqual(100000);
      expect(['acceso', 'rectificacion', 'cancelacion', 'oposicion']).toContain(A['public.solicitud_arco'][lado].tipo);
      expect(A['public.solicitud_arco'][lado].titular_ref.length).toBeGreaterThan(0);
      expect(A['public.prospecto'][lado].estado).toBe('cerrado');
      expect(A['public.prospecto'][lado].cerrado_en).toMatch(/^=/);
      expect(['llegada_carga', 'salida_carga', 'llegada_descarga', 'salida_descarga', 'regreso']).toContain(A['public.viaje_hito'][lado].tipo);
      expect(['manual', 'correo', 'whatsapp']).toContain(A['public.cp_documento'][lado].canal);
      expect(['operador', 'coordinador', 'rh', 'archivo', 'revisor']).toContain(A['public.liquidacion_entrega_correo'][lado].rol);
    }
  });

  it('donde hay unico global las dos flotas reciben valores distintos', () => {
    expect(A['public.operador'].a.telefono).not.toBe(A['public.operador'].b.telefono);
    expect(A['public.liquidacion_entrega_correo'].a.correo).not.toBe(A['public.liquidacion_entrega_correo'].b.correo);
  });

  it('sqlBases arma el INSERT con una fila por (tabla, lado, columna) y rechaza el delimitador', () => {
    const sql = sqlBases();
    expect(sql).toMatch(/insert into ci_banco\.bases/);
    const filas = Object.values(BASES_EXPLICITAS).reduce((n, b) => n + Object.keys(b.a).length + Object.keys(b.b).length, 0);
    expect(sql.split('"tabla"').length - 1).toBe(filas);
    expect(sqlBases({})).toBe('');
    expect(() => sqlBases({ 'public.t': { a: { c: 'x$base$y' }, b: {} } })).toThrow(/delimitador/);
  });
});
