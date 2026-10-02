import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Mundo } from './mundo.fixture';
import type { ResultadoEnvioConFallback } from '@/lib/meta/enviar_con_fallback';

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('../presupuesto', () => ({ acotada: (q: unknown) => q }));
vi.mock('@/lib/meta/enviar_con_fallback', () => ({ enviarConFallback: vi.fn() }));
let mundo = new Mundo();
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => mundo.admin() }));

const envio = await import('./envio');
const { parsearMatrizConvenios } = await import('./importador');
const { importarConvenios } = await import('./repo');

const A = 'tenant-a';
const OK_TEXTO: ResultadoEnvioConFallback = { ok: true, via: 'texto', id: 'wamid', motivo: 'ventana_abierta', ventana: 'abierta' };

let enviados: Array<{ telefono: string; texto: string; plantilla: string; contexto: string }>;
let respuesta: ResultadoEnvioConFallback;
const puertos = (): import('./envio').PuertosEnvio => ({
  ...envio.puertosEnvioReales,
  enviar: async (telefono, m, contexto) => { enviados.push({ telefono, texto: m.texto, plantilla: m.plantilla.nombre, contexto }); return respuesta; },
});

let viajeId: string;
beforeEach(async () => {
  mundo = new Mundo();
  enviados = [];
  respuesta = OK_TEXTO;
  const cliente = mundo.poner('cliente', { tenant_id: A, nombre: 'Cliente Uno' });
  const op = mundo.poner('operador', { tenant_id: A, nombre: 'Juan Pérez', telefono: '5213312345678' });
  const p = parsearMatrizConvenios([
    ['Cliente', 'Convenio', 'Origen', 'Destino', 'Categoría', 'Instrucción', 'Momento', 'Lugar'],
    ['Cliente Uno', 'Ruta norte', 'Zapopan', 'Tlaquepaque', 'puerta', 'Puerta 3, lado poniente', 'ambos', 'destino'],
    ['Cliente Uno', 'Ruta norte', '', '', 'reportarse', 'Con el Sr. Ramírez', 'acercamiento', 'destino'],
    ['Cliente Uno', 'Ruta norte', '', '', 'documentos', 'Carta porte y orden de compra', 'despacho', 'ambos'],
  ], { puedeVerFinanzas: false });
  await importarConvenios(A, p.convenios, { conFinanzas: false });
  viajeId = String(mundo.poner('viaje', { tenant_id: A, cliente_id: cliente.id, operador_id: op.id, folio: 'F-1042', origen: 'Zapopan', destino: 'Tlaquepaque', estatus: 'abierto' }).id);
});

describe('despacharInstrucciones', () => {
  it('liga el convenio y le manda al operador las instrucciones del despacho, una sola vez', async () => {
    const r = await envio.despacharInstrucciones(A, viajeId, puertos());
    expect(r).toEqual({ estado: 'enviado', canal: 'texto' });
    expect(enviados).toHaveLength(1);
    expect(enviados[0]).toMatchObject({ telefono: '5213312345678', plantilla: 'convenio_instrucciones_despacho_v1', contexto: 'convenios.despacho' });
    expect(enviados[0].texto).toContain('Puerta 3, lado poniente');
    expect(enviados[0].texto).toContain('Carta porte y orden de compra');
    expect(enviados[0].texto).not.toContain('Sr. Ramírez'); // solo de acercamiento
    expect(mundo.tablas.viaje_convenio[0]).toMatchObject({ despacho_canal: 'texto' });
    expect(mundo.tablas.viaje_convenio[0].despacho_enviado_en).toBeTruthy();

    expect(await envio.despacharInstrucciones(A, viajeId, puertos())).toEqual({ estado: 'ya_enviado' });
    expect(enviados).toHaveLength(1);
  });

  it('dos despachos simultáneos del mismo viaje mandan UN solo mensaje', async () => {
    const rs = await Promise.all([envio.despacharInstrucciones(A, viajeId, puertos()), envio.despacharInstrucciones(A, viajeId, puertos())]);
    expect(enviados).toHaveLength(1);
    expect(rs.map((r) => r.estado).sort()).toContain('enviado');
  });

  it('un rechazo REINTENTABLE libera el reclamo y la corrida siguiente lo manda', async () => {
    respuesta = { ok: false, motivo: 'rechazo_no_ventana', mensaje: 'límite de tasa', fueraDeVentana: false, reintentable: true, ventana: 'abierta' };
    expect(await envio.despacharInstrucciones(A, viajeId, puertos())).toMatchObject({ estado: 'rechazado', reintentable: true });
    respuesta = OK_TEXTO;
    expect(await envio.despacharInstrucciones(A, viajeId, puertos())).toMatchObject({ estado: 'enviado' });
  });

  it('un rechazo NO reintentable (plantilla sin aprobar) deja el reclamo: no se repite cada pasada', async () => {
    respuesta = { ok: false, motivo: 'plantilla_rechazada', mensaje: 'plantilla sin aprobar', fueraDeVentana: true, reintentable: false, ventana: 'cerrada' };
    expect(await envio.despacharInstrucciones(A, viajeId, puertos())).toMatchObject({ estado: 'rechazado', reintentable: false });
    expect(await envio.despacharInstrucciones(A, viajeId, puertos())).toEqual({ estado: 'perdido' });
    expect(enviados).toHaveLength(1);
  });

  it('sin convenio del cliente no manda nada y no falla', async () => {
    const otro = mundo.poner('cliente', { tenant_id: A, nombre: 'Otro' });
    const v = mundo.poner('viaje', { tenant_id: A, cliente_id: otro.id, operador_id: mundo.tablas.operador[0].id, estatus: 'abierto' });
    expect(await envio.despacharInstrucciones(A, String(v.id), puertos())).toEqual({ estado: 'sin_convenio' });
    expect(enviados).toHaveLength(0);
  });

  it('un operador sin teléfono no recibe nada; el viaje liquidado tampoco', async () => {
    mundo.tablas.operador[0].telefono = null;
    expect(await envio.despacharInstrucciones(A, viajeId, puertos())).toEqual({ estado: 'sin_destinatario' });
    mundo.tablas.operador[0].telefono = '5213312345678';
    mundo.tablas.viaje[0].estatus = 'liquidado';
    expect(await envio.despacharInstrucciones(A, viajeId, puertos())).toEqual({ estado: 'viaje_cerrado' });
  });

  it('NUNCA lanza: base sin migrar → no_disponible; un fallo inesperado → fallo', async () => {
    mundo.ausentes.add('cliente_convenio');
    expect(await envio.despacharInstrucciones(A, viajeId, puertos())).toEqual({ estado: 'no_disponible' });
    const roto = { ...puertos(), ligar: async () => { throw new Error('boom'); } };
    expect(await envio.despacharInstrucciones(A, viajeId, roto)).toEqual({ estado: 'fallo', motivo: 'boom' });
  });
});

describe('acercarInstrucciones', () => {
  it('manda las de acercamiento de ESA planta, una vez, y no antes de que exista la foto del despacho', async () => {
    expect(await envio.acercarInstrucciones(A, viajeId, 'destino', puertos())).toEqual({ estado: 'sin_convenio' });
    await envio.despacharInstrucciones(A, viajeId, puertos());
    enviados.length = 0;

    const r = await envio.acercarInstrucciones(A, viajeId, 'destino', puertos());
    expect(r).toEqual({ estado: 'enviado', canal: 'texto' });
    expect(enviados[0].plantilla).toBe('convenio_instrucciones_acercamiento_v1');
    expect(enviados[0].texto).toContain('ya vas llegando a Tlaquepaque');
    expect(enviados[0].texto).toContain('Puerta 3');
    expect(enviados[0].texto).toContain('Sr. Ramírez');
    expect(enviados[0].texto).not.toContain('Carta porte'); // era solo de despacho

    expect(await envio.acercarInstrucciones(A, viajeId, 'destino', puertos())).toEqual({ estado: 'ya_enviado' });
    expect(enviados).toHaveLength(1);
  });

  it('acercarse a la planta de ORIGEN, donde el convenio no pide nada, no manda un mensaje vacío', async () => {
    await envio.despacharInstrucciones(A, viajeId, puertos());
    enviados.length = 0;
    expect(await envio.acercarInstrucciones(A, viajeId, 'origen', puertos())).toEqual({ estado: 'sin_instrucciones' });
    expect(enviados).toHaveLength(0);
  });
});
