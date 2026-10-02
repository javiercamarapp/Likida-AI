import { describe, it, expect, vi, beforeEach } from 'vitest';
import { crearDbMemoria, type DbMemoria, type Fila } from './db_memoria.fixture';

// ═══════════════════════════════════════════════════════════════════════════
// E2E AGENTE 11 — COMUNICACIÓN CON OPERADORES (aceptar el viaje + avisos y acuses por el selector de WhatsApp +
// hitos «ya llegué / descargando / de regreso», que desde la ola 2 atiende el motor del Conductor).
//
// Cadena REAL: texto del chofer → atenderConfirmacion (decidirInicio + marcarAceptado, UPDATE condicional) →
// aceptarPorActividad (una foto cuenta como aceptar) → acuse por el selector real (enviarConFallback, ventana 24 h/plantilla).
// Hitos: atenderConductor real con el mundo en memoria del Conductor (sincroniza el legado 0090 solo en el destino).
// El orden de llamadas del dispatcher se replica como en processor.ts (cableado probado en processor_hitos.test.ts).
// NOTA: hitos_viaje.ts (interpretarHito/sellarHito) ya NO lo llama processor.ts ni lo importa nadie (quedó documentado como
// utilitario sin llamador); por eso aquí NO se prueba como si fuera el camino del chofer. Los hitos los atiende el Conductor.
// DOBLES: base en memoria, Meta. Datos sintéticos.
// ═══════════════════════════════════════════════════════════════════════════

let db: DbMemoria;
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => db.cliente }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/meta/client', async (original) => {
  const real = await original<Record<string, unknown>>();
  const { meta } = await import('../conductor/meta.fixture');
  return { ...real, enviarTexto: (...a: Parameters<typeof meta.enviarTexto>) => meta.enviarTexto(...a), enviarBotones: (...a: Parameters<typeof meta.enviarBotones>) => meta.enviarBotones(...a), sendTemplate: (...a: Parameters<typeof meta.sendTemplate>) => meta.sendTemplate(...a) };
});
vi.mock('../wa_ventana', async (original) => {
  const real = await original<typeof import('../wa_ventana')>();
  const { meta } = await import('../conductor/meta.fixture');
  return { ...real, ventanaDeContacto: async (tel: string, ahora: Date = new Date()) => real.estadoDeVentana(meta.ultimoEntrante.get(real.normalizarTelefonoWa(tel)) ?? null, ahora), registrarDecisionEnvio: async () => {} };
});

const { atenderConfirmacion, aceptarPorActividad } = await import('../confirmar_viaje');
const { atenderConductor } = await import('../conductor/atender');
const { crearMundo } = await import('../conductor/mundo.fixture');
const { viajeBase } = await import('../conductor/memoria.fixture');
const { enviarConFallback } = await import('@/lib/meta/enviar_con_fallback');
const { meta } = await import('../conductor/meta.fixture');

const A = 't-a'; const B = 't-b';
const TEL = '5219990000001';
const T0 = new Date('2026-10-02T14:00:00.000Z');

const viaje = (id: string, tenant: string, operador: string, extra: Fila = {}): Fila => ({
  id, tenant_id: tenant, operador_id: operador, folio: `F-${id}`, origen: 'Planta Ficticia', destino: 'CEDIS Ficticio', estatus: 'abierto',
  avisado_en: '2026-10-02T12:00:00Z', aceptado_en: null, ...extra,
});
const fila = (id: string) => db.tablas.viaje.find((v) => v.id === id)!;

/** Lo que hace processor.ts con el texto del chofer que tiene un viaje por confirmar, y el acuse por el selector real. */
async function chofer(texto: string, ctx: { tenantId?: string; operadorId?: string; viajeId?: string | null; ahora?: Date; sinVentana?: boolean } = {}) {
  const tenantId = ctx.tenantId ?? A; const operadorId = ctx.operadorId ?? 'o1'; const ahora = ctx.ahora ?? T0;
  meta.estado.reloj = ahora; meta.entrante(TEL, ahora);
  const conf = await atenderConfirmacion({ tenantId, operadorId, texto, viajeActual: ctx.viajeId ?? null });
  if (ctx.sinVentana) meta.ultimoEntrante.delete(meta.norm(TEL)); // el chofer lleva más de 24 h sin escribir
  if (conf.mensaje) await enviarConFallback(TEL, { texto: conf.mensaje, plantilla: { nombre: 'recordatorio_cierre', parametros: ['x', 'y'] }, contexto: 'e2e.operadores', tenantId, ahora });
  return conf;
}

beforeEach(() => {
  meta.reiniciar();
  db = crearDbMemoria({ viaje: [viaje('v1', A, 'o1'), viaje('v2', A, 'o2'), viaje('v3', B, 'o3')] });
});

describe('feliz', () => {
  it('«sí» acepta el viaje, el acuse sale por texto con la ruta y la hora de aceptación queda sellada', async () => {
    const c = await chofer('sí');
    expect(c).toMatchObject({ estado: 'confirmado', viajeConfirmado: 'v1' });
    expect(c.mensaje).toMatch(/F-v1.*Planta Ficticia → CEDIS Ficticio/s);
    expect(fila('v1').aceptado_en).not.toBeNull();
    expect(meta.salientes).toHaveLength(1);
    expect(meta.salientes[0]).toMatchObject({ tipo: 'texto', a: TEL });
  });

  it('con varios viajes por confirmar elige por número y solo acepta el elegido', async () => {
    db.tablas.viaje.push(viaje('v4', A, 'o1', { avisado_en: '2026-10-02T13:00:00Z' }));
    const c = await chofer('2');
    expect(c.estado).toBe('confirmado');
    expect([fila('v1').aceptado_en, fila('v4').aceptado_en].filter(Boolean)).toHaveLength(1);
  });

  it('mandar un comprobante cuenta como aceptar (una foto es trabajo hecho)', async () => {
    await aceptarPorActividad(A, 'v1', 'o1');
    expect(fila('v1').aceptado_en).not.toBeNull();
  });
});

describe('fallo', () => {
  it('dijo «no»: no lo arranca, queda sin aceptar y se le explica por qué no se anotan gastos', async () => {
    const c = await chofer('no');
    expect(c.estado).toBe('sin_viaje');
    expect(c.mensaje).toMatch(/no anoto gastos|no lo arranco/i);
    expect(fila('v1').aceptado_en).toBeNull();
  });

  it('la base falla al marcar la aceptación: la función no lanza al chofer y el viaje sigue sin aceptar', async () => {
    db.fallar('viaje.update', 'PostgREST 503');
    await expect(aceptarPorActividad(A, 'v1', 'o1')).resolves.toBeUndefined();
    expect(fila('v1').aceptado_en).toBeNull();
  });

  it('un texto ininteligible no acepta nada y se le vuelve a preguntar', async () => {
    const c = await chofer('asdf qwer');
    expect(c.estado).not.toBe('confirmado');
    expect(fila('v1').aceptado_en).toBeNull();
  });

  it('ventana de 24 h cerrada: el acuse de la aceptación sale por plantilla (por el camino del chofer) y no se pierde en silencio', async () => {
    const c = await chofer('sí', { sinVentana: true });
    expect(c).toMatchObject({ estado: 'confirmado', viajeConfirmado: 'v1' });
    expect(fila('v1').aceptado_en).not.toBeNull();            // aceptar no depende de poder contestar
    expect(meta.salientes).toHaveLength(1);
    expect(meta.salientes[0]).toMatchObject({ tipo: 'plantilla', a: TEL, plantilla: 'recordatorio_cierre' });
  });
});

describe('duplicado', () => {
  it('aceptar dos veces no mueve la hora de aceptación', async () => {
    await chofer('sí'); const primera = fila('v1').aceptado_en;
    await chofer('sí', { ahora: new Date('2026-10-02T16:00:00Z') });
    expect(fila('v1').aceptado_en).toBe(primera);
  });

  it('aceptar por foto y por «sí» a la vez: UNA sola aceptación — el UPDATE de ambos lleva el candado «aceptado_en IS NULL» y la hora no se pisa', async () => {
    await Promise.all([aceptarPorActividad(A, 'v1', 'o1'), atenderConfirmacion({ tenantId: A, operadorId: 'o1', texto: 'sí' })]);
    const sello = fila('v1').aceptado_en;
    expect(sello).not.toBeNull();
    const updates = db.llamadas.filter((l) => l.tabla === 'viaje' && l.op === 'update' && (l.payload as Fila)?.aceptado_en !== undefined);
    expect(updates.length).toBeGreaterThanOrEqual(1);         // al menos una vía escribió (la otra pudo ver ya el sello)
    for (const u of updates) expect(u.filtros).toContainEqual(['aceptado_en', 'is', null]);
    await aceptarPorActividad(A, 'v1', 'o1');                 // un tercer intento tardío tampoco la mueve
    expect(fila('v1').aceptado_en).toBe(sello);
  });
});

describe('fuera de orden', () => {
  it('un viaje que Likida nunca avisó no se ofrece para confirmar (un «sí» no puede materializar un viaje)', async () => {
    db.tablas.viaje.push(viaje('v9', A, 'o9', { avisado_en: null }));
    expect((await atenderConfirmacion({ tenantId: A, operadorId: 'o9', texto: 'sí' })).mensaje).toBeNull();
    expect(fila('v9').aceptado_en).toBeNull();
  });

  it('el viaje se cerró antes de que el chofer contestara: no se acepta un viaje que ya no está abierto', async () => {
    fila('v1').estatus = 'liquidado';
    expect((await atenderConfirmacion({ tenantId: A, operadorId: 'o1', texto: 'sí' })).mensaje).toBeNull();
    expect(fila('v1').aceptado_en).toBeNull();
  });

  it('la respuesta es para un viaje que ya no es el actual del chofer: se ignora (no confirma otro por error)', async () => {
    const c = await atenderConfirmacion({ tenantId: A, operadorId: 'o1', texto: 'sí', viajeActual: 'v-inexistente' });
    expect(c.mensaje).toBeNull();
    expect(fila('v1').aceptado_en).toBeNull();               // v1 (el viaje real del chofer) sigue SIN aceptar
  });
});

describe('otro tenant / otro chofer', () => {
  it('un chofer no puede aceptar el viaje de otro chofer de la misma flota, ni de otra flota', async () => {
    expect((await atenderConfirmacion({ tenantId: A, operadorId: 'o1', texto: 'sí', viajeActual: 'v2' })).mensaje).toBeNull();
    expect((await atenderConfirmacion({ tenantId: B, operadorId: 'o1', texto: 'sí' })).mensaje).toBeNull();
    await aceptarPorActividad(B, 'v1', 'o1');       // tenant ajeno: UPDATE acotado, no toca nada
    await aceptarPorActividad(A, 'v2', 'o1');       // operador ajeno
    expect(fila('v1').aceptado_en).toBeNull();
    expect(fila('v2').aceptado_en).toBeNull();
  });
});

// ── los hitos del chofer los atiende el Conductor (ola 2); aquí solo el contrato que ve el chofer de comunicación ──
describe('hitos «ya llegué» (motor del Conductor)', () => {
  const V = '4f1f6e2e-95c1-4c52-9f9e-3f6f6bd8d001';
  const mundo = () => crearMundo({ viajes: [viajeBase({ id: V, aceptadoEn: '2026-10-02T13:00:00.000Z', operadorTelefono: TEL })], enviar: async () => ({ ok: true, canal: 'texto' }) as never });
  const msg = (w: ReturnType<typeof mundo>, texto: string, cuando: Date, extra: { tenantId?: string; operadorId?: string; wa?: string } = {}) =>
    atenderConductor({ tenantId: extra.tenantId ?? 't1', operadorId: extra.operadorId ?? 'o1', telefono: TEL, viajeAbiertoId: V, texto, mensajeEn: cuando, ahora: cuando, waMessageId: extra.wa ?? `wa-${texto}-${cuando.toISOString()}` }, w.m.deps);

  it('feliz: el primer «ya llegué» es la llegada a CARGAR y NO sella el destino del legado 0090', async () => {
    const w = mundo();
    const r = await msg(w, 'ya llegué', new Date('2026-10-02T15:00:00Z'));
    expect(r?.mensajes[0].texto).toMatch(/llegaste a CARGAR/);
    expect(w.m.legado).toEqual([]);
  });

  it('duplicado: el mismo «ya llegué» dos veces deja UN solo hito y conserva la primera hora', async () => {
    const w = mundo();
    await msg(w, 'ya llegué', new Date('2026-10-02T15:00:00Z'));
    await msg(w, 'ya llegué', new Date('2026-10-02T15:20:00Z'));
    expect(w.m.de(V).filter((h) => h.tipo === 'llegada_carga' && h.estado === 'recibido')).toHaveLength(1);
    expect(w.m.de(V).find((h) => h.tipo === 'llegada_carga')!.mensajeEn).toBe('2026-10-02T15:00:00.000Z');
  });

  it('otro tenant: un chofer de OTRA flota con el viaje de la mía no registra nada', async () => {
    const w = mundo();
    await msg(w, 'ya llegué', new Date('2026-10-02T15:00:00Z'), { tenantId: 't-otra', operadorId: 'o-ajeno' });
    expect(w.m.de(V).filter((h) => h.estado === 'recibido')).toHaveLength(0);
    // Control: el MISMO mensaje del chofer de la flota dueña sí registra el hito (la ausencia de arriba es aislamiento, no un motor roto).
    await msg(w, 'ya llegué', new Date('2026-10-02T15:05:00Z'), { wa: 'wa-propio' });
    expect(w.m.de(V).filter((h) => h.estado === 'recibido' && h.tipo === 'llegada_carga')).toHaveLength(1);
  });
});

// La «calle de instrucciones» del convenio al despachar, al reasignar y al acercarse a la planta, y la pregunta
// «¿por dónde entro?», las ejerce `convenios/convenios.e2e.test.ts` (y P7 las amplía con la edición en pantalla).
