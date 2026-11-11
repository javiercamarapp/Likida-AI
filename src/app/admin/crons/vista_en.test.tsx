import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }), usePathname: () => '/admin/crons', useSearchParams: () => new URLSearchParams() }));
import { CRONS, type CronId, type LatidoDetallado } from '@/lib/admin/salud';
import { crearTraductor } from '@/lib/i18n/traducir';
import type { TrDe } from '@/lib/i18n/tr_tipos';
import { admin_sistema as es } from '@/lib/i18n/es/admin_sistema';
import { admin_sistema as en } from '@/lib/i18n/en/admin_sistema';
import { VistaCrons } from './vista';

// Los relojes en inglés: el mismo render con el traductor en no deja texto en español y las horas salen por formato con idioma.
const tEn: TrDe<'admin_sistema'> = crearTraductor('en', en, es).t;

function latido(sobre: Partial<LatidoDetallado> = {}): LatidoDetallado {
  return { estado: 'ok', haceMin: 3, ultimoEstado: 'ok', ultimoLatido: '2026-08-28T18:00:00.000Z', cadenciaMs: 300_000, detalle: {}, motivoSalto: null, ...sobre };
}

describe('VistaCrons en inglés', () => {
  it('pinta nombres, cadencia y pulso en inglés', () => {
    const latidos = {} as Record<CronId, LatidoDetallado>;
    for (const c of CRONS) latidos[c] = latido();
    latidos.facturar = latido({ estado: 'vencido', haceMin: 90, ultimoEstado: 'fallo', detalle: { codigo: 'x' } });
    const html = renderToStaticMarkup(<VistaCrons latidos={latidos} t={tEn} idioma="en" />);
    expect(html).toContain('Crons');
    expect(html).toContain('every 5 min');
    expect(html).toContain('3 min ago');
    expect(html).not.toMatch(/cada \d+ min|hace \d+ min|Los procesos programados/);
  });

  it('con la lectura caída lo dice en inglés y no afirma que corran', () => {
    const html = renderToStaticMarkup(<VistaCrons latidos={null} t={tEn} idioma="en" />);
    expect(html).toContain('does NOT mean they are running');
  });
});
