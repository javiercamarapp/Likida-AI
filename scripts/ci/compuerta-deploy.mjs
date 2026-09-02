#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// LA COMPUERTA DE DESPLIEGUE — OP-P1 / OP-P3 (auditoría 24, BLOQUEANTE).
//
// Producción corría con la base en la migración 0271 mientras `master` pedía
// la forma 0272 de `poliza_datos_tenant`. Las dos verdades (código y esquema)
// solo coincidían si un humano recordaba el orden «migrar → verificar →
// [deploy]». Este script lo convierte en regla:
//
//   · `vercel.json` lo corre como `ignoreCommand`. Exit 0 = construir; exit 1
//     = no construir (Vercel invierte: su ignoreCommand «exit 1» significa
//     «sí construye», por eso el `&& exit 1 || exit 0` del vercel.json).
//   · `salud-produccion.yml` lo corre en cada push con `[deploy]` para que el
//     mismo veredicto salga EN ROJO en Actions —el ignoreCommand de Vercel es
//     silencioso, y un deploy que no ocurre sin decirlo es exactamente OP-P3.
//
// QUÉ COMPARA: la última migración del repo que se va a publicar
// (`supabase/migrations/NNNN_*.sql`) contra `migracion.base` de
// `https://app.likida.ai/api/health`, que la base registra como aplicada
// (`migraciones_aplicadas()`, 0234). Base atrás → no se construye, y el
// mensaje dice qué aplicar.
//
// CUÁNDO SÍ DEJA PASAR AUNQUE NO PUEDA COTEJAR: solo si el health desplegado
// NO publica `migracion` todavía (la versión anterior a esta auditoría) — es
// el arranque, una sola vez; a partir del siguiente deploy la compuerta
// compara. Health caído o base ilegible = NO se construye: un cotejo que no
// pudo hacerse no es un cotejo verde. La salida a la vista es `[deploy:forzar]`
// en el asunto: construye igual y deja el aviso.
// ═══════════════════════════════════════════════════════════════════════════

import { readdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const HEALTH_URL = 'https://app.likida.ai/api/health';

/** El prefijo de cuatro dígitos más alto en `supabase/migrations`. */
export function ultimaMigracion(dir = 'supabase/migrations') {
  const prefijos = readdirSync(dir)
    .map((f) => /^(\d{4})_.*\.sql$/.exec(f)?.[1])
    .filter((p) => p !== undefined)
    .sort();
  if (prefijos.length === 0) throw new Error(`${dir} sin migraciones`);
  return prefijos[prefijos.length - 1];
}

function siguiente(prefijo) {
  return String(Number(prefijo) + 1).padStart(4, '0');
}

/**
 * PURA. `asunto` = primera línea del commit; `codigo` = última migración del
 * repo; `health` = el JSON de /api/health, o `null` si no se pudo leer.
 * Devuelve `{ construir, nivel: 'ok'|'aviso'|'error', motivo }`.
 */
export function decidir({ asunto, codigo, health }) {
  const primera = String(asunto ?? '').split('\n')[0];
  if (!/\[deploy(?::forzar)?\]/i.test(primera)) {
    return { construir: false, nivel: 'ok', motivo: 'el asunto no lleva [deploy]: este push NO construye a propósito (vercel.json).' };
  }
  const forzar = /\[deploy:forzar\]/i.test(primera);
  const bloquear = (motivo) => (forzar
    ? { construir: true, nivel: 'aviso', motivo: `${motivo} — [deploy:forzar] en el asunto: se construye igual, bajo tu responsabilidad.` }
    : { construir: false, nivel: 'error', motivo: `${motivo} Si de verdad quieres publicar sin cotejar, pon [deploy:forzar] en el asunto.` });

  if (health === null || typeof health !== 'object') {
    return bloquear(`no se pudo leer ${HEALTH_URL}: sin base cotejada no se despliega.`);
  }
  const m = health.migracion;
  if (m === undefined) {
    return {
      construir: true, nivel: 'aviso',
      motivo: 'el health desplegado no publica `migracion` (versión anterior a la auditoría 24): se construye esta vez; a partir del siguiente deploy la compuerta compara base y código.',
    };
  }
  if (!m || typeof m !== 'object' || typeof m.base !== 'string' || !/^\d{4}$/.test(m.base)) {
    return bloquear(`la base no se pudo cotejar (${(m && m.motivo) || 'sin motivo'}).`);
  }
  const atras = Number(codigo) - Number(m.base);
  if (atras > 0) {
    return bloquear(
      `la base está en ${m.base} y el código que vas a publicar llega a ${codigo}: faltan ${atras} migración(es) (${siguiente(m.base)}..${codigo}). ` +
      'Aplícalas primero (scripts/aplicar-migraciones-y-humos.sh), confirma /api/health con migracion.atras=0 y vuelve a pushear con [deploy].',
    );
  }
  return { construir: true, nivel: 'ok', motivo: `base ${m.base} a la par del código ${codigo}: se construye.` };
}

function asuntoDelCommit(args) {
  const i = args.indexOf('--asunto');
  if (i !== -1 && args[i + 1] !== undefined) return args[i + 1];
  try {
    return execSync('git log -1 --pretty=%s', { encoding: 'utf8' }).trim();
  } catch {
    return (process.env.VERCEL_GIT_COMMIT_MESSAGE ?? '').split('\n')[0];
  }
}

async function leerHealth(url) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(20_000), headers: { 'user-agent': 'likida-compuerta-deploy' } });
    // 503 también trae cuerpo (degraded): lo que importa es `migracion`.
    return await r.json();
  } catch (e) {
    console.log(`compuerta: ${url} no contestó (${e instanceof Error ? e.message : String(e)})`);
    return null;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const iUrl = args.indexOf('--health');
  const url = iUrl !== -1 && args[iUrl + 1] ? args[iUrl + 1] : HEALTH_URL;
  const asunto = asuntoDelCommit(args);
  const codigo = ultimaMigracion();
  const health = await leerHealth(url);
  const v = decidir({ asunto, codigo, health });
  const enActions = !!process.env.GITHUB_ACTIONS;
  const prefijo = v.nivel === 'error' ? (enActions ? '::error::' : 'ERROR: ') : v.nivel === 'aviso' ? (enActions ? '::warning::' : 'AVISO: ') : '';
  console.log(`compuerta de despliegue · asunto="${asunto.slice(0, 80)}" · código=${codigo} · base=${health?.migracion?.base ?? '?'}`);
  console.log(`${prefijo}${v.motivo}`);
  console.log(v.construir ? 'compuerta: CONSTRUIR' : 'compuerta: NO construir');
  process.exit(v.construir ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
