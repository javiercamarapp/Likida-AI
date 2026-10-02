import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const {
  correrWorkerCartaPorte, armarAviso, intercalarPorFlota, TOPE_FALLOS_MODELO_SEGUIDOS, TOPE_AVISOS_POR_PASADA, TOPE_AVISOS_RECHAZADOS_SEGUIDOS, MARGEN_EXTRACCION_MS,
} = await import('./worker');
type DepsWorker = import('./worker').DepsWorker;
type DocumentoFila = import('./repo').DocumentoFila;
type ResultadoProceso = import('./servicio').ResultadoProceso;
type ResultadoAvisoOficina = import('@/lib/meta/aviso_oficina').ResultadoAvisoOficina;

const T = 'tenant-a';
const URL = 'https://app.test/dashboard/carta-porte/documentos';
const OK: ResultadoProceso = { ok: true, estado: 'por_revisar', origen: 'llm', nivel: 1, costoUsd: 0.01, listoParaAprobar: true };
const falla = (motivo: 'archivo' | 'ilegible' | 'presupuesto' | 'modelo', permanente = false, alcance?: 'run' | 'tenant' | 'proposito'): ResultadoProceso => ({ ok: false, motivo, mensaje: `fallo ${motivo}`, permanente, ...(alcance ? { alcance } : {}) });

const doc = (over: Partial<DocumentoFila> = {}): DocumentoFila => ({
  id: 'd1', tenantId: T, canal: 'correo', formato: 'pdf_texto', nombreArchivo: 'orden.pdf', mime: 'application/pdf', bytes: 10, sha256: 'x', storageRuta: 'r',
  estado: 'por_revisar', version: 1, clienteId: null, perfilId: null, perfilVersion: null, remitente: null, asunto: null, remitenteReconocido: null,
  textoExtracto: null, riesgoInyeccion: false, extraccion: null, validacion: { hallazgos: [], bloqueos: 0, porConfirmar: 0, listoParaAprobar: true }, confianzaMin: 0.99,
  nivelModelo: 1, modelo: null, tokensIn: 0, tokensOut: 0, costoUsd: 0, viajeId: null, procesandoHasta: null, intentos: 1, ultimoError: null, abiertoEn: null,
  revisadoPor: null, aprobadoPor: null, aprobadoEn: null, rechazoMotivo: null, tiempoRevisionSeg: null, exportadoEn: null, retenerHasta: '2027-01-01',
  purgadoEn: null, createdAt: '2026-10-02T00:00:00Z', updatedAt: '2026-10-02T00:00:00Z', ...over,
});

interface Mundo {
  deps: DepsWorker;
  procesados: string[];
  avisos: Array<{ telefono: string; texto: string; contexto: Record<string, unknown> }>;
  candados: Map<string, Set<string>>;
  eventos: Array<{ id: string; tipo: string }>;
  reloj: { t: number };
}

function mundo(o: {
  pendientes?: string[];
  proceso?: (id: string) => ResultadoProceso | Promise<ResultadoProceso> | never;
  agotados?: string[] | null;
  porAvisar?: string[] | null;
  docs?: Record<string, Partial<DocumentoFila>>;
  telefono?: string | null;
  envio?: () => ResultadoAvisoOficina;
  avanceMs?: number;
} = {}): Mundo {
  const procesados: string[] = [];
  const avisos: Mundo['avisos'] = [];
  const candados = new Map<string, Set<string>>();
  const eventos: Mundo['eventos'] = [];
  const reloj = { t: 1_000_000 };
  const deps: DepsWorker = {
    pendientes: async () => (o.pendientes ?? []).map((id) => ({ tenantId: T, id, estado: 'recibido' as const, intentos: 0 })),
    procesar: async (_t, id) => { procesados.push(id); reloj.t += o.avanceMs ?? 1_000; return (o.proceso ? o.proceso(id) : OK); },
    agotados: async () => (o.agotados === null ? null : (o.agotados ?? []).map((id) => ({ tenantId: T, id }))),
    porAvisar: async () => (o.porAvisar === null ? null : (o.porAvisar ?? []).map((id) => ({ tenantId: T, id }))),
    leer: async (_t, id) => doc({ id, ...(o.docs?.[id] ?? {}) }),
    reclamarAviso: async (_t, id, tipo) => {
      const s = candados.get(id) ?? new Set<string>();
      if (s.has(tipo)) return 'perdido';
      s.add(tipo); candados.set(id, s);
      return 'ganado';
    },
    liberarAviso: async (_t, id, tipo) => { candados.get(id)?.delete(tipo); return true; },
    telefonoOficina: async () => (o.telefono === undefined ? '5215500000001' : o.telefono),
    avisar: async (telefono, texto, _p, contexto) => { avisos.push({ telefono, texto, contexto }); return o.envio ? o.envio() : { ok: true, via: 'texto', id: 'w1' }; },
    evento: async (_t, id, tipo) => { eventos.push({ id, tipo }); },
    ahora: () => reloj.t,
  };
  return { deps, procesados, avisos, candados, eventos, reloj };
}

const opts = (m: Mundo, extra: Partial<import('./worker').OpcionesWorker> = {}) => ({ venceEn: m.reloj.t + 600_000, urlBandeja: URL, ...extra });

describe('procesar lo pendiente', () => {
  it('procesa cada documento elegido y lo cuenta', async () => {
    const m = mundo({ pendientes: ['a', 'b', 'c'] });
    const r = await correrWorkerCartaPorte(m.deps, opts(m));
    expect(m.procesados).toEqual(['a', 'b', 'c']);
    expect(r).toMatchObject({ pendientes: 3, procesados: 3, fallidos: 0, errores: 0, cortadosPorReloj: 0 });
  });

  it('un archivo con varios embarques que se PARTE cuenta como procesado y como dividido (sus hijos entran a la pasada siguiente)', async () => {
    const DIVIDIDO: ResultadoProceso = { ok: true, estado: 'dividido', embarques: 3, hijos: ['h1', 'h2', 'h3'], yaExistian: 0 };
    const m = mundo({ pendientes: ['a', 'b'], proceso: (id) => (id === 'a' ? DIVIDIDO : OK) });
    const r = await correrWorkerCartaPorte(m.deps, opts(m));
    expect(r).toMatchObject({ pendientes: 2, procesados: 2, divididos: 1, fallidos: 0, errores: 0 });
  });

  it('un documento que otra invocación ya tenía no es un error ni un fallo', async () => {
    const m = mundo({ pendientes: ['a', 'b'], proceso: (id) => (id === 'a' ? { ok: false, motivo: 'no_reclamable', mensaje: 'ya', permanente: false } : OK) });
    const r = await correrWorkerCartaPorte(m.deps, opts(m));
    expect(r).toMatchObject({ procesados: 1, yaTomados: 1, fallidos: 0, errores: 0 });
  });

  it('el reloj corta ANTES del claim: lo no intentado queda intacto y se dice', async () => {
    const m = mundo({ pendientes: ['a', 'b', 'c', 'd'], avanceMs: 40_000 });
    const r = await correrWorkerCartaPorte(m.deps, { venceEn: m.reloj.t + 80_000 + MARGEN_EXTRACCION_MS - 1, urlBandeja: URL });
    expect(m.procesados).toEqual(['a', 'b']);
    expect(r.cortadosPorReloj).toBe(2);
  });

  it('el techo de IA agotado de la flota: el resto de SUS documentos no se toca (se omiten, no se cortan por reloj)', async () => {
    const m = mundo({ pendientes: ['a', 'b', 'c'], proceso: () => falla('presupuesto') });
    const r = await correrWorkerCartaPorte(m.deps, opts(m));
    expect(m.procesados).toEqual(['a']);
    expect(r).toMatchObject({ paradaPorPresupuesto: true, fallidos: 1, omitidosPorPresupuesto: 2 });
  });

  it(`${TOPE_FALLOS_MODELO_SEGUIDOS} fallos de modelo seguidos paran la pasada; uno bueno reinicia la racha`, async () => {
    const ids = Array.from({ length: 8 }, (_, i) => `d${i}`);
    const m = mundo({ pendientes: ids, proceso: () => falla('modelo') });
    const r = await correrWorkerCartaPorte(m.deps, opts(m));
    expect(m.procesados).toHaveLength(TOPE_FALLOS_MODELO_SEGUIDOS);
    expect(r).toMatchObject({ paradaPorFallosSeguidos: true, cortadosPorReloj: 8 - TOPE_FALLOS_MODELO_SEGUIDOS });

    let n = 0;
    const m2 = mundo({ pendientes: ids, proceso: () => (++n % 3 === 0 ? OK : falla('modelo')) });
    const r2 = await correrWorkerCartaPorte(m2.deps, opts(m2));
    expect(r2.paradaPorFallosSeguidos).toBe(false);
    expect(m2.procesados).toHaveLength(8);
  });

  it('un archivo ilegible (permanente) no cuenta como modelo caído', async () => {
    const m = mundo({ pendientes: ['a', 'b', 'c', 'd', 'e'], proceso: () => falla('ilegible', true) });
    const r = await correrWorkerCartaPorte(m.deps, opts(m));
    expect(r).toMatchObject({ procesados: 0, fallidos: 5, paradaPorFallosSeguidos: false });
    expect(m.procesados).toHaveLength(5);
  });

  it('un documento que revienta (la base) no tumba el lote', async () => {
    const m = mundo({ pendientes: ['a', 'b'], proceso: (id) => { if (id === 'a') throw new Error('base caída'); return OK; } });
    const r = await correrWorkerCartaPorte(m.deps, opts(m));
    expect(r).toMatchObject({ procesados: 1, errores: 1 });
    expect(r.fallos[0]).toContain('base caída');
  });

  it('si no se pudo ELEGIR (la base), se dice y los avisos igual corren', async () => {
    const m = mundo({ porAvisar: ['x'] });
    m.deps.pendientes = async () => { throw new Error('rpc roto'); };
    const r = await correrWorkerCartaPorte(m.deps, opts(m));
    expect(r.errores).toBe(1);
    expect(r.avisosEnviados).toBe(1);
  });
});

describe('avisar a la oficina (una vez por documento)', () => {
  it('un documento de correo con dudas avisa UNA vez y la pasada siguiente no repite', async () => {
    const m = mundo({ porAvisar: ['x'], docs: { x: { validacion: { hallazgos: [], bloqueos: 2, porConfirmar: 0, listoParaAprobar: false } } } });
    const r1 = await correrWorkerCartaPorte(m.deps, opts(m));
    expect(r1).toMatchObject({ hallazgos: 1, avisosEnviados: 1 });
    expect(m.avisos[0].texto).toContain('2 datos bloquean');
    expect(m.avisos[0].texto).toContain(`${URL}/x`);
    expect(m.avisos[0].contexto).toMatchObject({ agente: 'carta_porte', tenantId: T, documentoId: 'x', tipo: 'hallazgos' });
    const r2 = await correrWorkerCartaPorte(m.deps, opts(m));
    expect(r2).toMatchObject({ avisosEnviados: 0, avisosPerdidos: 1 });
    expect(m.avisos).toHaveLength(1);
  });

  it('un documento agotado avisa UNA vez (terminal)', async () => {
    const m = mundo({ agotados: ['z'], docs: { z: { estado: 'fallido', intentos: 5 } } });
    const r = await correrWorkerCartaPorte(m.deps, opts(m));
    expect(r).toMatchObject({ agotados: 1, avisosEnviados: 1 });
    expect(m.avisos[0].texto).toContain('No pude leer el documento');
    await correrWorkerCartaPorte(m.deps, opts(m));
    expect(m.avisos).toHaveLength(1);
    expect(m.eventos).toEqual([{ id: 'z', tipo: 'reintentos_agotados' }]);
  });

  it('REGLA DEL OUTBOX: un rechazo REINTENTABLE ya está en wa_outbox: el candado se queda y la pasada siguiente NO reenvía', async () => {
    const m = mundo({ porAvisar: ['x'], docs: { x: { confianzaMin: 0.4 } }, envio: () => ({ ok: false, motivo: 'límite de tasa', fueraDeVentana: false, reintentable: true }) });
    const r1 = await correrWorkerCartaPorte(m.deps, opts(m));
    expect(r1).toMatchObject({ avisosEnCola: 1, avisosFallidos: 0, avisosEnviados: 0 });
    expect(m.candados.get('x')?.has('hallazgos')).toBe(true);
    expect(r1.fallos[0]).toMatch(/no se reenvía/);
    const r2 = await correrWorkerCartaPorte(m.deps, opts(m));
    expect(r2).toMatchObject({ avisosPerdidos: 1, avisosEnCola: 0 });
    expect(m.avisos).toHaveLength(1);
  });

  it('un rechazo DEFINITIVO (plantilla sin aprobar) no mandó nada: se suelta el candado y la pasada siguiente reintenta', async () => {
    let falla = true;
    const m = mundo({ porAvisar: ['x'], docs: { x: { confianzaMin: 0.4 } }, envio: () => (falla ? { ok: false, motivo: 'plantilla sin aprobar', fueraDeVentana: true, reintentable: false } : { ok: true, via: 'plantilla', id: 'w' }) });
    const r1 = await correrWorkerCartaPorte(m.deps, opts(m));
    expect(r1).toMatchObject({ avisosFallidos: 1, avisosEnviados: 0 });
    expect(m.candados.get('x')?.has('hallazgos')).toBe(false);
    falla = false;
    const r2 = await correrWorkerCartaPorte(m.deps, opts(m));
    expect(r2.avisosEnviados).toBe(1);
  });

  it(`${TOPE_AVISOS_RECHAZADOS_SEGUIDOS} rechazos definitivos seguidos paran los avisos (una plantilla sin aprobar rebota para todos)`, async () => {
    const ids = Array.from({ length: 8 }, (_, i) => `x${i}`);
    const m = mundo({ porAvisar: ids, docs: Object.fromEntries(ids.map((i) => [i, { confianzaMin: 0.4 }])), envio: () => ({ ok: false, motivo: 'no aprobada', fueraDeVentana: true, reintentable: false }) });
    const r = await correrWorkerCartaPorte(m.deps, opts(m));
    expect(m.avisos).toHaveLength(TOPE_AVISOS_RECHAZADOS_SEGUIDOS);
    expect(r.avisosFallidos).toBe(TOPE_AVISOS_RECHAZADOS_SEGUIDOS);
  });

  it(`a lo más ${TOPE_AVISOS_POR_PASADA} avisos por pasada`, async () => {
    const ids = Array.from({ length: 15 }, (_, i) => `x${i}`);
    const m = mundo({ porAvisar: ids, docs: Object.fromEntries(ids.map((i) => [i, { confianzaMin: 0.4 }])) });
    await correrWorkerCartaPorte(m.deps, opts(m));
    expect(m.avisos).toHaveLength(TOPE_AVISOS_POR_PASADA);
  });

  it('sin teléfono de la oficina no se reclama el candado: cuando lo capturen, el aviso sale', async () => {
    const m = mundo({ porAvisar: ['x'], docs: { x: { confianzaMin: 0.4 } }, telefono: null });
    const r = await correrWorkerCartaPorte(m.deps, opts(m));
    expect(r).toMatchObject({ sinTelefono: 1, avisosEnviados: 0 });
    expect(m.candados.size).toBe(0);
  });

  it('una base SIN la 0641 deja los avisos apagados (no hay candado atómico) y lo dice', async () => {
    const m = mundo({ agotados: null, porAvisar: null });
    const r = await correrWorkerCartaPorte(m.deps, opts(m));
    expect(r.avisosSinMigracion).toBe(true);
    expect(m.avisos).toHaveLength(0);

    const m2 = mundo({ porAvisar: ['x'], docs: { x: { confianzaMin: 0.4 } } });
    m2.deps.reclamarAviso = async () => 'sin_migracion';
    const r2 = await correrWorkerCartaPorte(m2.deps, opts(m2));
    expect(r2.avisosSinMigracion).toBe(true);
    expect(m2.avisos).toHaveLength(0);
  });

  it('un evento que no se puede escribir (sin la 0642) no tumba el aviso', async () => {
    const m = mundo({ porAvisar: ['x'], docs: { x: { confianzaMin: 0.4 } } });
    m.deps.evento = async () => { throw new Error('check de tipo'); };
    const r = await correrWorkerCartaPorte(m.deps, opts(m));
    expect(r).toMatchObject({ avisosEnviados: 1, errores: 0 });
  });

  it('los avisos corren aunque el modelo esté caído (no dependen de él)', async () => {
    const m = mundo({ pendientes: ['a'], proceso: () => falla('presupuesto'), porAvisar: ['x'], docs: { x: { confianzaMin: 0.4 } } });
    const r = await correrWorkerCartaPorte(m.deps, opts(m));
    expect(r).toMatchObject({ paradaPorPresupuesto: true, avisosEnviados: 1 });
  });
});

describe('el texto del aviso', () => {
  it('no lleva datos de los campos extraídos: solo conteos, el nombre del archivo y la liga', () => {
    const a = armarAviso('hallazgos', doc({ validacion: { hallazgos: [{ campo: 'origen_rfc', renglon: null, severidad: 'bloqueo', codigo: 'x', mensaje: 'RFC XAXX010101000 inválido' }], bloqueos: 1, porConfirmar: 0, listoParaAprobar: false }, confianzaMin: 0.5 }), `${URL}/d1`);
    expect(a.texto).toContain('1 dato bloquea');
    expect(a.texto).toContain('lectura poco segura');
    expect(a.texto).not.toContain('XAXX010101000');
    expect(a.resumen.length).toBeLessThanOrEqual(60);
  });

  it('un nombre de archivo larguísimo se recorta', () => {
    const a = armarAviso('agotado', doc({ nombreArchivo: `${'x'.repeat(300)}.pdf` }), `${URL}/d1`);
    expect(a.texto.length).toBeLessThan(400);
  });
});

beforeEach(() => vi.clearAllMocks());


describe('ADVERSARIAL 07: aislamiento entre flotas y presupuesto', () => {
  const pend = (tenantId: string, id: string) => ({ tenantId, id, estado: 'recibido' as const, intentos: 0 });

  it('el techo de IA de una flota NO detiene a las demás: sus documentos se saltan y la otra flota se procesa', async () => {
    const m = mundo();
    m.deps.pendientes = async () => [pend('A', 'a1'), pend('A', 'a2'), pend('A', 'a3'), pend('B', 'b1')];
    m.deps.procesar = async (t, id) => { m.procesados.push(id); return t === 'A' ? falla('presupuesto', false, 'tenant') : OK; };
    const r = await correrWorkerCartaPorte(m.deps, opts(m));
    expect(m.procesados).toEqual(['a1', 'b1']);
    expect(r).toMatchObject({ paradaPorPresupuesto: true, fallidos: 1, procesados: 1, omitidosPorPresupuesto: 2 });
  });

  it('el tope de fondo de una flota (proposito) tampoco frena a las otras', async () => {
    const m = mundo();
    m.deps.pendientes = async () => [pend('A', 'a1'), pend('B', 'b1'), pend('B', 'b2')];
    m.deps.procesar = async (t, id) => { m.procesados.push(id); return t === 'A' ? falla('presupuesto', false, 'proposito') : OK; };
    const r = await correrWorkerCartaPorte(m.deps, opts(m));
    expect(m.procesados).toEqual(['a1', 'b1', 'b2']);
    expect(r.procesados).toBe(2);
  });

  it('el tope POR DOCUMENTO (run) no corta nada: el siguiente documento de la misma flota se intenta', async () => {
    const m = mundo({ pendientes: ['a', 'b', 'c'], proceso: (id) => (id === 'a' ? falla('presupuesto', false, 'run') : OK) });
    const r = await correrWorkerCartaPorte(m.deps, opts(m));
    expect(m.procesados).toEqual(['a', 'b', 'c']);
    expect(r).toMatchObject({ paradaPorPresupuesto: false, fallidos: 1, procesados: 2, omitidosPorPresupuesto: 0 });
  });

  it('el lote se reparte por turnos entre flotas: una flota con muchos recibidos no deja sin turno a la otra', () => {
    const lista = [...Array.from({ length: 30 }, (_, i) => pend('A', `a${i}`)), pend('B', 'b0'), pend('C', 'c0')];
    const lote = intercalarPorFlota(lista, 25);
    expect(lote).toHaveLength(25);
    expect(lote.slice(0, 3).map((d) => d.id)).toEqual(['a0', 'b0', 'c0']);
    expect(lote.filter((d) => d.tenantId === 'A').map((d) => d.id).slice(0, 3)).toEqual(['a0', 'a1', 'a2']);
    expect(intercalarPorFlota(lista.filter((d) => d.tenantId === 'A'), 25)).toHaveLength(25);
  });

  it('pide a la base más de lo que va a procesar (para poder repartir) y procesa a lo más el tope', async () => {
    const m = mundo();
    let pedido = 0;
    m.deps.pendientes = async (limite) => { pedido = limite; return Array.from({ length: 60 }, (_, i) => pend(i % 2 ? 'A' : 'B', `d${i}`)); };
    const r = await correrWorkerCartaPorte(m.deps, opts(m));
    expect(pedido).toBeGreaterThan(25);
    expect(r.pendientes).toBe(25);
  });
});

describe('ADVERSARIAL 07: el aviso que el cliente de Meta ya encoló no se reenvía en cada pasada', () => {
  it('token vencido (no reintentable pero encolado): el candado se queda cerrado y la 2.ª pasada no vuelve a mandar', async () => {
    const m = mundo({ porAvisar: ['x'], docs: { x: { confianzaMin: 0.4 } }, envio: () => ({ ok: false, motivo: 'token vencido', codigo: 190, fueraDeVentana: false, reintentable: false, encolado: true }) });
    const r1 = await correrWorkerCartaPorte(m.deps, opts(m));
    const r2 = await correrWorkerCartaPorte(m.deps, opts(m));
    const r3 = await correrWorkerCartaPorte(m.deps, opts(m));
    expect(m.avisos).toHaveLength(1);
    expect(r1).toMatchObject({ avisosEnCola: 1, avisosFallidos: 0 });
    expect(r2.avisosPerdidos).toBe(1);
    expect(r3.avisosPerdidos).toBe(1);
  });

  it('un rechazo definitivo que NO se encoló sí suelta el candado (reintentar es gratis)', async () => {
    const m = mundo({ porAvisar: ['x'], docs: { x: { confianzaMin: 0.4 } }, envio: () => ({ ok: false, motivo: 'plantilla sin aprobar', fueraDeVentana: true, reintentable: false, encolado: false }) });
    await correrWorkerCartaPorte(m.deps, opts(m));
    await correrWorkerCartaPorte(m.deps, opts(m));
    expect(m.avisos).toHaveLength(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// RONDA 15: M3 (zombis) y M1 (aviso cuando un archivo partido reabrió o repitió embarques).
// ═══════════════════════════════════════════════════════════════════════════
describe('un archivo partido que reabrió hijos previos avisa a la oficina (M1)', () => {
  const dividido = (extra: { reabiertos?: number; sinArchivo?: number }): ResultadoProceso => ({ ok: true, estado: 'dividido', embarques: 3, hijos: ['h1', 'h2', 'h3'], yaExistian: 2, ...extra });

  it('con reabiertos o sin archivo: un aviso con el conteo y la liga; sin ellos, ninguno', async () => {
    const m = mundo({ pendientes: ['a'], proceso: () => dividido({ reabiertos: 1, sinArchivo: 1 }), docs: { a: { nombreArchivo: 'plan.xlsx' } } });
    const r = await correrWorkerCartaPorte(m.deps, opts(m));
    expect(r).toMatchObject({ divididos: 1, divisionesAvisadas: 1 });
    expect(m.avisos).toHaveLength(1);
    expect(m.avisos[0].texto).toMatch(/plan\.xlsx.*3 embarques.*1 embarque ya estaba en la bandeja rechazado o fallido y se reabrió.*1 ya estaba resuelto/);
    expect(m.avisos[0].contexto).toMatchObject({ tipo: 'division_con_previos', documentoId: 'a' });

    const sin = mundo({ pendientes: ['a'], proceso: () => dividido({}) });
    expect((await correrWorkerCartaPorte(sin.deps, opts(sin))).divisionesAvisadas).toBe(0);
    expect(sin.avisos).toHaveLength(0);
  });

  it('sin teléfono de la oficina no se rompe nada', async () => {
    const m = mundo({ pendientes: ['a'], proceso: () => dividido({ reabiertos: 1 }), telefono: null });
    const r = await correrWorkerCartaPorte(m.deps, opts(m));
    expect(r).toMatchObject({ divididos: 1, divisionesAvisadas: 0, sinTelefono: 1, errores: 0 });
  });
});
