import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Liquidacion } from '@/types/cuadra';

// Se mockea el motor de cuadre desde DB para probar SOLO la lógica de la guardia
// (ramas de reemplazo / passthrough / fail-closed), sin tocar Supabase.
const LIQ: Omit<Liquidacion, 'id' | 'creadaEn'> = {
  viajeId: 'v1',
  totalComprobado: 10600,
  totalAnticipo: 10600,
  diferencia: 0,
  estatus: 'cuadrada',
  totalDeducible: 10600,
  totalNoDeducible: 0,
  totalPorConfirmar: 0,
  diferencias: [],
  gastos: [],
  iepsAcreditable: 0,
  ivaAcreditable: 0,
  peajeAcreditable: 0,
};

const cuadrarDesdeDB = vi.fn();
vi.mock('./desde_db', () => ({ cuadrarDesdeDB: (...a: unknown[]) => cuadrarDesdeDB(...a) }));

const { guardiaCifras } = await import('./guardia');

const tc = (toolName: string, error?: unknown) => ({ toolName, error, args: {}, result: {} }) as never;

describe('guardiaCifras', () => {
  beforeEach(() => {
    cuadrarDesdeDB.mockReset();
    cuadrarDesdeDB.mockResolvedValue(LIQ);
  });

  it('sin cifras: deja el texto del modelo intacto', async () => {
    const r = await guardiaCifras('¿Ya mandaste todo?', [], 't', 'v');
    expect(r.forzado).toBe(false);
    expect(cuadrarDesdeDB).not.toHaveBeenCalled();
  });

  it('cifras sin cuadrar_viaje ni política: fuerza el cuadre real', async () => {
    const r = await guardiaCifras('Sobraron 500 pesos', [], 't', 'v');
    expect(r.forzado).toBe(true);
    expect(cuadrarDesdeDB).toHaveBeenCalledWith('t', 'v');
    expect(r.reply).toContain('Este es el cuadre'); // encabezado neutral (no cerró)
  });

  it('cuadrar_viaje llamada + cifras: reemplaza por el resumen autoritativo', async () => {
    const r = await guardiaCifras('sobró 999', [tc('cuadrar_viaje')], 't', 'v');
    expect(r.forzado).toBe(true);
    expect(r.reply).toContain('Listo, cuadré'); // afirma cierre porque sí cuadró
  });

  it('solo consultar_politica + cifras (topes): respeta el texto', async () => {
    // El resultado de la tool tiene que TRAER el tope. Antes este caso pasaba
    // con `result: {}` —una tool que no devolvió nada— porque la guardia solo
    // miraba si la llamada existía. Con `{}` de resultado, "$2,000" es una
    // cifra que nadie calculó, y hoy la guardia lo dice.
    const r = await guardiaCifras(
      'El tope de efectivo es $2,000',
      [{ toolName: 'consultar_politica', args: {}, result: { topeEfectivo: 2000 } } as never],
      't', 'v',
    );
    expect(r.forzado).toBe(false);
    expect(cuadrarDesdeDB).not.toHaveBeenCalled();
  });

  it('cuadrar_viaje con error NO cuenta como cuadre válido', async () => {
    const r = await guardiaCifras('sobró 999', [tc('cuadrar_viaje', new Error('x'))], 't', 'v');
    expect(r.forzado).toBe(true);
    expect(r.reply).toContain('Este es el cuadre'); // neutral: no hubo cierre exitoso
  });

  it('FAIL-CLOSED: si el motor falla, no envía cifras', async () => {
    cuadrarDesdeDB.mockRejectedValue(new Error('db down'));
    const r = await guardiaCifras('Sobraron 500 pesos', [], 't', 'v');
    expect(r.forzado).toBe(true);
    expect(r.reply).not.toMatch(/\$|\d{2,}/);
  });
});

// La guardia responde AL OPERADOR por WhatsApp: es el camino feliz del demo
// (foto → "listo" → el agente narra → la guardia reemplaza con el cuadre real).
// Sin el destinatario, caía al default 'contralor' y le mandaba al chofer los
// veredictos fiscales reservados a la oficina —proveedor en lista 69-B, CFDI
// cancelado, RFC receptor— más el descargo legal completo, delante del comprador.
describe('guardiaCifras — el destinatario es el OPERADOR', () => {
  const conVeredictos: Omit<Liquidacion, 'id' | 'creadaEn'> = {
    ...LIQ,
    diferencias: [
      { tipo: 'cfdi_efos', concepto: 'diesel', monto: 0, nota: 'El emisor aparece en la lista 69-B del SAT.' },
      { tipo: 'sin_cfdi', concepto: 'diesel', monto: 0, nota: 'Diésel de $1,000 requiere factura CFDI.' },
    ],
  };

  it('no le manda al chofer el veredicto fiscal', async () => {
    cuadrarDesdeDB.mockResolvedValue(conVeredictos);
    const r = await guardiaCifras('Ya quedó, son $9,999.00', [tc('cuadrar_viaje')], 't', 'v');
    expect(r.reply).not.toMatch(/69-B/);
    expect(r.reply).not.toMatch(/no sustituye|dictamen/i); // ni el descargo legal
    expect(r.reply).toMatch(/requiere factura CFDI/);      // sí lo que puede arreglar
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// B11 — LA PUERTA TRASERA DE `consultar_politica`.
//
// La guardia dejaba pasar el texto entero en cuanto hubiera una llamada exitosa
// a consultar_politica, razonando "entonces las cifras son topes". Pero la tool
// no ata al texto. El modelo podía consultar la política —barata, y siempre
// disponible— y en el mismo turno narrar un cuadre inventado. Una tool
// irrelevante desbloqueaba narrar dinero que nadie calculó.
// ═══════════════════════════════════════════════════════════════════════════
const tcRes = (toolName: string, result: unknown) => ({ toolName, args: {}, result }) as never;

describe('guardiaCifras — política consultada', () => {
  beforeEach(() => {
    cuadrarDesdeDB.mockReset();
    cuadrarDesdeDB.mockResolvedValue(LIQ);
  });

  it('deja pasar los topes que la política SÍ devolvió', async () => {
    const r = await guardiaCifras(
      'El tope de alimentación son $750 por día.',
      [tcRes('consultar_politica', { topeAlimentacionDia: 750 })],
      't', 'v',
    );
    expect(r.forzado).toBe(false);
    expect(r.reply).toContain('$750');
    expect(cuadrarDesdeDB).not.toHaveBeenCalled();
  });

  it('NO deja pasar un cuadre inventado colado junto a un tope real', async () => {
    const r = await guardiaCifras(
      'El tope son $750 por día. Por cierto, comprobaste $8,340 y sobró $500.',
      [tcRes('consultar_politica', { topeAlimentacionDia: 750 })],
      't', 'v',
    );
    expect(r.forzado).toBe(true);
    expect(r.reply).not.toContain('8,340');
    expect(cuadrarDesdeDB).toHaveBeenCalled();
  });

  it('si la política falla y aun así hay cifras, no se confía en ella', async () => {
    const r = await guardiaCifras(
      'El tope son $750.',
      [{ toolName: 'consultar_politica', args: {}, result: { topeAlimentacionDia: 750 }, error: 'timeout' } as never],
      't', 'v',
    );
    expect(r.forzado).toBe(true);
  });
});
