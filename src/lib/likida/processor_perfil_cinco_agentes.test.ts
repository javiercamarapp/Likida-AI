import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';

// ═══════════════════════════════════════════════════════════════════════════
// T-PER-06 · WHATSAPP DEL CHOFER BAJO EL PERFIL `cinco_agentes` (mig. 0770).
//
// Una foto de comprobante enviada por un chofer de una flota CON perfil NO
// inicia OCR ni cuadre, aunque nadie haya movido la palanca `interruptor_tenant`
// (el script `aplicar` la escribe, pero el código no depende de ello). Se corre
// el `processInbound` REAL con el `perfil_tenant.ts` y el `interruptor_tenant.ts`
// reales; solo se simulan las tablas, el cliente de Meta y el OCR.
// Dos flotas sintéticas: `t-con` (perfil) y `t-sin` (control, comportamiento de siempre).
// ═══════════════════════════════════════════════════════════════════════════

let tenantDelOperador = 't-con';
let viajeAbierto: string | null = 'v1';
const descargaTexto = vi.fn();
const perfiles = new Map<string, string>([['t-con', 'cinco_agentes']]);
let falla_tabla_perfil = false;
const extraerComprobante = vi.fn();
const say = vi.fn();
const intakeDelta = vi.fn();
const intentarLockViaje = vi.fn(async () => 'obtenido' as const);

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (tabla: string) => {
      let id = '';
      const resultadoUno = async () => {
        if (tabla === 'tenant_perfil') {
          if (falla_tabla_perfil) return { data: null, error: { message: 'caída' } };
          return { data: perfiles.has(id) ? { perfil: perfiles.get(id) } : null, error: null };
        }
        return { data: null, error: null }; // interruptor_tenant: SIN fila = palanca sin mover
      };
      const b: Record<string, unknown> = new Proxy({}, {
        get: (_o, k) => {
          if (k === 'eq') return (c: string, v: string) => { if (c === 'tenant_id') id = v; return b; };
          if (k === 'maybeSingle' || k === 'single') return resultadoUno;
          if (k === 'then') return (ok: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok);
          return () => b;
        },
      });
      return b;
    },
  }),
}));
vi.mock('@/lib/likida/tools', () => ({}));
vi.mock('@/lib/meta/client', () => ({
  MAX_CUERPO_BOTONES: 1024,
  sendText: (...a: unknown[]) => say(...a),
  sendDocument: vi.fn(),
  downloadMediaAsDataUrl: vi.fn(async () => 'data:image/jpeg;base64,AAAA'),
  downloadMediaAsText: (...a: unknown[]) => descargaTexto(...a),
}));
vi.mock('@/lib/likida/intake/ocr', () => ({ extraerComprobante: (...a: unknown[]) => extraerComprobante(...a) }));
vi.mock('@/lib/likida/repo', () => ({
  ubicarGastoPorHash: vi.fn(async () => null),
  getHuerfanos: vi.fn(async () => []), guardarHuerfano: vi.fn(async () => true),
  resolverHuerfanos: vi.fn(), marcarHuerfanosOfrecidos: vi.fn(),
  addGasto: vi.fn(), getGastos: vi.fn(async () => []), updateGastoCfdiXml: vi.fn(),
  saveCfdiXmlRaw: vi.fn(), gastoExistePorHash: vi.fn(async () => false),
  enriquecerGastoConCodigo: vi.fn(), guardarCodigoPendiente: vi.fn(),
  getCodigosPendientes: vi.fn(async () => []), reclamarCodigoPendiente: vi.fn(),
  getDatosResponsable: vi.fn(async () => ({ razonSocial: 'FLOTA SA DE CV', domicilio: 'Calle 1, Mérida', urlAvisoIntegral: 'https://flota.mx/privacidad' })),
  reclamarEnvioAviso: vi.fn(async () => false), liberarEnvioAviso: vi.fn(),
}));
vi.mock('@/lib/likida/conv', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  resolveOperador: vi.fn(async () => ({ tenantId: tenantDelOperador, operadorId: 'o1' })),
  getOpenViaje: vi.fn(async () => viajeAbierto),
  getTenantContext: vi.fn(async () => ({ nombre: 'Flota' })),
  loadConversation: vi.fn(async () => ({ id: 'c1', turns: [] })),
  saveConversation: vi.fn(),
  claimMessage: vi.fn(async () => 'nuevo'),
  acquireViajeLock: vi.fn(async () => true),
  intentarLockViaje: (...a: unknown[]) => (intentarLockViaje as unknown as (...x: unknown[]) => unknown)(...a),
  releaseViajeLock: vi.fn(), releaseMessageClaim: vi.fn(),
  intakeDelta: (...a: unknown[]) => intakeDelta(...(a as [string, number])),
  esperarIntake: vi.fn(async () => true),
}));
vi.mock('@/lib/likida/costos', () => ({
  registrarCosto: vi.fn(), registrarCostoWhatsApp: vi.fn(),
  faseDeModelo: vi.fn(() => 'cuadre'), vincularCostosALiquidacion: vi.fn(),
}));
vi.mock('@/lib/agents/run', () => ({ runAgent: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { processInbound } = await import('./processor');
const { reiniciarCachePerfil } = await import('@/lib/auth/perfil_tenant');

const foto = { from: '5219993700779', type: 'image' as const, mediaId: 'm1', waMessageId: 'wa1' };
const OCR_OK = {
  gasto: { id: 'g1', concepto: 'diesel', monto: 500 },
  legible: true, motivo: 'ticket',
  costo: { modelo: 'm', tokensIn: 1, tokensOut: 1, costoUsd: 0 },
};
const dicho = () => say.mock.calls.map((c) => String(c[1])).join(' | ');

beforeEach(() => {
  reiniciarCachePerfil();
  tenantDelOperador = 't-con';
  viajeAbierto = 'v1';
  descargaTexto.mockReset();
  falla_tabla_perfil = false;
  extraerComprobante.mockReset(); extraerComprobante.mockResolvedValue(OCR_OK);
  say.mockReset();
  intakeDelta.mockReset(); intakeDelta.mockResolvedValue(1);
  intentarLockViaje.mockClear();
  process.env.WHATSAPP_ACCESS_TOKEN = 'tok';
  process.env.WHATSAPP_PHONE_NUMBER_ID = '123';
});

describe('T-PER-06 (c) · foto de comprobante de un chofer con perfil', () => {
  it('NO inicia OCR: no se llama al lector y se le dice que entregue sus papeles en la oficina', async () => {
    await processInbound(foto);
    expect(extraerComprobante).not.toHaveBeenCalled();
    expect(dicho()).toMatch(/no recibe comprobantes/i);
  });

  it('NO toca la barrera de intake ni toma el mutex del cierre (cuadre)', async () => {
    await processInbound(foto);
    expect(intakeDelta).not.toHaveBeenCalled();
    expect(intentarLockViaje).not.toHaveBeenCalled();
  });

  it('el perfil manda aunque el interruptor FALTE: no hay fila en interruptor_tenant y aun así se apaga', async () => {
    // El mock devuelve `data: null` para interruptor_tenant (palanca sin mover): sin perfil seguiría encendido.
    await processInbound(foto);
    expect(extraerComprobante).not.toHaveBeenCalled();
  });

  it('control: la flota SIN perfil lee el comprobante como siempre (el perfil solo quita)', async () => {
    tenantDelOperador = 't-sin';
    await processInbound(foto);
    expect(extraerComprobante).toHaveBeenCalledTimes(1);
    expect(dicho()).not.toMatch(/no recibe comprobantes/i);
  });

  it('si la tabla del perfil no se puede leer NO se apaga el pipeline del chofer (palanca operativa, no de incidente)', async () => {
    falla_tabla_perfil = true;
    await processInbound(foto);
    expect(extraerComprobante).toHaveBeenCalledTimes(1);
  });

  it('la RECEPCIÓN (pipeline whatsapp) sigue viva con perfil: el mensaje se procesa, no se frena con el aviso de pausa', async () => {
    await processInbound({ from: '5219993700779', type: 'text' as const, text: 'hola', waMessageId: 'wa2' });
    expect(dicho()).not.toMatch(/en pausa la recepci/i);
  });
});

describe('A37-S55-06 · el XML (documento) también respeta el perfil', () => {
  const doc = { from: '5219993700779', type: 'document' as const, mediaId: 'd1', waMessageId: 'wa-doc' };

  it('con viaje abierto: no baja el XML, no toca la barrera y avisa que entregue en la oficina', async () => {
    await processInbound(doc);
    expect(descargaTexto).not.toHaveBeenCalled();
    expect(intakeDelta).not.toHaveBeenCalled();
    expect(dicho()).toMatch(/no recibe comprobantes/i);
  });

  it('sin viaje abierto: tampoco lo procesa', async () => {
    viajeAbierto = null;
    await processInbound(doc);
    expect(descargaTexto).not.toHaveBeenCalled();
    expect(dicho()).toMatch(/no recibe comprobantes/i);
  });

  it('control: la flota SIN perfil sí baja el XML', async () => {
    tenantDelOperador = 't-sin';
    viajeAbierto = null;   // el camino sin viaje baja el XML primero
    await processInbound(doc);
    expect(descargaTexto).toHaveBeenCalled();
  });
});

describe('T-PER-06 (c) · contrato de orden en processor.ts', () => {
  const fuente = readFileSync('src/lib/likida/processor.ts', 'utf8');

  it('la puerta de `cuadre` va ANTES de tomar el mutex del cierre', () => {
    const puerta = fuente.indexOf("pipelineTenantApagado(op.tenantId, 'cuadre')");
    const lock = fuente.indexOf('intentarLockViaje(viajeId', puerta);
    expect(puerta).toBeGreaterThan(0);
    expect(lock).toBeGreaterThan(puerta);
  });

  it('las puertas de `ocr` (foto suelta, foto de viaje y los dos XML) van ANTES del lector de comprobantes que les sigue', () => {
    const puertas: number[] = [];
    let i = -1;
    while ((i = fuente.indexOf("pipelineTenantApagado(op.tenantId, 'ocr')", i + 1)) >= 0) puertas.push(i);
    expect(puertas).toHaveLength(4);
    // Las de FOTO anteceden a su lector (al menos dos de las cuatro lo tienen después).
    expect(puertas.filter((p) => fuente.indexOf('extraerComprobante(', p) > p).length).toBeGreaterThanOrEqual(2);
    for (const p of puertas) expect(fuente.indexOf('MENSAJE_SIN_COMPROBANTES_POR_WA', p)).toBeGreaterThan(p);
  });

  it('el webhook no se salta el procesador: la ruta delega en processInbound', () => {
    const ruta = readFileSync('src/app/api/webhook/whatsapp/route.ts', 'utf8');
    expect(ruta).toContain("from '@/lib/likida/processor'");
    expect(ruta).not.toMatch(/extraerComprobante|pipelineTenantApagado/);
  });
});
