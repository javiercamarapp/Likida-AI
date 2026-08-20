import { describe, it, expect, vi, beforeEach } from 'vitest';
import { crearPilotoVision, MARCA_CONTRASENA, PASOS_MAXIMOS } from './piloto_vision';
import type { InventarioPagina } from './playwright_base';
import type { Comercio } from '../comercios';

// ═══════════════════════════════════════════════════════════════════════════
// EL PILOTO DE VISIÓN — las cuatro reglas duras, cada una con su prueba.
//
// El modelo se sustituye por un guion de acciones y la página por un doble que
// ANOTA lo que se le hizo: lo que se verifica es lo que el piloto EJECUTÓ y lo
// que se negó a ejecutar, no el texto de sus prompts.
// ═══════════════════════════════════════════════════════════════════════════

const decidirMock = vi.fn();
vi.mock('@/lib/llm/openrouter', () => ({
  generateStructured: (...a: unknown[]) => decidirMock(...a),
}));

const COMERCIO: Comercio = {
  clave: 'enerser',
  nombre: 'Enerser',
  portal: 'https://facturacion.enerser.com.mx/',
  requiereCuenta: false,
  plazo: 'mes_natural',
  plazoVerificado: false,
  campos: [{ clave: 'webId', etiquetaPortal: 'Web ID', requerido: true }],
  reconocer: { dominios: ['facturacion.enerser.com.mx'] },
};

const RECEPTOR = {
  rfc: 'GMX0902279I1', nombre: 'G3M', codigoPostal: '97000',
  regimenFiscal: '601', usoCfdi: 'G03', correo: 'cfdi@flota.mx',
};

const CAMPOS = [{ clave: 'webId' as const, etiqueta: 'Web ID', valor: '650', requerido: true }];

const INVENTARIO: InventarioPagina = {
  url: 'https://facturacion.enerser.com.mx/',
  titulo: 'Facturación',
  campos: [
    { tag: 'input', type: 'text', id: 'webid', name: 'webid', placeholder: '', etiqueta: 'Web ID', visible: true, opciones: [] },
    { tag: 'input', type: 'password', id: 'pass', name: 'pass', placeholder: '', etiqueta: 'Contraseña', visible: true, opciones: [] },
  ],
  botones: [
    { tag: 'button', id: 'buscar', name: '', texto: 'Buscar ticket', visible: true },
    { tag: 'button', id: 'emitir', name: '', texto: 'Generar factura', visible: true },
  ],
  captcha: [],
  texto: 'Facturación electrónica',
};

/** Una página doble que ANOTA. `hechos` es lo que el piloto de verdad ejecutó. */
function paginaFalsa(inv: InventarioPagina = INVENTARIO) {
  const hechos: string[] = [];
  return {
    hechos,
    abrir: vi.fn(async () => { hechos.push('abrir'); }),
    escribir: vi.fn(async (sel: string, val: string) => { hechos.push(`escribir ${sel}=${val}`); }),
    hacerClic: vi.fn(async (sel: string) => { hechos.push(`clic ${sel}`); }),
    leerTexto: vi.fn(async () => null),
    captura: vi.fn(async () => 'data:image/jpeg;base64,xxxx'),
    inventario: vi.fn(async () => inv),
    cerrar: vi.fn(async () => { hechos.push('cerrar'); }),
  };
}

const accion = (a: Partial<Record<string, unknown>>) => ({
  data: {
    veo: 'la página', hayCaptcha: false, tipo: 'terminado',
    selector: null, valor: null, esBotonQueEmite: false, motivo: null,
    ...a,
  },
});

function piloto(pagina: ReturnType<typeof paginaFalsa>, credencial: Record<string, string> | null = null) {
  return crearPilotoVision({
    comercio: COMERCIO, receptor: RECEPTOR,
    abrirPagina: async () => pagina as never,
    credencial,
  });
}

beforeEach(() => vi.clearAllMocks());

describe('piloto de visión', () => {
  it('llena el formulario paso a paso y termina con la evidencia', async () => {
    const p = paginaFalsa();
    decidirMock
      .mockResolvedValueOnce(accion({ tipo: 'escribir', selector: '#webid', valor: '650' }))
      .mockResolvedValueOnce(accion({ tipo: 'terminado', motivo: 'formulario listo' }));
    const r = await piloto(p).facturar(CAMPOS, 'ensayo');
    expect(r.ok).toBe(true);
    expect(p.hechos).toContain('escribir #webid=650');
    expect(r.capturado['#webid']).toBe('650');
    expect(r.captura, 'sin captura el ensayo no prueba nada').toBeTruthy();
  });

  it('REGLA 1: el botón que emite NO se aprieta — ni marcado por el modelo…', async () => {
    const p = paginaFalsa();
    decidirMock
      .mockResolvedValueOnce(accion({ tipo: 'escribir', selector: '#webid', valor: '650' }))
      .mockResolvedValueOnce(accion({ tipo: 'clic', selector: '#emitir', esBotonQueEmite: true }));
    const r = await piloto(p).facturar(CAMPOS, 'ensayo');
    expect(p.hechos.some((h) => h.startsWith('clic'))).toBe(false);
    expect(r.ok, 'detenerse ante el botón con el formulario lleno ES el éxito del ensayo').toBe(true);
    expect(r.cfdiUuid).toBeUndefined();
  });

  it('…ni cuando el modelo NO lo marca: el veto por texto del botón lo caza', async () => {
    const p = paginaFalsa();
    decidirMock
      .mockResolvedValueOnce(accion({ tipo: 'escribir', selector: '#webid', valor: '650' }))
      // El modelo miente (o se equivoca): dice que el botón "Generar factura" no emite.
      .mockResolvedValueOnce(accion({ tipo: 'clic', selector: '#emitir', esBotonQueEmite: false }));
    const r = await piloto(p).facturar(CAMPOS, 'ensayo');
    expect(p.hechos.some((h) => h.startsWith('clic')), 'el texto «Generar factura» dispara el veto propio').toBe(false);
    expect(r.ok).toBe(true);
  });

  it('y en modo emitir TAMPOCO: el piloto no emite, con o sin mandato', async () => {
    const p = paginaFalsa();
    decidirMock
      .mockResolvedValueOnce(accion({ tipo: 'escribir', selector: '#webid', valor: '650' }))
      .mockResolvedValueOnce(accion({ tipo: 'clic', selector: '#emitir', esBotonQueEmite: true }));
    const r = await piloto(p).facturar(CAMPOS, 'emitir');
    expect(p.hechos.some((h) => h.startsWith('clic'))).toBe(false);
    expect(r.cfdiUuid, 'un piloto que "emitiera" sin poder confirmar UUID sería el peor verde posible').toBeUndefined();
  });

  it('REGLA 2: captcha en el DOM → requiereCaptcha, sin gastar una llamada de visión', async () => {
    const p = paginaFalsa({ ...INVENTARIO, captcha: ['https://www.google.com/recaptcha/api.js'] });
    const r = await piloto(p).facturar(CAMPOS, 'ensayo');
    expect(r.ok).toBe(false);
    expect(r.requiereCaptcha).toBe(true);
    expect(decidirMock).not.toHaveBeenCalled();
  });

  it('REGLA 3: la contraseña real llega a la página pero JAMÁS a capturado ni al historial', async () => {
    const p = paginaFalsa();
    decidirMock
      .mockResolvedValueOnce(accion({ tipo: 'escribir', selector: '#pass', valor: MARCA_CONTRASENA }))
      .mockResolvedValueOnce(accion({ tipo: 'terminado' }));
    const r = await piloto(p, { usuario: 'flota@x.mx', contrasena: 's3creta' }).facturar(CAMPOS, 'ensayo');
    expect(p.hechos).toContain('escribir #pass=s3creta');
    expect(r.capturado['#pass']).toBe(MARCA_CONTRASENA);
    expect(JSON.stringify(r.capturado)).not.toContain('s3creta');
    // Y lo que el modelo recibe en el paso 2 (historial) tampoco lleva el secreto.
    const segundaLlamada = JSON.stringify(decidirMock.mock.calls[1]);
    expect(segundaLlamada).not.toContain('s3creta');
  });

  it('sin cuenta compartida, el marcador de contraseña NO se inventa: se dice', async () => {
    const p = paginaFalsa();
    decidirMock.mockResolvedValueOnce(accion({ tipo: 'escribir', selector: '#pass', valor: MARCA_CONTRASENA }));
    const r = await piloto(p, null).facturar(CAMPOS, 'ensayo');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/no tiene cuenta compartida/);
    expect(p.hechos.some((h) => h.startsWith('escribir'))).toBe(false);
  });

  it('REGLA 4: un selector que no está en el inventario no se ejecuta', async () => {
    const p = paginaFalsa();
    decidirMock.mockResolvedValueOnce(accion({ tipo: 'escribir', selector: '#campo-sonado', valor: 'x' }));
    const r = await piloto(p).facturar(CAMPOS, 'ensayo');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/inventado|no corresponde/);
    expect(p.hechos.some((h) => h.startsWith('escribir'))).toBe(false);
  });

  it('la misma acción dos veces seguidas corta el vuelo: repetir cuesta y no cura', async () => {
    const p = paginaFalsa();
    decidirMock.mockResolvedValue(accion({ tipo: 'escribir', selector: '#webid', valor: '650' }));
    const r = await piloto(p).facturar(CAMPOS, 'ensayo');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/repitió/);
    // Se ejecutó UNA vez; la repetición se corta antes de tocar la página.
    expect(p.hechos.filter((h) => h.startsWith('escribir')).length).toBe(1);
    expect(decidirMock.mock.calls.length).toBeLessThan(PASOS_MAXIMOS);
  });

  it('no_puedo se respeta: el motivo del modelo llega tal cual al resultado', async () => {
    const p = paginaFalsa();
    decidirMock.mockResolvedValueOnce(accion({ tipo: 'no_puedo', motivo: 'el portal pide el número de bomba y no lo tengo' }));
    const r = await piloto(p).facturar(CAMPOS, 'ensayo');
    expect(r.ok).toBe(false);
    expect(r.error).toContain('número de bomba');
  });

  it('terminar sin haber llenado NADA no es un verde: se dice', async () => {
    const p = paginaFalsa();
    decidirMock.mockResolvedValueOnce(accion({ tipo: 'terminado', motivo: 'todo listo' }));
    const r = await piloto(p).facturar(CAMPOS, 'ensayo');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/sin llenar/);
  });

  it('la página SIEMPRE se cierra, aunque el vuelo reviente', async () => {
    const p = paginaFalsa();
    decidirMock.mockRejectedValueOnce(new Error('el modelo no contestó'));
    const r = await piloto(p).facturar(CAMPOS, 'ensayo');
    expect(r.ok).toBe(false);
    expect(p.cerrar).toHaveBeenCalled();
  });
});
