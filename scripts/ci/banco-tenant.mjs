#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// BANCO MULTI-TENANT (X-02): "flota A contra flota B" contra Postgres real.
//
// Une los archivos de `supabase/tests/banco_tenant/*.sql` en UNA sesion de psql (una transaccion que SIEMPRE termina en rollback),
// lee el JSON de hallazgos que el epilogo imprime y lo compara contra `scripts/ci/banco-tenant-allowlist.json`.
//
// Tres fases (ver supabase/tests/banco_tenant/LEEME.md):
//   estatica  ANTES de `grants_previos_0947_restaurar.sql`: politicas (a), funciones SECURITY DEFINER (c, d) y vistas (e) bajo los
//             grants REALES de produccion. Restaurar los grants previos tambien devuelve las ACL de funciones, por eso va antes.
//   dinamica  DESPUES de restaurar: siembra dos flotas con filas en cada tabla y lee como authenticated/anon (b). Con los grants
//             restituidos prueba RLS como capa independiente (igual que la capa 1).
//   canario   crea a proposito objetos abiertos y exige que el banco los detecte (prueba que el banco no esta ciego).
//
// La siembra no es generica a ciegas: scripts/ci/banco-tenant-siembra.mjs lee los CHECK del catalogo y arma valores candidatos
// por columna (literales de IN, muestras de regex, rangos); el SQL busca entre ellos. Lo que aun asi no se siembra debe estar en
// scripts/ci/banco-tenant-no-sembrables.json con motivo.
//
// Salida: 0 = sin hallazgos fuera de la allowlist; 1 = hallazgo no listado, excepcion vencida/invalida o cobertura insuficiente.
// BANCO_TENANT_ESTRICTO=0 convierte "hallazgo no listado" en informe (exit 0) — solo para la primera corrida de calibracion.
// ═══════════════════════════════════════════════════════════════════════════

import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  clasificarNoSembradas,
  construirCandidatos,
  consultaChecks,
  extraerChecks,
  reporteCobertura,
  sqlCandidatos,
  validarNoSembrables,
} from './banco-tenant-siembra.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const DIR_SQL = join(AQUI, '..', '..', 'supabase', 'tests', 'banco_tenant');
const RUTA_ALLOWLIST = join(AQUI, 'banco-tenant-allowlist.json');
const RUTA_NO_SEMBRABLES = join(AQUI, 'banco-tenant-no-sembrables.json');

export const ARCHIVOS_POR_FASE = {
  estatica: ['00_prologo.sql', '10_politicas.sql', '30_funciones.sql', '40_vistas.sql', '90_epilogo.sql'],
  dinamica: ['00_prologo.sql', '20_siembra_lectura.sql', '90_epilogo.sql'],
  canario: [
    '00_prologo.sql',
    '05_canario_objetos.sql',
    '10_politicas.sql',
    '30_funciones.sql',
    '40_vistas.sql',
    '20_siembra_lectura.sql',
    '90_epilogo.sql',
  ],
};

export const TIPOS = [
  'sin_rls',
  'politica_abierta',
  'fuga_lectura',
  'fuga_escritura',
  'fuga_anon',
  'funcion_anon',
  'funcion_authenticated',
  'vista_sin_invoker',
  'matview_expuesta',
];

// Que tipos de hallazgo produce cada fase: una excepcion de una fase solo puede "quedar obsoleta" en la fase que la produce
// (las de funciones/politicas/vistas las mide la estatica; las fugas, la dinamica). Antes la dinamica avisaba que RLS-01..07
// "ya no coincidian con nada" solo porque esa fase no mide funciones.
export const TIPOS_POR_FASE = {
  estatica: ['sin_rls', 'politica_abierta', 'funcion_anon', 'funcion_authenticated', 'vista_sin_invoker', 'matview_expuesta'],
  dinamica: ['fuga_lectura', 'fuga_escritura', 'fuga_anon'],
};

// Una fuga de datos entre flotas no puede ser excepcion permanente: solo temporal, con hallazgo y fecha.
const NO_PERMANENTES = new Set(['fuga_lectura', 'fuga_escritura', 'fuga_anon', 'sin_rls', 'politica_abierta']);

// Objetos abiertos a proposito por 05_canario_objetos.sql y lo que el banco DEBE decir de cada uno.
export const CANARIO_ESPERADO = [
  ['politica_abierta', 'public.zz_canario_fuga'],
  ['sin_rls', 'public.zz_canario_sin_rls'],
  ['fuga_lectura', 'public.zz_canario_fuga'],
  ['fuga_lectura', 'public.zz_canario_sin_rls'],
  ['fuga_lectura', 'public.zz_canario_vista'],
  ['fuga_escritura', 'public.zz_canario_fuga'],
  ['funcion_anon', 'public.zz_canario_definer()'],
  ['funcion_authenticated', 'public.zz_canario_definer()'],
  ['vista_sin_invoker', 'public.zz_canario_vista'],
];

const clave = (tipo, objeto) => `${tipo}|${objeto}`;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

export function validarAllowlist(lista, hoy) {
  const errores = [];
  const vencidas = [];
  const vistos = new Set();
  for (const e of lista?.entradas ?? []) {
    const id = e.id || '(sin id)';
    if (!e.id) errores.push(`${id}: falta id`);
    if (vistos.has(e.id)) errores.push(`${id}: id duplicado`);
    vistos.add(e.id);
    if (!TIPOS.includes(e.tipo)) errores.push(`${id}: tipo desconocido (${e.tipo})`);
    if (!e.objeto) errores.push(`${id}: falta objeto`);
    if (!e.justificacion || !String(e.justificacion).trim()) errores.push(`${id}: falta justificacion`);
    if (e.permanente) {
      if (e.fecha_limite) errores.push(`${id}: una excepcion permanente no lleva fecha_limite (si tiene fecha es temporal)`);
      if (NO_PERMANENTES.has(e.tipo)) errores.push(`${id}: tipo ${e.tipo} no puede ser permanente (fuga o RLS ausente: solo temporal)`);
    } else {
      if (!e.hallazgo) errores.push(`${id}: falta hallazgo (id CT-SEG-nn / MX-nnn / L1K-nn)`);
      if (!e.fecha_limite || !ISO.test(e.fecha_limite)) errores.push(`${id}: falta fecha_limite AAAA-MM-DD`);
      else if (e.fecha_limite < hoy) vencidas.push(e);
    }
  }
  return { errores, vencidas };
}

export function clasificar(hallazgos, lista, hoy, fase) {
  const entradas = lista?.entradas ?? [];
  const vigente = (e) => e.permanente || (e.fecha_limite && e.fecha_limite >= hoy);
  const vencidas = entradas.filter((e) => !e.permanente && !vigente(e));
  const porClave = new Map(entradas.filter(vigente).map((e) => [clave(e.tipo, e.objeto), e]));
  const usadas = new Set();
  const permitidos = [];
  const noListados = [];
  for (const h of hallazgos) {
    const e = porClave.get(clave(h.tipo, h.objeto));
    if (e) {
      permitidos.push({ ...h, excepcion: e.id });
      usadas.add(e.id);
    } else noListados.push(h);
  }
  const deEstaFase = (e) => !TIPOS_POR_FASE[fase] || TIPOS_POR_FASE[fase].includes(e.tipo);
  const obsoletas = [...porClave.values()].filter((e) => !usadas.has(e.id) && deEstaFase(e));
  return { permitidos, noListados, vencidas, obsoletas };
}

export function verificarCobertura(cobertura, minimo) {
  const { tablas = 0, sembradas = 0 } = cobertura ?? {};
  if (tablas === 0) return { ok: false, razon: 'ninguna tabla con columna de tenant: el banco no vio nada' };
  const razon = sembradas / tablas;
  return { ok: razon >= minimo, razon: `sembradas ${sembradas}/${tablas} (${(razon * 100).toFixed(0)}%), minimo ${(minimo * 100).toFixed(0)}%` };
}

export function verificarCanario(hallazgos) {
  const hay = new Set(hallazgos.map((h) => clave(h.tipo, h.objeto)));
  return { faltantes: CANARIO_ESPERADO.filter(([t, o]) => !hay.has(clave(t, o))) };
}

export function extraerResultado(stdout) {
  const linea = stdout.split('\n').find((l) => l.startsWith('BANCO_JSON '));
  if (!linea) throw new Error('la salida de psql no trae la linea BANCO_JSON: el banco no corrio completo');
  return JSON.parse(linea.slice('BANCO_JSON '.length));
}

export function armarSql(fase, { esquemas, candidatos = [] }) {
  const archivos = ARCHIVOS_POR_FASE[fase];
  if (!archivos) throw new Error(`fase desconocida: ${fase}`);
  for (const s of esquemas) if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw new Error(`esquema invalido: ${s}`);
  const partes = ['begin;', `select set_config('ci_banco.esquemas', '${esquemas.join(',')}', true);`];
  for (const f of archivos) {
    partes.push(readFileSync(join(DIR_SQL, f), 'utf8'));
    // Los candidatos de la siembra se cargan justo despues del prologo (que crea ci_banco.candidatos).
    if (f === '00_prologo.sql' && candidatos.length) partes.push(sqlCandidatos(candidatos));
  }
  return partes.join('\n');
}

function imprimir(titulo, filas) {
  if (filas.length === 0) return;
  console.log(`\n${titulo} (${filas.length})`);
  for (const h of filas) console.log(`  - [${h.severidad ?? '-'}] ${h.tipo}  ${h.objeto}${h.detalle ? `  :: ${h.detalle}` : ''}`);
}

function principal() {
  const fase = (process.argv.find((a) => a.startsWith('--fase=')) ?? '').slice('--fase='.length);
  if (!ARCHIVOS_POR_FASE[fase]) {
    console.error('uso: node scripts/ci/banco-tenant.mjs --fase=estatica|dinamica|canario');
    process.exit(2);
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('Falta DATABASE_URL.');
    process.exit(2);
  }
  const hoy = process.env.BANCO_TENANT_HOY || new Date().toISOString().slice(0, 10);
  const lista = JSON.parse(readFileSync(RUTA_ALLOWLIST, 'utf8'));
  const noSembrables = JSON.parse(readFileSync(RUTA_NO_SEMBRABLES, 'utf8'));
  // Fases que siembran: leer los CHECK reales del catalogo y armar los candidatos de cada tabla (solo lectura).
  let candidatos = [];
  if (fase === 'dinamica' || fase === 'canario') {
    const q = spawnSync('psql', [url, '-v', 'ON_ERROR_STOP=1', '-X', '-q', '-A', '-t', '--no-psqlrc'], {
      input: consultaChecks(lista.esquemas_expuestos),
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    if (q.status !== 0) {
      console.error('::error::no se pudieron leer los CHECK del catalogo para armar la siembra:');
      console.error((q.stderr ?? '').trim());
      process.exit(1);
    }
    candidatos = construirCandidatos(extraerChecks(q.stdout ?? ''));
    console.log(`siembra: ${candidatos.length} valores candidatos para ${new Set(candidatos.map((c) => c.tabla)).size} tablas con CHECK`);
  }
  const sql = armarSql(fase, { esquemas: lista.esquemas_expuestos, candidatos });

  const r = spawnSync('psql', [url, '-v', 'ON_ERROR_STOP=1', '-X', '-q', '-A', '-t', '--no-psqlrc'], {
    input: sql,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.status !== 0) {
    console.error(`::error::el banco multi-tenant (${fase}) fallo al ejecutarse; no es un hallazgo, es el banco roto:`);
    console.error((r.stderr ?? '').trim());
    process.exit(1);
  }
  const res = extraerResultado(r.stdout ?? '');
  if (process.env.BANCO_TENANT_SALIDA) writeFileSync(process.env.BANCO_TENANT_SALIDA, JSON.stringify({ fase, ...res }, null, 2));
  const c = res.cobertura ?? {};
  console.log(`banco multi-tenant [${fase}] — hallazgos crudos: ${res.hallazgos.length}; cobertura: ${JSON.stringify(c)}`);

  if (fase === 'canario') {
    const { faltantes } = verificarCanario(res.hallazgos);
    if (faltantes.length) {
      for (const [t, o] of faltantes) console.log(`::error::el banco NO detecto el objeto abierto a proposito: ${t} ${o}`);
      process.exit(1);
    }
    console.log('canario: el banco detecto los 9 objetos abiertos a proposito.');
    return;
  }

  const val = validarAllowlist(lista, hoy);
  const cls = clasificar(res.hallazgos, lista, hoy, fase);
  let falla = false;
  for (const e of val.errores) {
    console.log(`::error::allowlist invalida: ${e}`);
    falla = true;
  }
  for (const e of cls.vencidas) {
    console.log(`::error::excepcion VENCIDA ${e.id} (${e.tipo} ${e.objeto}, limite ${e.fecha_limite}, hallazgo ${e.hallazgo}): se corrige o se renueva con decision escrita`);
    falla = true;
  }
  imprimir('permitidos por la allowlist', cls.permitidos);
  for (const e of cls.obsoletas) console.log(`::warning::excepcion ${e.id} (${e.tipo} ${e.objeto}) ya no coincide con ningun hallazgo: retirala de la allowlist`);
  if (fase === 'dinamica') {
    for (const e of validarNoSembrables(noSembrables)) {
      console.log(`::error::lista de tablas no sembrables invalida: ${e}`);
      falla = true;
    }
    const cob = verificarCobertura(c, lista.cobertura_minima_siembra ?? 0.85);
    console.log(`cobertura de siembra: ${cob.razon}`);
    if (!cob.ok) {
      console.log('::error::cobertura de siembra insuficiente (las tablas sin sembrar no se probaron)');
      falla = true;
    }
    const clas = clasificarNoSembradas(c, noSembrables);
    console.log(reporteCobertura(c, clas));
    if (clas.sinJustificar.length) {
      console.log(`::error::${clas.sinJustificar.length} tabla(s) con columna de tenant sin sembrar y SIN motivo escrito en scripts/ci/banco-tenant-no-sembrables.json (no se prueba lo que no se siembra, y no se calla)`);
      console.log('Esqueleto para banco-tenant-no-sembrables.json (solo si de verdad no se puede sembrar; si no, se arregla la siembra):');
      console.log(JSON.stringify(clas.sinJustificar.map((t) => ({ tabla: t.tabla, motivo: '' })), null, 2));
      falla = true;
    }
    for (const t of clas.sobrantes) console.log(`::warning::${t} esta en banco-tenant-no-sembrables.json pero esta corrida si la sembro: retirala de la lista`);
  }
  if (cls.noListados.length) {
    imprimir('HALLAZGOS NO LISTADOS', cls.noListados);
    console.log('\nEsqueleto para la allowlist (completar hallazgo, justificacion y fecha_limite):');
    console.log(JSON.stringify(cls.noListados.map((h) => ({ id: 'L1K-??', tipo: h.tipo, objeto: h.objeto, hallazgo: '', severidad: h.severidad, justificacion: '', fecha_limite: '' })), null, 2));
    if (process.env.BANCO_TENANT_ESTRICTO !== '0') {
      console.log('::error::hallazgos fuera de la allowlist');
      falla = true;
    } else console.log('::warning::modo informe (BANCO_TENANT_ESTRICTO=0): no se falla por hallazgos no listados');
  }
  if (falla) process.exit(1);
  console.log(`banco multi-tenant [${fase}]: OK`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) principal();
