// La actividad del repo en vivo — el contrato de TRES estados es la prueba:
// sin llave, API caída y datos son cosas DISTINTAS y ninguna se disfraza de
// cero (la regla de la casa aplicada a GitHub).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getActividadGitHub, getMapaCommits, getAutoresCommits } from './github';

const conToken = () => vi.stubEnv('GITHUB_TOKEN', 'github_pat_prueba');

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('getActividadGitHub', () => {
  it('sin GITHUB_TOKEN → sin_token, sin tocar la red', async () => {
    vi.stubEnv('GITHUB_TOKEN', '');
    const fetchEspia = vi.fn();
    vi.stubGlobal('fetch', fetchEspia);
    expect((await getActividadGitHub()).estado).toBe('sin_token');
    expect(fetchEspia).not.toHaveBeenCalled();
  });

  it('GitHub caído → error (que NO es una lista vacía)', async () => {
    conToken();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 500 })));
    expect((await getActividadGitHub()).estado).toBe('error');
  });

  it('con datos: commits con sha corto y primera línea; CI con conclusión', async () => {
    conToken();
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('/commits')) {
        return Response.json([{
          sha: 'abcdef1234567890', html_url: 'https://x/c',
          commit: { message: 'feat: lo nuevo\n\ncuerpo largo', author: { name: 'Javier', date: '2026-08-17T00:00:00Z' } },
        }]);
      }
      return Response.json({ workflow_runs: [{ name: 'verificar', status: 'completed', conclusion: 'success', head_branch: 'master', created_at: '2026-08-17T00:00:00Z', html_url: 'https://x/r' }] });
    }));
    const r = await getActividadGitHub();
    if (r.estado !== 'ok') throw new Error(`esperaba ok, vino ${r.estado}`);
    expect(r.commits[0]).toMatchObject({ sha: 'abcdef1', mensaje: 'feat: lo nuevo', autor: 'Javier' });
    expect(r.ci[0]).toMatchObject({ nombre: 'verificar', conclusion: 'success' });
  });
});

describe('getMapaCommits — el mapa de puntos', () => {
  it('202 = GitHub aún lo genera; se dice, no se pinta vacío', async () => {
    conToken();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 202 })));
    expect((await getMapaCommits()).estado).toBe('generando');
  });

  it('con datos: semanas en ms y total sumado', async () => {
    conToken();
    vi.stubGlobal('fetch', vi.fn(async () => Response.json([
      { week: 1_755_000_000, days: [0, 2, 5, 0, 0, 1, 0], total: 8 },
      { week: 1_755_604_800, days: [3, 0, 0, 0, 0, 0, 0], total: 3 },
    ])));
    const r = await getMapaCommits();
    if (r.estado !== 'ok') throw new Error(`esperaba ok, vino ${r.estado}`);
    expect(r.total).toBe(11);
    expect(r.semanas[0].inicio).toBe(1_755_000_000_000);
    expect(r.semanas[0].dias).toHaveLength(7);
  });
});

describe('getAutoresCommits — el por-integrante del mapa', () => {
  it('ordena por pushes y aguanta un author nulo (commits sin cuenta ligada)', async () => {
    conToken();
    vi.stubGlobal('fetch', vi.fn(async () => Response.json([
      { total: 12, author: { login: 'javiercamarapp' } },
      { total: 851, author: { login: 'claude' } },
      { total: 3, author: null },
    ])));
    const r = await getAutoresCommits();
    if (r.estado !== 'ok') throw new Error(`esperaba ok, vino ${r.estado}`);
    expect(r.autores[0]).toEqual({ nombre: 'claude', pushes: 851 });
    expect(r.autores.map((a) => a.nombre)).toContain('desconocido');
  });

  it('202 = generando; sin token = se dice (no "cero autores")', async () => {
    conToken();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 202 })));
    expect((await getAutoresCommits()).estado).toBe('generando');
    vi.stubEnv('GITHUB_TOKEN', '');
    expect((await getAutoresCommits()).estado).toBe('sin_token');
  });
});
