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

  it('R10-3: si el refresco del convenio cae ENTRE leer la foto y ganar el reclamo, se manda la foto NUEVA (no la vieja) y queda sellado', async () => {
    const conRefresco: import('./envio').PuertosEnvio = {
      ...puertos(),
      async reclamar(t, v, cual, ahora) {
        // la edición con «llevar a los viajes» cae justo antes del reclamo: la foto del viaje cambia
        const fila = mundo.tablas.viaje_convenio.find((x) => x.viaje_id === v)!;
        fila.instrucciones = [{ categoria: 'documentos', texto: 'Solo la orden de compra NUEVA', momento: 'despacho', lugar: 'ambos', orden: 0 }];
        return envio.puertosEnvioReales.reclamar(t, v, cual, ahora);
      },
    };
    expect(await envio.despacharInstrucciones(A, viajeId, conRefresco)).toEqual({ estado: 'enviado', canal: 'texto' });
    expect(enviados).toHaveLength(1);
    expect(enviados[0].texto).toContain('Solo la orden de compra NUEVA');
    expect(enviados[0].texto).not.toContain('Carta porte y orden de compra');
    expect(mundo.tablas.viaje_convenio[0].despacho_enviado_en).toBeTruthy();
  });

  it('R10-3: si la foto nueva ya no trae nada para el despacho, no se manda lo viejo y el reclamo se suelta (la siguiente corrida decide)', async () => {
    const conRefresco: import('./envio').PuertosEnvio = {
      ...puertos(),
      async reclamar(t, v, cual, ahora) {
        mundo.tablas.viaje_convenio.find((x) => x.viaje_id === v)!.instrucciones = [{ categoria: 'reportarse', texto: 'Con el guardia', momento: 'acercamiento', lugar: 'origen', orden: 0 }];
        return envio.puertosEnvioReales.reclamar(t, v, cual, ahora);
      },
    };
    expect(await envio.despacharInstrucciones(A, viajeId, conRefresco)).toEqual({ estado: 'sin_instrucciones' });
    expect(enviados).toHaveLength(0);
    expect(mundo.tablas.viaje_convenio[0].despacho_enviado_en ?? null).toBeNull();
    expect(mundo.tablas.viaje_convenio[0].despacho_reclamado_en ?? null).toBeNull();
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

describe('instruccionesAlCambiarOperador (primera asignación y reasignación)', () => {
  const nuevoChofer = () => mundo.poner('operador', { tenant_id: A, nombre: 'Pedro Gómez', telefono: '5213399998888' });

  it('primera asignación posterior: un viaje creado SIN chofer liga el convenio y le manda las instrucciones al que se le asigna', async () => {
    const sinChofer = String(mundo.poner('viaje', { tenant_id: A, cliente_id: mundo.tablas.cliente[0].id, operador_id: null, folio: 'F-2000', origen: 'Zapopan', destino: 'Tlaquepaque', estatus: 'abierto' }).id);
    const pedro = nuevoChofer();
    mundo.tablas.viaje.find((v) => v.id === sinChofer)!.operador_id = pedro.id; // lo que hace reasignarOperador
    const r = await envio.instruccionesAlCambiarOperador(A, sinChofer, { cambio: true, operadorAnteriorId: null }, puertos());
    expect(r).toEqual({ estado: 'enviado', canal: 'texto' });
    expect(enviados).toHaveLength(1);
    expect(enviados[0]).toMatchObject({ telefono: '5213399998888', contexto: 'convenios.despacho' });
    expect(enviados[0].texto).toContain('Puerta 3, lado poniente');
  });

  it('reasignación: lo ya enviado al chofer anterior se le manda también al nuevo, una vez', async () => {
    expect(await envio.despacharInstrucciones(A, viajeId, puertos())).toMatchObject({ estado: 'enviado' });
    expect(enviados).toHaveLength(1);

    const pedro = nuevoChofer();
    mundo.tablas.viaje.find((v) => v.id === viajeId)!.operador_id = pedro.id;
    const r = await envio.instruccionesAlCambiarOperador(A, viajeId, { cambio: true, operadorAnteriorId: String(mundo.tablas.operador[0].id) }, puertos());
    expect(r).toEqual({ estado: 'enviado', canal: 'texto' });
    expect(enviados).toHaveLength(2);
    expect(enviados[1]).toMatchObject({ telefono: '5213399998888', plantilla: 'convenio_instrucciones_despacho_v1' });
    expect(enviados[1].texto).toContain('Puerta 3, lado poniente');
    // y un segundo gesto idéntico no duplica: el sello del despacho volvió a quedar puesto
    expect(await envio.despacharInstrucciones(A, viajeId, puertos())).toEqual({ estado: 'ya_enviado' });
  });

  it('reasignar reinicia también los avisos de acercamiento ya mandados, para que el chofer nuevo los reciba al llegar', async () => {
    await envio.despacharInstrucciones(A, viajeId, puertos());
    Object.assign(mundo.tablas.viaje_convenio[0], { acercamiento_origen_enviado_en: new Date().toISOString(), acercamiento_origen_canal: 'texto' });
    await envio.instruccionesAlCambiarOperador(A, viajeId, { cambio: true, operadorAnteriorId: String(mundo.tablas.operador[0].id) }, puertos());
    expect(mundo.tablas.viaje_convenio[0].acercamiento_origen_enviado_en).toBeNull();
    expect(mundo.tablas.viaje_convenio[0].acercamiento_origen_canal).toBeNull();
  });

  it('el mismo chofer (el gesto no cambió nada) NO recibe el mensaje otra vez', async () => {
    await envio.despacharInstrucciones(A, viajeId, puertos());
    const r = await envio.instruccionesAlCambiarOperador(A, viajeId, { cambio: false, operadorAnteriorId: String(mundo.tablas.operador[0].id) }, puertos());
    expect(r).toEqual({ estado: 'sin_cambio' });
    expect(enviados).toHaveLength(1);
  });

  it('un viaje cuyo cliente no tiene convenio no manda nada y no lanza; tampoco una base sin la 0580', async () => {
    const otro = mundo.poner('cliente', { tenant_id: A, nombre: 'Sin convenio' });
    const v = String(mundo.poner('viaje', { tenant_id: A, cliente_id: otro.id, operador_id: null, folio: 'F-3', estatus: 'abierto' }).id);
    expect(await envio.instruccionesAlCambiarOperador(A, v, { cambio: true, operadorAnteriorId: null }, puertos())).toEqual({ estado: 'sin_convenio' });
    mundo.ausentes.add('viaje_convenio');
    expect(await envio.instruccionesAlCambiarOperador(A, viajeId, { cambio: true, operadorAnteriorId: 'x' }, puertos())).toEqual({ estado: 'no_disponible' });
    expect(enviados).toHaveLength(0);
  });

  it('un doble que no informa el cambio (undefined) se trata como «cambió»', async () => {
    const r = await envio.instruccionesAlCambiarOperador(A, viajeId, undefined, puertos());
    expect(r).toMatchObject({ estado: 'enviado' });
  });
});
