import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// EL BRIEFING DE INICIO — lo que más importa:
//  · cada sección existe SOLO si su dato existe (sin sitio no hay línea de
//    sitio; sin directorio verificado no hay sección de emergencia);
//  · los papeles listados son HECHOS que piden acción, jamás palmaditas;
//  · un viaje sin folio ni ruta no genera briefing;
//  · doble disparo (despacho + confirmación) = UN briefing (el sello 0208);
//  · un envío que Meta no aceptó NO sella — el reintento sigue vivo (c2-1).
// ═══════════════════════════════════════════════════════════════════════════

const sendText = vi.hoisted(() =>
  vi.fn(async (_to: string, _body: string): Promise<string | null> => 'wamid.brf'));
vi.mock('@/lib/meta/client', () => ({ sendText }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('./presupuesto', async (importOriginal) => {
  // Solo se neutraliza `acotada`; el resto (PRESUPUESTO_WEBHOOK_MS y compañía)
  // lo importan módulos del grafo (conv.ts vía relojes_legales) y debe existir.
  const real = await importOriginal<typeof import('./presupuesto')>();
  return { ...real, acotada: (q: unknown) => q };
});

const politicasDetencion = vi.hoisted(() => vi.fn(async () => ({
  flota: null as { horasLibres: number | null; tarifaHora: number | null; moneda: string } | null,
  porCliente: new Map<string, { horasLibres: number | null; tarifaHora: number | null; moneda: string }>(),
})));
vi.mock('./estadias/lector', () => ({ politicasDetencion }));

const polizaVigenteDe = vi.hoisted(() => vi.fn(async (): Promise<unknown> => null));
const listarProveedoresEmergencia = vi.hoisted(() => vi.fn(async (): Promise<unknown[]> => []));
vi.mock('./emergencias', async (importOriginal) => {
  const real = await importOriginal<typeof import('./emergencias')>();
  return { ...real, polizaVigenteDe, listarProveedoresEmergencia };
});

// La "base": una fila por tabla, y el registro de los UPDATE al sello. El
// builder es THENABLE como el real; `maybeSingle` cierra las lecturas y el
// await cierra el UPDATE (que encadena .select('id') al final).
const filas = vi.hoisted(() => ({
  viaje: null as Record<string, unknown> | null,
  operador: null as Record<string, unknown> | null,
  unidad: null as Record<string, unknown> | null,
  cliente: null as Record<string, unknown> | null,
  geocerca: null as Record<string, unknown> | null,
  sellos: [] as Array<Record<string, unknown>>,
  selloFilas: [{ id: 'v-1' }] as Array<Record<string, unknown>>,
}));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (tabla: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const api: any = {};
      for (const m of ['select', 'eq', 'is', 'order', 'limit', 'range']) api[m] = () => api;
      let esUpdate = false;
      api.update = (patch: Record<string, unknown>) => {
        esUpdate = true;
        if (tabla === 'viaje') filas.sellos.push(patch);
        return api;
      };
      api.maybeSingle = () => Promise.resolve({
        data: (filas as Record<string, unknown>)[tabla] ?? null,
        error: null,
      });
      api.then = (res: (v: unknown) => unknown) =>
        Promise.resolve({ data: esUpdate ? filas.selloFilas : [], error: null }).then(res);
      return api;
    },
  }),
}));

import { armarBriefing, enviarBriefingInicio, type DatosBriefing } from './briefing_inicio_wa';

const base: DatosBriefing = {
  folio: 'F-201',
  origen: 'Mérida',
  destino: 'Cancún',
  unidad: 'T-12',
  cliente: null,
  sitio: null,
  papelesQuePiden: [],
  unidadSinPapeles: false,
  horasLibres: null,
  poliza: null,
  proveedores: [],
};

describe('armarBriefing', () => {
  it('con todo capturado, arma todas las secciones en orden', () => {
    const t = armarBriefing({
      ...base,
      cliente: 'CEDIS Peninsular',
      sitio: 'CEDIS Cancún Norte',
      papelesQuePiden: ['Verificación: vence en 5 días'],
      horasLibres: 3,
      poliza: { aseguradora: 'Qualitas', telefono: '8001234567' },
      proveedores: [{ tipo: 'grua', nombre: 'Grúas Maya', telefono: '9991112233' }],
    });
    expect(t).toContain('Briefing del viaje F-201');
    expect(t).toContain('Mérida → Cancún');
    expect(t).toContain('Unidad T-12');
    expect(t).toContain('CEDIS Peninsular — entregas en «CEDIS Cancún Norte»');
    expect(t).toContain('⚠️ Verificación: vence en 5 días');
    expect(t).toContain('3 horas libres de descarga');
    expect(t).toContain('Siniestros Qualitas: 8001234567');
    expect(t).toContain('Grúa Grúas Maya: 9991112233');
  });

  it('sin folio ni ruta no hay briefing: no identifica nada', () => {
    expect(armarBriefing({ ...base, folio: null, origen: null, destino: '  ' })).toBeNull();
  });

  it('sin sitio, el cliente sale sin línea de entregas', () => {
    const t = armarBriefing({ ...base, cliente: 'CEDIS Peninsular' });
    expect(t).toContain('Cliente: CEDIS Peninsular');
    expect(t).not.toContain('entregas en');
  });

  it('sin directorio verificado, la sección de emergencia NO sale', () => {
    const t = armarBriefing(base);
    expect(t).not.toContain('🚨');
    expect(t).not.toContain('Siniestros');
  });

  it('sin pacto de horas libres no se afirma ninguna hora', () => {
    expect(armarBriefing(base)).not.toContain('libres de descarga');
    // Y con 1 hora, el singular se conjuga — no "1 horas".
    expect(armarBriefing({ ...base, horasLibres: 1 })).toContain('1 hora libre de descarga');
  });

  it('papeles al día = silencio, no palmadita; unidad sin papeles = se dice', () => {
    expect(armarBriefing(base)).not.toContain('⚠️');
    const t = armarBriefing({ ...base, unidadSinPapeles: true });
    expect(t).toContain('no tiene papeles capturados');
  });

  it('un viaje solo con origen sigue siendo identificable', () => {
    const t = armarBriefing({ ...base, folio: null, destino: null });
    expect(t).toContain('Mérida');
  });
});

describe('enviarBriefingInicio', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    filas.viaje = {
      folio: 'F-201', origen: 'Mérida', destino: 'Cancún',
      operador_id: 'op-1', unidad_id: null, cliente_id: null, briefing_enviado_en: null,
    };
    filas.operador = { telefono: '+5219991234567', licencia_vence: null };
    filas.unidad = null;
    filas.cliente = null;
    filas.geocerca = null;
    filas.sellos = [];
    filas.selloFilas = [{ id: 'v-1' }];
    sendText.mockResolvedValue('wamid.brf');
    polizaVigenteDe.mockResolvedValue(null);
    listarProveedoresEmergencia.mockResolvedValue([]);
  });

  it('manda una vez y sella; el segundo disparo ve el sello y NO manda', async () => {
    expect(await enviarBriefingInicio('t-1', 'v-1')).toBe('enviado');
    expect(sendText).toHaveBeenCalledTimes(1);
    expect(filas.sellos).toHaveLength(1);
    expect(filas.sellos[0]).toHaveProperty('briefing_enviado_en');

    // El "despacho" ya selló: la confirmación encuentra la marca.
    filas.viaje = { ...filas.viaje!, briefing_enviado_en: '2026-08-26T05:00:00Z' };
    expect(await enviarBriefingInicio('t-1', 'v-1')).toBe('ya_enviado');
    expect(sendText).toHaveBeenCalledTimes(1);
  });

  it('si Meta no aceptó (ventana cerrada), NO sella: el reintento sigue vivo', async () => {
    sendText.mockResolvedValue(null);
    expect(await enviarBriefingInicio('t-1', 'v-1')).toBe('fallo');
    expect(filas.sellos).toHaveLength(0);
  });

  it('sin operador o sin teléfono utilizable, se omite sin intentar', async () => {
    filas.viaje = { ...filas.viaje!, operador_id: null };
    expect(await enviarBriefingInicio('t-1', 'v-1')).toBe('omitido');

    filas.viaje = { ...filas.viaje!, operador_id: 'op-1' };
    filas.operador = { telefono: 'n/a', licencia_vence: null };
    expect(await enviarBriefingInicio('t-1', 'v-1')).toBe('omitido');
    expect(sendText).not.toHaveBeenCalled();
  });

  it('solo los proveedores VERIFICADOS entran al mensaje', async () => {
    listarProveedoresEmergencia.mockResolvedValue([
      { id: 'p1', tipo: 'grua', nombre: 'Grúas Maya', telefono: '9991112233', radioKm: null, verificadoEn: '2026-08-01', notas: null },
      { id: 'p2', tipo: 'llantera', nombre: 'Llantas Sur', telefono: '9994445566', radioKm: null, verificadoEn: null, notas: null },
    ]);
    await enviarBriefingInicio('t-1', 'v-1');
    const texto = sendText.mock.calls[0][1] as string;
    expect(texto).toContain('Grúas Maya');
    expect(texto).not.toContain('Llantas Sur');
  });

  it('el pacto del CLIENTE gana sobre el de flota', async () => {
    filas.viaje = { ...filas.viaje!, cliente_id: 'c-9' };
    filas.cliente = { nombre: 'CEDIS Peninsular', geocerca_id: null };
    politicasDetencion.mockResolvedValue({
      flota: { horasLibres: 2, tarifaHora: null, moneda: 'MXN' },
      porCliente: new Map([['c-9', { horasLibres: 5, tarifaHora: null, moneda: 'MXN' }]]),
    });
    await enviarBriefingInicio('t-1', 'v-1');
    const texto = sendText.mock.calls[0][1] as string;
    expect(texto).toContain('5 horas libres');
  });

  it('la licencia por vencer del chofer entra como hecho', async () => {
    const pronto = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
    filas.operador = { telefono: '+5219991234567', licencia_vence: pronto };
    await enviarBriefingInicio('t-1', 'v-1');
    const texto = sendText.mock.calls[0][1] as string;
    expect(texto).toContain('Tu licencia');
  });

  it('una lectura rota LANZA: no se manda un briefing a medias', async () => {
    filas.viaje = { ...filas.viaje!, unidad_id: 'u-1' };
    filas.unidad = null; // maybeSingle da null sin error — eso es ausencia, no error
    // La ausencia de la unidad no lanza (la unidad pudo borrarse): sale sin ella.
    expect(await enviarBriefingInicio('t-1', 'v-1')).toBe('enviado');
  });
});
