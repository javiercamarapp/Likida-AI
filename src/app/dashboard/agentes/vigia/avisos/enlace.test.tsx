import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { EnlaceAvisos } from '../vista';

// El acceso desde el tablero del Vigía a la bandeja de avisos de viaje y su contador (T-A4-22).
const pintar = async (sufijo: string, pendientes?: Promise<number | null>) =>
  renderToStaticMarkup(await EnlaceAvisos({ sufijo, pendientes }));

describe('el enlace a «Avisos de viaje» del tablero', () => {
  it('con avisos por revisar enseña cuántos', async () => {
    expect(await pintar('', Promise.resolve(3))).toContain('Avisos de viaje (3 por revisar)');
  });
  it('sin pendientes, sin contar o si el conteo falla: el enlace va sin número (no inventa un cero)', async () => {
    expect(await pintar('', Promise.resolve(0))).not.toContain('por revisar');
    expect(await pintar('', Promise.resolve(null))).not.toContain('por revisar');
    expect(await pintar('')).not.toContain('por revisar');
    expect(await pintar('', Promise.reject(new Error('base caída')))).not.toContain('por revisar');
  });
  it('conserva el sufijo de tenant y apunta a la bandeja', async () => {
    expect(await pintar('?tenant=abc', Promise.resolve(1))).toContain('href="/dashboard/agentes/vigia/avisos?tenant=abc"');
  });
});
