// ═══════════════════════════════════════════════════════════════════════════
// BANCO MULTI-TENANT (X-02): planificador de la siembra.
//
// La siembra generica (supabase/tests/banco_tenant/00_prologo.sql) llena las columnas NOT NULL con un valor por tipo, y eso no
// cumple los CHECK de las tablas (dominios de texto, formas con regex, rangos, coherencias entre columnas). Aqui se leen los CHECK
// reales del catalogo (pg_get_constraintdef) y se arma, por tabla y columna, una lista ORDENADA de valores candidatos que los
// cumplen: literales de los IN (...), muestras generadas desde el regex, numeros de las comparaciones, fechas relativas, etc.
// El SQL (`ci_banco.sembrar_buscando`) prueba combinaciones de esas listas, dentro de una subtransaccion por intento, hasta que
// una tabla se siembra. Nada de esto se ejecuta contra Postgres en la Mac: la logica pura se prueba en banco_tenant_siembra.test.ts.
//
// Convencion de los valores (texto): '@N' = NULL; '@V' = el valor generico por tipo de la siembra; '=<sql>' = expresion SQL cruda
// (solo la generamos nosotros: now(), fechas relativas); cualquier otro texto = literal. `va`/`vb` son el valor de la flota A y de
// la B (distintos solo cuando el patron lo permite, para no chocar con unicos globales como el telefono).
// ═══════════════════════════════════════════════════════════════════════════

const POOL_NEGADA = 'abcdefghijklmnopqrstuvwxyz0123456789';

const rango = (a, b) => {
  const r = [];
  for (let c = a.codePointAt(0); c <= b.codePointAt(0); c++) r.push(String.fromCodePoint(c));
  return r;
};
const POSIX = {
  space: [' ', '\t'],
  digit: rango('0', '9'),
  alpha: [...rango('a', 'z'), ...rango('A', 'Z')],
  alnum: [...rango('0', '9'), ...rango('a', 'z'), ...rango('A', 'Z')],
  upper: rango('A', 'Z'),
  lower: rango('a', 'z'),
  cntrl: ['\u0001'],
  punct: ['.', ',', '-'],
};
const ESCAPE_CLASE = {
  d: POSIX.digit,
  s: [' ', '\t'],
  w: [...rango('a', 'z'), ...rango('A', 'Z'), ...rango('0', '9'), '_'],
};

// ── Muestra de un regex (subconjunto de ARE de Postgres que usan los CHECK de este repo) ─────────────────────────────────
function parsearRegex(pat) {
  let i = 0;
  const falla = (m) => {
    throw new Error(`regex no soportado (${m}): ${pat}`);
  };

  function clase() {
    i++; // [
    let neg = false;
    if (pat[i] === '^') {
      neg = true;
      i++;
    }
    const set = [];
    let primero = true;
    while (i < pat.length && (pat[i] !== ']' || primero)) {
      primero = false;
      if (pat[i] === '[' && pat[i + 1] === ':') {
        const fin = pat.indexOf(':]', i);
        if (fin < 0) falla('posix');
        const nombre = pat.slice(i + 2, fin);
        if (!POSIX[nombre]) falla(`posix ${nombre}`);
        set.push(...POSIX[nombre]);
        i = fin + 2;
        continue;
      }
      let c = pat[i++];
      if (c === '\\') {
        const e = pat[i++];
        if (ESCAPE_CLASE[e]) {
          set.push(...ESCAPE_CLASE[e]);
          continue;
        }
        c = e;
      }
      if (pat[i] === '-' && pat[i + 1] !== ']' && i + 1 < pat.length) {
        let hasta = pat[i + 1];
        i += 2;
        if (hasta === '\\') hasta = pat[i++];
        set.push(...rango(c, hasta));
      } else set.push(c);
    }
    if (pat[i] !== ']') falla('clase sin cerrar');
    i++;
    if (neg) {
      const excl = new Set(set);
      const chars = [...POOL_NEGADA].filter((c) => !excl.has(c));
      if (!chars.length) falla('clase negada vacia');
      return { t: 'clase', chars };
    }
    if (!set.length) falla('clase vacia');
    return { t: 'clase', chars: set };
  }

  function atomo() {
    const c = pat[i];
    if (c === '^' || c === '$') {
      i++;
      return null;
    }
    if (c === '(') {
      i++;
      if (pat[i] === '?') {
        if (pat.startsWith('?:', i)) i += 2;
        else falla('grupo especial');
      }
      const g = alternativa();
      if (pat[i] !== ')') falla('grupo sin cerrar');
      i++;
      return { t: 'grupo', g };
    }
    if (c === '[') return clase();
    if (c === '.') {
      i++;
      return { t: 'clase', chars: ['a'] };
    }
    if (c === '\\') {
      i++;
      const e = pat[i++];
      if (ESCAPE_CLASE[e]) return { t: 'clase', chars: ESCAPE_CLASE[e] };
      if (e === 'D' || e === 'S' || e === 'W') return { t: 'clase', chars: ['a'] };
      return { t: 'lit', c: e };
    }
    if (c === '*' || c === '+' || c === '?' || c === '{') falla('cuantificador suelto');
    i++;
    return { t: 'lit', c };
  }

  function cuantificar(a) {
    const c = pat[i];
    let min = 1;
    let max = 1;
    if (c === '?') {
      min = 0;
      max = 1;
      i++;
    } else if (c === '*') {
      min = 0;
      max = Infinity;
      i++;
    } else if (c === '+') {
      min = 1;
      max = Infinity;
      i++;
    } else if (c === '{') {
      const fin = pat.indexOf('}', i);
      if (fin < 0) falla('llave sin cerrar');
      const m = /^(\d+)(?:(,)(\d*))?$/.exec(pat.slice(i + 1, fin));
      if (!m) falla('cuantificador');
      min = Number(m[1]);
      max = m[2] ? (m[3] === '' ? Infinity : Number(m[3])) : min;
      i = fin + 1;
    } else return { ...a, reps: 1 };
    if (pat[i] === '?') i++; // perezoso
    // Prefiere presente: una repeticion cuando el minimo es 0 (si cabe), el minimo en otro caso.
    return { ...a, reps: min === 0 ? Math.min(1, max) : min };
  }

  function secuencia() {
    const items = [];
    while (i < pat.length && pat[i] !== '|' && pat[i] !== ')') {
      const a = atomo();
      if (a) items.push(cuantificar(a));
    }
    return items;
  }

  function alternativa() {
    const ramas = [secuencia()];
    while (pat[i] === '|') {
      i++;
      ramas.push(secuencia());
    }
    return ramas;
  }

  const ramas = alternativa();
  if (i < pat.length) falla('sobran caracteres');
  return ramas;
}

function generar(ramas, v, ctx) {
  let out = '';
  for (const a of ramas[0]) {
    for (let k = 0; k < a.reps; k++) {
      if (a.t === 'lit') out += a.c;
      else if (a.t === 'clase') out += a.chars[(v + ctx.n++) % a.chars.length];
      else out += generar(a.g, v, ctx);
    }
  }
  return out;
}

// POSIX -> JS para poder verificar la muestra con RegExp (solo comprobacion; si no compila, se acepta la muestra).
function aJs(pat) {
  return pat
    .replace(/\[:space:\]/g, '\\s')
    .replace(/\[:digit:\]/g, '0-9')
    .replace(/\[:alnum:\]/g, 'A-Za-z0-9')
    .replace(/\[:cntrl:\]/g, '\\x00-\\x1f');
}

/** Cadena que cumple `patron` (null si el regex esta fuera del subconjunto o la muestra no lo cumple). `v` desplaza la
 *  eleccion dentro de cada clase para tener un segundo valor distinto (flota B) cuando haya unicos globales. */
export function muestraRegex(patron, v = 0, insensible = false) {
  let s;
  try {
    s = generar(parsearRegex(patron), v, { n: 0 });
  } catch {
    return null;
  }
  try {
    if (!new RegExp(aJs(patron), insensible ? 'i' : '').test(s)) return null;
  } catch {
    /* no compila en JS: se acepta */
  }
  return s;
}

// ── Lectura de un CHECK ─────────────────────────────────────────────────────────────────────────────────────────────────
function literales(texto) {
  const r = [];
  const re = /'((?:[^']|'')*)'/g;
  let m;
  while ((m = re.exec(texto))) r.push({ valor: m[1].replace(/''/g, "'"), ini: m.index, fin: m.index + m[0].length });
  return r;
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Trozos del CHECK que "hablan" de `col`: desde cada mencion hasta la siguiente mencion de OTRA columna. */
function segmentos(def, cols, col) {
  const menciones = [];
  for (const c of cols) {
    const re = new RegExp(`(?<![\\w."])"?${esc(c)}"?(?![\\w"])`, 'g');
    let m;
    while ((m = re.exec(def))) menciones.push({ pos: m.index, col: c });
  }
  menciones.sort((a, b) => a.pos - b.pos);
  const out = [];
  menciones.forEach((m, k) => {
    if (m.col !== col) return;
    let fin = def.length;
    for (let j = k + 1; j < menciones.length; j++) {
      if (menciones[j].col !== col) {
        fin = menciones[j].pos;
        break;
      }
    }
    out.push(def.slice(m.pos, fin));
  });
  return out;
}

const ES_TEXTO = (c) => ['text', 'varchar', 'bpchar', 'citext', 'name'].includes(c.tipo);

function candidatosDeColumna(col, defs, todasLasCols) {
  const va = []; // [{a, b}]
  const poner = (a, b = a) => {
    if (!va.some((x) => x.a === a)) va.push({ a, b });
  };
  const esNum = col.cat === 'N';
  const esFecha = col.cat === 'D';
  const esJson = col.tipo === 'jsonb' || col.tipo === 'json';
  const esArreglo = col.cat === 'A';

  for (const def of defs) {
    for (const seg of segmentos(def.def, todasLasCols, col.nombre)) {
      // 1) regex (~ / ~*): muestras para A y B
      const lits = literales(seg);
      const reRe = /(?<![!])~(\*?)\s*'((?:[^']|'')*)'/g;
      let m;
      while ((m = reRe.exec(seg))) {
        const patron = m[2].replace(/''/g, "'");
        const a = muestraRegex(patron, 0, m[1] === '*');
        const b = muestraRegex(patron, 1, m[1] === '*');
        if (a != null) poner(a, b ?? a);
      }
      const regexIni = new Set();
      const reIni = /(?<![!])~\*?\s*(')/g;
      while ((m = reIni.exec(seg))) regexIni.add(m.index + m[0].length - 1);

      // 2) longitud: char_length(col) / length(col) con cotas
      if (ES_TEXTO(col)) {
        // El segmento arranca en la mencion de la columna: el prefijo char_length(/btrim( ya quedo fuera, asi que se exige solo
        // `col ... ) >= n` (la columna cerrando una o mas funciones).
        const reLen = new RegExp(`^"?${esc(col.nombre)}"?[^)]*\\)+\\s*(>=|>|<=|<|=)\\s*(\\d+)`, 'g');
        for (const parte of seg.split(/\bAND\b|\bOR\b/i)) {
          reLen.lastIndex = 0;
          m = reLen.exec(parte.replace(/^[\s(]+/, ''));
          if (!m) continue;
          const n = Number(m[2]);
          const len = m[1] === '>' ? n + 1 : m[1] === '<' ? Math.max(1, n - 1) : Math.max(1, n);
          poner('x'.repeat(Math.min(len, 400)));
        }
      }

      // 3) literales que el CHECK compara con la columna
      if (!esJson && !esArreglo && col.tipo !== 'bool') {
        for (const l of lits) {
          if (regexIni.has(l.ini)) continue;
          if (esNum && !/^-?\d+(\.\d+)?$/.test(l.valor)) continue;
          if (esFecha && !/^\d{4}-\d{2}-\d{2}/.test(l.valor)) continue;
          if (col.tipo === 'uuid' && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(l.valor)) continue;
          poner(l.valor);
        }
      }

      // 4) numeros de las comparaciones
      if (esNum) {
        const reNum = /(>=|<=|<>|>|<|=)\s*\(?\s*(-?\d+(?:\.\d+)?)/g;
        while ((m = reNum.exec(seg))) {
          const n = Number(m[2]);
          if (m[1] === '<>') continue;
          const x = m[1] === '>' ? n + 1 : m[1] === '<' ? n - 1 : n;
          poner(String(x));
        }
      }

      // 5) json: tipo y llaves
      if (esJson) {
        const llaves = [];
        const reLl = /\?\s*'((?:[^']|'')*)'/g;
        while ((m = reLl.exec(seg))) llaves.push(m[1]);
        if (llaves.length) poner(JSON.stringify(Object.fromEntries(llaves.map((k) => [k, 1]))));
        if (/jsonb?_typeof\([^)]*\)\s*=\s*'array'/.test(seg) || /jsonb_array_length/.test(seg)) poner('[1]');
        if (/jsonb?_typeof\([^)]*\)\s*=\s*'object'/.test(seg)) poner('{"a":1}');
      }
    }
  }

  // Valores por tipo (despues de los que salen del CHECK).
  if (col.tipo === 'bool') {
    poner('true');
    poner('false');
  } else if (col.tipo === 'timestamptz' || col.tipo === 'timestamp') {
    poner('=now()');
    poner("=now() + interval '1 day'");
    poner("=now() - interval '1 day'");
  } else if (col.tipo === 'date') {
    poner("=date_trunc('month', current_date)::date");
    poner('=current_date');
    poner('=current_date + 1');
    poner('=current_date - 1');
  } else if (esJson) {
    poner('{}');
    poner('[1]');
    poner('{"a":1}');
  } else if (esArreglo) {
    const el = col.elem ?? '';
    if (['int2', 'int4', 'int8', 'numeric', 'float4', 'float8'].includes(el)) poner('{1}');
    else if (el === 'uuid') poner('{00000000-0000-4000-8000-000000000001}');
    else poner('{x}');
    poner('{}');
  } else if (esNum) {
    poner('1');
    poner('0');
    poner('10');
  }
  poner('@V');
  if (!col.notnull) poner('@N');
  return va.slice(0, 10);
}

/** checks: filas de CONSULTA_CHECKS. Devuelve [{tabla, columna, ord, va, vb}]. Una tabla con un CHECK que no se pudo leer se
 *  omite (queda con la siembra generica y, si falla, en no_sembradas): nunca se finge cobertura. */
export function construirCandidatos(checks) {
  const porTabla = new Map();
  for (const c of checks) {
    if (!porTabla.has(c.tabla)) porTabla.set(c.tabla, []);
    porTabla.get(c.tabla).push(c);
  }
  const filas = [];
  for (const [tabla, defs] of porTabla) {
    try {
      const cols = new Map();
      for (const d of defs) for (const c of d.cols ?? []) cols.set(c.nombre, c);
      for (const col of cols.values()) {
        if (col.nombre === 'tenant_id') continue;
        const delCheck = defs.filter((d) => (d.cols ?? []).some((c) => c.nombre === col.nombre));
        const todas = [...new Set(delCheck.flatMap((d) => d.cols.map((c) => c.nombre)))];
        const cands = candidatosDeColumna(col, delCheck, todas);
        cands.forEach((c, ord) => filas.push({ tabla, columna: col.nombre, ord, va: c.a, vb: c.b }));
      }
    } catch (e) {
      console.log(`::warning::banco multi-tenant: no se pudieron armar candidatos para ${tabla}: ${e.message}`);
    }
  }
  return filas;
}

/** Consulta de catalogo: un CHECK por fila con sus columnas. Una sola linea `BANCO_CHECKS <json>`. */
export function consultaChecks(esquemas) {
  for (const s of esquemas) if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw new Error(`esquema invalido: ${s}`);
  const lista = esquemas.map((s) => `'${s}'`).join(',');
  return `select 'BANCO_CHECKS ' || coalesce(jsonb_agg(jsonb_build_object(
  'tabla', n.nspname || '.' || c.relname,
  'restriccion', k.conname,
  'def', pg_get_constraintdef(k.oid),
  'cols', (select coalesce(jsonb_agg(jsonb_build_object(
              'nombre', a.attname, 'tipo', t.typname, 'cat', t.typcategory::text, 'elem', et.typname,
              'notnull', a.attnotnull) order by a.attnum), '[]'::jsonb)
             from pg_attribute a
             join pg_type t on t.oid = a.atttypid
             left join pg_type et on et.oid = t.typelem and t.typcategory = 'A'
            where a.attrelid = c.oid and a.attnum = any (k.conkey)))), '[]'::jsonb)::text
  from pg_constraint k
  join pg_class c on c.oid = k.conrelid
  join pg_namespace n on n.oid = c.relnamespace
 where k.contype = 'c' and c.relkind in ('r', 'p') and not c.relispartition and n.nspname in (${lista});`;
}

export function extraerChecks(stdout) {
  const linea = stdout.split('\n').find((l) => l.startsWith('BANCO_CHECKS '));
  if (!linea) throw new Error('la consulta de CHECK no devolvio la linea BANCO_CHECKS');
  return JSON.parse(linea.slice('BANCO_CHECKS '.length));
}

/** Sentencia SQL que carga los candidatos en ci_banco.candidatos (se inserta justo despues del prologo). */
export function sqlCandidatos(filas) {
  if (!filas.length) return '';
  const json = JSON.stringify(filas);
  if (json.includes('$cand$')) throw new Error('un candidato trae el delimitador $cand$');
  return `insert into ci_banco.candidatos select * from jsonb_to_recordset($cand$${json}$cand$::jsonb)
  as x(tabla text, columna text, ord int, va text, vb text);`;
}

// ── Bases explicitas (F2, CT-SEG): tablas con CHECK acoplados ───────────────────────────────────────────────────────────
// La busqueda de candidatos no las halla porque el valor valido de una columna anulable (NULL, o la combinacion coherente de
// dos columnas) esta al FINAL de su lista y la primera columna varia mas rapido: 600 intentos no alcanzan. Aqui se declara, por
// tabla, SOLO lo que la siembra generica (valores por tipo en las columnas NOT NULL sin default) no deduce. Las demas columnas
// anulables quedan NULL, que es lo que esos CHECK piden. Cada valor sale de la migracion citada. `a`/`b` = flota A / flota B
// (distintos donde hay unico global: el telefono de operador es unico entre flotas mientras el operador este activo).
// Convencion de valores: la misma de los candidatos ('@N' = NULL, '=<sql>' = expresion cruda, otro = literal).
const HEX64_A = 'a'.repeat(64);
const HEX64_B = 'b'.repeat(64);
export const BASES_EXPLICITAS = {
  // 0290/0932 operador_telefono_forma (10-15 digitos), 0460 invitacion_coherente y 0462 fallo_coherente (todo NULL = pendiente).
  'public.operador': { a: { telefono: '529990000001' }, b: { telefono: '529990000002' } },
  // 0050/0480: radio entre 25 y 100000 y tipo de pareja con el catalogo por omision ('peajes'): punto_interes vale en ambos.
  'public.geocerca': { a: { tipo: 'punto_interes', radio_m: '100' }, b: { tipo: 'punto_interes', radio_m: '100' } },
  // 0053/0291: tipo del dominio ARCO y titular presente (operador_id o titular_ref).
  'public.solicitud_arco': { a: { tipo: 'acceso', titular_ref: 'banco-titular-a' }, b: { tipo: 'acceso', titular_ref: 'banco-titular-b' } },
  // 0098: huella SHA-256 en hex (64) y status 200/201.
  'public.api_idempotencia': { a: { huella: HEX64_A, status: '200' }, b: { huella: HEX64_B, status: '200' } },
  // 0105/0181: el tenant solo se llena en un prospecto cerrado, y cerrado <=> con fecha de cierre.
  'public.prospecto': { a: { estado: 'cerrado', cerrado_en: '=now()' }, b: { estado: 'cerrado', cerrado_en: '=now()' } },
  // 0229: plantilla del catalogo cerrado; estado 'pendiente' (por omision) no exige confirmacion.
  'public.regla_vigilancia': { a: { plantilla: 'estadia_mayor_a' }, b: { plantilla: 'estadia_mayor_a' } },
  // 0380: tipo de hito del dominio; estado 'esperado' (por omision) no exige recibido_en ni fuente.
  'public.viaje_hito': { a: { tipo: 'llegada_carga' }, b: { tipo: 'llegada_carga' } },
  // 0420/0791: canal y formato del dominio, sha256 en hex (64) y bytes entre 1 y 12582912.
  'public.cp_documento': {
    a: { canal: 'manual', formato: 'pdf_texto', bytes: '1000', sha256: HEX64_A },
    b: { canal: 'manual', formato: 'pdf_texto', bytes: '1000', sha256: HEX64_B },
  },
  // 0787/0788/0933: rol del dominio y correo con forma (unico por liquidacion, generacion, rol y correo).
  'public.liquidacion_entrega_correo': {
    a: { rol: 'operador', correo: 'banco-a@ejemplo.test' },
    b: { rol: 'operador', correo: 'banco-b@ejemplo.test' },
  },
};

/**
 * Sentencia SQL que carga las bases explicitas en ci_banco.bases (tabla, lado, columna, valor).
 * @param {Record<string, { a?: Record<string, string>, b?: Record<string, string> }>} [bases]
 */
export function sqlBases(bases = BASES_EXPLICITAS) {
  const filas = [];
  for (const [tabla, lados] of Object.entries(bases)) {
    for (const [lado, n] of [['a', 1], ['b', 2]]) {
      for (const [columna, valor] of Object.entries(lados[lado] ?? {})) filas.push({ tabla, lado: n, columna, valor });
    }
  }
  if (!filas.length) return '';
  const json = JSON.stringify(filas);
  if (json.includes('$base$')) throw new Error('una base trae el delimitador $base$');
  return `insert into ci_banco.bases select * from jsonb_to_recordset($base$${json}$base$::jsonb)
  as x(tabla text, lado int, columna text, valor text);`;
}

// ── Tablas que de verdad no se pueden sembrar (con motivo) y cobertura ─────────────────────────────────────────────────
export function validarNoSembrables(lista) {
  const errores = [];
  const vistos = new Set();
  for (const e of lista?.tablas ?? []) {
    if (!e.tabla || !/^[a-z_]+\.[a-z0-9_]+$/.test(e.tabla)) errores.push(`${e.tabla ?? '(sin tabla)'}: nombre de tabla invalido (esquema.tabla)`);
    if (vistos.has(e.tabla)) errores.push(`${e.tabla}: duplicada`);
    vistos.add(e.tabla);
    if (!e.motivo || String(e.motivo).trim().length < 20) errores.push(`${e.tabla}: falta motivo (al menos una oracion que diga por que no se puede sembrar)`);
  }
  return errores;
}

/** Cruza las no sembradas de la corrida contra la lista con motivo. `sinJustificar` hace fallar el banco. */
export function clasificarNoSembradas(cobertura, lista) {
  const motivos = new Map((lista?.tablas ?? []).map((e) => [e.tabla, e.motivo]));
  const no = Array.isArray(cobertura?.no_sembradas) ? cobertura.no_sembradas : [];
  const justificadas = [];
  const sinJustificar = [];
  for (const t of no) (motivos.has(t.tabla) ? justificadas : sinJustificar).push({ ...t, motivo: motivos.get(t.tabla) });
  const nombres = new Set(no.map((t) => t.tabla));
  const sobrantes = [...motivos.keys()].filter((t) => !nombres.has(t));
  return { justificadas, sinJustificar, sobrantes };
}

export function reporteCobertura(cobertura, clas) {
  const l = [];
  l.push(`\n### Cobertura de siembra: ${cobertura.sembradas}/${cobertura.tablas} tablas con columna de tenant`);
  if (!clas.justificadas.length && !clas.sinJustificar.length) l.push('Todas las tablas con columna de tenant se sembraron.');
  else {
    l.push('\n| tabla no sembrada | estado | motivo / error |');
    l.push('| --- | --- | --- |');
    for (const t of clas.justificadas) l.push(`| ${t.tabla} | justificada | ${String(t.motivo).replace(/\|/g, '/')} |`);
    for (const t of clas.sinJustificar) l.push(`| ${t.tabla} | SIN JUSTIFICAR | ${String(t.error ?? '').replace(/\|/g, '/')} |`);
  }
  return l.join('\n');
}
