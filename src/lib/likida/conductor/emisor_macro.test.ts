import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  claveMacro, crearDobleEmisorMacro, emisorMacroApagado, emitirMacro, normalizarEventoMacro,
  type EmisorMacro, type EventoMacro,
} from './emisor_macro';

// Todo sintético: referencias, ids y textos inventados; ningún dato real ni nombre del cliente ni del proveedor.
const AHORA = new Date('2026-10-02T14:30:00.000Z');
const hace = (min: number): Date => new Date(AHORA.getTime() - min * 60_000);
const evento = (extra: Partial<EventoMacro> = {}): EventoMacro => ({
  eventoId: 'EV-SINT-001', viajeRef: 'VJ-SINT-001', tipo: 'detencion', ocurridoEn: hace(1), motivo: 'Fila en caseta sintética', ...extra,
});

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('doble de pruebas del emisor de macros', () => {
  it('recibe la macro esperada por evento (tipo, viaje y hora) y la deja en su registro', async () => {
    const doble = crearDobleEmisorMacro();
    expect(await emitirMacro(doble, evento(), AHORA, { habilitado: true })).toEqual({ estado: 'enviada', clave: 'VJ-SINT-001|detencion|EV-SINT-001' });
    expect(doble.recibidas).toEqual([{
      clave: 'VJ-SINT-001|detencion|EV-SINT-001', viajeRef: 'VJ-SINT-001', tipo: 'detencion', ocurridoEn: hace(1), motivo: 'Fila en caseta sintética',
    }]);
  });

  it('un evento de cada tipo produce su propia macro, con la clave que incluye el tipo', async () => {
    const doble = crearDobleEmisorMacro();
    for (const [i, tipo] of (['detencion', 'llegada', 'salida'] as const).entries()) {
      await emitirMacro(doble, evento({ eventoId: `EV-SINT-10${i}`, tipo, motivo: undefined }), AHORA, { habilitado: true });
    }
    expect(doble.recibidas.map((m) => m.tipo)).toEqual(['detencion', 'llegada', 'salida']);
    expect(doble.recibidas.every((m) => m.motivo === undefined)).toBe(true);
    expect(new Set(doble.recibidas.map((m) => m.clave)).size).toBe(3);
  });

  it('es idempotente: el mismo evento emitido dos veces llega UNA sola vez y la segunda dice duplicada', async () => {
    const doble = crearDobleEmisorMacro();
    const r1 = await emitirMacro(doble, evento(), AHORA, { habilitado: true });
    const r2 = await emitirMacro(doble, evento(), AHORA, { habilitado: true });
    expect(r1.estado).toBe('enviada');
    expect(r2.estado).toBe('duplicada');
    expect(doble.recibidas).toHaveLength(1);
    // Otro evento del mismo viaje y tipo NO es duplicado.
    expect((await emitirMacro(doble, evento({ eventoId: 'EV-SINT-002' }), AHORA, { habilitado: true })).estado).toBe('enviada');
    expect(doble.recibidas).toHaveLength(2);
  });

  it('no hace ninguna llamada de red', async () => {
    const fetchEspia = vi.fn();
    vi.stubGlobal('fetch', fetchEspia);
    await emitirMacro(crearDobleEmisorMacro(), evento(), AHORA, { habilitado: true });
    await emitirMacro(emisorMacroApagado, evento(), AHORA, { habilitado: true });
    expect(fetchEspia).not.toHaveBeenCalled();
  });
});

describe('nace apagado', () => {
  it('con la perilla apagada (por omisión) no emite nada aunque el puerto exista', async () => {
    const doble = crearDobleEmisorMacro();
    expect((await emitirMacro(doble, evento(), AHORA)).estado).toBe('apagado');
    expect((await emitirMacro(doble, evento(), AHORA, { habilitado: false })).estado).toBe('apagado');
    expect(doble.recibidas).toHaveLength(0);
  });

  it('sin puerto, o con el emisor apagado por omisión, no sale nada y no lanza', async () => {
    expect((await emitirMacro(null, evento(), AHORA, { habilitado: true })).estado).toBe('apagado');
    expect((await emitirMacro(undefined, evento(), AHORA, { habilitado: true })).estado).toBe('apagado');
    expect((await emitirMacro(emisorMacroApagado, evento(), AHORA, { habilitado: true })).estado).toBe('apagado');
  });
});

describe('lo dudoso se descarta, no se inventa', () => {
  it('rechaza evento sin id, sin viaje, tipo desconocido, sin hora, hora inválida o del futuro', async () => {
    const doble = crearDobleEmisorMacro();
    const malos: unknown[] = [
      evento({ eventoId: '  ' }), evento({ viajeRef: '' }), { ...evento(), tipo: 'promocion' },
      { ...evento(), ocurridoEn: null }, evento({ ocurridoEn: new Date('x') }), evento({ ocurridoEn: new Date(AHORA.getTime() + 10 * 60_000) }),
      null, undefined,
    ];
    for (const m of malos) expect((await emitirMacro(doble, m as EventoMacro, AHORA, { habilitado: true })).estado).toBe('invalida');
    expect(doble.recibidas).toHaveLength(0);
  });

  it('normaliza: recorta espacios, deja el motivo vacío como ausente y copia la fecha', () => {
    const fuente = evento({ eventoId: ' EV-1 ', viajeRef: ' VJ-1 ', motivo: '   ' });
    const n = normalizarEventoMacro(fuente, AHORA);
    expect(n).toEqual({ eventoId: 'EV-1', viajeRef: 'VJ-1', tipo: 'detencion', ocurridoEn: hace(1), motivo: undefined });
    expect(n?.ocurridoEn).not.toBe(fuente.ocurridoEn);
    expect(claveMacro(n!)).toBe('VJ-1|detencion|EV-1');
  });

  it('un fallo del proveedor da «fallo» y no lanza: nunca tumba al llamador', async () => {
    const roto: EmisorMacro = { emitir: async () => { throw new Error('proveedor caído'); } };
    expect((await emitirMacro(roto, evento(), AHORA, { habilitado: true })).estado).toBe('fallo');
  });

  it('una respuesta inesperada del puerto cuenta como fallo, no como enviada', async () => {
    const raro = { emitir: async () => 'ok' } as unknown as EmisorMacro;
    expect((await emitirMacro(raro, evento(), AHORA, { habilitado: true })).estado).toBe('fallo');
  });
});
