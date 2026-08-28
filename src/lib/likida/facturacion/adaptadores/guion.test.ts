import { describe, it, expect, vi } from 'vitest';
import {
  AdaptadorDeclarativo, motivoSinVerificar, revisarDatosDeGuion, SIN_TURNO,
  type GuionPortal, type ReceptorDeGuion,
} from './guion';
import { aplicarFormato, SELECTORES_CAPTCHA_COMUNES } from './pasos';
import type { CampoListo } from '../pendientes';
import type { InventarioPagina, PaginaPortal } from './playwright_base';

// ═══════════════════════════════════════════════════════════════════════════
// LO QUE ESTAS PRUEBAS PROTEGEN.
//
// El motor declarativo va a operar 4 portales hoy y N mañana, y todos comparten
// el mismo código: un fallo aquí no se equivoca en un portal, se equivoca en
// todos a la vez. Así que se prueban las cinco formas de hacer daño:
//
//   1. EMITIR CON UN MAPEO QUE NADIE MIDIÓ. Un guion `verificado: null` no
//      puede apretar el botón por ningún camino — ni con `modo: 'emitir'`, ni
//      con un modo raro, ni por lote.
//   2. RODEAR UN CAPTCHA. Ante señales de captcha se para ANTES de escribir el
//      primer carácter, y sale con `requiereCaptcha` — nunca con un "listo".
//   3. INVENTAR UN CFDI cuando el portal cambió su HTML: el pre-vuelo falla,
//      sale `portalCambio` con captura, y el botón no se toca.
//   4. ITERAR SIN MIRAR EL RELOJ. Los tickets que no caben salen POR SU NOMBRE
//      como no intentados; no se marcan, no se pierden.
//   5. RELLENAR UN DATO FISCAL. Un valor que no se puede formatear NO se
//      escribe como venga: se declara el fallo. `null` nunca se vuelve 0.
//
// Todo contra un DOBLE de página: sin navegador, sin red y sin portal real.
// Un portal real emitiría de verdad.
// ═══════════════════════════════════════════════════════════════════════════

const { logger } = vi.hoisted(() => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('@/lib/logger', () => ({ logger }));

const RECEPTOR: ReceptorDeGuion = {
  // El MISMO RFC que usan las pruebas de `capufe.ts`: pasa forma Y dígito
  // verificador. Uno inventado haría fallar `revisarDatosDeGuion` por la razón
  // equivocada y la prueba pasaría por casualidad.
  rfc: 'GMX0902279I1',
  nombre: 'Transportes de Prueba SA de CV',
  codigoPostal: '64000',
  regimenFiscal: '601',
  usoCfdi: 'G03',
  correo: 'facturas@flota.mx',
};

const GUION: GuionPortal = {
  comercio: 'portal_prueba',
  portal: 'https://portal.prueba.mx/',
  verificado: null,
  campos: {
    folio: { selector: '#folio' },
    monto: { selector: '#total', formato: 'monto' },
    fecha: { selector: '#fecha', formato: 'fecha_dmy' },
  },
  receptor: { rfc: { selector: '#rfc', formato: 'mayusculas' }, correo: { selector: '#correo' } },
  botonEmitir: '#emitir',
  uuid: '.uuid',
  error: '.aviso',
};

/** El mismo guion, ya medido contra el portal. Es lo único que habilita emitir. */
const GUION_MEDIDO: GuionPortal = {
  ...GUION,
  verificado: { fecha: '2026-08-27', arnes: 'prueba', resueltos: ['#folio', '#total', '#fecha', '#rfc', '#correo', '#emitir'] },
};

const TODOS = ['#folio', '#total', '#fecha', '#rfc', '#correo', '#emitir'];

const CAMPOS: CampoListo[] = [
  { clave: 'folio', etiqueta: 'Folio del ticket', valor: 'AB-123', requerido: true },
  { clave: 'monto', etiqueta: 'Monto total', valor: '$ 1,234.50', requerido: true },
  { clave: 'fecha', etiqueta: 'Fecha de compra', valor: '2026-08-04', requerido: true },
];

interface OpcDoble {
  presentes?: string[];
  textos?: Record<string, string>;
  conPreVuelo?: boolean;
  /** Selectores de captcha que el doble declara presentes. */
  captcha?: string[];
  /** El inventario que devuelve, si el doble sabe describirse. */
  inventario?: Partial<InventarioPagina>;
  /** El XML que entrega al apretar el botón de descarga. */
  xmlRuta?: string;
  descargaRevienta?: boolean;
}

class PaginaDoble implements PaginaPortal {
  abiertas: string[] = [];
  escritos: Array<{ sel: string; valor: string }> = [];
  clics: string[] = [];
  descargas: string[] = [];
  capturas = 0;
  cerradas = 0;
  existe?: (selector: string) => Promise<boolean>;
  inventario?: () => Promise<InventarioPagina>;
  descargar?: (selector: string) => Promise<string>;
  private readonly presentes: string[];

  constructor(private readonly o: OpcDoble = {}) {
    this.presentes = [...(o.presentes ?? TODOS), ...(o.captcha ?? [])];
    if (o.conPreVuelo !== false) this.existe = async (s) => this.presentes.includes(s);
    if (o.inventario) {
      this.inventario = async () => ({
        url: 'https://portal.prueba.mx/', titulo: 'Prueba',
        campos: [], botones: [], captcha: [], texto: '',
        ...o.inventario,
      });
    }
    if (o.xmlRuta !== undefined || o.descargaRevienta) {
      this.descargar = async (sel) => {
        this.descargas.push(sel);
        if (o.descargaRevienta) throw new Error('el portal no mandó archivo');
        return o.xmlRuta ?? '';
      };
    }
  }

  async abrir(url: string) { this.abiertas.push(url); }
  async escribir(sel: string, valor: string) {
    if (!this.presentes.includes(sel)) throw new Error(`no existe ${sel}`);
    this.escritos.push({ sel, valor });
  }
  async hacerClic(sel: string) {
    if (!this.presentes.includes(sel)) throw new Error(`no existe ${sel}`);
    this.clics.push(sel);
  }
  async leerTexto(sel: string) { return this.o.textos?.[sel] ?? null; }
  async captura() { this.capturas++; return 'data:image/jpeg;base64,xx'; }
  async cerrar() { this.cerradas++; }
}

function armar(guion: GuionPortal, doble: PaginaDoble, extra: Record<string, unknown> = {}) {
  return new AdaptadorDeclarativo({
    guion,
    receptor: RECEPTOR,
    abrirPagina: async () => doble,
    // Reloj y sueño inyectados: la prueba no espera de verdad.
    dormir: async () => {},
    ahora: () => 0,
    esperaUuidMs: 10,
    intervaloMs: 5,
    ...extra,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// 1 · UN GUION SIN MEDIR NO EMITE. POR NINGÚN CAMINO.
// ═══════════════════════════════════════════════════════════════════════════

describe('la política de no emitir con un mapeo sin verificar', () => {
  it('en `emitir` se niega ANTES de abrir el navegador', async () => {
    const p = new PaginaDoble();
    const r = await armar(GUION, p).facturar(CAMPOS, 'emitir');

    expect(r.ok).toBe(false);
    expect(r.error).toContain('NO se ha medido');
    // Y esto es lo que hace que la política valga: no se abrió el portal, no se
    // llenó un formulario ajeno y no se apretó nada.
    expect(p.abiertas).toEqual([]);
    expect(p.clics).toEqual([]);
  });

  it('en `ensayo` SÍ corre: llena, captura y NO aprieta', async () => {
    const p = new PaginaDoble();
    const r = await armar(GUION, p).facturar(CAMPOS, 'ensayo');

    expect(r.ok).toBe(true);
    expect(r.captura).toBeTruthy();
    expect(p.clics).toEqual([]);
    // El ensayo es lo que convierte un guion sin medir en algo útil: dice qué
    // habría escrito y en qué campo.
    expect(r.capturado).toMatchObject({ folio: 'AB-123', monto: '1234.50', fecha: '04/08/2026' });
  });

  it('un modo raro cae en ensayo, no en emitir', async () => {
    const p = new PaginaDoble({ textos: { '.uuid': 'NO-DEBERIA-SALIR' } });
    // Lo que llega de un cuerpo JSON: el tipo no protege nada.
    const r = await armar(GUION_MEDIDO, p).facturar(CAMPOS, 'EMITIR' as never);

    expect(r.ok).toBe(true);
    expect(r.cfdiUuid).toBeUndefined();
    expect(p.clics).toEqual([]);
  });

  it('el guion MEDIDO sí emite, y confirma el UUID', async () => {
    const p = new PaginaDoble({ textos: { '.uuid': 'A1B2-C3D4' } });
    const r = await armar(GUION_MEDIDO, p).facturar(CAMPOS, 'emitir');

    expect(r.ok).toBe(true);
    expect(r.cfdiUuid).toBe('A1B2-C3D4');
    expect(p.clics).toEqual(['#emitir']);
  });

  it('el motivo dice a dónde ir, no solo que no se puede', () => {
    expect(motivoSinVerificar(GUION)).toContain('arnés de pre-vuelo');
    expect(motivoSinVerificar(GUION)).toContain('portal.prueba.mx');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2 · EL CAPTCHA NO SE RODEA.
// ═══════════════════════════════════════════════════════════════════════════

describe('captcha', () => {
  it('se detecta ANTES de escribir el primer carácter y no se resuelve', async () => {
    const p = new PaginaDoble({ captcha: ['.g-recaptcha'], textos: { '.uuid': 'NO' } });
    const r = await armar(GUION_MEDIDO, p).facturar(CAMPOS, 'emitir');

    expect(r.ok).toBe(false);
    expect(r.requiereCaptcha).toBe(true);
    // LO QUE IMPORTA: ni un campo escrito, ni un clic. El formulario a medio
    // llenar detrás de un captcha no le sirve a nadie y deja rastro de robot.
    expect(p.escritos).toEqual([]);
    expect(p.clics).toEqual([]);
    // Y con captura, para que el humano vea lo que hay que resolver.
    expect(r.captura).toBeTruthy();
  });

  it('el mensaje dice que NO se intentó resolverlo y por qué', async () => {
    const p = new PaginaDoble({ captcha: ['.h-captcha'] });
    const r = await armar(GUION_MEDIDO, p).facturar(CAMPOS, 'emitir');

    expect(r.error).toContain('No se intentó resolverlo');
    expect(r.error).toContain('la del CLIENTE');
    expect(r.error).toContain('no se puede');
  });

  it('también lo ve por el texto de la página cuando no hay clase que lo delate', async () => {
    const p = new PaginaDoble({ inventario: { texto: 'Por favor confirma que no soy un robot' } });
    const r = await armar(GUION_MEDIDO, p).facturar(CAMPOS, 'emitir');

    expect(r.requiereCaptcha).toBe(true);
  });

  it('un reCAPTCHA v3 invisible NO lo dispara: eso lo trae medio internet', async () => {
    // `.grecaptcha-badge` está deliberadamente FUERA de la lista. Si estuviera,
    // el motor no facturaría nunca.
    expect(SELECTORES_CAPTCHA_COMUNES).not.toContain('.grecaptcha-badge');
    const p = new PaginaDoble({ presentes: [...TODOS, '.grecaptcha-badge'], textos: { '.uuid': 'OK-1' } });
    const r = await armar(GUION_MEDIDO, p).facturar(CAMPOS, 'emitir');

    expect(r.requiereCaptcha).toBeUndefined();
    expect(r.cfdiUuid).toBe('OK-1');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3 · EL PORTAL CAMBIÓ SU HTML.
// ═══════════════════════════════════════════════════════════════════════════

describe('cuando el portal cambia de plantilla', () => {
  it('el pre-vuelo los reporta TODOS juntos, con captura, y no aprieta nada', async () => {
    const p = new PaginaDoble({ presentes: ['#rfc', '#correo', '#emitir'] });
    const r = await armar(GUION_MEDIDO, p).facturar(CAMPOS, 'emitir');

    expect(r.ok).toBe(false);
    // Los tres de golpe: sin esto se descubre uno por corrida.
    expect(r.error).toContain('#folio');
    expect(r.error).toContain('#total');
    expect(r.error).toContain('#fecha');
    expect(r.captura).toBeTruthy();
    expect(p.clics).toEqual([]);
    expect(p.escritos).toEqual([]);
  });

  it('lo marca como `portalCambio` — el dueño del arreglo es Likida, no el cliente', async () => {
    const p = new PaginaDoble({ presentes: ['#rfc', '#correo', '#emitir'] });
    const r = await armar(GUION_MEDIDO, p).facturar(CAMPOS, 'emitir');

    expect(r.portalCambio).toBe(true);
    // Y NO como vinculación: mandar al contralor a repetir un login que ya
    // funciona deja el problema igual para la corrida siguiente.
    expect(r.requiereVinculacion).toBeUndefined();
    expect(r.error).toContain('lo corrige Likida');
  });

  it('el botón de emitir entra al pre-vuelo aunque el ensayo no lo apriete', async () => {
    // Es el único selector cuyo fallo no se puede probar de otra forma sin
    // emitir: un ensayo que pasa con un botón que ya no existe da confianza
    // falsa sobre lo único que no se puede deshacer.
    const p = new PaginaDoble({ presentes: ['#folio', '#total', '#fecha', '#rfc', '#correo'] });
    const r = await armar(GUION, p).facturar(CAMPOS, 'ensayo');

    expect(r.ok).toBe(false);
    expect(r.error).toContain('el botón de emitir');
  });

  it('con candidatos, gana el que EXISTE y no el primero declarado', async () => {
    const conCandidatos: GuionPortal = {
      ...GUION_MEDIDO,
      campos: { ...GUION_MEDIDO.campos, folio: { selector: ['#viejo', '#folio'] } },
    };
    const p = new PaginaDoble({ textos: { '.uuid': 'OK-2' } });
    const r = await armar(conCandidatos, p).facturar(CAMPOS, 'emitir');

    expect(r.ok).toBe(true);
    expect(p.escritos).toContainEqual({ sel: '#folio', valor: 'AB-123' });
  });

  it('si NINGÚN candidato existe, los enumera los dos', async () => {
    const conCandidatos: GuionPortal = {
      ...GUION_MEDIDO,
      campos: { ...GUION_MEDIDO.campos, folio: { selector: ['#viejo', '#tampoco'] } },
    };
    const r = await armar(conCandidatos, new PaginaDoble()).facturar(CAMPOS, 'ensayo');

    expect(r.error).toContain('#viejo');
    expect(r.error).toContain('#tampoco');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4 · EL RELOJ.
// ═══════════════════════════════════════════════════════════════════════════

describe('el reloj del lote (PR #152)', () => {
  const tickets = [
    { gastoId: 'g1', campos: CAMPOS },
    { gastoId: 'g2', campos: CAMPOS },
    { gastoId: 'g3', campos: CAMPOS },
  ];

  it('los que no caben salen POR SU NOMBRE como no intentados', async () => {
    const p = new PaginaDoble({ textos: { '.uuid': 'OK' } });
    // El reloj avanza 100 ms por consulta; con `venceEn` a 250 y margen de 100,
    // el tercer ticket ya no cabe.
    let t = 0;
    const a = armar(GUION_MEDIDO, p, { ahora: () => (t += 100), venceEn: 350, margenTicketMs: 100 });

    const r = await a.facturarLote(tickets, 'ensayo');

    const sinTurno = r.porGasto.filter((g) => g.motivo === SIN_TURNO);
    expect(sinTurno.length).toBeGreaterThan(0);
    // NO se marcan como incluidos: lo que no se intentó no se cuenta.
    expect(sinTurno.every((g) => g.incluido === false)).toBe(true);
    // Y el lote lo DICE, con los ids dentro: un motor que se calla es el que
    // mató al runner de producción dos veces.
    expect(r.aviso).toContain('sin turno');
    expect(r.aviso).toContain(sinTurno[0].gastoId);
  });

  it('sin `venceEn` no corta nada: es el caso de las pruebas y de una llamada a mano', async () => {
    const p = new PaginaDoble({ textos: { '.uuid': 'OK' } });
    const r = await armar(GUION_MEDIDO, p).facturarLote(tickets, 'ensayo');

    expect(r.porGasto).toHaveLength(3);
    expect(r.porGasto.every((g) => g.incluido)).toBe(true);
    expect(r.aviso).toBeUndefined();
  });

  it('en `emitir` el margen reserva la espera del UUID completa', async () => {
    // Un ticket que arranca con 200 ms por delante muere a media emisión, y esa
    // muerte es AMBIGUA: es como se acaba con dos CFDI por el mismo consumo.
    const p = new PaginaDoble({ textos: { '.uuid': 'OK' } });
    // `esperaUuidMs` 10 000 → margen por default 15 000. Con `venceEn` a 5 000,
    // NINGÚN ticket cabe aunque el reloj esté en cero.
    const a = armar(GUION_MEDIDO, p, { esperaUuidMs: 10_000, venceEn: 5_000, ahora: () => 0 });

    const r = await a.facturarLote(tickets, 'emitir');

    expect(r.porGasto.every((g) => g.motivo === SIN_TURNO)).toBe(true);
    expect(p.abiertas).toEqual([]);
  });

  it('un muro para el lote entero, y los que faltan salen como no intentados', async () => {
    const p = new PaginaDoble({ captcha: ['.g-recaptcha'] });
    const r = await armar(GUION_MEDIDO, p).facturarLote(tickets, 'ensayo');

    expect(r.requiereCaptcha).toBe(true);
    expect(r.porGasto).toHaveLength(3);
    // El primero se topó; los otros dos ni se intentaron —se toparían con lo
    // mismo, y seguir gastaría el presupuesto de la corrida siguiente.
    expect(r.porGasto[1].motivo).toContain('no se intentó');
    expect(p.abiertas).toHaveLength(1);
  });

  it('un lote de un portal sano reparte un resultado por gasto, sin faltar ninguno', async () => {
    const p = new PaginaDoble({ textos: { '.uuid': 'UUID-X' } });
    const r = await armar(GUION_MEDIDO, p).facturarLote(tickets, 'emitir');

    expect(r.porGasto.map((g) => g.gastoId)).toEqual(['g1', 'g2', 'g3']);
    expect(r.porGasto.every((g) => g.cfdiUuid === 'UUID-X')).toBe(true);
    // UNA sesión de navegador, TRES pestañas: es lo que convierte ocho casetas
    // de ~128 s en ~48 s.
    expect(p.abiertas).toHaveLength(3);
    expect(p.cerradas).toBe(3);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5 · NADA DE RELLENOS: `null` no se vuelve 0.
// ═══════════════════════════════════════════════════════════════════════════

describe('los formatos', () => {
  it('un monto se limpia de símbolo y comas, y conserva los centavos', () => {
    expect(aplicarFormato('$ 1,234.50', 'monto')).toBe('1234.50');
    expect(aplicarFormato('850', 'monto')).toBe('850.00');
  });

  it('un monto ILEGIBLE devuelve null, NO cero', () => {
    // Un monto que no se leyó no es un monto de cero pesos, y escribir "0" en
    // un documento fiscal es peor que no escribir nada.
    expect(aplicarFormato('ilegible', 'monto')).toBeNull();
    expect(aplicarFormato(null, 'monto')).toBeNull();
    expect(aplicarFormato('   ', 'monto')).toBeNull();
  });

  it('la fecha se pasa al formato del portal, y una que no es fecha devuelve null', () => {
    expect(aplicarFormato('2026-08-04', 'fecha_dmy')).toBe('04/08/2026');
    expect(aplicarFormato('2026-08-04', 'fecha_dmy_guion')).toBe('04-08-2026');
    expect(aplicarFormato('el martes', 'fecha_dmy')).toBeNull();
  });

  it('mayúsculas y solo dígitos', () => {
    expect(aplicarFormato('ab-123', 'mayusculas')).toBe('AB-123');
    expect(aplicarFormato('AB-12 34', 'solo_digitos')).toBe('1234');
    expect(aplicarFormato('sin-numeros', 'solo_digitos')).toBeNull();
    expect(aplicarFormato(' hola ')).toBe('hola');
    expect(aplicarFormato('1,234.90', 'monto_entero')).toBe('1234');
  });

  it('un valor del ticket que no se puede formatear DECLARA el fallo, no lo disimula', async () => {
    const p = new PaginaDoble();
    const campos: CampoListo[] = [
      ...CAMPOS.slice(0, 1),
      { clave: 'monto', etiqueta: 'Monto total', valor: 'ilegible', requerido: true },
      ...CAMPOS.slice(2),
    ];
    const r = await armar(GUION, p).facturar(campos, 'ensayo');

    expect(r.ok).toBe(false);
    expect(r.error).toContain('No se inventa un valor de relleno');
    expect(p.abiertas).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6 · LA PUERTA, EL XML Y LO QUE SE RECHAZA SIN ABRIR NAVEGADOR.
// ═══════════════════════════════════════════════════════════════════════════

describe('la puerta del portal', () => {
  const conSesion: GuionPortal = { ...GUION_MEDIDO, requiereSesion: true };

  it('la pantalla de entrar SIN sesión guardada pide vincular', async () => {
    const p = new PaginaDoble({
      inventario: { campos: [{ tag: 'input', type: 'password', id: 'pass', name: '', placeholder: '', etiqueta: 'Contraseña', visible: true, opciones: [] }] },
    });
    const r = await armar(conSesion, p).facturar(CAMPOS, 'emitir');

    expect(r.requiereVinculacion).toBe(true);
    expect(r.sesionCaducada).toBeUndefined();
    // Y NO se teclea ninguna contraseña: Likida no las maneja.
    expect(p.escritos).toEqual([]);
  });

  it('la MISMA pantalla CON sesión guardada dice que caducó', async () => {
    const p = new PaginaDoble({
      inventario: { campos: [{ tag: 'input', type: 'password', id: 'pass', name: '', placeholder: '', etiqueta: 'Contraseña', visible: true, opciones: [] }] },
    });
    const r = await armar(conSesion, p, { arrancoConSesion: true }).facturar(CAMPOS, 'emitir');

    // Misma acción, mensaje distinto: «se te venció» y «nunca has vinculado»
    // llevan al contralor a sitios distintos del panel.
    expect(r.requiereVinculacion).toBe(true);
    expect(r.sesionCaducada).toBe(true);
  });

  it('un portal que NO declara `requiereSesion` no mira la puerta', async () => {
    const p = new PaginaDoble({
      textos: { '.uuid': 'OK' },
      inventario: { campos: [{ tag: 'input', type: 'password', id: 'p', name: '', placeholder: '', etiqueta: '', visible: true, opciones: [] }] },
    });
    const r = await armar(GUION_MEDIDO, p).facturar(CAMPOS, 'emitir');

    expect(r.requiereVinculacion).toBeUndefined();
    expect(r.ok).toBe(true);
  });
});

describe('el XML', () => {
  const conXml: GuionPortal = { ...GUION_MEDIDO, xml: { boton: '#xml' } };

  it('se BAJA del portal y se devuelve su ruta', async () => {
    const p = new PaginaDoble({ presentes: [...TODOS, '#xml'], textos: { '.uuid': 'U-1' }, xmlRuta: '/tmp/cfdi.xml' });
    const r = await armar(conXml, p).facturar(CAMPOS, 'emitir');

    expect(r.xmlRuta).toBe('/tmp/cfdi.xml');
    expect(p.descargas).toEqual(['#xml']);
  });

  it('si el portal no entrega el archivo, se DICE que el CFDI ya existe', async () => {
    const p = new PaginaDoble({ presentes: [...TODOS, '#xml'], textos: { '.uuid': 'U-1' }, descargaRevienta: true });
    const r = await armar(conXml, p).facturar(CAMPOS, 'emitir');

    expect(r.ok).toBe(false);
    // Lo importante: NO se reintenta la emisión, que duplicaría el CFDI.
    expect(r.error).toContain('El comprobante EXISTE');
    expect(r.emisionSinConfirmar).toBe(true);
  });

  it('una plataforma que no sabe descargar no tumba una emisión buena', async () => {
    // El CFDI ya existe y el UUID ya se confirmó: quedarse sin XML es un hueco
    // de plataforma, no un fallo del portal.
    const p = new PaginaDoble({ presentes: [...TODOS, '#xml'], textos: { '.uuid': 'U-1' } });
    const r = await armar(conXml, p).facturar(CAMPOS, 'emitir');

    expect(r.ok).toBe(true);
    expect(r.cfdiUuid).toBe('U-1');
    expect(r.xmlRuta).toBeUndefined();
  });
});

describe('lo que se rechaza sin gastar un navegador', () => {
  it('un campo requerido vacío', async () => {
    const p = new PaginaDoble();
    const campos: CampoListo[] = [{ clave: 'folio', etiqueta: 'Folio del ticket', valor: null, requerido: true }];
    const r = await armar(GUION, p).facturar(campos, 'ensayo');

    expect(r.error).toContain('No se abrió el portal');
    expect(p.abiertas).toEqual([]);
  });

  it('un campo requerido que la tabla no sabe dónde poner', async () => {
    const p = new PaginaDoble();
    const campos: CampoListo[] = [{ clave: 'webId', etiqueta: 'Web ID', valor: '77', requerido: true }];
    const r = await armar(GUION, p).facturar(campos, 'ensayo');

    expect(r.error).toContain('no sabe dónde van estos campos');
    expect(p.abiertas).toEqual([]);
  });

  it('un guion sin botón de emitir', async () => {
    const r = await armar({ ...GUION, botonEmitir: '' }, new PaginaDoble()).facturar(CAMPOS, 'ensayo');
    expect(r.error).toContain('no declara el botón de emitir');
  });

  it('el portal que se queja de lo capturado para el ensayo en seco', async () => {
    const p = new PaginaDoble({ textos: { '.aviso': 'El folio no corresponde a ninguna venta' } });
    const r = await armar(GUION, p).facturar(CAMPOS, 'ensayo');

    expect(r.ok).toBe(false);
    expect(r.error).toContain('El folio no corresponde');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7 · SOLO SE EXIGEN LOS DATOS FISCALES QUE EL PORTAL PIDE.
// ═══════════════════════════════════════════════════════════════════════════

describe('revisarDatosDeGuion', () => {
  it('no exige régimen a un portal que no lo pide', () => {
    // El comentario de `TABLA` en registro.ts lo anticipó: «el día que entre uno
    // que no necesite régimen fiscal, no puede quedar fuera porque la flota no
    // lo tenga capturado». Ese día es hoy.
    expect(revisarDatosDeGuion(GUION, { ...RECEPTOR, regimenFiscal: '' })).toEqual([]);
  });

  it('SÍ exige lo que el portal pide, y lo dice en palabras', () => {
    expect(revisarDatosDeGuion(GUION, { ...RECEPTOR, rfc: 'NO-ES-RFC' })[0]).toContain('no tiene forma de RFC');
    expect(revisarDatosDeGuion(GUION, { ...RECEPTOR, correo: 'sin-arroba' })[0]).toContain('no tiene forma de correo');
  });

  it('caza un RFC con forma buena y dígito verificador malo', () => {
    // Forma buena (12 caracteres de moral), homoclave cambiada a mano.
    const malos = revisarDatosDeGuion(GUION, { ...RECEPTOR, rfc: 'GMX0902279I2' });
    expect(malos[0]).toContain('dígito verificador');
  });

  it('un guion sin receptor no exige nada', () => {
    expect(revisarDatosDeGuion({ ...GUION, receptor: undefined }, {})).toEqual([]);
  });
});
