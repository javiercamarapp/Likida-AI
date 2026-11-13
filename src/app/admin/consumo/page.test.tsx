import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';
// A37-S05-01/S06-01: la página ahora llama su propia puerta; aquí la sesión es de superadmin.
vi.mock('@/lib/auth/guard', () => ({ requireSuperadmin: vi.fn(async () => ({ rol: 'superadmin', tenantId: null, nombre: 'Prueba' })) }));

// ═══════════════════════════════════════════════════════════════════════════
// /admin/consumo — CERO cobertura de la PÁGINA (getResumenNegocio y
// getConsumoPorAgente/getPresupuestoPorProposito ya tienen prueba propia).
// Sin server actions. Lo real que se vigila: resiliencia POR SECCIÓN —
// r/consumo/proposito caen cada uno por su lado, así que con la 0123 o la
// 0244 sin aplicar, la mitad que SÍ funciona sigue viva y lo dice — nunca
// pinta ceros donde en realidad no se pudo leer.
// ═══════════════════════════════════════════════════════════════════════════

const dobles = vi.hoisted(() => ({
  getResumenNegocio: vi.fn(),
  getConsumoPorAgente: vi.fn(),
  getPresupuestoPorProposito: vi.fn(),
  leerEstadoCreditoIa: vi.fn(),
  avisosEncendidos: vi.fn(),
  listarAlertasTope: vi.fn(),
}));

vi.mock('@/lib/admin/negocio', () => ({ getResumenNegocio: dobles.getResumenNegocio }));
vi.mock('@/lib/admin/consumo', () => ({ getConsumoPorAgente: dobles.getConsumoPorAgente, getPresupuestoPorProposito: dobles.getPresupuestoPorProposito }));
vi.mock('@/lib/admin/estado-ia', async (importar) => ({
  ...(await importar<typeof import('@/lib/admin/estado-ia')>()),
  leerEstadoCreditoIa: dobles.leerEstadoCreditoIa,
  avisosDeTopeEncendidos: dobles.avisosEncendidos,
}));
vi.mock('@/lib/llm/repo', () => ({ listarAlertasTopeRecientes: dobles.listarAlertasTope }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }));

import ConsumoPage from './page';

async function renderizar() { return renderToStaticMarkup(await ConsumoPage()); }

const R_OK = {
  costoIaUsd: 120, tokensIn: 1000, tokensOut: 500, tendenciaCosto: -0.1, tendenciaTokens: 0.05,
  porDia: [{ dia: '2026-01-01', costoUsd: 10 }, { dia: '2026-01-02', costoUsd: 12 }],
  viajesProcesados: 10,
  porModelo: [{ modelo: 'gpt-5', n: 10, costoUsd: 5 }],
  porFase: [{ fase: 'ocr', n: 10, costoUsd: 5 }],
  flotas: [{ id: 't-1', nombre: 'Flota A', viajes: 10, costoIaUsd: 5 }, { id: 't-2', nombre: 'Flota B', viajes: 20, costoIaUsd: 15 }],
};
const CONSUMO_OK = {
  agentes: [{ agente: 'analista', estado: 'vivo', runnerHabilitado: true, corridas30d: 100, fallos30d: 2, gastado30dUsd: 3, techoDiaUsd: 1, pctTechoHoy: 50 }],
  insights: [{ tipo: 'problema', titulo: 'Techo excedido', detalle: 'x' }, { tipo: 'recomendacion', titulo: 'Baja el modelo', detalle: 'y' }],
};
const PROPOSITO_OK = {
  topeTenantDiaUsd: 10, reservaInteractivoUsd: 7, fraccionReserva: 0.7,
  filas: [{ tenantId: 't-1', tenantNombre: 'Flota A', proposito: 'interactivo', n: 5, liquidadoUsd: 1, reservadoVivoUsd: 0.5 }],
};

beforeEach(() => {
  vi.clearAllMocks();
  dobles.getResumenNegocio.mockResolvedValue(R_OK);
  dobles.getConsumoPorAgente.mockResolvedValue(CONSUMO_OK);
  dobles.getPresupuestoPorProposito.mockResolvedValue(PROPOSITO_OK);
  dobles.leerEstadoCreditoIa.mockResolvedValue({ clave: 'ok', restanteUsd: 42 });
  dobles.avisosEncendidos.mockReturnValue(true);
  dobles.listarAlertasTope.mockResolvedValue([]);
});

it('si TODO falla (resumen y consumo por agente), la página entera dice que no se pudo leer — nunca "$0 gastado"', async () => {
  dobles.getResumenNegocio.mockRejectedValueOnce(new Error('caída'));
  dobles.getConsumoPorAgente.mockRejectedValueOnce(new Error('caída'));
  const html = await renderizar();
  expect(html).toContain('No se pudo leer el consumo');
  expect(html).toContain('NO significa que la IA salga gratis');
});

it('si SOLO el resumen (llm_costo) falla, la sección de agentes sigue viva por su lado', async () => {
  dobles.getResumenNegocio.mockRejectedValueOnce(new Error('caída'));
  const html = await renderizar();
  expect(html).toContain('No disponible ahora. No es cero.'); // la cifra del gasto del producto cae en error, no en cero
  expect(html).toContain('Analista'); // la tabla de agentes sí se pintó
});

it('si SOLO el consumo por agente (migración 0123) falla, el resumen de negocio sigue vivo', async () => {
  dobles.getConsumoPorAgente.mockRejectedValueOnce(new Error('caída'));
  const html = await renderizar();
  expect(html).toContain('La medición por agente no se pudo leer');
  expect(html).not.toMatch(/migración 0\d{3}/);
  expect(html).toContain('Flota A'); // la tabla por flota (de r) sí se pintó
});

it('si el presupuesto por propósito (migración 0244) falla, el resto de la página sigue viva', async () => {
  dobles.getPresupuestoPorProposito.mockRejectedValueOnce(new Error('caída'));
  const html = await renderizar();
  expect(html).toContain('No se pudo leer el gasto por propósito');
  expect(html).not.toMatch(/migración 0\d{3}/);
  expect(html).toContain('Analista');
});

it('los insights se separan: "problema" arriba de todo, el resto abajo en su propia sección', async () => {
  const html = await renderizar();
  const idxProblema = html.indexOf('Techo excedido');
  const idxTabla = html.indexOf('Por agente, gasto medido');
  const idxRecomendacion = html.indexOf('Baja el modelo');
  expect(idxProblema).toBeGreaterThan(-1);
  expect(idxProblema).toBeLessThan(idxTabla); // problema va ANTES de la tabla de agentes
  expect(idxRecomendacion).toBeGreaterThan(idxTabla); // recomendación va DESPUÉS
});

it('sin flotas dadas de alta (lectura ok, arreglo vacío) dice eso, no "no se pudo leer"', async () => {
  dobles.getResumenNegocio.mockResolvedValue({ ...R_OK, flotas: [] });
  const html = await renderizar();
  expect(html).toContain('Sin flotas dadas de alta');
  expect(html).not.toContain('No se pudo leer el costo por flota');
});

it('las flotas se ordenan por costo de IA descendente, no por orden de llegada', async () => {
  const html = (await renderizar()).split('Por flota, costo de IA histórico')[1];
  expect(html.indexOf('Flota B')).toBeLessThan(html.indexOf('Flota A')); // B ($15) antes que A ($5)
});

it('sin historial de días suficiente, no intenta pintar una gráfica de un solo punto', async () => {
  dobles.getResumenNegocio.mockResolvedValue({ ...R_OK, porDia: [{ dia: '2026-01-01', costoUsd: 10 }] });
  const html = await renderizar();
  expect(html).toContain('Sin historial suficiente');
});

it('hoy nadie ha gastado por propósito (filas vacías) lo dice explícito, distinto de "no se pudo leer"', async () => {
  dobles.getPresupuestoPorProposito.mockResolvedValue({ ...PROPOSITO_OK, filas: [] });
  const html = await renderizar();
  expect(html).toContain('Hoy nadie ha gastado todavía');
});

it('A37-S05-02: el costo por flota se rotula HISTÓRICO, no "ventana (7 días)"', async () => {
  const html = await renderizar();
  expect(html).toContain('costo de IA histórico');
  expect(html).not.toContain('ventana (7 días)');
});

// ── Lo nuevo de la fase: crédito del proveedor (402) y avisos de tope 80 / 100 % ─────────────────────────────────────────────

it('crédito agotado (402): aviso de error arriba de todo y la cifra dice IA caída — no un saldo', async () => {
  dobles.leerEstadoCreditoIa.mockResolvedValue({ clave: 'sin_saldo', restanteUsd: null });
  const html = await renderizar();
  expect(html).toContain('Crédito de IA agotado (402)');
  expect(html).toContain('IA caída');
  expect(html.indexOf('Crédito de IA agotado (402)')).toBeLessThan(html.indexOf('Gastado en IA'));
});

it('si no se pudo comprobar el crédito, lo dice y NO afirma que haya saldo', async () => {
  dobles.leerEstadoCreditoIa.mockResolvedValue({ clave: 'sin_dato', restanteUsd: null });
  const html = await renderizar();
  expect(html).toContain('No se pudo comprobar el crédito de IA');
  expect(html).not.toContain('Con crédito');
});

it('con crédito y saldo reportado, la cifra es el saldo del proveedor', async () => {
  const html = await renderizar();
  expect(html).toContain('Crédito del proveedor');
  expect(html).toContain('$42.00');
  expect(html).not.toContain('IA caída');
});

it('los avisos de tope registrados se listan con su nivel, su flota y su uso', async () => {
  dobles.listarAlertasTope.mockResolvedValue([
    { tenantId: 't-1', tenantNombre: 'Flota A', dia: '2026-11-08', nivel: 80, usoUsd: 8, topeUsd: 10, origenTope: 'plan', creadoEn: '2026-11-08T12:00:00Z' },
    { tenantId: 't-2', tenantNombre: 'Flota B', dia: '2026-11-08', nivel: 100, usoUsd: 10, topeUsd: 10, origenTope: 'piso', creadoEn: '2026-11-08T15:00:00Z' },
  ]);
  const html = await renderizar();
  expect(html).toContain('Avisos de tope');
  expect(html).toContain('80 %');
  expect(html).toContain('100 %');
  expect(html).toContain('08/11/2026');
});

it('sin avisos y con los avisos APAGADOS, NO dice que ninguna flota cruzó su techo (no se sabe)', async () => {
  dobles.avisosEncendidos.mockReturnValue(false);
  const html = await renderizar();
  expect(html).toContain('Los avisos de tope están apagados');
  expect(html).toContain('no se sabe si alguna flota cruzó su techo');
  expect(html).not.toContain('Ninguna flota cruzó el 80 %');
});

it('sin avisos y con los avisos ENCENDIDOS, sí dice que ninguna flota cruzó el 80 %', async () => {
  const html = await renderizar();
  expect(html).toContain('Ninguna flota cruzó el 80 %');
  expect(html).not.toContain('Los avisos de tope están apagados');
});

it('una lectura caída de los avisos se dice y no se pinta como «ninguno»', async () => {
  dobles.listarAlertasTope.mockRejectedValue(new Error('caída'));
  const html = await renderizar();
  expect(html).toContain('No se pudieron leer los avisos de tope');
  expect(html).not.toContain('Ningún aviso registrado');
});

it('muchos días sin ninguna llamada de IA registrada se avisan (el hueco del 15-oct al 7-nov)', async () => {
  dobles.getResumenNegocio.mockResolvedValue({ ...R_OK, porDia: [{ dia: '2020-01-01', costoUsd: 3 }, { dia: '2020-01-02', costoUsd: 0 }] });
  const html = await renderizar();
  expect(html).toContain('Sin llamadas de IA registradas desde hace');
});

it('el costo por viaje se estima y se rotula estimado; sin viajes procesados es «—», no $0', async () => {
  const html = await renderizar();
  expect(html).toContain('Costo por viaje procesado');
  dobles.getResumenNegocio.mockResolvedValue({ ...R_OK, viajesProcesados: 0 });
  const sinViajes = await renderizar();
  expect(sinViajes).toContain('Aún no hay viajes procesados para estimarlo');
});

it('el gasto de hoy por flota y propósito se pinta apilado, con el aviso de que la fase por día no se mide', async () => {
  const html = await renderizar();
  expect(html).toContain('Gasto de hoy por flota y propósito');
  expect(html).toContain('rv-apcol');
  expect(html).toContain('Interactivo (chofer y chats)');
  expect(html).toContain('no se mide todavía');
});

it('sin gasto por propósito leído no se monta el apilado (tampoco con datos inventados)', async () => {
  dobles.getPresupuestoPorProposito.mockRejectedValueOnce(new Error('caída'));
  const html = await renderizar();
  expect(html).not.toContain('rv-apcol');
});
