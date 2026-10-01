import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA OLA 1, #10 — /aviso/<flota> NO da 404 por un dato que le toca capturar
// a la empresa. 404 solo para «esa flota no existe» (y para un id sin forma de UUID).
// ═══════════════════════════════════════════════════════════════════════════

const d = vi.hoisted(() => ({ datos: null as unknown }));
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('NEXT_NOT_FOUND'); } }));
vi.mock('@/lib/likida/repo', () => ({ getDatosResponsable: async () => d.datos }));

import AvisoIntegral from './page';

const TENANT = '11111111-1111-4111-8111-111111111111';
const base = { urlAvisoIntegral: `https://app.likida.ai/aviso/${TENANT}`, contactoPrivacidad: null, gps: 'sin_conector' };
const render = async (tenant = TENANT) => renderToStaticMarkup(await AvisoIntegral({ params: Promise.resolve({ tenant }) }));

beforeEach(() => { d.datos = null; });

describe('/aviso/<flota>', () => {
  it('con los datos completos pinta la razón social y SIN el banner de pendientes de identidad', async () => {
    d.datos = { ...base, razonSocial: 'TRANSPORTES PÉREZ SA DE CV', nombreFlota: 'Pérez', domicilio: 'Calle 1, Mérida' };
    const html = await render();
    expect(html).toContain('TRANSPORTES PÉREZ SA DE CV');
    expect(html).not.toContain('Su razón social inscrita');
  });

  it('SIN razón social: renderiza (no 404), nombra a la flota por su nombre de alta y señala el dato como pendiente', async () => {
    d.datos = { ...base, razonSocial: '', nombreFlota: 'Transportes Pérez', domicilio: 'Calle 1, Mérida' };
    const html = await render();
    expect(html).toContain('Transportes Pérez');
    expect(html).toMatch(/razón social inscrita/);
    expect(html).toMatch(/Pendiente de capturar/);
    expect(html).toMatch(/PRIVACIDAD/);
  });

  it('sin razón social ni nombre de alta: «la empresa», jamás vacío', async () => {
    d.datos = { ...base, razonSocial: '', nombreFlota: null, domicilio: '' };
    const html = await render();
    expect(html).toContain('la empresa');
    expect(html).not.toMatch(/undefined|>null</);
  });

  it('una flota que NO existe sigue siendo 404 (y no distingue «a medias» de «inexistente»)', async () => {
    d.datos = null;
    await expect(render()).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('un id sin forma de UUID es 404 sin consultar la base', async () => {
    d.datos = { ...base, razonSocial: 'X', domicilio: 'Y' };
    await expect(render('no-es-uuid')).rejects.toThrow('NEXT_NOT_FOUND');
  });
});
