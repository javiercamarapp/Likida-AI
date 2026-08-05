// ═══════════════════════════════════════════════════════════════════════════
// CRÍTICO — TRES RAMAS MANDABAN UN WHATSAPP **POR FOTO**.
//
// `avisar_falla`, `pedir_reenvio` y la de fecha dudosa contestaban cada una por
// su cuenta, y los tres disparadores son SISTÉMICOS: un 429 del proveedor de
// visión tumba las 22 fotos de la ráfaga a la vez, y una gasolinera mal
// iluminada de noche también. O sea que el caso normal no es «una de 22 falló»,
// es «fallaron las 22» — y el chofer recibía veintidós mensajes idénticos
// seguidos. Este repo ya arregló ese antipatrón tres veces (el acuse de ráfaga,
// el aviso de acercamiento, los avisos de fecha) y el mecanismo estaba puesto:
// el contador de ráfaga y el resumen del `finally`.
//
// Aquí se ejercita `processInbound` DE VERDAD con una ráfaga simultánea, como
// la entrega Meta, contra un contador de intake que se comporta como el real
// (atómico, +1 al entrar y -1 al salir). Lo que se mide es lo único que le
// importa al chofer: CUÁNTOS mensajes recibió.
//
// Cubre además, del mismo hallazgo:
//   · el fallo técnico de OCR ya no pierde el comprobante (guarda huérfano), y
//   · `MAX_CONFIRMACIONES_SEGUIDAS`, que estaba escrito y sin cablear.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { olvidarRafagas } from './intake/rafaga';

const salientes: string[] = [];
const botones: string[] = [];
const guardarHuerfano = vi.fn(async () => true);
const subirComprobante = vi.fn(async () => 't1/v1/foto.jpg');
const extraerComprobante = vi.fn();
const getGastos = vi.fn(async () => [] as unknown[]);
const addGasto = vi.fn(async () => {});
const ventanaDesdeDB = vi.fn();

/** El contador de intake REAL: atómico, compartido por las fotos del viaje. */
let contador = 0;
const intakeDelta = vi.fn(async (_v: string, d: number) => {
  contador = Math.max(0, contador + d);
  return contador;
});

vi.mock('@/lib/cuadra/tools', () => ({}));
vi.mock('@/lib/meta/client', () => ({
  sendText: vi.fn(async (_to: string, t: string) => { salientes.push(t); return 'wamid.1'; }),
  sendButtons: vi.fn(async (_to: string, cuerpo: string) => { botones.push(cuerpo); return 'wamid.b'; }),
  sendDocument: vi.fn(),
  downloadMediaAsDataUrl: vi.fn(async () => 'data:image/jpeg;base64,AAAA'),
  downloadMediaAsText: vi.fn(),
}));
vi.mock('@/lib/cuadra/intake/ocr', () => ({ extraerComprobante: (...a: unknown[]) => extraerComprobante(...a) }));
vi.mock('@/lib/cuadra/intake/almacen', () => ({ subirComprobante: (...a: unknown[]) => subirComprobante(...(a as [])) }));
vi.mock('@/lib/cuadra/repo', () => ({
  addGasto: (...a: unknown[]) => addGasto(...(a as [])),
  getGastos: (...a: unknown[]) => getGastos(...(a as [])),
  guardarHuerfano: (...a: unknown[]) => guardarHuerfano(...(a as [])),
  ubicarGastoPorHash: vi.fn(async () => null),
  getHuerfanos: vi.fn(async () => []), resolverHuerfanos: vi.fn(), marcarHuerfanosOfrecidos: vi.fn(),
  updateGastoCfdiXml: vi.fn(), saveCfdiXmlRaw: vi.fn(),
  gastoExistePorHash: vi.fn(async () => false), gastoPorHash: vi.fn(async () => null),
  corregirFechaGasto: vi.fn(), enriquecerGastoConCodigo: vi.fn(),
  guardarCodigoPendiente: vi.fn(), getCodigosPendientes: vi.fn(async () => []),
  reclamarCodigoPendiente: vi.fn(), getViaje: vi.fn(async () => null),
  getDatosResponsable: vi.fn(async () => ({
    razonSocial: 'FLOTA SA DE CV', domicilio: 'Calle 1, Mérida',
    urlAvisoIntegral: 'https://flota.mx/privacidad',
  })),
  reclamarEnvioAviso: vi.fn(async () => false),   // ya se le puso a disposición
  confirmarEnvioAviso: vi.fn(), liberarEnvioAviso: vi.fn(),
}));
vi.mock('@/lib/cuadra/conv', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  resolveOperador: vi.fn(async () => ({ tenantId: 't1', operadorId: 'o1', nombre: 'Chuy', telefono: '52999' })),
  getOpenViaje: vi.fn(async () => 'v1'),
  getTenantContext: vi.fn(async () => ({ nombreFlota: 'Flota', agentName: 'Likida' })),
  loadConversation: vi.fn(async () => ({ id: 'c1', turns: [] })),
  saveConversation: vi.fn(), claimMessage: vi.fn(async () => 'nuevo'),
  acquireViajeLock: vi.fn(async () => true), releaseViajeLock: vi.fn(),
  releaseMessageClaim: vi.fn(),
  intakeDelta: (...a: unknown[]) => intakeDelta(...(a as [string, number])),
  esperarIntake: vi.fn(async () => true),
}));
vi.mock('@/lib/cuadra/cuadre/desde_db', () => ({
  ventanaDesdeDB: (...a: unknown[]) => ventanaDesdeDB(...a),
  cuadrarDesdeDB: vi.fn(),
}));
vi.mock('@/lib/cuadra/confirmar_viaje', () => ({
  aceptarPorActividad: vi.fn(), atenderConfirmacion: vi.fn(async () => ({ mensaje: null })),
}));
vi.mock('@/lib/cuadra/consulta_chofer', () => ({
  estadoDelViaje: vi.fn(async () => ({ anticipo: 6000, comprobado: 100, comprobantes: 1 })),
  responderConsulta: vi.fn(async () => null),
}));
vi.mock('@/lib/cuadra/costos', () => ({
  registrarCosto: vi.fn(), registrarCostoWhatsApp: vi.fn(),
  faseDeModelo: vi.fn(() => 'cuadre'), vincularCostosALiquidacion: vi.fn(),
}));
vi.mock('@/lib/agents/run', () => ({ runAgent: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { processInbound } = await import('./processor');

const FALLO_TECNICO = {
  gasto: { id: 'g0', concepto: 'otro', monto: 0, ocrConfianza: 0 },
  legible: false, motivo: 'fallo_tecnico',
  costo: { modelo: 'ocr', tokensIn: 0, tokensOut: 0, costoUsd: 0 },
};
const ILEGIBLE = {
  gasto: { id: 'g0', concepto: 'otro', monto: 0, ocrConfianza: 0.2 },
  legible: false, motivo: 'ilegible',
  costo: { modelo: 'ocr', tokensIn: 1, tokensOut: 1, costoUsd: 0 },
};
const bueno = (monto: number, confianza = 0.99) => ({
  gasto: { id: `g${monto}`, concepto: 'diesel', monto, fecha: '2026-08-03', ocrConfianza: confianza, ocrExtra: {} },
  legible: true,
  costo: { modelo: 'ocr', tokensIn: 1, tokensOut: 1, costoUsd: 0 },
});

/** Una ráfaga de `n` fotos como la entrega Meta: todas a la vez, en un after(). */
const rafaga = (n: number) => Promise.all(
  Array.from({ length: n }, (_, i) =>
    processInbound({ from: '5219993700779', type: 'image' as const, mediaId: `m${i}`, waMessageId: `wa${i}` })),
);

beforeEach(() => {
  salientes.length = 0; botones.length = 0; contador = 0;
  olvidarRafagas();
  extraerComprobante.mockReset(); getGastos.mockReset(); addGasto.mockReset();
  guardarHuerfano.mockClear(); subirComprobante.mockClear();
  ventanaDesdeDB.mockReset(); ventanaDesdeDB.mockResolvedValue(undefined);
  getGastos.mockResolvedValue([]);
  process.env.WHATSAPP_ACCESS_TOKEN = 'tok';
  process.env.WHATSAPP_PHONE_NUMBER_ID = '123';
});

describe('22 fotos que fallan NO son 22 mensajes', () => {
  it('fallo técnico en toda la ráfaga: se resume, no se repite', async () => {
    extraerComprobante.mockResolvedValue(FALLO_TECNICO);
    await rafaga(22);

    // El número es el hallazgo entero. Antes: 22.
    expect(salientes.length, `el chofer recibió ${salientes.length} mensajes`).toBeLessThanOrEqual(2);
    const todo = salientes.join('\n');
    expect(todo).toContain('De tus 22 fotos');
    expect(todo).toMatch(/\*22\*/);
    expect(todo).toMatch(/de mi lado/i);
  });

  it('foto ilegible en toda la ráfaga (la gasolinera de noche): un solo aviso', async () => {
    extraerComprobante.mockResolvedValue(ILEGIBLE);
    await rafaga(22);

    expect(salientes.length).toBeLessThanOrEqual(2);
    expect(salientes.join('\n')).toMatch(/no las pude leer/i);
  });

  it('fechas dudosas en ráfaga: se listan los montos, no se manda un mensaje por ticket', async () => {
    ventanaDesdeDB.mockResolvedValue({ inicio: '2026-08-01', fin: '2026-08-05', hoy: '2026-08-04' });
    // Fecha de 2019: fuera de la ventana por cualquier criterio.
    let n = 0;
    extraerComprobante.mockImplementation(async () => {
      n += 1;
      return { ...bueno(100 * n), gasto: { ...bueno(100 * n).gasto, fecha: '2019-03-02' } };
    });
    await rafaga(3);

    expect(salientes.length).toBeLessThanOrEqual(2);
    const todo = salientes.join('\n');
    expect(todo).toMatch(/fecha dudosa/i);
    expect(todo).toContain('$100.00');
  });

  it('CONTROL — una foto sola SIGUE recibiendo su mensaje individual', async () => {
    extraerComprobante.mockResolvedValue(ILEGIBLE);
    await processInbound({ from: '5219993700779', type: 'image', mediaId: 'm1', waMessageId: 'wa1' });

    expect(salientes).toHaveLength(1);
    expect(salientes[0]).toMatch(/difícil de leer/i);
    // Y NO se le manda además el resumen: sería decirle lo mismo dos veces.
    expect(salientes.join('\n')).not.toContain('Ya revisé tus fotos');
  });

  it('CONTROL — una ráfaga que sale bien no inventa incidencias', async () => {
    let n = 0;
    extraerComprobante.mockImplementation(async () => bueno(100 * (n += 1)));
    await rafaga(5);

    const todo = salientes.join('\n');
    expect(todo).not.toMatch(/no las pude leer|de mi lado|fecha dudosa/i);
  });
});

describe('un fallo técnico de OCR ya no pierde el comprobante', () => {
  it('guarda huérfano CON la foto, esperando la subida', async () => {
    extraerComprobante.mockResolvedValue(FALLO_TECNICO);
    await processInbound({ from: '5219993700779', type: 'image', mediaId: 'm1', waMessageId: 'wa1' });

    expect(guardarHuerfano).toHaveBeenCalledTimes(1);
    const [, , h] = guardarHuerfano.mock.calls[0] as unknown as [string, string, { rutaImagen?: string; gasto: { imagenUrl?: string } }];
    expect(h.rutaImagen, 'la subida se descartaba sin esperarla').toBe('t1/v1/foto.jpg');
    expect(h.gasto.imagenUrl).toBe('t1/v1/foto.jpg');
  });

  it('y el texto ya NO lo manda a un trámite que no existe', async () => {
    extraerComprobante.mockResolvedValue(FALLO_TECNICO);
    await processInbound({ from: '5219993700779', type: 'image', mediaId: 'm1', waMessageId: 'wa1' });

    const dicho = salientes.join('\n');
    // No hay alta manual de gastos en NINGÚN lado: `addGasto` es el único
    // insert sobre `gasto` del repo y sus tres llamadores viven en el camino de
    // WhatsApp. Prometerle "captúralo aparte" era mandarlo a hacer nada.
    expect(dicho).not.toMatch(/capturarlo aparte|NO quedó registrado/i);
    expect(dicho).toMatch(/no se pierde/i);
  });

  it('si tampoco se puede guardar, se le dice la verdad', async () => {
    extraerComprobante.mockResolvedValue(FALLO_TECNICO);
    guardarHuerfano.mockResolvedValueOnce(false);
    await processInbound({ from: '5219993700779', type: 'image', mediaId: 'm1', waMessageId: 'wa1' });

    expect(salientes.join('\n')).toMatch(/tampoco lo pude guardar/i);
  });
});

describe('MAX_CONFIRMACIONES_SEGUIDAS: el tope estaba escrito y sin cablear', () => {
  it('doce tickets dudosos NO son doce mensajes con botones', async () => {
    // Confianza entre los dos umbrales: se lee, pero no se puede probar → el
    // peldaño `confirmar`, que es el que gasta un mensaje interactivo por foto.
    let n = 0;
    extraerComprobante.mockImplementation(async () => bueno(100 * (n += 1), 0.8));
    await rafaga(12);

    expect(botones.length, `salieron ${botones.length} mensajes con botones`).toBeLessThanOrEqual(4);
  });

  it('y las que se pasaron del tope se DICEN, no se callan', async () => {
    let n = 0;
    extraerComprobante.mockImplementation(async () => bueno(100 * (n += 1), 0.8));
    await rafaga(12);

    // `mensajeDemasiadasDudas` existía en `acuse_ticket.ts` y no la llamaba
    // nadie. Un tope que no se anuncia se lee como "todo salió bien".
    expect(salientes.join('\n')).toMatch(/no pude leer con seguridad/i);
  });

  it('CONTROL — cuatro dudosos siguen recibiendo sus cuatro botones', async () => {
    let n = 0;
    extraerComprobante.mockImplementation(async () => bueno(100 * (n += 1), 0.8));
    await rafaga(4);

    expect(botones).toHaveLength(4);
    expect(salientes.join('\n')).not.toMatch(/no pude leer con seguridad/i);
  });
});
