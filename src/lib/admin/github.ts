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
