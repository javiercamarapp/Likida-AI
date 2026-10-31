import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { SenalesAsistente } from '@/lib/likida/asistente/pasos_cinco_agentes';

vi.mock('next/navigation', () => ({ usePathname: () => '/dashboard', useRouter: () => ({ push: () => {} }) }));

const base: SenalesAsistente = {
  tms: 'sin_credencial', archivosRecibidos: 0, correoPlataforma: true,
  correoDesglose: { activa: false, usaCorreo: false, remitenteCapturado: false },
  operadores: { activos: 0, conCorreo: 0 }, unidadesActivas: 0, patios: 0, coordinadores: 0, supervisores: 0, revisorCartaPorte: false,
};
let actuales: SenalesAsistente = base;
const lecturas = vi.fn(async () => actuales);
vi.mock('@/lib/likida/asistente/senales', () => ({ leerSenalesAsistente: lecturas }));

const { ResumenV2, indicadoresResumen } = await import('./resumen-v2');

const pintar = async (s: SenalesAsistente, veAsistente = true) => {
  actuales = s;
  const el = await ResumenV2({
    tenantId: 't', userId: 'u', tenantNombre: null, nombre: 'Ana', tenantExiste: true, sufijo: '', soloLectura: false, veAsistente,
    fichas: <div data-ficha>fichas</div>,
  });
  return renderToStaticMarkup(el);
};

describe('indicadoresResumen', () => {
  it('null (no se pudo leer) NO se vuelve 0, y el 0 medido sí se conserva', () => {
    const caido = indicadoresResumen({ ...base, operadores: null, unidadesActivas: null, supervisores: null });
    expect(caido.every((k) => k.valor === null)).toBe(true);
    const cero = indicadoresResumen(base);
    expect(cero.map((k) => k.valor)).toEqual([0, 0, 0, 0]);
  });
  it('«con correo» desconocido es null aunque haya operadores', () => {
    const k = indicadoresResumen({ ...base, operadores: { activos: 5, conCorreo: null } });
    expect(k[1].valor).toBeNull();
    expect(k[1].nota).toBeUndefined();
  });
});

describe('Resumen v2', () => {
  it('cuenta vacía: invita al archivo de muestra, sin cifras de ahorro ni «Hoy» inventado', async () => {
    const h = await pintar(base);
    expect(h.includes('Todavía no ha llegado ningún archivo')).toBe(true);
    expect(h.includes('Entregar archivo de muestra')).toBe(true);
    expect(h.includes('/dashboard/puesta-en-marcha?paso=tms')).toBe(true);
    expect(h.includes('0 de 6 pasos terminados')).toBe(true);
    expect(/ahorr/i.test(h)).toBe(false);
    expect(h.includes('data-ficha')).toBe(true);
  });
  it('con un archivo recibido lo dice sin inventar procesados, enviados ni rebotes', async () => {
    const h = await pintar({ ...base, archivosRecibidos: 1 });
    expect(h.includes('Ya recibimos un archivo de muestra')).toBe(true);
    expect(/rebote/i.test(h)).toBe(false);
  });
  it('lectura caída: lo confiesa y la tira muestra «—» con sello Sin dato', async () => {
    const h = await pintar({ ...base, archivosRecibidos: null, operadores: null, unidadesActivas: null, supervisores: null });
    expect(h.includes('No pudimos revisar tus archivos ahora')).toBe(true);
    expect(h.includes('Sin dato')).toBe(true);
    expect(h.includes('NaN')).toBe(false);
  });
});

describe('Resumen v2 para un rol sin acceso a Puesta en marcha (p. ej. el encargado)', () => {
  it('no pinta la tarjeta ni el enlace y ni siquiera lee las señales del asistente; las fichas siguen', async () => {
    lecturas.mockClear();
    const h = await pintar({ ...base, tms: { activa: true, probadaEn: null, ultimoError: 'x' }, archivosRecibidos: 3 }, false);
    expect(lecturas).not.toHaveBeenCalled();
    expect(h.includes('puesta-en-marcha')).toBe(false);
    expect(h.includes('Puesta en marcha')).toBe(false);
    expect(h.includes('Operadores activos')).toBe(false);
    expect(h.includes('data-ficha')).toBe(true);
  });
  it('para quien sí tiene acceso lee las señales y pinta la tarjeta', async () => {
    lecturas.mockClear();
    const h = await pintar(base, true);
    expect(lecturas).toHaveBeenCalledTimes(1);
    expect(h.includes('Puesta en marcha')).toBe(true);
  });
});
