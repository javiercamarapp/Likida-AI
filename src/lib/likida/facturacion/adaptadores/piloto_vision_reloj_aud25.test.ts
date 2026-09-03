// ═══════════════════════════════════════════════════════════════════════════
// AUD25 · rendimiento MEDIO línea 434 (REND-A8, REINCIDENTE) — el `for` de
// pasos del piloto de visión no consultaba el reloj: 14 pasos típicos ya suman
// 140-168 s de solo llamadas de visión, por arriba de los 150 s que
// `MARGEN_LOTE_MS` (lote.ts) le promete a la sesión de UN portal en vuelo.
//
// Esta prueba simula el reloj avanzando 50 s por paso (una llamada de visión
// "típica" lenta) y comprueba que el piloto se detiene ANTES de exceder su
// presupuesto propio, en vez de correr los 14 pasos completos.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { crearPilotoVision, PASOS_MAXIMOS } from './piloto_vision';
import type { InventarioPagina } from './playwright_base';
import type { Comercio } from '../comercios';

const decidirMock = vi.fn();
vi.mock('@/lib/llm/openrouter', () => ({
  generateStructured: (...a: unknown[]) => decidirMock(...a),
}));

const COMERCIO: Comercio = {
  clave: 'enerser', nombre: 'Enerser', portal: 'https://facturacion.enerser.com.mx/',
  requiereCuenta: false, plazo: 'mes_natural', plazoVerificado: false,
  campos: [{ clave: 'webId', etiquetaPortal: 'Web ID', requerido: true }],
  reconocer: { dominios: ['facturacion.enerser.com.mx'] },
};
const RECEPTOR = {
  rfc: 'GMX0902279I1', nombre: 'G3M', codigoPostal: '97000',
  regimenFiscal: '601', usoCfdi: 'G03', correo: 'cfdi@flota.mx',
};
const CAMPOS = [{ clave: 'webId' as const, etiqueta: 'Web ID', valor: '650', requerido: true }];

const INVENTARIO: InventarioPagina = {
  url: 'https://facturacion.enerser.com.mx/', titulo: 'Facturación',
  campos: [{ tag: 'input', type: 'text', id: 'webid', name: 'webid', placeholder: '', etiqueta: 'Web ID', visible: true, opciones: [] }],
  botones: [{ tag: 'button', id: 'buscar', name: '', texto: 'Buscar ticket', visible: true }],
  captcha: [], texto: 'Facturación electrónica',
};

const accion = (valor: string) => ({
  data: {
    veo: 'la página', hayCaptcha: false, tipo: 'escribir',
    selector: '#webid', valor, esBotonQueEmite: false, motivo: null,
  },
});

let ahora = 1_000_000;
/** Cuánto avanza el reloj FALSO por cada paso — una llamada de visión lenta. */
const MS_POR_PASO = 50_000;

beforeEach(() => {
  ahora = 1_000_000;
  vi.spyOn(Date, 'now').mockImplementation(() => ahora);
  decidirMock.mockReset();
  // Un valor DISTINTO cada vez: la firma `tipo|selector|valor` no se repite,
  // así que el loop-guard no corta antes de que el reloj tenga oportunidad.
  let i = 0;
  decidirMock.mockImplementation(async () => accion(`v${i++}`));
});

afterEach(() => { vi.restoreAllMocks(); });

function paginaFalsa() {
  const hechos: string[] = [];
  return {
    hechos,
    abrir: vi.fn(async () => { hechos.push('abrir'); }),
    escribir: vi.fn(async (sel: string, val: string) => { hechos.push(`escribir ${sel}=${val}`); }),
    hacerClic: vi.fn(async (sel: string) => { hechos.push(`clic ${sel}`); }),
    leerTexto: vi.fn(async () => null),
    captura: vi.fn(async () => 'data:image/jpeg;base64,xxxx'),
    // El reloj FALSO solo avanza cuando arranca un paso — igual que la nota
    // de voz y el OCR del banco: determinista, sin esperar de verdad.
    inventario: vi.fn(async () => { ahora += MS_POR_PASO; return INVENTARIO; }),
    cerrar: vi.fn(async () => { hechos.push('cerrar'); }),
  };
}

function piloto(pagina: ReturnType<typeof paginaFalsa>) {
  return crearPilotoVision({
    comercio: COMERCIO, receptor: RECEPTOR,
    abrirPagina: async () => pagina as never,
    arrancoConSesion: true,
  });
}

describe('AUD25 rendimiento MEDIO L434: el piloto de visión mira el reloj entre pasos', () => {
  it('se detiene por reloj antes de agotar los 14 pasos, con error que dice "sin tiempo"', async () => {
    const p = piloto(paginaFalsa());
    const r = await p.facturar(CAMPOS, 'ensayo');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/tiempo/);
    // No llegó a los 14 pasos: el reloj lo cortó antes.
    expect(decidirMock.mock.calls.length).toBeLessThan(PASOS_MAXIMOS);
    // Con 50s/paso y un presupuesto de 130s, caben 3 pasos (150s de reloj
    // consumido tras el tercero) y el cuarto ya no arranca (150s ≥ 130s).
    expect(decidirMock.mock.calls.length).toBe(3);
  });

  it('con pasos rápidos (reloj de sobra) SÍ corre hasta agotar los 14 pasos', async () => {
    // 1s por paso: 14 pasos son solo 14s, muy por debajo del presupuesto.
    const pagina = paginaFalsa();
    pagina.inventario = vi.fn(async () => { ahora += 1_000; return INVENTARIO; });
    const r = await piloto(pagina).facturar(CAMPOS, 'ensayo');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/14 pasos/);
    expect(decidirMock.mock.calls.length).toBe(PASOS_MAXIMOS);
  });
});
