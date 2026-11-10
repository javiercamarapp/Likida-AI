#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// ACTIVAR (o desactivar) el mapeo del TMS de UNA flota sin SQL a mano (P0-5). Hace lo de docs/operacion/conexion-tms.md §8.2.7:
// en UNA transacción desactiva la versión activa del recurso e inserta la nueva (version = max + 1, activa). Las versiones anteriores
// se conservan como historia.
//
//   DATABASE_URL=postgresql:///likida_demo node scripts/tms/activar-mapeo.mjs --tenant <UUID> --recurso viajes --mapeo /ruta/mapeo.json
//       (SIN --aplicar es un ENSAYO: valida el mapeo y dice qué haría; no escribe nada, ni siquiera abre transacción de escritura)
//   ... --aplicar                       escribe de verdad
//   ... --desactivar --recurso <r>      apaga la versión activa del recurso (frena la lectura de esa flota sin perder la credencial)
//   ... --desactivar --todos            apaga los cuatro recursos
//   ... --produccion --confirmar <UUID> OBLIGATORIO si la base NO es local (misma guarda del demo); el UUID debe ser el del --tenant
//
// `--recurso` es viajes | peajes | posiciones | liquidaciones. Para `liquidaciones` el JSON es { nomina, operadores, conceptos }. Un mapeo
// que no pasa `validarMapeo` NO se escribe. La bitácora (una línea JSON por corrida, sin el contenido del mapeo: solo su huella, versión
// anterior/nueva y el actor del sistema operativo) va a ~/likida-respaldos/tms/activar-mapeo.log; además, antes de cambiar, el mapeo
// activo previo se guarda en ~/likida-respaldos/tms/<fecha>-<tenant>-<recurso>-v<n>.json (modo 600).
// Salida: 0 = hecho (o ensayo limpio) · 1 = el mapeo no valida · 2 = uso · 3 = base no local sin --produccion/--confirmar.
// ═══════════════════════════════════════════════════════════════════════════
import { createHash } from 'node:crypto';
import { appendFileSync, chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { evaluarHost } from '../demo/cinco-agentes/guarda-host.mjs';

export const RECURSOS = ['viajes', 'peajes', 'posiciones', 'liquidaciones'];
const SUB_LIQUIDACIONES = ['nomina', 'operadores', 'conceptos'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parsearArgs(argv) {
  const o = { aplicar: false, desactivar: false, todos: false, produccion: false, tenant: null, recurso: null, mapeo: null, confirmar: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const val = () => { i += 1; return argv[i] ?? null; };
    if (a === '--aplicar') o.aplicar = true;
    else if (a === '--desactivar') o.desactivar = true;
    else if (a === '--todos') o.todos = true;
    else if (a === '--produccion') o.produccion = true;
    else if (a === '--tenant') o.tenant = val();
    else if (a === '--recurso') o.recurso = val();
    else if (a === '--mapeo') o.mapeo = val();
    else if (a === '--confirmar') o.confirmar = val();
    else return { error: `Opción desconocida: ${a}` };
  }
  if (!o.tenant || !UUID.test(o.tenant)) return { error: '--tenant debe ser el UUID de la flota.' };
  if (o.desactivar) {
    if (!o.todos && !RECURSOS.includes(o.recurso)) return { error: `--desactivar pide --recurso (${RECURSOS.join('|')}) o --todos.` };
  } else {
    if (!RECURSOS.includes(o.recurso)) return { error: `--recurso debe ser ${RECURSOS.join(', ')}.` };
    if (!o.mapeo) return { error: '--mapeo pide la ruta del JSON del mapeo.' };
  }
  return { ...o, tenant: o.tenant.toLowerCase() };
}

/** ¿Se puede escribir en esta base? Local sí; cualquier otra solo con --produccion y --confirmar <UUID del tenant>. */
export function decidirEntorno(o, env) {
  const r = evaluarHost({ url: env.DATABASE_URL, env });
  if (r.ok) return { ok: true, local: true };
  if (o.produccion && o.confirmar && o.confirmar.toLowerCase() === o.tenant) return { ok: true, local: false };
  return {
    ok: false,
    motivo: `La base no es local (${r.motivo}) Para escribir en ella: --produccion --confirmar ${o.tenant} (el UUID de la flota).`,
  };
}

/** Valida el JSON con el validador REAL (`validarMapeo`, inyectado). Devuelve la lista de errores por pieza; vacía = limpio. */
export function validarArchivo(recurso, json, validarMapeo) {
  const errores = [];
  if (recurso === 'liquidaciones') {
    if (json === null || typeof json !== 'object') return ['liquidaciones: el JSON debe ser { nomina, operadores, conceptos }'];
    for (const k of SUB_LIQUIDACIONES) for (const e of validarMapeo(json[k])) errores.push(`${k}: ${e}`);
    for (const k of Object.keys(json)) if (!k.startsWith('_') && !SUB_LIQUIDACIONES.includes(k)) errores.push(`${k}: pieza desconocida`);
  } else {
    for (const e of validarMapeo(json)) errores.push(e);
    if (json && typeof json === 'object' && json.recurso !== recurso) errores.push(`el JSON dice recurso «${json.recurso}» y se pidió «${recurso}»`);
  }
  return errores;
}

export const huella = (obj) => createHash('sha256').update(JSON.stringify(obj)).digest('hex').slice(0, 16);

/**
 * Hace (o ensaya) el cambio de UN recurso con el cliente `pg` dado. Devuelve un resumen sin datos del cliente.
 * Ensayo: solo SELECT. Aplicar: una transacción (begin … commit) y rollback si algo falla.
 */
export async function cambiarRecurso(cliente, { tenant, recurso, mapeo, desactivar, aplicar }) {
  const act = (await cliente.query('select id, version, mapeo from public.tms_mapeo where tenant_id = $1 and recurso = $2 and activo', [tenant, recurso])).rows[0] ?? null;
  const max = Number((await cliente.query('select coalesce(max(version), 0) as m from public.tms_mapeo where tenant_id = $1 and recurso = $2', [tenant, recurso])).rows[0].m);
  const resumen = {
    recurso, accion: desactivar ? 'desactivar' : 'activar', aplicado: false,
    versionActiva: act ? Number(act.version) : null, versionNueva: desactivar ? null : max + 1,
    sinCambio: desactivar ? act === null : (act !== null && huella(act.mapeo) === huella(mapeo)),
    previo: act ? act.mapeo : null,
  };
  if (!aplicar || resumen.sinCambio) return resumen;
  await cliente.query('begin');
  try {
    await cliente.query('update public.tms_mapeo set activo = false where tenant_id = $1 and recurso = $2 and activo', [tenant, recurso]);
    if (!desactivar) {
      await cliente.query(
        'insert into public.tms_mapeo (tenant_id, recurso, mapeo, version, activo) values ($1, $2, $3::jsonb, $4, true)',
        [tenant, recurso, JSON.stringify(mapeo), max + 1],
      );
    }
    await cliente.query('commit');
  } catch (e) {
    await cliente.query('rollback');
    throw e;
  }
  return { ...resumen, aplicado: true };
}

function bitacora(linea) {
  const dir = join(homedir(), 'likida-respaldos', 'tms');
  mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, 'activar-mapeo.log'), `${JSON.stringify(linea)}\n`, { mode: 0o600 });
}

function respaldarPrevio(tenant, recurso, version, mapeo) {
  const dir = join(homedir(), 'likida-respaldos', 'tms');
  mkdirSync(dir, { recursive: true });
  const ruta = join(dir, `${new Date().toISOString().slice(0, 10)}-${tenant}-${recurso}-v${version}.json`);
  writeFileSync(ruta, JSON.stringify(mapeo, null, 2), { mode: 0o600 });
  chmodSync(ruta, 0o600);
  return ruta;
}

async function main() {
  const salir = (c, ...l) => { for (const x of l) console[c === 0 ? 'log' : 'error'](x); process.exit(c); };
  const o = parsearArgs(process.argv.slice(2));
  if (o.error) salir(2, o.error, 'Uso: DATABASE_URL=… node scripts/tms/activar-mapeo.mjs --tenant <UUID> --recurso <r> --mapeo <json> [--aplicar] [--produccion --confirmar <UUID>]');
  if (!process.env.DATABASE_URL) salir(2, 'Define DATABASE_URL (la base se elige a propósito; este script no adivina).');
  const ent = decidirEntorno(o, process.env);
  if (!ent.ok) salir(3, ent.motivo);

  const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const { createJiti } = createRequire(import.meta.url)('jiti');
  const jiti = createJiti(import.meta.url, { alias: { '@': join(raiz, 'src') }, moduleCache: false });
  const { validarMapeo } = await jiti.import(join(raiz, 'src/lib/likida/conectores/tms/mapeo.ts'));
  const { Client } = createRequire(import.meta.url)('pg');

  const recursos = o.desactivar ? (o.todos ? RECURSOS : [o.recurso]) : [o.recurso];
  let mapeo = null;
  if (!o.desactivar) {
    try { mapeo = JSON.parse(readFileSync(o.mapeo, 'utf8')); } catch { salir(2, 'No se pudo leer el JSON del mapeo (ruta o formato).'); }
    const errores = validarArchivo(o.recurso, mapeo, validarMapeo);
    if (errores.length > 0) salir(1, `El mapeo NO valida; no se escribió nada (${errores.length}):`, ...errores.map((e) => `  - ${e}`));
  }

  const cliente = new Client({ connectionString: process.env.DATABASE_URL });
  await cliente.connect();
  let codigo = 0;
  try {
    const ten = (await cliente.query('select 1 from public.tenant where id = $1', [o.tenant])).rowCount;
    if (!ten) salir(2, 'Esa flota no existe en esta base. No se hizo nada.');
    console.log(`${o.aplicar ? 'APLICANDO' : 'ENSAYO (no se escribe nada; agrega --aplicar)'} · base ${ent.local ? 'local' : 'REMOTA (producción)'} · flota ${o.tenant}`);
    for (const r of recursos) {
      const m = o.desactivar ? null : mapeo;
      const res = await cambiarRecurso(cliente, { tenant: o.tenant, recurso: r, mapeo: m, desactivar: o.desactivar, aplicar: o.aplicar });
      const previo = res.previo;
      let respaldo = null;
      if (res.aplicado && previo) respaldo = respaldarPrevio(o.tenant, r, res.versionActiva, previo);
      console.log(`  ${r}: ${res.accion}${res.sinCambio ? ' (sin cambio: ya está así)' : ''} · activa v${res.versionActiva ?? '—'}${res.versionNueva ? ` → v${res.versionNueva}` : ''}${res.aplicado ? ' · HECHO' : ''}`);
      if (o.aplicar) {
        bitacora({
          en: new Date().toISOString(), actor: userInfo().username, tenant: o.tenant, recurso: r, accion: res.accion, aplicado: res.aplicado,
          sinCambio: res.sinCambio, versionAnterior: res.versionActiva, versionNueva: res.versionNueva, huellaMapeo: m ? huella(m) : null,
          base: ent.local ? 'local' : 'remota', respaldo,
        });
      }
    }
    if (!o.aplicar) console.log('Ensayo limpio: el mapeo valida. Para escribirlo repite con --aplicar.');
  } finally {
    await cliente.end();
  }
  process.exit(codigo);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();
