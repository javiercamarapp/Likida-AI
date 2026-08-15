// ═══════════════════════════════════════════════════════════════════════════
// APLICADOR — fase 4: corrige el repo con compuerta real.
//
// Compuertas duras (del skill): reemplazo por LÍNEAS dentro de rango, `tsc
// --noEmit` limpio, tests del archivo (si existen) verdes, commit atómico
// citando el ID. Compuerta roja → `git checkout` (rollback) y PENDIENTE.
// Árbol sucio (código ajeno) → no arregla.
// ═══════════════════════════════════════════════════════════════════════════

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirRonda } from './config.audit';
import { verificarRonda } from './verificar.audit';
import { fixerPorSeveridad, severidadDeTexto } from './modelos.audit';
import { llamada } from './llamada.audit';
import type { HallazgoVerificado } from './verificar.audit';

interface Reemplazo {
  archivo?: string;
  desde?: number;
  hasta?: number;
  reemplazo?: string;
  falso_positivo?: boolean;
  motivo?: string;
}

export interface ResultadoFixAplicado {
  id: string;
  archivo: string;
  estado: 'APLICADO' | 'FALSO_POSITIVO' | 'ERROR' | 'NADA';
  detalle: string;
}

export interface Cambio {
  archivo: string;
  desde: number;
  hasta: number;
  reemplazo: string;
  id: string;
  descripcion: string;
  /** Modelo que propuso el cambio (opcional: default por severidad/fixer). */
  modelo?: string;
}

const repo = process.cwd();

function arbolLimpio(): boolean {
  // Los propios artefactos del pipeline no ensucian el árbol de los fixes.
  const r = spawnSync('git', ['status', '--porcelain'], { encoding: 'utf8', cwd: repo });
  const lineas = (r.stdout ?? '').split('\n').filter((l) => l.trim().length > 0).map((l) => l.slice(3));
  const ajenos = lineas.filter((l) => !l.startsWith('docs/auditoria-') && !l.startsWith('scripts/auditoria') && l !== 'vitest.audit.config.ts');
  return ajenos.length === 0;
}

export function estadoGit(): string {
  const r = spawnSync('git', ['status', '--porcelain'], { encoding: 'utf8', cwd: repo });
  return (r.stdout ?? '').trim().slice(0, 500);
}

function leerArchivo(ruta: string): string[] | null {
  const abs = `${repo}/${ruta}`;
  if (!existsSync(abs)) return null;
  return readFileSync(abs, 'utf8').split('\n');
}

function ejecutar(cmd: string, args: string[]): { ok: boolean; salida: string } {
  const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 25 * 60_000, maxBuffer: 48 * 1024 * 1024, cwd: repo });
  return { ok: r.status === 0, salida: ((r.stdout ?? '') + '\n' + (r.stderr ?? '')).slice(0, 2500) };
}

function testArchivo(ruta: string): string | null {
  const base = ruta.replace(/\.[jt]sx?$/, '');
  const candidatos = [
    `${base}.test.ts`,
    `${base}.test.tsx`,
    ruta.replace('src/', 'src/__tests__/').replace(/\.(ts|tsx)$/, '.test.ts'),
    ruta.replace('src/', 'tests/').replace(/\.ts$/, '.test.ts'),
  ];
  for (const c of candidatos) {
    const rutaLim = c.replace(/^\/+/, '');
    if (existsSync(`${repo}/${rutaLim}`)) return rutaLim;
  }
  return null;
}

function extractJson(texto: string): Reemplazo | null {
  try {
    const ini = texto.indexOf('{');
    const fin = texto.lastIndexOf('}');
    if (ini < 0 || fin <= ini) return null;
    return JSON.parse(texto.slice(ini, fin + 1)) as Reemplazo;
  } catch {
    return null;
  }
}

/** Pide a un fixer un JSON de reemplazo; `modelo` dado o el de la clase del hallazgo. */
async function sugerirReemplazo(h: HallazgoVerificado, modelo?: string): Promise<Reemplazo | null> {
  const f = fixerPorSeveridad(h.rubro, severidadDeTexto(h.severidad));
  const linea = h.linea;
  const archivo = h.archivo;
  const lineas = leerArchivo(archivo);
  if (!lineas) return null;
  const desdeCtx = Math.max(1, linea - 12);
  const hastaCtx = Math.min(lineas.length, linea + 12);
  const contexto = lineas.slice(desdeCtx - 1, hastaCtx).map((l, i) => `${desdeCtx + i}: ${l}`).join('\n');
  const total = lineas.length <= 3500 ? lineas.join('\n') : '';

  const out = await llamada({
    modelo: modelo ?? f.modelo(h.rubro),
    quien: `fixer-${f.nombre}-${h.rubro}`,
    mensajes: [
      {
        role: 'system',
        content: `Eres "${f.nombre}" en Likida. ${f.queHace}. Reglas estrictas:
1) Un solo reemplazo de LÍNEAS dentro de UN archivo.
2) Responde SOLO JSON: {"archivo":"<ruta>","desde":N,"hasta":M,"reemplazo":"<texto>"} — o {"falso_positivo":true,"motivo":"..."} si el hallazgo no aplica.
3) Reemplazo mínimo: sin imports nuevos, sin semántica ajena, sin tocar pagos salvo trivial y obvio.`,
      },
      {
        role: 'user',
        content: `Hallazgo [${h.severidad}] ${h.titulo} (rubro ${h.rubro}).
Archivo: ${h.archivo}:${h.linea}
Contexto (líneas ${desdeCtx}-${hastaCtx}):
${contexto}
${total ? `\n=== ARCHIVO COMPLETO (${lineas.length} líneas) ===\n${total.slice(0, 15000)}` : ''}

Devuelve SOLO el JSON del reemplazo (o falso:true). "reemplazo" sustituye desde..hasta INCLUSIVE.`,
      },
    ],
    maxTokens: 2500,
    temperatura: 0.1,
  });
  return extractJson(out.text);
}

/** Gate + commit de un cambio concreto (usado por auditores Y por rutinas). */
export async function aplicarCambio(n: number, c: Cambio): Promise<ResultadoFixAplicado> {
  if (!arbolLimpio()) {
    return { id: c.id, archivo: c.archivo, estado: 'ERROR', detalle: `árbol sucio — no commit atómico (${estadoGit().slice(0, 120)})` };
  }
  const archivo = c.archivo.replace(/^\/+/, '');
  const lineas = leerArchivo(archivo);
  if (!lineas || c.desde < 1 || c.hasta < c.desde || c.hasta > lineas.length) {
    return { id: c.id, archivo, estado: 'ERROR', detalle: `rango ${c.desde}-${c.hasta} inválido (${lineas?.length ?? 0} líneas)` };
  }
  const nuevas = [...lineas.slice(0, c.desde - 1), ...c.reemplazo.split('\n'), ...lineas.slice(c.hasta)];
  writeFileSync(`${repo}/${archivo}`, nuevas.join('\n') + '\n', 'utf8');

  const tsc = ejecutar('npx', ['tsc', '--noEmit']);
  if (!tsc.ok) {
    spawnSync('git', ['checkout', '--', archivo], { encoding: 'utf8', cwd: repo });
    return { id: c.id, archivo, estado: 'ERROR', detalle: `tsc roto: ${tsc.salida.slice(0, 190)}` };
  }
  const t = testArchivo(archivo);
  if (t) {
    const vt = ejecutar('npx', ['vitest', 'run', t, '--reporter=dot']);
    if (!vt.ok) {
      spawnSync('git', ['checkout', '--', archivo], { encoding: 'utf8', cwd: repo });
      return { id: c.id, archivo, estado: 'ERROR', detalle: `test roto (${t}): ${vt.salida.slice(0, 190)}` };
    }
  }
  const msg = `[audit${n}] ${c.id} ${c.descripcion.slice(0, 70)}`;
  spawnSync('git', ['add', archivo], { encoding: 'utf8', cwd: repo });
  spawnSync('git', ['commit', '-m', msg], { encoding: 'utf8', cwd: repo });
  return { id: c.id, archivo, estado: 'APLICADO', detalle: `tsc+tests verdes → ${msg}` };
}

export async function aplicarFix(n: number, h: HallazgoVerificado, modelo?: string): Promise<ResultadoFixAplicado> {
  const id = `${h.rubro}-${h.severidad.slice(0, 1)}`;
  if (!arbolLimpio()) return { id, archivo: h.archivo, estado: 'ERROR', detalle: 'árbol de git sucio — no commit atómico' };
  const sug = await sugerirReemplazo(h, modelo);
  if (!sug) return { id, archivo: h.archivo, estado: 'ERROR', detalle: 'fixer sin JSON válido' };
  if (sug.falso_positivo) return { id, archivo: h.archivo, estado: 'FALSO_POSITIVO', detalle: sug.motivo ?? 'no aplica' };
  return aplicarCambio(n, {
    id,
    descripcion: h.titulo,
    archivo: (sug.archivo ?? h.archivo).replace(/^\/+/, ''),
    desde: sug.desde ?? 1,
    hasta: sug.hasta ?? (sug.desde ?? 1),
    reemplazo: sug.reemplazo ?? '',
    modelo,
  });
}

export async function aplicarFixesRonda(n: number): Promise<ResultadoFixAplicado[]> {
  const hallazgos = verificarRonda(n).filter((h) => h.existe);
  const resultados: ResultadoFixAplicado[] = [];
  for (const h of hallazgos) {
    process.stderr.write(`[audit] 🔧 fix ${h.rubro}-${h.severidad}: ${h.titulo.slice(0, 60)}\n`);
    try {
      resultados.push(await aplicarFix(n, h));
    } catch (e) {
      resultados.push({ id: `${h.rubro}-${h.severidad}`, archivo: h.archivo, estado: 'ERROR', detalle: String((e as Error).message).slice(0, 200) });
    }
  }
  const md = [
    `# Fixes aplicados — auditoría ${n}`,
    '',
    ...resultados.map((r) => `- [${r.estado}] ${r.id} ${r.archivo}: ${r.detalle}`),
  ].join('\n');
  const dir = dirRonda(n);
  writeFileSync(`${dir}/fixes-aplicadas.md`, md, 'utf8');
  return resultados;
}