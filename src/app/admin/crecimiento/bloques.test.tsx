import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// /admin/crecimiento — cada bloque lee lo suyo y cae por su lado. Lo que se vigila: una lectura caída NUNCA se pinta como «no hay nada»,
// ningún cero tiene cara de medición, un solo <h1> (el del marco), y las comisiones de los vendedores se declaran «falta» (no hay base).
const dobles = vi.hoisted(() => ({
  getResumenNegocio: vi.fn(), getAdquisicion: vi.fn(), listarCampanasConTotal: vi.fn(), getResumenProspectos: vi.fn(),
  getEmbudoActivacion: vi.fn(), getCohortesUso: vi.fn(), requireSuperadmin: vi.fn(),
}));
vi.mock('@/lib/auth/guard', () => ({ requireSuperadmin: dobles.requireSuperadmin }));
vi.mock('@/lib/admin/negocio', () => ({ getResumenNegocio: dobles.getResumenNegocio }));
vi.mock('@/lib/admin/adquisicion', () => ({ getAdquisicion: dobles.getAdquisicion }));
vi.mock('@/lib/admin/campanas', () => ({
  listarCampanasConTotal: dobles.listarCampanasConTotal,
  estadoIntegracionAds: () => ({ metaConfigurada: false, googleConfigurada: false, nota: '' }),
  pausarCampana: vi.fn(), refrescarGastoMeta: vi.fn(),
}));
// w15/perf: el embudo lee el RESUMEN compartido (una sola lectura de la cartera viva), no 15 conteos aparte.
vi.mock('@/lib/admin/prospectos-mapa', async (importar) => ({ ...(await importar<typeof import('@/lib/admin/prospectos-mapa')>()), getResumenProspectos: dobles.getResumenProspectos }));
vi.mock('@/lib/admin/instrumentacion', () => ({ getEmbudoActivacion: dobles.getEmbudoActivacion, getCohortesUso: dobles.getCohortesUso }));
vi.mock('./acciones', () => ({ accionPausarCampana: vi.fn(), accionRefrescarGasto: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock('next/link', () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));

import { BloqueActivacion, BloqueCampanas, BloqueCifrasCrecimiento, BloqueCohortes, BloqueComisiones, BloqueCostoLead, BloqueEmbudoAdquisicion, BloqueIntro, BloqueUso } from './bloques';
import { ControlCampanas } from './campanas';
import CrecimientoPage from './page';

const resumen = (total: number, porEtapa: Record<string, number>) => ({ generadoEn: 'x', total, porEtapa, conTelefono: 0, conDecisor: 0, sinPlaza: 0, porEntidad: {} });
const html = async (bloque: () => Promise<React.ReactElement> | React.ReactElement) => renderToStaticMarkup(await bloque());
const CAMPANA = { id: 'c-1', canal: 'meta' as const, idExterno: 'x', nombre: 'Campaña A', presupuestoAprobadoUsd: 100, cplObjetivoUsd: 5, estado: 'activa' as const, aprobadoPorEmail: null, aprobadoEn: null, gastoRealUsd: null, gastoMedidoEn: null };

beforeEach(() => {
  vi.clearAllMocks();
  dobles.requireSuperadmin.mockResolvedValue({ rol: 'superadmin' });
  dobles.getResumenNegocio.mockResolvedValue({ tenants: 1, flotas: [{ id: 't-1' }], porDia: [{ dia: '2026-11-01', costoUsd: 1, tokens: 10 }, { dia: '2026-11-02', costoUsd: 2, tokens: 20 }], viajesProcesados: 4, tokensIn: 5, tokensOut: 5, tendenciaTokens: null });
  dobles.getResumenProspectos.mockResolvedValue(resumen(10, { nuevo: 10 }));
  dobles.getAdquisicion.mockResolvedValue({ porFuente: [], alertas: [], sinFuenteDeDatos: [] });
  dobles.listarCampanasConTotal.mockResolvedValue({ campanas: [], total: 0 });
  dobles.getEmbudoActivacion.mockResolvedValue({ altas: 4, activadas: 1, dePago: 0 });
  dobles.getCohortesUso.mockResolvedValue({ filas: [], desdeMedicion: null });
});

describe('BloqueIntro', () => {
  it('no pinta un <h1> propio: el título lo pone el marco', async () => {
    expect(await html(BloqueIntro)).not.toContain('<h1');
  });
  it('con la base caída NO afirma cuántas flotas hay', async () => {
    dobles.getResumenNegocio.mockRejectedValue(new Error('caída'));
    const h = await html(BloqueIntro);
    expect(h).toContain('No se pudo leer el número de flotas');
    expect(h).not.toMatch(/Con \d+ flota/);
  });
});

describe('embudo de adquisición', () => {
  it('lectura caída: lo dice y no afirma que no haya prospectos', async () => {
    dobles.getResumenProspectos.mockRejectedValue(new Error('caída'));
    const h = await html(BloqueEmbudoAdquisicion);
    expect(h).toContain('No se pudo leer el pipeline');
    expect(h).toContain('NO significa que no haya prospectos');
  });
  it('sin cierres no inventa una conversión', async () => {
    const h = await html(BloqueEmbudoAdquisicion);
    expect(h).toContain('Sin cierres todavía');
    expect(h).not.toMatch(/Conversión a cierre: 0/);
  });
  it('(16) barras SOLO para las etapas con gente, proporcionales y de color; las que valen 0 se dicen en una línea', async () => {
    dobles.getResumenProspectos.mockResolvedValue(resumen(130, { nuevo: 100, contactado: 25, negociacion: 5 }));
    const h = await html(BloqueEmbudoAdquisicion);
    expect(h).toContain('130 prospectos del censo');
    // Tres etapas con gente = tres barras; 'negociacion' (alias histórico) suma en «Propuesta».
    expect(h.match(/rv-barlist__fila/g)).toHaveLength(3);
    expect(h).toContain('Propuesta');
    expect(h).toMatch(/width="100\.?0*%"/);
    expect(h).toMatch(/width="25\.?0*%"/);
    expect(h).toMatch(/width="5\.?0*%"/);
    // Las siete etapas en cero NO son siete filas: van en una frase.
    expect(h).toContain('Sin prospectos todavía en: Cita agendada, Cita reprogramada');
    expect(h.match(/<svg/g)).toHaveLength(3);
  });
  it('(6) el total del título y la fila «Nuevo» son LA misma cifra (una sola lectura)', async () => {
    dobles.getResumenProspectos.mockResolvedValue(resumen(33_148, { nuevo: 33_148 }));
    const h = await html(BloqueEmbudoAdquisicion);
    expect(h).toContain('33,148 prospectos del censo');
    expect((h.match(/33,148/g) ?? []).length).toBe(2);
    expect(h).not.toContain('33,153');
    expect(h).not.toContain('33,676');
  });
  it('sin prospectos dice qué falta', async () => {
    dobles.getResumenProspectos.mockResolvedValue(resumen(0, {}));
    expect(await html(BloqueEmbudoAdquisicion)).toContain('Sin prospectos en el censo');
  });
});

describe('activación y cohortes', () => {
  it('el embudo de activación dice que el cero de «de pago» es un conteo real', async () => {
    const h = await html(BloqueActivacion);
    expect(h).toContain('El cero de «de pago» es un conteo real');
  });
  it('el embudo de activación son barras de 6 px con la cifra exacta de cada etapa y la conversión contra la anterior', async () => {
    const h = await html(BloqueActivacion);
    expect(h).toContain('rv-barlist');
    expect(h).toContain('· 25%');
    expect(h).toContain('· 0%'); // de pago: 0 de 1 activada; es un cero real, no un faltante
    expect(h).toContain('data-lift');
  });
  it('con los tres conteos en cero dice que el cero es real, no «sin datos»', async () => {
    dobles.getEmbudoActivacion.mockResolvedValue({ altas: 0, activadas: 0, dePago: 0 });
    const h = await html(BloqueActivacion);
    expect(h).toContain('las tres etapas valen cero');
    expect(h).not.toContain('rv-barlist');
  });
  it('lecturas caídas: no se pintan como cero flotas ni como cero uso', async () => {
    dobles.getEmbudoActivacion.mockResolvedValue(null);
    dobles.getCohortesUso.mockResolvedValue(null);
    expect(await html(BloqueActivacion)).toContain('NO significa que haya cero flotas');
    expect(await html(BloqueCohortes)).toContain('NO significa que no haya uso');
  });
  it('un mes sin medición se pinta «no medido», nunca 0 %', async () => {
    dobles.getCohortesUso.mockResolvedValue({ desdeMedicion: '2026-10', filas: [{ cohorte: '2026-09', flotas: 2, celdas: [{ mes: '2026-09', activas: null, enCurso: false }, { mes: '2026-10', activas: 1, enCurso: true }] }] });
    const h = await html(BloqueCohortes);
    expect(h).toContain('09 · no medido');
    expect(h).toContain('10 · 1/2 (en curso)');
    expect(h).not.toContain('0 %');
  });
});

describe('costo por lead y campañas', () => {
  it('adquisición caída: lo dice', async () => {
    dobles.getAdquisicion.mockResolvedValue(null);
    expect(await html(BloqueCostoLead)).toContain('NO significa que no haya alertas');
  });
  it('campañas caídas: lo dicen y no afirman que no haya', async () => {
    dobles.listarCampanasConTotal.mockResolvedValue(null);
    expect(await html(BloqueCampanas)).toContain('NO significa que no haya');
  });
  it('el costo por lead sin dato dice «no disponible», nunca $0', async () => {
    dobles.getAdquisicion.mockResolvedValue({ porFuente: [{ fuente: 'ads', leads: 3, ultimoCapturado: '2026-11-01T00:00:00Z', costo: null, costoNota: 'falta integración de gasto' }], alertas: [], sinFuenteDeDatos: [] });
    const h = await html(BloqueCostoLead);
    expect(h).toContain('no disponible');
    expect(h).toContain('falta integración de gasto');
  });
});

describe('uso', () => {
  it('rotula el gasto de IA como proxy de uso, no como usuarios, y no inventa el delta de tokens', async () => {
    const h = await html(BloqueUso);
    expect(h).toContain('No es una métrica de usuarios');
    const cifras = await html(BloqueCifrasCrecimiento);
    expect(cifras).toContain('Tokens usados');
    expect(cifras).toContain('Observado');
  });
  it('lectura caída: no se pinta como uso cero', async () => {
    dobles.getResumenNegocio.mockRejectedValue(new Error('caída'));
    expect(await html(BloqueUso)).toContain('NO significa que no se use');
  });
});

describe('comisiones de vendedores', () => {
  it('se declaran «falta»: no hay base y la pantalla no calcula ni una cifra', async () => {
    const h = await html(async () => BloqueComisiones());
    expect(h).toContain('Comisiones de vendedores');
    expect(h).toContain('Falta: aún no hay base para calcularlas');
    expect(h).toContain('sería inventar una cifra');
    expect(h).not.toMatch(/\$\d/);
  });
});

describe('ControlCampanas', () => {
  const props = { integracion: { metaConfigurada: true }, leadsAds: 0, pausar: vi.fn(), refrescar: vi.fn() };
  it('pausar tiene efecto externo: el botón abre una confirmación (el diálogo nace cerrado)', () => {
    const h = renderToStaticMarkup(<ControlCampanas {...props} campanas={[CAMPANA]} />);
    expect(h).toMatch(/<button[^>]*>Pausar<\/button>/);
    expect(h).not.toMatch(/<dialog[^>]*\sopen/);
    expect(props.pausar).not.toHaveBeenCalled();
  });
  it('sin gasto medido dice «sin medir» y «sin gasto medido», nunca $0', () => {
    const h = renderToStaticMarkup(<ControlCampanas {...props} campanas={[CAMPANA]} />);
    expect(h).toContain('sin medir');
    expect(h).toContain('sin gasto medido');
  });
  it('sin conexión con Meta lo dice y no ofrece medir el gasto', () => {
    const h = renderToStaticMarkup(<ControlCampanas {...props} integracion={{ metaConfigurada: false }} campanas={[CAMPANA]} />);
    expect(h).toContain('Sin conexión con Meta Ads');
    expect(h).not.toContain('Actualizar gasto desde Meta');
    expect(h).not.toContain('META_ADS_TOKEN');
  });
  it('cero campañas explica el candado de aprobación', () => {
    expect(renderToStaticMarkup(<ControlCampanas {...props} campanas={[]} />)).toContain('Cero campañas registradas');
  });
});

describe('la página', () => {
  it('exige superadmin, monta UN <h1> con el nombre del menú y ningún marcado de v1', async () => {
    const h = renderToStaticMarkup(await CrecimientoPage());
    expect(dobles.requireSuperadmin).toHaveBeenCalled();
    expect((h.match(/<h1/g) ?? []).length).toBe(1);
    expect(h).toContain('>Crecimiento</h1>');
    expect(h).not.toContain('class="card p-');
  });
  it('sin sesión de superadmin no lee nada', async () => {
    dobles.requireSuperadmin.mockRejectedValue(new Error('REDIRECT'));
    await expect(CrecimientoPage()).rejects.toThrow('REDIRECT');
    expect(dobles.getResumenNegocio).not.toHaveBeenCalled();
  });
});
