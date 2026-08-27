import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// La ruta pública de captura de la calculadora — se prueba como PUERTA:
// honeypot, límite de tasa, y que el pipeline REAL de validación
// (`validarProspecto`, sin doblar) reciba lo que el formulario mandó. Lo que
// se dobla: la base, el límite, la alerta.
// ═══════════════════════════════════════════════════════════════════════════

let limiteOk = true;
vi.mock('@/lib/ratelimit', () => ({
  rateLimit: async () => limiteOk,
  clientIp: () => '1.2.3.4',
  bodyExcede: () => false,
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const alertas: Array<[string, Record<string, unknown>]> = [];
vi.mock('@/lib/observability/alerta', () => ({
  alertarOperador: async (e: string, d: Record<string, unknown>) => { alertas.push([e, d]); },
}));

// crearProspecto se dobla (escribe base); validarProspecto es el REAL — así
// la ruta no puede divergir del pipeline de ventas.
const creados: Array<{ p: unknown; fuente: string }> = [];
let fallaCrear = false;
vi.mock('@/lib/likida/vendedores', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/likida/vendedores')>();
  return {
    ...real,
    crearProspecto: async (p: unknown, fuente: string) => {
      if (fallaCrear) throw new Error('base caída');
      creados.push({ p, fuente });
      return 'prospecto-1';
    },
  };
});

const eventos: Array<Record<string, unknown>> = [];
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => ({ insert: async (v: Record<string, unknown>) => { eventos.push(v); return { error: null }; } }),
  }),
}));

const { POST } = await import('./route');

function pedir(cuerpo: unknown): Request {
  return new Request('https://x/api/marketing/prospecto', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cuerpo),
  });
}

const VALIDO = {
  nombre: 'Ana Torres', empresa: 'Transportes Prueba', correo: 'ana@prueba.mx',
  telefono: '', sitioWeb: '',
  cifras: { litrosDieselMes: 10000, gastoDieselMesMxn: null, gastoCasetasMesMxn: 116000, unidades: 35 },
};

beforeEach(() => {
  limiteOk = true;
  fallaCrear = false;
  creados.length = 0;
  alertas.length = 0;
  eventos.length = 0;
});

describe('POST /api/marketing/prospecto', () => {
  it('captura válida → prospecto con fuente landing, cifras en notas, conversión y aviso el mismo día', async () => {
    const res = await POST(pedir(VALIDO));
    expect(res.status).toBe(200);
    expect(creados).toHaveLength(1);
    expect(creados[0].fuente).toBe('landing');
    const p = creados[0].p as { empresa: string; notas: string | null };
    expect(p.empresa).toBe('Transportes Prueba');
    expect(p.notas).toContain('calculadora');
    expect(p.notas).toContain('10000');
    expect(eventos).toEqual([{ pagina: 'calculadora', evento: 'conversion' }]);
    expect(alertas).toHaveLength(1);
    expect(alertas[0][0]).toBe('prospecto.landing');
  });

  it('cifras ausentes van como "sin dato" en notas — jamás como 0', async () => {
    await POST(pedir({ ...VALIDO, cifras: {} }));
    const p = creados[0].p as { notas: string | null };
    expect(p.notas).toContain('sin dato');
    expect(p.notas).not.toMatch(/: \$?0[.,]/);
  });

  it('honeypot lleno → 200 SIN escribir nada (no se le enseña al bot)', async () => {
    const res = await POST(pedir({ ...VALIDO, sitioWeb: 'http://spam.example' }));
    expect(res.status).toBe(200);
    expect(creados).toHaveLength(0);
    expect(alertas).toHaveLength(0);
  });

  it('sin correo NI teléfono → 400 con el motivo (no hay a dónde mandar la copia)', async () => {
    const res = await POST(pedir({ ...VALIDO, correo: '', telefono: '' }));
    expect(res.status).toBe(400);
    expect(creados).toHaveLength(0);
  });

  it('la validación REAL del pipeline rebota el correo malformado con su mensaje', async () => {
    const res = await POST(pedir({ ...VALIDO, correo: 'no-es-correo' }));
    expect(res.status).toBe(400);
    const cuerpo = await res.json() as { error: string };
    expect(cuerpo.error).toContain('correo');
    expect(creados).toHaveLength(0);
  });

  it('sin empresa → 400 (lo único obligatorio del pipeline sigue mandando aquí)', async () => {
    const res = await POST(pedir({ ...VALIDO, empresa: '  ' }));
    expect(res.status).toBe(400);
  });

  it('límite de tasa → 429 sin escribir', async () => {
    limiteOk = false;
    const res = await POST(pedir(VALIDO));
    expect(res.status).toBe(429);
    expect(creados).toHaveLength(0);
  });

  it('base caída → 500 honesto, sin alerta fantasma', async () => {
    fallaCrear = true;
    const res = await POST(pedir(VALIDO));
    expect(res.status).toBe(500);
    expect(alertas).toHaveLength(0);
  });
});
