// ═══════════════════════════════════════════════════════════════════════════
// ACTIVIDAD DE CÓDIGO — el heatmap de commits del repo (16-ago-2026, pedido
// de Javier: "un control de pushes a GitHub como el de los puntitos").
//
// Fuente: la API de GitHub del repo real (stats/commit_activity: 52 semanas
// con el desglose por día, en UNA llamada + la lista de commits recientes).
// El repo es privado: sin GITHUB_TOKEN la pantalla lo DICE — jamás un
// heatmap vacío con cara de "nadie ha trabajado". stats/commit_activity
// puede contestar 202 (GitHub aún calculando): también se dice, con
// reintento en la mano del usuario.
// ═══════════════════════════════════════════════════════════════════════════

const REPO = 'javiercamarapp/likida.ai';

export interface SemanaActividad {
  /** Epoch (segundos) del domingo que abre la semana. */
  semana: number;
  /** Commits por día, domingo→sábado. */
  dias: number[];
  total: number;
}

export interface CommitReciente {
  sha: string;
  mensaje: string;
  autor: string;
  fecha: string;
}

export type ActividadCodigo =
  | { estado: 'sin_token' }
  | { estado: 'calculando' }
  | { estado: 'error'; detalle: string }
  | { estado: 'ok'; semanas: SemanaActividad[]; totalAnual: number; recientes: CommitReciente[] };

export async function getActividadCodigo(): Promise<ActividadCodigo> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return { estado: 'sin_token' };
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'likida-admin',
  };

  try {
    const [actividad, commits] = await Promise.all([
      fetch(`https://api.github.com/repos/${REPO}/stats/commit_activity`, { headers, signal: AbortSignal.timeout(20_000), cache: 'no-store' }),
      fetch(`https://api.github.com/repos/${REPO}/commits?per_page=10`, { headers, signal: AbortSignal.timeout(20_000), cache: 'no-store' }),
    ]);
    if (actividad.status === 202) return { estado: 'calculando' };
    if (!actividad.ok) return { estado: 'error', detalle: `GitHub contestó ${actividad.status} al pedir la actividad.` };

    const semanasCrudas = await actividad.json() as Array<{ week: number; days: number[]; total: number }>;
    if (!Array.isArray(semanasCrudas)) return { estado: 'error', detalle: 'La actividad no tiene la forma esperada.' };
    const semanas: SemanaActividad[] = semanasCrudas.map((s) => ({ semana: s.week, dias: s.days, total: s.total }));

    let recientes: CommitReciente[] = [];
    if (commits.ok) {
      const filas = await commits.json() as Array<{ sha: string; commit: { message: string; author?: { name?: string; date?: string } } }>;
      recientes = (Array.isArray(filas) ? filas : []).map((c) => ({
        sha: c.sha.slice(0, 7),
        mensaje: (c.commit.message.split('\n')[0] ?? '').slice(0, 120),
        autor: c.commit.author?.name ?? '—',
        fecha: c.commit.author?.date ?? '',
      }));
    }
    return { estado: 'ok', semanas, totalAnual: semanas.reduce((s, x) => s + x.total, 0), recientes };
  } catch (e) {
    return { estado: 'error', detalle: e instanceof Error ? e.message.slice(0, 120) : 'red' };
  }
}
