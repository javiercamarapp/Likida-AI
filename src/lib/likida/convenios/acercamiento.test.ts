import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Mundo } from './mundo.fixture';

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
const enviadosWa: Array<{ telefono: string; texto: string; plantilla: string }> = [];
vi.mock('@/lib/meta/enviar_con_fallback', () => ({
  enviarConFallback: vi.fn(async (telefono: string, o: { texto: string; plantilla: { nombre: string } }) => {
    enviadosWa.push({ telefono, texto: o.texto, plantilla: o.plantilla.nombre });
    return { ok: true, via: 'texto', id: 'w', motivo: 'ventana_abierta', ventana: 'abierta' };
  }),
}));
let mundo = new Mundo();
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => mundo.admin() }));

const { barridoAcercamiento, estaCerca, MARGEN_ACERCAMIENTO_M } = await import('./acercamiento');
const { despacharInstrucciones } = await import('./envio');
const { importarConvenios } = await import('./repo');
const { parsearMatrizConvenios } = await import('./importador');

const A = 'tenant-a';
const AHORA = new Date('2026-10-10T18:00:00Z');
// Planta de descarga y planta de carga (Guadalajara, ~25 km entre ellas)
const DESTINO = { lat: 20.6402, lng: -103.3128 };
const ORIGEN = { lat: 20.7416, lng: -103.4200 };
const km = (lat: number, lng: number) => ({ lat, lng });

let viajeId: string; let unidadId: string;
const posicion = (p: { lat: number; lng: number }, minAtras = 2) =>
  mundo.poner('posicion', { tenant_id: A, unidad_id: unidadId, lat: p.lat, lng: p.lng, medida_en: new Date(AHORA.getTime() - minAtras * 60_000).toISOString() });
const hito = (tipo: string, estado = 'recibido') => mundo.poner('viaje_hito', { tenant_id: A, viaje_id: viajeId, tipo, estado });

beforeEach(async () => {
  mundo = new Mundo();
  enviadosWa.length = 0;
  const cliente = mundo.poner('cliente', { tenant_id: A, nombre: 'Cliente Uno' });
  const op = mundo.poner('operador', { tenant_id: A, nombre: 'Juan Pérez', telefono: '5213312345678' });
  unidadId = String(mundo.poner('unidad', { tenant_id: A, numero_economico: 'T-12' }).id);
  const origen = mundo.poner('geocerca', { tenant_id: A, nombre: 'Planta Zapopan', codigo: 'ZAP', activa: true, ...ORIGEN, radio_m: 300 });
  const destino = mundo.poner('geocerca', { tenant_id: A, nombre: 'CEDIS Tlaquepaque', codigo: 'CED', activa: true, ...DESTINO, radio_m: 300 });
  const p = parsearMatrizConvenios([
    ['Cliente', 'Convenio', 'Sitio origen', 'Sitio destino', 'Categoría', 'Instrucción', 'Momento', 'Lugar'],
    ['Cliente Uno', 'Ruta norte', 'ZAP', 'CED', 'puerta', 'Puerta 3, lado poniente', 'acercamiento', 'destino'],
    ['Cliente Uno', 'Ruta norte', '', '', 'reportarse', 'Con el guardia de la caseta 1', 'acercamiento', 'origen'],
  ], { puedeVerFinanzas: false });
  await importarConvenios(A, p.convenios, { conFinanzas: false });
  viajeId = String(mundo.poner('viaje', {
    tenant_id: A, cliente_id: cliente.id, operador_id: op.id, unidad_id: unidadId, folio: 'F-1042', origen: 'Zapopan', destino: 'Tlaquepaque',
    estatus: 'abierto', aceptado_en: AHORA.toISOString(), origen_geocerca_id: origen.id, destino_geocerca_id: destino.id,
  }).id);
  const r = await despacharInstrucciones(A, viajeId);
  expect(r.estado).toBe('sin_instrucciones'); // el convenio solo trae instrucciones de acercamiento: nada que mandar al despachar
  enviadosWa.length = 0;
});

describe('estaCerca', () => {
  it('cuenta el radio de la geocerca más el margen de acercamiento', () => {
    const sitio = { ...DESTINO, radioM: 300 };
    expect(estaCerca({ ...km(DESTINO.lat + 0.03, DESTINO.lng), medidaEn: AHORA }, sitio)).toBe(true); // ~3.3 km
    expect(estaCerca({ ...km(DESTINO.lat + 0.06, DESTINO.lng), medidaEn: AHORA }, sitio)).toBe(false); // ~6.7 km
    expect(MARGEN_ACERCAMIENTO_M).toBe(5000);
  });
});

describe('barridoAcercamiento — de punta a punta con la base en memoria', () => {
  it('antes de cargar, la planta que toca es la de ORIGEN: al acercarse recibe lo del origen, una sola vez', async () => {
    posicion({ lat: ORIGEN.lat + 0.02, lng: ORIGEN.lng });
    const r = await barridoAcercamiento(undefined, AHORA);
    expect(r).toMatchObject({ candidatos: 1, enviados: 1 });
    expect(enviadosWa).toHaveLength(1);
    expect(enviadosWa[0]).toMatchObject({ telefono: '5213312345678', plantilla: 'convenio_instrucciones_acercamiento_v1' });
    expect(enviadosWa[0].texto).toContain('ya vas llegando a Zapopan');
    expect(enviadosWa[0].texto).toContain('guardia de la caseta 1');
    expect(enviadosWa[0].texto).not.toContain('Puerta 3'); // esa es de la planta de descarga
    expect(mundo.tablas.viaje_convenio[0].acercamiento_enviado_en).toBeTruthy();

    // Segunda pasada: ya no es candidato (y aunque lo fuera, el claim lo impide).
    expect(await barridoAcercamiento(undefined, AHORA)).toMatchObject({ candidatos: 0, enviados: 0 });
    expect(enviadosWa).toHaveLength(1);
  });

  it('cargado el camión, la planta es la de DESTINO y recibe lo de ahí', async () => {
    hito('llegada_carga'); hito('salida_carga');
    posicion({ lat: DESTINO.lat + 0.02, lng: DESTINO.lng });
    const r = await barridoAcercamiento(undefined, AHORA);
    expect(r.enviados).toBe(1);
    expect(enviadosWa[0].texto).toContain('ya vas llegando a Tlaquepaque');
    expect(enviadosWa[0].texto).toContain('Puerta 3, lado poniente');
    expect(enviadosWa[0].texto).not.toContain('caseta 1');
  });

  it('lejos de la planta no manda nada (y el viaje sigue pendiente)', async () => {
    posicion({ lat: ORIGEN.lat + 0.5, lng: ORIGEN.lng });
    expect(await barridoAcercamiento(undefined, AHORA)).toMatchObject({ candidatos: 1, lejos: 1, enviados: 0 });
    expect(enviadosWa).toHaveLength(0);
    expect(mundo.tablas.viaje_convenio[0].acercamiento_enviado_en ?? null).toBeNull();
  });

  it('sin posición reciente (flota sin GPS o poller atrasado) NO adivina', async () => {
    posicion({ lat: ORIGEN.lat, lng: ORIGEN.lng }, 45); // hace 45 min: más vieja que la vigencia
    expect(await barridoAcercamiento(undefined, AHORA)).toMatchObject({ sinPosicion: 1, enviados: 0 });
    expect(enviadosWa).toHaveLength(0);
  });

  it('si ya registró su llegada a esa planta, el aviso ya no hace falta', async () => {
    hito('llegada_carga');
    posicion({ lat: ORIGEN.lat, lng: ORIGEN.lng });
    expect(await barridoAcercamiento(undefined, AHORA)).toMatchObject({ candidatos: 0, enviados: 0 });
  });

  it('un viaje cerrado, o sin unidad, no es candidato', async () => {
    posicion({ lat: ORIGEN.lat, lng: ORIGEN.lng });
    mundo.tablas.viaje[0].estatus = 'liquidado';
    expect((await barridoAcercamiento(undefined, AHORA)).candidatos).toBe(0);
    mundo.tablas.viaje[0].estatus = 'abierto';
    mundo.tablas.viaje[0].unidad_id = null;
    expect((await barridoAcercamiento(undefined, AHORA)).candidatos).toBe(0);
  });

  it('el reloj de la corrida corta el barrido sin perder el resto', async () => {
    posicion({ lat: ORIGEN.lat, lng: ORIGEN.lng });
    const r = await barridoAcercamiento(undefined, AHORA, Date.now() - 1);
    expect(r).toMatchObject({ enviados: 0, cortadosPorReloj: 1 });
    expect(enviadosWa).toHaveLength(0);
  });

  it('un candidato cuyo fallo de envío no es de otro: cada viaje es independiente', async () => {
    const puertos = {
      candidatos: async () => [
        { tenantId: A, viajeId: 'v1', unidadId: 'u1', lado: 'origen' as const, sitio: { ...ORIGEN, radioM: 300 } },
        { tenantId: A, viajeId: 'v2', unidadId: 'u2', lado: 'origen' as const, sitio: { ...ORIGEN, radioM: 300 } },
      ],
      posiciones: async () => new Map([['u1', { ...ORIGEN, medidaEn: AHORA }], ['u2', { ...ORIGEN, medidaEn: AHORA }]]),
      enviar: vi.fn(async (_t: string, v: string) => (v === 'v1' ? { estado: 'fallo' as const, motivo: 'boom' } : { estado: 'enviado' as const, canal: 'texto' as const })),
    };
    expect(await barridoAcercamiento(puertos, AHORA)).toMatchObject({ candidatos: 2, enviados: 1, fallos: 1 });
  });
});

describe('base sin la 0580', () => {
  it('el barrido lanza ConveniosNoDisponibles (el cron lo trata como «nada que avisar», no como fallo)', async () => {
    const { ConveniosNoDisponibles } = await import('./repo');
    mundo.ausentes.add('viaje_convenio');
    await expect(barridoAcercamiento(undefined, AHORA)).rejects.toBeInstanceOf(ConveniosNoDisponibles);
  });
});
