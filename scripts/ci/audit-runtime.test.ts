import { describe, expect, it } from 'vitest';
import { clasificarAuditoriaRuntime } from './audit-runtime.mjs';

const conteosLimpios = { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 };
const reporte = (conteos: unknown) => ({ metadata: { vulnerabilities: conteos } });

describe('clasificador de npm audit para dependencias runtime', () => {
  it('acepta un reporte concluyente sin high ni critical', () => {
    expect(clasificarAuditoriaRuntime({
      metadata: { vulnerabilities: { ...conteosLimpios, moderate: 2, total: 2 } },
    })).toEqual({ tipo: 'limpia', high: 0, critical: 0 });
  });

  it('bloquea vulnerabilidades high/critical aunque npm termine con exit 1', () => {
    expect(clasificarAuditoriaRuntime({
      metadata: { vulnerabilities: { ...conteosLimpios, high: 2, critical: 1, total: 3 } },
    })).toEqual({ tipo: 'vulnerable', high: 2, critical: 1 });
  });

  it('distingue un 503 del registry para que CI reintente sin fingir verde', () => {
    expect(clasificarAuditoriaRuntime({
      error: { code: 'E503', summary: 'Service Unavailable - POST /-/npm/v1/security/advisories/bulk' },
    })).toEqual(expect.objectContaining({ tipo: 'inconclusa', codigo: 'E503' }));
  });

  it('un objeto inesperado también es inconcluso, nunca limpio', () => {
    expect(clasificarAuditoriaRuntime({})).toEqual(expect.objectContaining({ tipo: 'inconclusa' }));
  });

  it.each([{}, [], null, 'sin conteos'])('rechaza un contenedor de conteos inválido: %j', (conteos) => {
    expect(clasificarAuditoriaRuntime(reporte(conteos)).tipo).toBe('inconclusa');
  });

  for (const clave of Object.keys(conteosLimpios)) {
    it(`exige el conteo ${clave}`, () => {
      const conteos: Record<string, unknown> = { ...conteosLimpios };
      delete conteos[clave];
      expect(clasificarAuditoriaRuntime(reporte(conteos)).tipo).toBe('inconclusa');
    });

    it.each(['no-numero', '0', null, false, -1, 0.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1])(
      `rechaza ${clave} inválido: %s`, (valor) => {
        expect(clasificarAuditoriaRuntime(reporte({ ...conteosLimpios, [clave]: valor })).tipo).toBe('inconclusa');
      },
    );
  }

  it('no deja que un conteo negativo cancele una vulnerabilidad real', () => {
    expect(clasificarAuditoriaRuntime(reporte({ ...conteosLimpios, high: 1, critical: -1 })).tipo).toBe('inconclusa');
  });

  describe('aviso aceptado (GHSA-fc5q-39xc-vjpf, picomatch) hasta el 18-dic-2026', () => {
    const GHSA = 'https://github.com/advisories/GHSA-fc5q-39xc-vjpf';
    const conAviso = (extra: unknown[] = []) => ({
      metadata: { vulnerabilities: { ...conteosLimpios, moderate: 1, high: 3, total: 4 } },
      vulnerabilities: {
        picomatch: { severity: 'high', via: [{ url: GHSA, severity: 'high' }, ...extra] },
        fdir: { severity: 'high', via: ['picomatch'] },
        '@sentry/nextjs': { severity: 'high', via: ['fdir', 'glob'] },
        glob: { severity: 'moderate', via: [{ url: 'https://github.com/advisories/GHSA-zzzz-zzzz-zzzz', severity: 'moderate' }] },
      },
    });
    const antes = new Date('2026-11-18T12:00:00Z');

    it('con la fecha vigente, solo ese aviso y lo que arrastra deja el runtime limpio', () => {
      expect(clasificarAuditoriaRuntime(conAviso(), antes)).toEqual({ tipo: 'limpia', high: 0, critical: 0 });
    });

    it('vencida la fecha vuelve a bloquear', () => {
      expect(clasificarAuditoriaRuntime(conAviso(), new Date('2026-12-19T00:00:00Z')).tipo).toBe('vulnerable');
    });

    it('un aviso NUEVO en el mismo paquete sigue bloqueando', () => {
      const nuevo = [{ url: 'https://github.com/advisories/GHSA-aaaa-bbbb-cccc', severity: 'high' }];
      expect(clasificarAuditoriaRuntime(conAviso(nuevo), antes).tipo).toBe('vulnerable');
    });

    it('un high de otro paquete sigue bloqueando', () => {
      const r = conAviso() as { metadata: { vulnerabilities: Record<string, number> }; vulnerabilities: Record<string, unknown> };
      r.metadata.vulnerabilities.high = 4;
      r.vulnerabilities.otro = { severity: 'high', via: [{ url: 'https://github.com/advisories/GHSA-xxxx-yyyy-zzzz', severity: 'high' }] };
      expect(clasificarAuditoriaRuntime(r, antes).tipo).toBe('vulnerable');
    });

    it('sin detalle de paquetes no se cubre nada (falla cerrado)', () => {
      expect(clasificarAuditoriaRuntime({ metadata: { vulnerabilities: { ...conteosLimpios, high: 3, total: 3 } } }, antes).tipo).toBe('vulnerable');
    });
  });
});
