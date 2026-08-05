import { describe, it, expect, vi } from 'vitest';
import {
  AdaptadorPlaywrightBase,
  type MapeoPortal,
  type OpcionesAdaptador,
  type PaginaPortal,
} from './playwright_base';
import type { ModoAgente } from '../agente';
import type { CampoListo } from '../pendientes';

// ═══════════════════════════════════════════════════════════════════════════
// LO QUE ESTAS PRUEBAS PROTEGEN ES UN BOTÓN QUE NO SE DESHACE.
//
// Emitir crea un CFDI REAL ante el SAT: cancelarlo fuera de plazo se le queda
// al cliente en su contabilidad. Así que aquí no se prueba "que llene bien"
// —eso es lo fácil— sino las cuatro formas de emitir de más:
//
//   1. que el ensayo apriete el botón sin querer,
//   2. que un modo raro (`undefined`, una cadena de un JSON) caiga en `emitir`,
//   3. que tras un fallo ambiguo se reintente y salgan dos CFDI,
//   4. que un selector movido escriba el monto en el campo del folio.
//
// Todo corre contra un DOBLE de página: sin navegador, sin red y sin portal
// real. Un portal real emitiría de verdad, que es justo lo que no se puede
// hacer en una suite que corre en cada push.
// ═══════════════════════════════════════════════════════════════════════════

// `vi.hoisted` porque el mock se iza por encima de las declaraciones: sin él,
// el doble del logger no existe todavía cuando se importa el módulo bajo prueba.
const { logger } = vi.hoisted(() => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('@/lib/logger', () => ({ logger }));

const MAPEO: MapeoPortal = {
  campos: { folio: '#folio', monto: '#total', fecha: '#fecha', webId: '#webid' },
  botonEmitir: '#emitir',
  uuid: '.uuid',
  error: '.aviso',
};

const TODOS = ['#folio', '#total', '#fecha', '#webid', '#emitir'];

const CAMPOS: CampoListo[] = [
  { clave: 'folio', etiqueta: 'Folio del ticket', valor: '12345', requerido: true },
  { clave: 'monto', etiqueta: 'Total', valor: '850.40', requerido: true },
  { clave: 'fecha', etiqueta: 'Fecha de compra', valor: '2026-08-04', requerido: true },
  { clave: 'webId', etiqueta: 'Web ID', valor: '650', requerido: false },
];

interface OpcDoble {
  /** Qué selectores existen en la página. Por default, todos. */
  presentes?: string[];
  /** Qué devuelve `leerTexto` por selector. */
  textos?: Record<string, string>;
  /** Si el doble ofrece el pre-vuelo `existe`. */
  conPreVuelo?: boolean;
  /** El clic se registra y DESPUÉS revienta: el fallo ambiguo de verdad. */
  clicRevienta?: boolean;
  /**
   * Cuántas lecturas del UUID pasan antes de que el folio esté. Imita al PAC:
   * el portal manda a timbrar y pinta el resultado cuando le contestan.
   */
  uuidVueltas?: number;
  /**
   * El portal PRE-PINTA el contenedor del UUID: existe desde el principio y
   * está vacío, así que `leerTexto` devuelve `''` y no `null`. Esa diferencia
   * es la que hacía que una emisión BUENA se reportara como fallo.
   */
  uuidPrepintado?: boolean;
}

/** El doble. Registra todo lo que se le hizo, para poder afirmarlo. */
class PaginaDoble implements PaginaPortal {
  abiertas: string[] = [];
  escritos: Array<{ sel: string; valor: string }> = [];
  clics: string[] = [];
  capturas = 0;
  cerradas = 0;
  vecesQueLeyoUuid = 0;
  existe?: (selector: string) => Promise<boolean>;
  private readonly presentes: string[];

  constructor(private readonly o: OpcDoble = {}) {
    this.presentes = o.presentes ?? TODOS;
    if (o.conPreVuelo) this.existe = async (s: string) => this.presentes.includes(s);
  }

  async abrir(url: string) {
    this.abiertas.push(url);
  }

  async escribir(sel: string, valor: string) {
    // Playwright lanza cuando el selector no resuelve. El doble hace lo mismo:
    // si esto devolviera en silencio, un portal rediseñado se leería como éxito.
    if (!this.presentes.includes(sel)) throw new Error(`no existe ${sel}`);
    this.escritos.push({ sel, valor });
  }

  async hacerClic(sel: string) {
    if (this.o.clicRevienta) {
      this.clics.push(sel);
      throw new Error('la navegación no terminó');
    }
    if (!this.presentes.includes(sel)) throw new Error(`no existe ${sel}`);
    this.clics.push(sel);
  }

  async leerTexto(sel: string) {
    if (sel === MAPEO.uuid) {
      // Las dos formas de "todavía no": `''` (contenedor pintado y vacío) y
      // `null` (el selector no resuelve). Aplanarlas borraría el caso que rompía.
      const todavia = this.o.uuidPrepintado ? '' : null;
      this.vecesQueLeyoUuid += 1;
      if (this.vecesQueLeyoUuid <= (this.o.uuidVueltas ?? 0)) return todavia;
      return this.o.textos?.[sel] ?? todavia;
    }
    return this.o.textos?.[sel] ?? null;
  }

  async captura() {
    this.capturas += 1;
    return `captura-${this.capturas}.png`;
  }

  async cerrar() {
    this.cerradas += 1;
  }
}

class PortalDePrueba extends AdaptadorPlaywrightBase {
  readonly comercio = 'e-facpos';
  readonly portal = 'https://e-facpos.com/facturacion';

  constructor(op: OpcionesAdaptador, private readonly mapeo: MapeoPortal = MAPEO) {
    super(op);
  }

  mapeoDeCampos(): MapeoPortal {
    return this.mapeo;
  }
}

function montar(o: OpcDoble & { reintentos?: number; mapeo?: MapeoPortal; esperaUuidMs?: number } = {}) {
  const paginas: PaginaDoble[] = [];
  const abrirPagina = vi.fn(async () => {
    const p = new PaginaDoble(o);
    paginas.push(p);
    return p;
  });
  const adaptador = new PortalDePrueba(
    {
      abrirPagina,
      reintentosEnEnsayo: o.reintentos,
      // El reloj no avanza en la prueba: lo que se prueba es que PREGUNTA hasta
      // que el folio aparece, no cuánto duerme. Sin esto, el sondeo del UUID
      // gasta sus 20 s reales y se lleva por delante el tope de la prueba.
      dormir: async () => {},
      intervaloMs: 1,
      esperaUuidMs: o.esperaUuidMs ?? 10,
    },
    o.mapeo ?? MAPEO,
  );
  return { adaptador, paginas, abrirPagina, primera: () => paginas[0] };
}

describe('llenado', () => {
  it('escribe TODOS los campos, cada valor en su selector', async () => {
    const m = montar();
    const r = await m.adaptador.facturar(CAMPOS, 'ensayo');

    expect(r.ok).toBe(true);
    expect(m.primera().abiertas).toEqual(['https://e-facpos.com/facturacion']);
    expect(m.primera().escritos).toEqual([
      { sel: '#folio', valor: '12345' },
      { sel: '#total', valor: '850.40' },
      { sel: '#fecha', valor: '2026-08-04' },
      { sel: '#webid', valor: '650' },
    ]);
    // Lo capturado se devuelve por CLAVE, no por etiqueta: dos campos pueden
    // llamarse igual en pantalla y uno pisaría al otro.
    expect(r.capturado).toEqual({
      folio: '12345', monto: '850.40', fecha: '2026-08-04', webId: '650',
    });
  });

  it('un opcional sin valor no se rellena con nada', async () => {
    const m = montar();
    const sinWebId = CAMPOS.map((c) => (c.clave === 'webId' ? { ...c, valor: null } : c));
    await m.adaptador.facturar(sinWebId, 'ensayo');

    expect(m.primera().escritos.map((e) => e.sel)).not.toContain('#webid');
  });
});

describe('modo ensayo', () => {
  it('llena, captura y SE DETIENE antes del botón de emitir', async () => {
    const m = montar();
    const r = await m.adaptador.facturar(CAMPOS, 'ensayo');

    expect(r.modo).toBe('ensayo');
    expect(r.ok).toBe(true);
    expect(m.primera().escritos).toHaveLength(4);
    expect(m.primera().capturas).toBeGreaterThan(0);
    expect(r.captura).toBeDefined();
    // LO ÚNICO QUE NO SE PUEDE DESHACER.
    expect(m.primera().clics).toEqual([]);
    expect(r.cfdiUuid).toBeUndefined();
  });

  it('es el default: sin modo, y con cualquier cosa que no sea exactamente "emitir"', async () => {
    const sinModo = montar();
    expect((await sinModo.adaptador.facturar(CAMPOS)).modo).toBe('ensayo');
    expect(sinModo.primera().clics).toEqual([]);

    // Lo que llega de un cuerpo JSON no lo protege el tipo.
    const raro = montar();
    const r = await raro.adaptador.facturar(CAMPOS, 'EMITIR' as unknown as ModoAgente);
    expect(r.modo).toBe('ensayo');
    expect(raro.primera().clics).toEqual([]);
  });

  it('caza un botón de emitir que ya no existe, sin emitir para averiguarlo', async () => {
    // El pre-vuelo revisa el botón aunque el ensayo no lo apriete: es el único
    // selector cuyo fallo, sin esto, solo se descubre emitiendo.
    const m = montar({ conPreVuelo: true, presentes: TODOS.filter((s) => s !== '#emitir') });
    const r = await m.adaptador.facturar(CAMPOS, 'ensayo');

    expect(r.ok).toBe(false);
    expect(r.error).toContain('#emitir');
    expect(r.error).toMatch(/botón de emitir/);
  });
});

describe('modo emitir', () => {
  it('aprieta el botón y devuelve el UUID del CFDI', async () => {
    const m = montar({ textos: { '.uuid': '  B0800A68-1F2E-4C3A-9D77-0A1B2C3D4E5F  ' } });
    const r = await m.adaptador.facturar(CAMPOS, 'emitir');

    expect(r.modo).toBe('emitir');
    expect(r.ok).toBe(true);
    expect(m.primera().clics).toEqual(['#emitir']);
    expect(r.cfdiUuid).toBe('B0800A68-1F2E-4C3A-9D77-0A1B2C3D4E5F');
    expect(r.captura).toBeDefined();
  });

  it('sin UUID confirmado no dice que salió bien, y avisa que el CFDI puede existir', async () => {
    const m = montar({ textos: {} });
    const r = await m.adaptador.facturar(CAMPOS, 'emitir');

    expect(r.ok).toBe(false);
    expect(r.cfdiUuid).toBeUndefined();
    expect(r.error).toMatch(/PUEDE QUE EL CFDI YA EXISTA/);
    // Y NO se vuelve a intentar: el segundo intento es el que lo duplica.
    expect(m.abrirPagina).toHaveBeenCalledTimes(1);
    expect(m.primera().clics).toEqual(['#emitir']);
  });

  it('EL UUID SE SONDEA: un contenedor pre-pintado VACÍO no convierte un éxito en fallo', async () => {
    // Esto leía el selector UNA vez, justo después del clic. El folio no está
    // ahí en ese instante —el portal manda a timbrar a un PAC— y, si además el
    // contenedor viene pre-pintado, `leerTexto` devuelve `''`, que es falsy: una
    // emisión EXITOSA se reportaba como "PUEDE QUE EL CFDI YA EXISTA", lo que
    // manda a revisar a mano algo que salió bien e invita a reintentar una
    // emisión que ya ocurrió.
    const m = montar({
      uuidPrepintado: true,
      uuidVueltas: 3,
      textos: { '.uuid': 'B0800A68-1F2E-4C3A-9D77-0A1B2C3D4E5F' },
    });

    const r = await m.adaptador.facturar(CAMPOS, 'emitir');

    expect(r.ok).toBe(true);
    expect(r.cfdiUuid).toBe('B0800A68-1F2E-4C3A-9D77-0A1B2C3D4E5F');
    expect(m.primera().vecesQueLeyoUuid).toBe(4);
    // Sondear no es reintentar: el botón se aprieta UNA vez.
    expect(m.primera().clics).toEqual(['#emitir']);
  });

  it('distingue "no apareció" de "apareció vacío": se arreglan en sitios distintos', async () => {
    const ausente = await montar({ textos: {} }).adaptador.facturar(CAMPOS, 'emitir');
    expect(ausente.error).toMatch(/no apareció/);

    const vacio = await montar({ textos: {}, uuidPrepintado: true }).adaptador.facturar(CAMPOS, 'emitir');
    expect(vacio.error).toMatch(/siguió VACÍO/);

    expect(ausente.error).not.toBe(vacio.error);
  });

  it('el sondeo tiene TECHO: no gira para siempre esperando un folio que no llega', async () => {
    // 6 ms de tope / 1 ms de intervalo = seis vueltas. Sin techo, un portal que
    // nunca pinta el folio se lleva la invocación entera y con ella el resto del
    // lote.
    const m = montar({ textos: {}, uuidPrepintado: true, esperaUuidMs: 6 });
    const r = await m.adaptador.facturar(CAMPOS, 'emitir');

    expect(r.ok).toBe(false);
    expect(m.primera().vecesQueLeyoUuid).toBe(6);
  });

  it('si el portal rechaza lo capturado, no se aprieta emitir', async () => {
    const m = montar({ textos: { '.aviso': 'El folio no corresponde a la sucursal' } });
    const r = await m.adaptador.facturar(CAMPOS, 'emitir');

    expect(r.ok).toBe(false);
    expect(r.error).toContain('El folio no corresponde a la sucursal');
    expect(m.primera().clics).toEqual([]);
    // Con su captura: el mensaje del portal sin la pantalla no dice qué había
    // en los campos.
    expect(r.captura).toBeDefined();
  });
});

describe('campo requerido sin valor', () => {
  it('se rechaza ANTES de tocar el navegador, y dice cuál falta', async () => {
    const m = montar();
    const sinFolio = CAMPOS.map((c) => (c.clave === 'folio' ? { ...c, valor: null } : c));
    const r = await m.adaptador.facturar(sinFolio, 'emitir');

    expect(r.ok).toBe(false);
    expect(r.error).toContain('Folio del ticket');
    expect(m.abrirPagina).not.toHaveBeenCalled();
  });

  it('un requerido que el mapeo no sabe dónde va tampoco abre el navegador', async () => {
    const m = montar({ mapeo: { ...MAPEO, campos: { monto: '#total', fecha: '#fecha' } } });
    const r = await m.adaptador.facturar(CAMPOS, 'emitir');

    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/folio/i);
    expect(m.abrirPagina).not.toHaveBeenCalled();
  });
});

describe('selector que ya no está en la página', () => {
  it('dice QUÉ selector faltó y en qué campo, y devuelve lo que alcanzó a llenar', async () => {
    const m = montar({ presentes: TODOS.filter((s) => s !== '#fecha') });
    const r = await m.adaptador.facturar(CAMPOS, 'emitir');

    expect(r.ok).toBe(false);
    expect(r.error).toContain('#fecha');
    expect(r.error).toContain('Fecha de compra');
    // Hasta dónde llegó: la otra mitad del diagnóstico.
    expect(r.capturado).toEqual({ folio: '12345', monto: '850.40' });
    // Y con un campo sin llenar NO se emite.
    expect(m.primera().clics).toEqual([]);
  });

  it('con pre-vuelo los reporta TODOS juntos y no escribe ni uno', async () => {
    const m = montar({ conPreVuelo: true, presentes: ['#folio', '#emitir'] });
    const r = await m.adaptador.facturar(CAMPOS, 'ensayo');

    expect(r.ok).toBe(false);
    expect(r.error).toContain('#total');
    expect(r.error).toContain('#fecha');
    expect(r.error).toContain('#webid');
    // Sin pre-vuelo se descubriría uno por corrida: tres vueltas para arreglar
    // un portal que cambió de plantilla.
    expect(m.primera().escritos).toEqual([]);
  });
});

describe('no se reintenta', () => {
  it('en emitir NO reintenta aunque haya reintentos configurados', async () => {
    // El fallo ambiguo de verdad: el clic entró y la navegación no terminó.
    // Nadie sabe si el CFDI se creó — y por eso no se toca nada más.
    const m = montar({ clicRevienta: true, reintentos: 3 });
    const r = await m.adaptador.facturar(CAMPOS, 'emitir');

    expect(r.ok).toBe(false);
    expect(m.abrirPagina).toHaveBeenCalledTimes(1);
    expect(m.paginas).toHaveLength(1);
    expect(m.primera().clics).toEqual(['#emitir']);
    expect(r.error).toMatch(/SE APRETÓ EMITIR/);
    expect(r.error).toMatch(/PUEDE QUE EL CFDI YA EXISTA/);
  });

  it('por default tampoco reintenta en ensayo', async () => {
    const m = montar({ presentes: [] });
    await m.adaptador.facturar(CAMPOS, 'ensayo');

    expect(m.abrirPagina).toHaveBeenCalledTimes(1);
  });

  it('el candado es el MODO, no la falta de bucle: en ensayo sí repite', async () => {
    const m = montar({ presentes: TODOS.filter((s) => s !== '#fecha'), reintentos: 2 });
    const r = await m.adaptador.facturar(CAMPOS, 'ensayo');

    expect(r.ok).toBe(false);
    expect(m.abrirPagina).toHaveBeenCalledTimes(3);
    // Repetir un ensayo es gratis justo porque nunca aprieta el botón.
    expect(m.paginas.every((p) => p.clics.length === 0)).toBe(true);
  });

  it('cierra la página aunque el intento falle', async () => {
    const m = montar({ presentes: [] });
    await m.adaptador.facturar(CAMPOS, 'ensayo');

    expect(m.primera().cerradas).toBe(1);
  });
});
