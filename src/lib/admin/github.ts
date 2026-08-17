// ═══════════════════════════════════════════════════════════════════════════
// LA ACTIVIDAD DEL REPO EN VIVO (17-ago-2026) — commits, PRs y corridas de
// CI vía la API de GitHub, con la llave GITHUB_TOKEN que Javier cargó hoy
// (local y Vercel). Alimenta /admin/dev; la sección de PRs de "Tu turno" usa
// getPrsAbiertos de bus.ts (misma llave, otra pregunta).
//
// Mismo contrato honesto que esa función: `sin_token`, `error` y `ok` son
// TRES estados — una API que no contestó jamás se pinta como "cero commits".
// ═══════════════════════════════════════════════════════════════════════════

import { logger } from '@/lib/logger';

export interface CommitVivo {
  sha: string;
  mensaje: string;
  autor: string;
  fecha: string;
  url: string;
}

export interface CorridaCi {
  nombre: string;
  estado: string;      // queued | in_progress | completed
  conclusion: string | null; // success | failure | …
  rama: string;
  fecha: string;
  url: string;
}

export type ActividadGitHub =
  | { estado: 'sin_token' }
  | { estado: 'error' }
  | { estado: 'ok'; commits: CommitVivo[]; ci: CorridaCi[] };

function repo(): string {
  return process.env.GITHUB_REPO || 'javiercamarapp/likida.ai';
}

async function gh<T>(ruta: string): Promise<T> {
  const r = await fetch(`https://api.github.com/repos/${repo()}${ruta}`, {
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
    },
    signal: AbortSignal.timeout(5000),
    cache: 'no-store',
  });
  if (!r.ok) throw new Error(`GitHub ${r.status} en ${ruta}`);
  return (await r.json()) as T;
}

/** El mapa de puntos de contribuciones (orden 17-ago: "mapa por puntos en
 *  tiempo real de los push"). GitHub precalcula 52 semanas × 7 días en
 *  stats/commit_activity; la PRIMERA consulta tras un push puede contestar
 *  202 ("lo estoy generando") — ese estado se enseña, no se finge un cero. */
export type MapaCommits =
  | { estado: 'sin_token' }
  | { estado: 'error' }
  | { estado: 'generando' }
  | { estado: 'ok'; semanas: Array<{ inicio: number; dias: number[] }>; total: number };

export async function getMapaCommits(): Promise<MapaCommits> {
  if (!process.env.GITHUB_TOKEN) return { estado: 'sin_token' };
  try {
    const r = await fetch(`https://api.github.com/repos/${repo()}/stats/commit_activity`, {
      headers: {
        Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json',
      },
      signal: AbortSignal.timeout(6000),
      cache: 'no-store',
    });
    if (r.status === 202) return { estado: 'generando' };
    if (!r.ok) throw new Error(`GitHub ${r.status}`);
    const crudo = (await r.json()) as Array<{ week: number; days: number[]; total: number }>;
    const semanas = crudo.map((s) => ({ inicio: s.week * 1000, dias: s.days }));
    return { estado: 'ok', semanas, total: crudo.reduce((a, s) => a + s.total, 0) };
  } catch (e) {
    logger.error('github.mapa_commits', { err: e instanceof Error ? e.message : String(e) });
    return { estado: 'error' };
  }
}

export async function getActividadGitHub(): Promise<ActividadGitHub> {
  if (!process.env.GITHUB_TOKEN) return { estado: 'sin_token' };
  try {
    const [commits, runs] = await Promise.all([
      gh<Array<{ sha: string; html_url: string; commit: { message: string; author: { name?: string; date?: string } | null } }>>(
        '/commits?per_page=10',
      ),
      gh<{ workflow_runs: Array<{ name: string; status: string; conclusion: string | null; head_branch: string; created_at: string; html_url: string }> }>(
        '/actions/runs?per_page=6',
      ),
    ]);
    return {
      estado: 'ok',
      commits: commits.map((c) => ({
        sha: c.sha.slice(0, 7),
        mensaje: c.commit.message.split('\n')[0],
        autor: c.commit.author?.name ?? '—',
        fecha: c.commit.author?.date ?? '',
        url: c.html_url,
      })),
      ci: runs.workflow_runs.map((w) => ({
        nombre: w.name,
        estado: w.status,
        conclusion: w.conclusion,
        rama: w.head_branch,
        fecha: w.created_at,
        url: w.html_url,
      })),
    };
  } catch (e) {
    logger.error('github.actividad', { err: e instanceof Error ? e.message : String(e) });
    return { estado: 'error' };
  }
}
