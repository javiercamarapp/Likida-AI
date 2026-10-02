import { describe, it, expect, vi, beforeEach } from 'vitest';
import { crearBaseEnMemoria, type BaseEnMemoria, type Fila } from '@/lib/pruebas/tablas_en_memoria.fixture';

// ═══════════════════════════════════════════════════════════════════════════
// COBRANZA POR GASTO (Agente 7) — PRUEBA E2E DEL CICLO COMPLETO.
//
// Dobles SOLO de los proveedores (Meta/WhatsApp, registro de ventana de 24 h) y de
// la base en memoria; todo lo demás es el código REAL:
//
//   viajes y gastos de la flota → qué comprobante falta de qué gasto → cadencia
//   escalonada por gasto → fusión por chofer (UN mensaje) → tope diario → claim
//   atómico del lote → enviarConFallback REAL (texto o plantilla cobranza_gastos_v1)
//   → bitácora → barrido de resolución → efectividad del tablero.
//
// Casos: feliz, fallo de Meta (permanente y reintentable), duplicado (dos corridas
// solapadas), fuera de orden / ventana / tope diario, otro tenant, un chofer sin
// teléfono, y la convivencia con la cobranza por viaje (no duplica el día).
// Lo que un doble no prueba (CHECK, FK compuesta, RLS) lo prueba
// supabase/tests/0525_cobranza_por_gasto.sql contra Postgres real.
// ═══════════════════════════════════════════════════════════════════════════

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

const estado = vi.hoisted(() => ({ db: null as unknown as BaseEnMemoria }));
const ventana = vi.hoisted(() => ({ estado: 'cerrada' as 'abierta' | 'cerrada' }));
const meta = vi.hoisted(() => ({ enviarTexto: vi.fn(), enviarBotones: vi.fn(), sendTemplate: vi.fn() }));
const alerta = vi.hoisted(() => vi.fn());

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => estado.db.cliente }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/observability/alerta', () => ({ alertarOperador: alerta }));
vi.mock('../perfil/preguntas', () => ({ ventanaCobranzaDeclarada: () => null }));
vi.mock('../repo', () => ({ getPerfilCrudo: async () => null }));
vi.mock('./notificaciones', () => ({ avisarCorridasPorFlota: async () => {} }));
vi.mock('./corridas', () => ({ registrarCorrida: async () => {} }));
vi.mock('@/lib/likida/wa_ventana', () => ({
  ventanaDeContacto: async () => ({ estado: ventana.estado }),
  registrarDecisionEnvio: async () => {},
}));
vi.mock('@/lib/meta/client', () => ({
  enviarTexto: (...a: unknown[]) => meta.enviarTexto(...a),
  enviarBotones: (...a: unknown[]) => meta.enviarBotones(...a),
  sendTemplate: (...a: unknown[]) => meta.sendTemplate(...a),
  esReintentableMeta: (codigo?: number, status?: number) => codigo === 130429 || status === 429,
  motivoDeFalloWhatsApp: (error: string) => error,
}));

const { ejecutarCobranza } = await import('./cobranza');
const gastoMod = await import('./cobranza_gasto');

// Un miércoles a las 10:00 de México (16:00Z): dentro de la ventana 9–18 L–S.
const AHORA = new Date('2026-10-07T16:00:00Z');
const hace = (dias: number, desde: Date = AHORA) => new Date(desde.getTime() - dias * 86_400_000).toISOString();
const mas = (horas: number) => new Date(AHORA.getTime() + horas * 3_600_000);

const OK = { ok: true, id: 'wamid.OK' };

function config(tenant: string, extra: Fila = {}): Fila {
  return {
    tenant_id: tenant, activo: true, tiers: [3, 7, 14], hora_inicio: 9, hora_fin: 18, dias_semana: [1, 2, 3, 4, 5, 6],
    instrucciones: '', firma: 'Tráfico Norte', por_gasto: true, tiers_gasto: [1, 3, 7], max_mensajes_dia: 1,
    conceptos_cfdi: ['diesel', 'caseta'], umbral_foto: 0.5, ...extra,
  };
}

function viaje(tenant: string, id: string, op: { id: string; nombre: string; telefono: string | null }, extra: Fila = {}): Fila {
  return {
    id, tenant_id: tenant, folio: `F-${id}`, fecha_inicio: '2026-10-01', avisado_en: '2026-10-01T10:00:00Z',
    recordatorio_comprobacion_en: null, estatus: 'abierto', operador_id: op.id, operador: op, ...extra,
  };
}

function gasto(tenant: string, id: string, viajeId: string, extra: Fila = {}): Fila {
  return {
    id, tenant_id: tenant, viaje_id: viajeId, concepto: 'diesel', monto: 1200, fecha: '2026-10-05',
    created_at: hace(2), imagen_url: 'fotos/ticket.jpg', cfdi_uuid: null, ocr_confianza: 0.9,
    cfdi_esquema_alterno: null, estado_sat: null, ...extra,
  };
}

const JUAN = { id: 'op-1', nombre: 'Juan Pérez', telefono: '5211111111' };
const LUIS = { id: 'op-2', nombre: 'Luis Gómez', telefono: null as string | null };
const ANA = { id: 'op-3', nombre: 'Ana Ruiz', telefono: '5233333333' };

function nuevaBase(inicial: Record<string, Fila[]>) {
  estado.db = crearBaseEnMemoria(
    { viaje: [], gasto: [], agente_cobranza_config: [], cobranza_gasto_contacto: [], cobranza_contacto: [], ...inicial },
    [
      { tabla: 'cobranza_gasto_contacto', nombre: 'cobranza_gasto_contacto_gasto_tier_key', columnas: ['gasto_id', 'tier'] },
      { tabla: 'cobranza_contacto', nombre: 'cobranza_contacto_viaje_id_tier_key', columnas: ['viaje_id', 'tier'] },
    ],
  );
}

const contactos = () => estado.db.tabla('cobranza_gasto_contacto');
const tel = (n: number) => meta.sendTemplate.mock.calls[n]?.[0] as string;

beforeEach(() => {
  ventana.estado = 'cerrada';
  for (const m of Object.values(meta)) m.mockReset().mockResolvedValue(OK);
  alerta.mockReset();
});

describe('el ciclo feliz: qué comprobante falta de qué gasto, un mensaje por chofer', () => {
  beforeEach(() => {
    nuevaBase({
      agente_cobranza_config: [config(A)],
      viaje: [viaje(A, 'v1', JUAN)],
      gasto: [
        gasto(A, 'g1', 'v1'),                                                   // diésel con ticket, falta CFDI
        gasto(A, 'g2', 'v1', { concepto: 'caseta', monto: 85.5, imagen_url: null }), // sin foto
        gasto(A, 'g3', 'v1', { concepto: 'alimentacion', monto: 180 }),          // ticket legible, no exige CFDI: no se cobra
        gasto(A, 'g4', 'v1', { cfdi_uuid: 'U-1', estado_sat: 'vigente' }),       // ya comprobado
      ],
    });
  });

  it('fusiona los gastos pendientes del chofer en UN mensaje (plantilla, ventana cerrada) con QUÉ falta de CADA uno', async () => {
    const r = await ejecutarCobranza(A, AHORA);
    expect(r.gasto).toMatchObject({ pendientes: 2, mensajes: 1, gastosAvisados: 2, pospuestosPorTope: 0 });
    expect(r.contactados).toBe(1);
    expect(meta.enviarTexto).not.toHaveBeenCalled();
    expect(meta.sendTemplate).toHaveBeenCalledTimes(1);
    const [telefono, nombre, op] = meta.sendTemplate.mock.calls[0] as [string, string, { parametros: string[] }];
    expect(telefono).toBe('5211111111');
    expect(nombre).toBe('cobranza_gastos_v1');
    expect(op.parametros[0]).toBe('Juan Pérez');
    expect(op.parametros[1]).toBe('2');
    expect(op.parametros[2]).toContain('Diésel $1,200.00');
    expect(op.parametros[2]).toContain('falta la factura (CFDI)');

    // El claim: una fila por (gasto, tier), mismo lote, con el motivo.
    expect(contactos()).toHaveLength(2);
    expect(new Set(contactos().map((c) => c.lote_id)).size).toBe(1);
    expect(contactos().map((c) => [c.gasto_id, c.tier, c.motivo, c.enviado, c.via]).sort()).toEqual([
      ['g1', 1, 'sin_cfdi', true, 'plantilla'],
      ['g2', 1, 'sin_foto', true, 'plantilla'],
    ]);
  });

  it('con la ventana de 24 h ABIERTA el mensaje sale como texto con un renglón por gasto, y la firma', async () => {
    ventana.estado = 'abierta';
    await ejecutarCobranza(A, AHORA);
    expect(meta.sendTemplate).not.toHaveBeenCalled();
    const texto = meta.enviarTexto.mock.calls[0][1] as string;
    expect(texto).toContain('Te faltan comprobantes de 2 gastos');
    expect(texto).toContain('· Diésel $1,200.00');
    expect(texto).toContain('falta la factura (CFDI)');
    expect(texto).toContain('· Casetas $85.50');
    expect(texto).toContain('falta la foto del ticket');
    expect(texto).toContain('— Tráfico Norte');
    expect(contactos().every((c) => c.via === 'texto')).toBe(true);
  });

  it('la cadencia escalonada: no repite el mismo tier, escala al 3 y al 7 en su día, y deja de insistir al agotarse', async () => {
    await ejecutarCobranza(A, AHORA);                       // día 2 → tier 1
    await ejecutarCobranza(A, mas(2));                      // misma jornada → nada nuevo
    expect(meta.sendTemplate).toHaveBeenCalledTimes(1);

    await ejecutarCobranza(A, mas(24));                     // día 3 → tier 3
    expect(meta.sendTemplate).toHaveBeenCalledTimes(2);
    expect(contactos().filter((c) => c.tier === 3)).toHaveLength(2);

    await ejecutarCobranza(A, mas(24 * 3));                 // día 5: sin tier nuevo
    expect(meta.sendTemplate).toHaveBeenCalledTimes(2);
    await ejecutarCobranza(A, mas(24 * 5));                 // día 7 → tier 7
    expect(meta.sendTemplate).toHaveBeenCalledTimes(3);
    await ejecutarCobranza(A, mas(24 * 12));                // día 14: la cadencia se agotó
    expect(meta.sendTemplate).toHaveBeenCalledTimes(3);
  });

  it('EFECTIVIDAD: cuando llega el comprobante, el barrido lo marca resuelto y el tablero mide tasa y mediana', async () => {
    await ejecutarCobranza(A, AHORA);
    // 4 horas después el chofer manda la foto del g2 y el XML del g1.
    const g1 = estado.db.tabla('gasto').find((g) => g.id === 'g1')!;
    const g2 = estado.db.tabla('gasto').find((g) => g.id === 'g2')!;
    g1.cfdi_uuid = 'U-NUEVO'; g1.estado_sat = 'vigente';
    g2.imagen_url = 'fotos/caseta.jpg'; g2.ocr_confianza = 0.95; // caseta con ticket legible pero sin CFDI: SIGUE faltando
    const r = await ejecutarCobranza(A, mas(4));
    expect(r.gasto?.resueltos).toBe(1);
    const resueltos = contactos().filter((c) => c.resuelto_por === 'chofer');
    expect(resueltos.map((c) => c.gasto_id)).toEqual(['g1']);
    expect(contactos().find((c) => c.gasto_id === 'g2')?.resuelto_en).toBeUndefined();

    const tablero = await gastoMod.tableroGastos(A, mas(5));
    expect(tablero.efectividad).toMatchObject({ avisos: 2, resueltosPorChofer: 1, abiertos: 1 });
    expect(tablero.efectividad.tasa).toBeNull();            // menos de 5 avisos: no se publica un %
    expect(tablero.efectividad.medianaHoras).toBe(4);
    expect(tablero.bitacora).toHaveLength(2);
    // Con los datos que el tablero necesita: qué gasto, de qué viaje, de qué chofer.
    expect(tablero.bitacora.map((b) => b.gastoId).sort()).toEqual(['g1', 'g2']);
  });

  it('un viaje que se liquida con el comprobante faltando queda como «cerrado sin resolver», no como éxito', async () => {
    await ejecutarCobranza(A, AHORA);
    // El barrido lee `viaje:viaje_id(estatus)` del gasto: el doble no hace joins, el dato va pre-embebido.
    for (const g of estado.db.tabla('gasto')) g.viaje = { estatus: 'liquidado' };
    estado.db.tabla('viaje')[0].estatus = 'liquidado';
    const r = await ejecutarCobranza(A, mas(30));
    expect(r.gasto).toMatchObject({ pendientes: 0, mensajes: 0 }); // el viaje liquidado ya no se cobra
    expect(r.gasto?.resueltos).toBe(2);                      // el barrido de la propia corrida los marca
    expect(contactos().every((c) => c.resuelto_por === 'cierre')).toBe(true);
  });
});

describe('fallo del proveedor', () => {
  beforeEach(() => {
    nuevaBase({
      agente_cobranza_config: [config(A)],
      viaje: [viaje(A, 'v1', JUAN)],
      gasto: [gasto(A, 'g1', 'v1')],
    });
  });

  it('un rechazo PERMANENTE de Meta deja el intento en bitácora con su porqué y consume el tier (no insiste contra un número roto)', async () => {
    meta.sendTemplate.mockResolvedValue({ ok: false, error: 'La plantilla no está aprobada', codigo: 132001, status: 400 });
    meta.enviarTexto.mockResolvedValue({ ok: false, error: 'ventana', codigo: 131047, status: 400 });
    const r = await ejecutarCobranza(A, AHORA);
    expect(r.gasto?.mensajes).toBe(0);
    expect(r.fallos.join(' ')).toContain('La plantilla no está aprobada');
    expect(contactos()).toEqual([expect.objectContaining({ gasto_id: 'g1', enviado: false })]);
    expect(String(contactos()[0].detalle)).toContain('La plantilla no está aprobada');
    // Mismo día: no vuelve a intentarlo.
    meta.sendTemplate.mockClear();
    await ejecutarCobranza(A, mas(1));
    expect(meta.sendTemplate).not.toHaveBeenCalled();
  });

  it('un rechazo REINTENTABLE (429) libera el claim: el tier no se consume y la corrida siguiente sí lo manda', async () => {
    meta.sendTemplate.mockResolvedValue({ ok: false, error: 'rate limit', codigo: 130429, status: 429 });
    const r = await ejecutarCobranza(A, AHORA);
    expect(r.rechazosReintentables).toBe(1);
    expect(contactos()).toHaveLength(0);
    meta.sendTemplate.mockResolvedValue(OK);
    const r2 = await ejecutarCobranza(A, mas(1));
    expect(r2.gasto?.mensajes).toBe(1);
    expect(contactos()).toEqual([expect.objectContaining({ gasto_id: 'g1', enviado: true })]);
  });

  it('el chofer SIN teléfono se dice (bitácora con motivo) y no se reintenta cada hora', async () => {
    nuevaBase({
      agente_cobranza_config: [config(A)],
      viaje: [viaje(A, 'v2', LUIS)],
      gasto: [gasto(A, 'g9', 'v2')],
    });
    const r = await ejecutarCobranza(A, AHORA);
    expect(r.gasto).toMatchObject({ mensajes: 0, sinTelefono: 1 });
    expect(contactos()).toEqual([expect.objectContaining({ gasto_id: 'g9', enviado: false, detalle: 'el operador no tiene teléfono capturado' })]);
    expect(meta.sendTemplate).not.toHaveBeenCalled();
    await ejecutarCobranza(A, mas(1));
    expect(contactos()).toHaveLength(1);
  });

  it('el reloj corta ANTES de reclamar: lo que no alcanzó queda intacto para la siguiente corrida', async () => {
    const r = await ejecutarCobranza(A, AHORA, { venceEn: Date.now() - 1 });
    expect(r.cortadosPorReloj).toBeGreaterThanOrEqual(1);
    expect(contactos()).toHaveLength(0);
    expect(meta.sendTemplate).not.toHaveBeenCalled();
  });
});

describe('duplicado: dos corridas solapadas', () => {
  it('el claim atómico deja pasar UNA sola: un mensaje, un juego de filas', async () => {
    nuevaBase({
      agente_cobranza_config: [config(A)],
      viaje: [viaje(A, 'v1', JUAN)],
      gasto: [gasto(A, 'g1', 'v1'), gasto(A, 'g2', 'v1', { imagen_url: null })],
    });
    const [x, y] = await Promise.all([
      gastoMod.ejecutarCobranzaGastos(A, AHORA),
      gastoMod.ejecutarCobranzaGastos(A, AHORA),
    ]);
    expect(x.mensajes + y.mensajes).toBe(1);
    expect(meta.sendTemplate).toHaveBeenCalledTimes(1);
    expect(contactos()).toHaveLength(2);
  });

  it('un lote donde UN gasto ya fue reclamado no se manda a medias: se salta entero y se reintenta con la cola actualizada', async () => {
    nuevaBase({
      agente_cobranza_config: [config(A)],
      viaje: [viaje(A, 'v1', JUAN)],
      gasto: [gasto(A, 'g1', 'v1'), gasto(A, 'g2', 'v1', { imagen_url: null })],
      // Otra corrida reclamó g1 (tier 1) entre la lectura y el insert.
    });
    const original = estado.db.cliente.from.bind(estado.db.cliente);
    let inyectado = false;
    estado.db.cliente.from = (t: string) => {
      if (t === 'cobranza_gasto_contacto' && !inyectado) {
        const q = original(t) as { insert: (f: unknown) => unknown };
        const insertar = q.insert.bind(q);
        q.insert = (filas: unknown) => {
          if (!inyectado && Array.isArray(filas) && filas.some((f) => (f as Fila).enviado === false && (f as Fila).detalle === undefined)) {
            inyectado = true;
            estado.db.tabla('cobranza_gasto_contacto').push({ id: 'otra', tenant_id: A, gasto_id: 'g1', tier: 1, motivo: 'sin_cfdi', lote_id: 'otro-lote', enviado: true });
          }
          return insertar(filas);
        };
        return q;
      }
      return original(t);
    };
    const r = await gastoMod.ejecutarCobranzaGastos(A, AHORA);
    expect(r.mensajes).toBe(0);
    expect(meta.sendTemplate).not.toHaveBeenCalled();
    expect(contactos().filter((c) => c.lote_id !== 'otro-lote')).toHaveLength(0);
  });
});

describe('fuera de orden, fuera de ventana y tope diario', () => {
  beforeEach(() => {
    nuevaBase({
      agente_cobranza_config: [config(A)],
      viaje: [viaje(A, 'v1', JUAN)],
      gasto: [gasto(A, 'g1', 'v1')],
    });
  });

  it('fuera de la ventana horaria la cobranza no corre; con «Ejecutar ahora» (ignorarVentana) sí', async () => {
    const madrugada = new Date('2026-10-07T09:00:00Z'); // 03:00 en México
    const r = await ejecutarCobranza(A, madrugada);
    expect(r.omitido).toBe('fuera de la ventana de contacto');
    expect(meta.sendTemplate).not.toHaveBeenCalled();
    const manual = await ejecutarCobranza(A, madrugada, { ignorarVentana: true });
    expect(manual.gasto?.mensajes).toBe(1);
  });

  it('un domingo (día no permitido) no se cobra', async () => {
    const domingo = new Date('2026-10-04T16:00:00Z');
    expect((await ejecutarCobranza(A, domingo)).omitido).toBe('fuera de la ventana de contacto');
  });

  it('el agente pausado no corre ni por gasto', async () => {
    estado.db.tabla('agente_cobranza_config')[0].activo = false;
    expect((await ejecutarCobranza(A, AHORA)).omitido).toBe('el agente está pausado');
    expect(meta.sendTemplate).not.toHaveBeenCalled();
  });

  it('TOPE DIARIO: un gasto nuevo el mismo día espera a mañana SIN consumir tier, y entonces sale fusionado', async () => {
    await ejecutarCobranza(A, AHORA);                      // g1 → tier 1, 1 mensaje (tope = 1)
    estado.db.tabla('gasto').push(gasto(A, 'g2', 'v1', { concepto: 'caseta', imagen_url: null, created_at: hace(2) }));
    const r = await ejecutarCobranza(A, mas(2));           // mismo día
    expect(r.gasto).toMatchObject({ mensajes: 0, pospuestosPorTope: 1 });
    expect(contactos().filter((c) => c.gasto_id === 'g2')).toHaveLength(0);   // no se reclamó nada
    expect(meta.sendTemplate).toHaveBeenCalledTimes(1);

    const manana = await ejecutarCobranza(A, mas(24));     // g1 (día 3 → tier 3) y g2 (día 3 → tier 1…3)
    expect(manana.gasto?.mensajes).toBe(1);
    expect(meta.sendTemplate).toHaveBeenCalledTimes(2);
    expect((meta.sendTemplate.mock.calls[1][2] as { parametros: string[] }).parametros[1]).toBe('2');
  });

  it('con tope de 2 al día el segundo mensaje sí sale', async () => {
    estado.db.tabla('agente_cobranza_config')[0].max_mensajes_dia = 2;
    await ejecutarCobranza(A, AHORA);
    estado.db.tabla('gasto').push(gasto(A, 'g2', 'v1', { imagen_url: null }));
    const r = await ejecutarCobranza(A, mas(2));
    expect(r.gasto?.mensajes).toBe(1);
    expect(meta.sendTemplate).toHaveBeenCalledTimes(2);
  });

  it('un viaje liquidado o sin aviso de Likida NO se cobra por gasto', async () => {
    nuevaBase({
      agente_cobranza_config: [config(A)],
      viaje: [
        viaje(A, 'liq', JUAN, { estatus: 'liquidado' }),
        viaje(A, 'sinaviso', ANA, { avisado_en: null }),
      ],
      gasto: [gasto(A, 'g1', 'liq'), gasto(A, 'g2', 'sinaviso')],
    });
    const r = await ejecutarCobranza(A, AHORA);
    expect(r.gasto).toMatchObject({ pendientes: 0, mensajes: 0 });
    expect(meta.sendTemplate).not.toHaveBeenCalled();
  });
});

describe('convivencia con la cobranza por viaje', () => {
  it('encendida la de por gasto, un viaje con gasto pendiente NO se cobra además por viaje, y un chofer al que ya se escribió hoy no recibe el recordatorio de viaje', async () => {
    nuevaBase({
      agente_cobranza_config: [config(A)],
      viaje: [
        viaje(A, 'v1', JUAN),                                        // con gasto pendiente → lo cobra el gasto
        viaje(A, 'v2', ANA, { fecha_inicio: '2026-10-01' }),         // sin gastos → lo cobra el viaje (tier 3 a los 6 días)
        viaje(A, 'v3', JUAN, { fecha_inicio: '2026-10-01' }),        // sin gastos, pero a JUAN ya se le escribió hoy
      ],
      gasto: [gasto(A, 'g1', 'v1')],
    });
    const r = await ejecutarCobranza(A, AHORA);
    expect(r.gasto?.mensajes).toBe(1);
    const destinos = meta.sendTemplate.mock.calls.map((c) => [c[0], c[1]]);
    expect(destinos).toContainEqual(['5211111111', 'cobranza_gastos_v1']);
    expect(destinos).toContainEqual(['5233333333', 'recordatorio_cierre']);
    expect(destinos).not.toContainEqual(['5211111111', 'recordatorio_cierre']);
    expect(destinos).toHaveLength(2);
    expect(r.contactados).toBe(2);
  });

  it('con por_gasto APAGADO (el default) la conducta de siempre no cambia: se cobra por viaje y nada por gasto', async () => {
    nuevaBase({
      agente_cobranza_config: [config(A, { por_gasto: false })],
      viaje: [viaje(A, 'v1', JUAN)],
      gasto: [gasto(A, 'g1', 'v1')],
    });
    const r = await ejecutarCobranza(A, AHORA);
    expect(r.gasto).toBeUndefined();
    expect(contactos()).toHaveLength(0);
    expect(meta.sendTemplate.mock.calls.map((c) => c[1])).toEqual(['recordatorio_cierre']);
  });

  it('sin fila de configuración tampoco corre por gasto (nace apagada)', async () => {
    nuevaBase({ viaje: [viaje(A, 'v1', JUAN)], gasto: [gasto(A, 'g1', 'v1')] });
    const r = await ejecutarCobranza(A, AHORA);
    expect(r.gasto).toBeUndefined();
    expect(contactos()).toHaveLength(0);
  });
});

describe('otro tenant', () => {
  it('cada flota cobra SOLO sus gastos, a SUS choferes, y la que no encendió la función no se toca', async () => {
    nuevaBase({
      agente_cobranza_config: [config(A), config(B, { por_gasto: false })],
      viaje: [viaje(A, 'va', JUAN), viaje(B, 'vb', ANA)],
      gasto: [gasto(A, 'ga', 'va'), gasto(B, 'gb', 'vb')],
    });
    const ra = await ejecutarCobranza(A, AHORA);
    expect(ra.gasto?.mensajes).toBe(1);
    expect(tel(0)).toBe('5211111111');
    expect(contactos().every((c) => c.tenant_id === A)).toBe(true);
    expect(contactos().map((c) => c.gasto_id)).toEqual(['ga']);

    // B (apagada) cobra por viaje, jamás ve ni escribe sobre los gastos de A.
    meta.sendTemplate.mockClear();
    const rb = await ejecutarCobranza(B, AHORA);
    expect(rb.gasto).toBeUndefined();
    expect(meta.sendTemplate.mock.calls.map((c) => c[0])).toEqual(['5233333333']);

    // El tablero de A no incluye nada de B y viceversa.
    const tableroA = await gastoMod.tableroGastos(A, AHORA);
    expect(tableroA.bitacora.map((b) => b.gastoId)).toEqual(['ga']);
    expect((await gastoMod.tableroGastos(B, AHORA)).bitacora).toEqual([]);
    expect((await gastoMod.colaPorGasto(B, AHORA)).plan.pendientes.every((p) => p.gastoId === 'gb')).toBe(true);
  });

  it('las llamadas a la base de la cobranza por gasto anclan SIEMPRE por tenant_id', async () => {
    nuevaBase({
      agente_cobranza_config: [config(A)],
      viaje: [viaje(A, 'va', JUAN), viaje(B, 'vb', ANA)],
      gasto: [gasto(A, 'ga', 'va'), gasto(B, 'gb', 'vb')],
    });
    await gastoMod.ejecutarCobranzaGastos(A, AHORA);
    // Si alguna consulta hubiera traído filas de B, habría un contacto de B.
    expect(contactos().some((c) => c.gasto_id === 'gb')).toBe(false);
  });
});

describe('configuración', () => {
  it('guardar la config valida, persiste solo sus columnas y nace apagada si la flota no tiene fila', async () => {
    nuevaBase({});
    expect(await gastoMod.leerConfigGasto(A)).toEqual(gastoMod.CONFIG_GASTO_DEFAULT);
    expect(gastoMod.CONFIG_GASTO_DEFAULT.porGasto).toBe(false);
    expect(await gastoMod.guardarConfigGasto(A, { porGasto: true, tiersGasto: [2, 5], maxMensajesDia: 2 })).toEqual({});
    expect(await gastoMod.leerConfigGasto(A)).toMatchObject({ porGasto: true, tiersGasto: [2, 5], maxMensajesDia: 2 });
    expect(await gastoMod.guardarConfigGasto(A, { tiersGasto: [1, 1] })).toHaveProperty('error');
  });
});
