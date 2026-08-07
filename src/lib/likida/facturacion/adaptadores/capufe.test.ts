import { describe, it, expect, vi } from 'vitest';
import {
  AdaptadorCapufe,
  MENSAJE_CAPTCHA,
  SELECTORES_CAPUFE,
  URL_CAPUFE_SIN_REGISTRO,
  parsearCosto,
  pideCaptcha,
  registrarCapufe,
  revisarReceptor,
  type DatosReceptorCapufe,
  type OpcionesCapufe,
  type PaginaCapufe,
  type TicketCapufe,
} from './capufe';
import type { CampoListo } from '../pendientes';
import type { ModoAgente } from '../agente';

// ═══════════════════════════════════════════════════════════════════════════
// LO QUE ESTAS PRUEBAS PROTEGEN.
//
// CAPUFE emite UN CFDI con TODAS las casetas de un viaje. O sea: un error aquí
// no arruina un ticket de $180, arruina la factura de las ocho casetas — y
// emitir ante el SAT no se deshace.
//
// Las cuatro formas de arruinarla, y por eso están las pruebas:
//   1. marcar `#cb1` creyendo que son términos y condiciones (es el complemento
//      de PARTIDOS POLÍTICOS),
//   2. que el ensayo apriete el botón de emitir,
//   3. que un CAPTCHA se lea como "falló, reintenta" y la cola gire para siempre
//      mientras los tickets caducan,
//   4. que un código sea de otro cruce y se facture igual porque nadie cotejó
//      el costo que devolvió el portal.
//
// Todo corre contra un DOBLE que imita al portal: sin navegador, sin red, sin
// CFDI de verdad. El portal real emitiría en serio, que es justo lo que no se
// puede hacer en una suite que corre en cada push.
// ═══════════════════════════════════════════════════════════════════════════

const { logger } = vi.hoisted(() => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('@/lib/logger', () => ({ logger }));

const S = SELECTORES_CAPUFE;

/**
 * Los ocho que revisa el pre-vuelo, más `botonEmitir` — que YA NO es de ese
 * grupo: con el formulario en blanco ese botón no existe, así que se revisa
 * aparte, cuando debería estar (`hayBotonDeEmitir`, en `capufe.ts`).
 */
const TODOS = [
  S.rfc, S.nombre, S.codigoPostal, S.regimenFiscal, S.usoCfdi, S.correo,
  S.codigo, S.botonValidar, S.botonEmitir,
];

/** RFC real de persona moral: pasa formato Y dígito verificador. */
const RECEPTOR: DatosReceptorCapufe = {
  rfc: 'GMX0902279I1',
  nombre: 'TRANSPORTES DEL BAJIO SA DE CV',
  codigoPostal: '37000',
  regimenFiscal: '601',
  usoCfdi: 'G03',
  correo: 'facturas@transportesdelbajio.mx',
};

const REGIMENES = ['', '601', '603', '612', '626'];
const USOS = ['', 'G01', 'G03', 'S01'];

interface Fila { codigo: string; plaza: string; fecha: string; costo: string }

type Respuesta =
  | { agrega: true; plaza?: string; fecha?: string; costo?: string }
  | { agrega: false; aviso?: string; captcha?: string[] };

interface OpcDoble {
  /** Qué selectores existen. Default: los nueve del pre-vuelo. */
  presentes?: string[];
  /** Qué contesta el portal por código. Default: lo agrega con costo $180.00. */
  respuestas?: Record<string, Respuesta>;
  /** Cuántas veces hay que preguntar antes de que el AJAX traiga las opciones. */
  vueltasParaPoblar?: number;
  opcionesRegimen?: string[];
  opcionesUso?: string[];
  /** La página no ofrece `seleccionar()`: se cae al buscador. */
  sinSeleccionar?: boolean;
  /** `seleccionar()` no prende — el `<select>` oculto detrás del control. */
  seleccionNoPrende?: boolean;
  /** La página no ofrece `existe()`: sin pre-vuelo. */
  sinPreVuelo?: boolean;
  /** La página no ofrece `valorSeleccionado()`. */
  sinValorSeleccionado?: boolean;
  /** El UUID que enseña al emitir. `undefined` = no lo enseña. */
  uuid?: string;
  /**
   * Cuántas lecturas del `.uuid` pasan antes de que el folio esté. Imita al PAC:
   * CAPUFE manda a timbrar y pinta el resultado cuando le contestan.
   */
  uuidVueltas?: number;
  /**
   * El portal PRE-PINTA el contenedor del UUID: existe desde el principio y
   * está vacío. Con eso `leerTexto` devuelve `''` y no `null` — la diferencia
   * que hacía que una emisión buena se reportara como fallo.
   */
  uuidPrepintado?: boolean;
  /** Texto del cuadro de error nada más abrir. */
  avisoInicial?: string;
}

/**
 * El doble. No es un stub: imita el flujo del portal —los códigos entran a una
 * tabla, los `<select>` llegan vacíos y se pueblan— porque lo que se está
 * probando es justamente ese flujo.
 */
class PortalDoble implements PaginaCapufe {
  abiertas: string[] = [];
  escritos: Array<{ sel: string; valor: string }> = [];
  clics: string[] = [];
  filas: Fila[] = [];
  capturas = 0;
  cerradas = 0;
  emitido = false;
  seleccionados: Record<string, string> = {};
  vecesQuePreguntoOpciones = 0;
  vecesQueLeyoUuid = 0;

  private aviso: string | null;
  private ultimoCodigo = '';
  private readonly presentes: string[];

  existe?: (selector: string) => Promise<boolean>;
  seleccionar?: (selector: string, valor: string) => Promise<void>;
  valorSeleccionado?: (selector: string) => Promise<string | null>;

  constructor(private readonly o: OpcDoble = {}) {
    // COPIA. Un CAPTCHA que aparece a media sesión se agrega a esta lista, y sin
    // la copia eso mutaba el `TODOS` del módulo: la prueba del CAPTCHA
    // envenenaba a todas las siguientes con un reto que nadie pidió.
    this.presentes = [...(o.presentes ?? TODOS)];
    this.aviso = o.avisoInicial ?? null;
    if (!o.sinPreVuelo) this.existe = (s) => Promise.resolve(this.resuelve(s));
    if (!o.sinSeleccionar) {
      this.seleccionar = async (sel, valor) => {
        if (!this.opcionesDe(sel).includes(valor)) throw new Error(`sin opción ${valor}`);
        // El caso feo: el framework pinta su propio control y el `<select>` de
        // abajo no se entera. Se ve igual desde fuera hasta que se verifica.
        if (!this.o.seleccionNoPrende) this.seleccionados[sel] = valor;
      };
    }
    if (!o.sinValorSeleccionado) {
      this.valorSeleccionado = async (sel) => this.seleccionados[sel] ?? '';
    }
  }

  /** Las opciones de HOY: vacías hasta que el AJAX "responde". */
  private opcionesDe(sel: string): string[] {
    const listas = (this.vecesQuePreguntoOpciones ?? 0) >= (this.o.vueltasParaPoblar ?? 0);
    if (!listas) return [''];
    if (sel === S.regimenFiscal) return this.o.opcionesRegimen ?? REGIMENES;
    if (sel === S.usoCfdi) return this.o.opcionesUso ?? USOS;
    return [''];
  }

  async opciones(sel: string): Promise<string[]> {
    this.vecesQuePreguntoOpciones += 1;
    return this.opcionesDe(sel);
  }

  /** `existe` de verdad: entiende `option[value=…]` y `:checked`. */
  private resuelve(sel: string): boolean {
    const m = /^(.*) option\[value="(.+?)"\](:checked)?$/.exec(sel);
    if (m) {
      const [, base, valor, marcada] = m;
      if (marcada) return this.seleccionados[base] === valor;
      return this.opcionesDe(base).includes(valor);
    }
    return this.presentes.includes(sel);
  }

  async abrir(url: string) {
    this.abiertas.push(url);
  }

  async escribir(sel: string, valor: string) {
    if (!this.presentes.includes(sel)) throw new Error(`no existe ${sel}`);
    this.escritos.push({ sel, valor });
    if (sel === S.codigo) this.ultimoCodigo = valor;
  }

  async hacerClic(sel: string) {
    if (!this.presentes.includes(sel)) throw new Error(`no existe ${sel}`);
    this.clics.push(sel);
    if (sel === S.botonValidar) this.validar();
    if (sel === S.botonEmitir) this.emitido = true;

    // El camino del buscador: elegir de la lista pintada SÍ prende el `<select>`
    // de abajo. Es el comportamiento que se espera del framework cuando se usa
    // su propio control en vez de escribirle el valor por detrás.
    const op = /^\[role="option"\]:has-text\("(.+?)"\)$/.exec(sel);
    if (op && !this.o.seleccionNoPrende) {
      const valor = op[1];
      if ((this.o.opcionesRegimen ?? REGIMENES).includes(valor)) this.seleccionados[S.regimenFiscal] = valor;
      else if ((this.o.opcionesUso ?? USOS).includes(valor)) this.seleccionados[S.usoCfdi] = valor;
    }
  }

  private validar() {
    // El portal limpia su aviso en cada validación; si no, el rechazo de un
    // código se le pegaría al siguiente.
    this.aviso = null;
    const r: Respuesta = this.o.respuestas?.[this.ultimoCodigo] ?? { agrega: true };
    if (r.agrega) {
      this.filas.push({
        codigo: this.ultimoCodigo,
        plaza: r.plaza ?? 'Palmillas',
        fecha: r.fecha ?? '2026-08-03',
        costo: r.costo ?? '$180.00',
      });
      return;
    }
    this.aviso = r.aviso ?? null;
    for (const c of r.captcha ?? []) if (!this.presentes.includes(c)) this.presentes.push(c);
  }

  async leerTexto(sel: string): Promise<string | null> {
    if (sel === S.error) return this.aviso;
    if (sel === S.uuid) return this.leerUuid();

    const m = /^(.*) tbody tr:nth-child\((\d+)\) td:nth-child\((\d+)\)$/.exec(sel);
    if (m && m[1] === S.tabla) {
      const fila = this.filas[Number(m[2]) - 1];
      if (!fila) return null; // se acabaron las filas
      return [fila.codigo, fila.plaza, fila.fecha, fila.costo][Number(m[3]) - 1] ?? null;
    }
    return null;
  }

  /**
   * El `.uuid`, con las dos formas de "todavía no".
   *
   *   pre-pintado → `''`   (el contenedor existe y está vacío)
   *   sin pintar  → `null` (el selector no resuelve)
   *
   * Aplanar las dos en `null` sería borrar de la prueba justo el caso que rompía:
   * `''` es falsy, así que una emisión BUENA se leía como "no se pudo confirmar
   * el UUID · PUEDE QUE EL CFDI YA EXISTA".
   */
  private leerUuid(): string | null {
    const todavia = this.o.uuidPrepintado ? '' : null;
    if (!this.emitido) return todavia;
    this.vecesQueLeyoUuid += 1;
    if (this.vecesQueLeyoUuid <= (this.o.uuidVueltas ?? 0)) return todavia;
    return this.o.uuid ?? todavia;
  }

  async captura() {
    this.capturas += 1;
    return `capufe-${this.capturas}.png`;
  }

  async cerrar() {
    this.cerradas += 1;
  }
}

function montar(o: OpcDoble & Partial<OpcionesCapufe> = {}) {
  const paginas: PortalDoble[] = [];
  const abrirPagina = vi.fn(async () => {
    const p = new PortalDoble(o);
    paginas.push(p);
    return p;
  });
  const adaptador = new AdaptadorCapufe({
    abrirPagina,
    receptor: o.receptor ?? RECEPTOR,
    // El reloj no avanza en la prueba: lo que se prueba es que PREGUNTA hasta
    // que la opción aparece, no cuánto duerme.
    dormir: async () => {},
    intervaloMs: 1,
    esperaMaxMs: 10,
    // Diez vueltas también para el UUID. En producción son 20 s reales; aquí lo
    // que importa es que hay TECHO y que se sondea más de una vez.
    esperaUuidMs: o.esperaUuidMs ?? 10,
    emitirAunConDiscrepancia: o.emitirAunConDiscrepancia,
    selectores: o.selectores,
  });
  return { adaptador, paginas, abrirPagina, primera: () => paginas[0] };
}

/** 18 caracteres exactos: es lo que pide el portal. */
const c = (n: number) => `CAPUFE${String(n).padStart(12, '0')}`;

const CODIGO_A = c(1);
const CODIGO_B = c(2);
const CODIGO_C = c(3);

describe('el código de 18 caracteres', () => {
  it('las constantes de prueba miden lo que el portal pide', () => {
    // Esta prueba existe porque la primera versión de este archivo usaba
    // códigos de 19 y el adaptador los rechazó a todos, correctamente.
    expect(CODIGO_A).toHaveLength(18);
    expect(c(7)).toHaveLength(18);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('#cb1 — el checkbox que NO son términos y condiciones', () => {
  it('no se marca en ningún camino: ensayo, emitir, ni con un código rechazado', async () => {
    const ensayo = montar();
    await ensayo.adaptador.facturarVarios([{ codigo: CODIGO_A }], 'ensayo');

    const emitir = montar({ uuid: 'AA11BB22-3333-4444-5555-666677778888' });
    await emitir.adaptador.facturarVarios([{ codigo: CODIGO_A }], 'emitir');

    const rechazo = montar({ respuestas: { [CODIGO_A]: { agrega: false, aviso: 'Código no encontrado' } } });
    await rechazo.adaptador.facturarVarios([{ codigo: CODIGO_A }], 'emitir');

    for (const m of [ensayo, emitir, rechazo]) {
      expect(m.primera().clics).not.toContain(S.complementoPartidos);
      expect(m.primera().escritos.map((e) => e.sel)).not.toContain(S.complementoPartidos);
    }
    // Y el checkbox NUNCA es el botón que se aprieta.
    expect(emitir.primera().clics).toEqual([S.botonValidar, S.botonEmitir]);
  });

  it('si alguien lo cablea como botón, el clic se NIEGA y dice por qué', async () => {
    // La prohibición tiene que ser código, no comentario: un adaptador nuevo se
    // escribe copiando este archivo, y los comentarios se copian sin leerse.
    const m = montar({
      selectores: { botonValidar: S.complementoPartidos },
      presentes: [...TODOS, S.complementoPartidos],
    });
    const r = await m.adaptador.facturarVarios([{ codigo: CODIGO_A }], 'emitir');

    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/partidos pol[ií]ticos/i);
    expect(m.primera().clics).toEqual([]);
    expect(m.primera().emitido).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('modo ensayo', () => {
  it('llena, agrega los códigos, captura y SE DETIENE antes de emitir', async () => {
    const m = montar();
    const r = await m.adaptador.facturarVarios([{ codigo: CODIGO_A }, { codigo: CODIGO_B }], 'ensayo');

    expect(r.modo).toBe('ensayo');
    expect(r.ok).toBe(true);
    expect(m.primera().abiertas).toEqual([URL_CAPUFE_SIN_REGISTRO]);
    expect(m.primera().filas.map((f) => f.codigo)).toEqual([CODIGO_A, CODIGO_B]);
    expect(m.primera().capturas).toBeGreaterThan(0);
    expect(r.captura).toBeDefined();

    // LO ÚNICO QUE NO SE PUEDE DESHACER.
    expect(m.primera().clics).not.toContain(S.botonEmitir);
    expect(m.primera().emitido).toBe(false);
    expect(r.cfdiUuid).toBeUndefined();
  });

  it('es el default: sin modo y con cualquier cosa que no sea exactamente "emitir"', async () => {
    const sinModo = montar();
    expect((await sinModo.adaptador.facturarVarios([{ codigo: CODIGO_A }])).modo).toBe('ensayo');
    expect(sinModo.primera().emitido).toBe(false);

    // Lo que llega de un cuerpo JSON no lo protege el tipo.
    const raro = montar();
    const r = await raro.adaptador.facturarVarios([{ codigo: CODIGO_A }], 'EMITIR' as unknown as ModoAgente);
    expect(r.modo).toBe('ensayo');
    expect(raro.primera().emitido).toBe(false);

    const vacio = montar();
    expect((await vacio.adaptador.facturar(campos(CODIGO_A), '' as unknown as ModoAgente)).modo).toBe('ensayo');
    expect(vacio.primera().emitido).toBe(false);
  });

  it('devuelve los datos fiscales que escribió, para poder mirarlos sin emitir', async () => {
    const m = montar();
    const r = await m.adaptador.facturarVarios([{ codigo: CODIGO_A }], 'ensayo');

    expect(r.capturado).toEqual({
      rfc: 'GMX0902279I1',
      nombre: 'TRANSPORTES DEL BAJIO SA DE CV',
      codigoPostal: '37000',
      correo: 'facturas@transportesdelbajio.mx',
      regimenFiscal: '601',
      usoCfdi: 'G03',
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('varios códigos en UNA sesión', () => {
  it('ocho casetas son un navegador y un llenado de datos fiscales, no ocho', async () => {
    const m = montar();
    const tickets: TicketCapufe[] = Array.from({ length: 8 }, (_, i) => ({ codigo: c(i + 1) }));
    const r = await m.adaptador.facturarVarios(tickets, 'ensayo');

    expect(r.ok).toBe(true);
    // Abrir el navegador es lo caro. Teclear un campo más no cuesta nada.
    expect(m.abrirPagina).toHaveBeenCalledTimes(1);
    expect(m.paginas).toHaveLength(1);
    expect(m.primera().escritos.filter((e) => e.sel === S.rfc)).toHaveLength(1);
    expect(m.primera().escritos.filter((e) => e.sel === S.codigo)).toHaveLength(8);
    expect(m.primera().clics.filter((s) => s === S.botonValidar)).toHaveLength(8);
    expect(r.codigos.filter((x) => x.estado === 'agregado')).toHaveLength(8);
    expect(r.totalPortal).toBe(1440); // 8 × 180
  });

  it('lee la fila DE SU código, no la última de la tabla', async () => {
    // El portal puede ordenar por fecha o por plaza: leer "el último renglón"
    // le pegaría a un código el costo de otro.
    const m = montar({
      respuestas: {
        [CODIGO_A]: { agrega: true, plaza: 'Palmillas', costo: '$ 1,240.50' },
        [CODIGO_B]: { agrega: true, plaza: 'Tepotzotlán', costo: '$95.00' },
      },
    });
    const r = await m.adaptador.facturarVarios([{ codigo: CODIGO_A }, { codigo: CODIGO_B }], 'ensayo');

    const a = r.codigos.find((x) => x.codigo === CODIGO_A);
    const b = r.codigos.find((x) => x.codigo === CODIGO_B);
    expect(a).toMatchObject({ estado: 'agregado', plaza: 'Palmillas', costoPortal: 1240.5 });
    expect(b).toMatchObject({ estado: 'agregado', plaza: 'Tepotzotlán', costoPortal: 95 });
    expect(r.totalPortal).toBe(1335.5);
  });

  it('un código repetido en el lote no se manda dos veces', async () => {
    const m = montar();
    const r = await m.adaptador.facturarVarios(
      [{ codigo: CODIGO_A }, { codigo: CODIGO_A.toLowerCase() }, { codigo: CODIGO_B }],
      'ensayo',
    );

    expect(r.codigos.map((x) => x.estado)).toEqual(['agregado', 'duplicado', 'agregado']);
    expect(m.primera().escritos.filter((e) => e.sel === S.codigo)).toHaveLength(2);
    // Agregarlo dos veces lo cobraría dos veces EN LA MISMA factura.
    expect(r.totalPortal).toBe(360);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('un código que el portal rechaza', () => {
  it('no se reintenta, no tumba a los demás, y guarda lo que dijo el portal', async () => {
    const m = montar({
      respuestas: { [CODIGO_B]: { agrega: false, aviso: 'El código ya fue facturado' } },
    });
    const r = await m.adaptador.facturarVarios(
      [{ codigo: CODIGO_A }, { codigo: CODIGO_B }, { codigo: CODIGO_C }],
      'ensayo',
    );

    expect(r.ok).toBe(true);
    expect(r.codigos.map((x) => x.estado)).toEqual(['agregado', 'rechazado', 'agregado']);
    expect(r.codigos[1].motivo).toContain('El código ya fue facturado');
    // UNA vez. Un código rechazado se rechaza igual el segundo intento; lo
    // único que cambia es que el portal empieza a vernos como un robot.
    expect(m.primera().escritos.filter((e) => e.valor === CODIGO_B)).toHaveLength(1);
    expect(r.aviso).toContain('El código ya fue facturado');
    expect(r.totalPortal).toBe(360);
  });

  it('rechazado en silencio se dice como tal, no como éxito', async () => {
    const m = montar({ respuestas: { [CODIGO_A]: { agrega: false } } });
    const r = await m.adaptador.facturarVarios([{ codigo: CODIGO_A }], 'ensayo');

    expect(r.ok).toBe(false);
    expect(r.codigos[0].estado).toBe('rechazado');
    expect(r.codigos[0].motivo).toMatch(/no dijo por qué/);
  });

  it('si NINGUNO entró no se aprieta emitir', async () => {
    const m = montar({
      respuestas: {
        [CODIGO_A]: { agrega: false, aviso: 'Código inválido' },
        [CODIGO_B]: { agrega: false, aviso: 'Código inválido' },
      },
      uuid: 'AA11BB22-3333-4444-5555-666677778888',
    });
    const r = await m.adaptador.facturarVarios([{ codigo: CODIGO_A }, { codigo: CODIGO_B }], 'emitir');

    expect(r.ok).toBe(false);
    expect(m.primera().emitido).toBe(false);
    expect(r.error).toMatch(/No se aprieta emitir/);
    expect(r.cfdiUuid).toBeUndefined();
  });

  it('un código que no mide 18 se rechaza SIN abrir el navegador', async () => {
    const m = montar();
    const r = await m.adaptador.facturarVarios([{ codigo: 'CAP123' }], 'emitir');

    expect(r.ok).toBe(false);
    expect(m.abrirPagina).not.toHaveBeenCalled();
    expect(r.codigos[0]).toMatchObject({ estado: 'rechazado' });
    expect(r.codigos[0].motivo).toMatch(/6 caracteres y CAPUFE pide 18/);
  });

  it('un código corto no impide facturar los otros siete del viaje', async () => {
    const m = montar();
    const r = await m.adaptador.facturarVarios([{ codigo: 'CAP123' }, { codigo: CODIGO_A }], 'ensayo');

    expect(r.ok).toBe(true);
    expect(r.codigos.map((x) => x.estado)).toEqual(['rechazado', 'agregado']);
    expect(m.abrirPagina).toHaveBeenCalledTimes(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('los <select> que se pueblan por AJAX', () => {
  it('espera a que lleguen las opciones en vez de fallar en la primera vuelta', async () => {
    const m = montar({ vueltasParaPoblar: 3 });
    const r = await m.adaptador.facturarVarios([{ codigo: CODIGO_A }], 'ensayo');

    expect(r.ok).toBe(true);
    expect(m.primera().seleccionados[S.regimenFiscal]).toBe('601');
    expect(m.primera().seleccionados[S.usoCfdi]).toBe('G03');
    // Preguntó más de una vez: eso es esperar por CONDICIÓN, no por reloj.
    expect(m.primera().vecesQuePreguntoOpciones).toBeGreaterThan(1);
  });

  it('si nunca se pueblan, lo dice como AJAX que no respondió', async () => {
    const m = montar({ vueltasParaPoblar: 9999 });
    const r = await m.adaptador.facturarVarios([{ codigo: CODIGO_A }], 'ensayo');

    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/sigui[óo] vac[ií]o/i);
    expect(r.error).toMatch(/AJAX/);
    // Y no se siguió tecleando a ciegas.
    expect(m.primera().escritos.map((e) => e.sel)).not.toContain(S.codigo);
  });

  it('si se pueblan SIN nuestra clave, dice que el portal no la ofrece (que se arregla distinto)', async () => {
    const m = montar({ opcionesRegimen: ['', '603', '612'] });
    const r = await m.adaptador.facturarVarios([{ codigo: CODIGO_A }], 'ensayo');

    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/no ofrece "601"/);
    expect(r.error).toMatch(/reintentar no lo va a cambiar/);
  });

  it('NO da por buena una selección que no prendió en el control', async () => {
    // El patrón del desplegable con buscador: el `<select>` queda debajo y
    // escribirle el valor no dispara el handler del framework. Sin verificar,
    // el CFDI sale con el régimen anterior y el receptor no lo puede deducir.
    const m = montar({ seleccionNoPrende: true });
    const r = await m.adaptador.facturarVarios([{ codigo: CODIGO_A }], 'emitir');

    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/qued[óo] ""/);
    expect(m.primera().emitido).toBe(false);
  });

  it('sin `seleccionar()` cae al buscador: escribe el filtro y elige de la lista', async () => {
    const opcion = S.opcionDelBuscador('601');
    const opcionUso = S.opcionDelBuscador('G03');
    const m = montar({
      sinSeleccionar: true,
      // Sin `valorSeleccionado` la verificación cae al `:checked` de la
      // `<option>`, que es lo único que se puede preguntar con los cinco
      // métodos de la base.
      sinValorSeleccionado: true,
      presentes: [...TODOS, S.buscadorRegimen, S.buscadorUso, opcion, opcionUso],
    });
    const r = await m.adaptador.facturarVarios([{ codigo: CODIGO_A }], 'ensayo');

    expect(r.ok).toBe(true);
    expect(m.primera().escritos).toContainEqual({ sel: S.buscadorRegimen, valor: '601' });
    expect(m.primera().clics).toContain(opcion);
    expect(m.primera().seleccionados[S.regimenFiscal]).toBe('601');
  });

  it('por el buscador tampoco se da por buena una selección que no prendió', async () => {
    const opcion = S.opcionDelBuscador('601');
    const m = montar({
      sinSeleccionar: true,
      sinValorSeleccionado: true,
      seleccionNoPrende: true,
      presentes: [...TODOS, S.buscadorRegimen, S.buscadorUso, opcion, S.opcionDelBuscador('G03')],
    });
    const r = await m.adaptador.facturarVarios([{ codigo: CODIGO_A }], 'emitir');

    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Régimen Fiscal/);
    expect(m.primera().emitido).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('CAPTCHA — "no se puede", que no es "no pude"', () => {
  it('lo detecta al abrir, aborta sin escribir un carácter y lo dice con la frase', async () => {
    const m = montar({ presentes: [...TODOS, '.g-recaptcha'] });
    const r = await m.adaptador.facturarVarios([{ codigo: CODIGO_A }], 'emitir');

    expect(r.ok).toBe(false);
    expect(r.requiereCaptcha).toBe(true);
    expect(pideCaptcha(r)).toBe(true);
    expect(r.error).toContain(MENSAJE_CAPTCHA);
    expect(r.error).toMatch(/no se puede/i);
    // Ni un carácter, ni un clic, ni el botón de emitir.
    expect(m.primera().escritos).toEqual([]);
    expect(m.primera().clics).toEqual([]);
    expect(m.primera().emitido).toBe(false);
    // Y la página se cierra igual.
    expect(m.primera().cerradas).toBe(1);
  });

  it('lo detecta cuando aparece AL VALIDAR, y ya no aprieta emitir', async () => {
    const m = montar({
      respuestas: { [CODIGO_A]: { agrega: false, captcha: ['iframe[src*="recaptcha/api2/bframe"]'] } },
      uuid: 'AA11BB22-3333-4444-5555-666677778888',
    });
    const r = await m.adaptador.facturarVarios([{ codigo: CODIGO_A }, { codigo: CODIGO_B }], 'emitir');

    expect(r.requiereCaptcha).toBe(true);
    expect(r.error).toContain(MENSAJE_CAPTCHA);
    expect(m.primera().emitido).toBe(false);
    // Se paró en el primero: no siguió tecleando contra un reto.
    expect(m.primera().escritos.filter((e) => e.sel === S.codigo)).toHaveLength(1);
  });

  it('lo detecta cuando el portal lo dice con palabras (v3 bloquea sin widget)', async () => {
    const m = montar({ avisoInicial: 'Verificación de seguridad requerida, intenta de nuevo' });
    const r = await m.adaptador.facturarVarios([{ codigo: CODIGO_A }], 'ensayo');

    expect(r.requiereCaptcha).toBe(true);
    expect(r.error).toContain(MENSAJE_CAPTCHA);
  });

  it('el badge de v3 y el script cargado NO son un CAPTCHA que bloquee', async () => {
    // Los trae este sitio siempre. Abortar por ellos convertiría al adaptador en
    // un "no se puede" permanente: no facturaría nunca y nadie sabría por qué.
    const m = montar({ presentes: [...TODOS, '.grecaptcha-badge', 'script[src*="recaptcha"]'] });
    const r = await m.adaptador.facturarVarios([{ codigo: CODIGO_A }], 'ensayo');

    expect(r.requiereCaptcha).toBe(false);
    expect(r.ok).toBe(true);
  });

  it('un rechazo normal del portal NO se confunde con un CAPTCHA', async () => {
    const m = montar({ respuestas: { [CODIGO_A]: { agrega: false, aviso: 'El código ya fue facturado' } } });
    const r = await m.adaptador.facturarVarios([{ codigo: CODIGO_A }], 'ensayo');

    expect(r.requiereCaptcha).toBe(false);
    expect(pideCaptcha(r)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('el costo lo dice el portal, no el OCR', () => {
  it('marca la discrepancia y la enseña con las dos cifras', async () => {
    const m = montar({ respuestas: { [CODIGO_A]: { agrega: true, costo: '$246.00' } } });
    const r = await m.adaptador.facturarVarios([{ codigo: CODIGO_A, montoEsperado: 180 }], 'ensayo');

    expect(r.codigos[0]).toMatchObject({
      estado: 'agregado', costoPortal: 246, montoEsperado: 180, discrepanciaDeMonto: true,
    });
    expect(r.discrepancias).toHaveLength(1);
    expect(r.aviso).toContain('246');
    expect(r.aviso).toContain('180');
    // El total es el DEL PORTAL, que es la fuente de verdad.
    expect(r.totalPortal).toBe(246);
  });

  it('unos centavos de diferencia no son una discrepancia', async () => {
    const m = montar({ respuestas: { [CODIGO_A]: { agrega: true, costo: '$180.00' } } });
    const r = await m.adaptador.facturarVarios([{ codigo: CODIGO_A, montoEsperado: 180.004 }], 'ensayo');

    expect(r.codigos[0].discrepanciaDeMonto).toBeUndefined();
    expect(r.discrepancias).toEqual([]);
  });

  it('en `emitir` NO se emite con discrepancia — el CFDI no se deshace', async () => {
    const m = montar({
      respuestas: { [CODIGO_A]: { agrega: true, costo: '$246.00' } },
      uuid: 'AA11BB22-3333-4444-5555-666677778888',
    });
    const r = await m.adaptador.facturarVarios([{ codigo: CODIGO_A, montoEsperado: 180 }], 'emitir');

    expect(r.ok).toBe(false);
    expect(m.primera().emitido).toBe(false);
    expect(r.error).toMatch(/NO SE EMITIÓ/);
    expect(r.error).toMatch(/puede ser de otro ticket/);
    expect(r.cfdiUuid).toBeUndefined();
  });

  it('con la bandera explícita sí emite, porque la decisión la tomó una persona', async () => {
    const m = montar({
      respuestas: { [CODIGO_A]: { agrega: true, costo: '$246.00' } },
      uuid: 'AA11BB22-3333-4444-5555-666677778888',
      emitirAunConDiscrepancia: true,
    });
    const r = await m.adaptador.facturarVarios([{ codigo: CODIGO_A, montoEsperado: 180 }], 'emitir');

    expect(r.ok).toBe(true);
    expect(r.cfdiUuid).toBe('AA11BB22-3333-4444-5555-666677778888');
    expect(r.discrepancias).toHaveLength(1); // sigue reportada, no desaparece
  });

  it('un costo ilegible deja el total en null en vez de sumar cero', async () => {
    const m = montar({
      respuestas: {
        [CODIGO_A]: { agrega: true, costo: '180.00' },
        [CODIGO_B]: { agrega: true, costo: 'N/D' },
      },
    });
    const r = await m.adaptador.facturarVarios([{ codigo: CODIGO_A }, { codigo: CODIGO_B }], 'ensayo');

    expect(r.codigos[1]).toMatchObject({ estado: 'agregado', costoIlegible: true });
    expect(r.codigos[1].costoPortal).toBeUndefined();
    // Una suma incompleta que se ve completa es lo que el contralor cruza
    // contra su PDF y no cuadra.
    expect(r.totalPortal).toBeNull();
    expect(r.aviso).toMatch(/no se puede sumar/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('modo emitir', () => {
  it('aprieta una sola vez al final y devuelve el UUID del CFDI', async () => {
    const m = montar({ uuid: '  B0800A68-1F2E-4C3A-9D77-0A1B2C3D4E5F  ' });
    const r = await m.adaptador.facturarVarios([{ codigo: CODIGO_A }, { codigo: CODIGO_B }], 'emitir');

    expect(r.ok).toBe(true);
    expect(r.cfdiUuid).toBe('B0800A68-1F2E-4C3A-9D77-0A1B2C3D4E5F');
    expect(m.primera().clics.filter((s) => s === S.botonEmitir)).toHaveLength(1);
    expect(r.totalPortal).toBe(360);
  });

  it('sin UUID confirmado no dice que salió bien, avisa del CFDI y NO reintenta', async () => {
    const m = montar({ uuid: undefined });
    const r = await m.adaptador.facturarVarios([{ codigo: CODIGO_A }], 'emitir');

    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/PUEDE QUE EL CFDI YA EXISTA/);
    expect(m.abrirPagina).toHaveBeenCalledTimes(1);
    expect(m.primera().clics.filter((s) => s === S.botonEmitir)).toHaveLength(1);
  });

  it('si el botón de emitir revienta, dice que se apretó y que puede haber CFDI', async () => {
    const m = montar({ presentes: TODOS.filter((s) => s !== S.botonEmitir), sinPreVuelo: true });
    const r = await m.adaptador.facturarVarios([{ codigo: CODIGO_A }], 'emitir');

    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/SE APRETÓ EMITIR/);
    expect(r.error).toMatch(/PUEDE QUE EL CFDI YA EXISTA/);
    expect(m.abrirPagina).toHaveBeenCalledTimes(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('el UUID se SONDEA, no se lee una vez', () => {
  it('EL CASO QUE ROMPÍA: el contenedor viene pre-pintado VACÍO y la emisión salió bien', async () => {
    // Esto leía `.uuid` UNA vez, justo después del clic. Si el portal declara
    // `<span class="uuid"></span>` de entrada —cualquier plantilla lo hace—,
    // `leerTexto` devuelve `''`, `''` es falsy, y una emisión EXITOSA se
    // reportaba como "no se pudo confirmar el UUID · PUEDE QUE EL CFDI YA
    // EXISTA": una persona mandada a revisar a mano algo que salió bien, e
    // invitada a reintentar una emisión que YA OCURRIÓ.
    const m = montar({
      uuidPrepintado: true,
      uuidVueltas: 3, // el PAC tarda tres vueltas en contestar
      uuid: 'AA11BB22-3333-4444-5555-666677778888',
    });

    const r = await m.adaptador.facturarVarios([{ codigo: CODIGO_A }], 'emitir');

    expect(r.ok).toBe(true);
    expect(r.cfdiUuid).toBe('AA11BB22-3333-4444-5555-666677778888');
    expect(r.error).toBeUndefined();
    // Y se preguntó más de una vez: con una sola lectura esto sería 1.
    expect(m.primera().vecesQueLeyoUuid).toBe(4);
    // El botón se apretó UNA vez. Sondear no es reintentar.
    expect(m.primera().clics.filter((s) => s === S.botonEmitir)).toHaveLength(1);
  });

  it('lo mismo sin pre-pintar: el contenedor aparece tarde y el folio se confirma igual', async () => {
    const m = montar({ uuidVueltas: 2, uuid: 'B0800A68-1F2E-4C3A-9D77-0A1B2C3D4E5F' });
    const r = await m.adaptador.facturarVarios([{ codigo: CODIGO_A }], 'emitir');

    expect(r.ok).toBe(true);
    expect(r.cfdiUuid).toBe('B0800A68-1F2E-4C3A-9D77-0A1B2C3D4E5F');
  });

  it('distingue "NO APARECIÓ" de "apareció VACÍO" — se arreglan en sitios distintos', async () => {
    // No apareció → o el portal no llegó a su pantalla de resultado, o `.uuid`
    // ya no es el selector: se mira el mapeo.
    const ausente = montar({ uuid: undefined });
    const a = await ausente.adaptador.facturarVarios([{ codigo: CODIGO_A }], 'emitir');
    expect(a.ok).toBe(false);
    expect(a.error).toMatch(/no apareció/);
    expect(a.error).toMatch(/PUEDE QUE EL CFDI YA EXISTA/);

    // Apareció vacío → el contenedor está bien, el timbrado no volvió. Mandar a
    // revisar el mapeo aquí es perder el tiempo.
    const vacio = montar({ uuid: undefined, uuidPrepintado: true });
    const v = await vacio.adaptador.facturarVarios([{ codigo: CODIGO_A }], 'emitir');
    expect(v.ok).toBe(false);
    expect(v.error).toMatch(/siguió VACÍO/);
    expect(v.error).toMatch(/PUEDE QUE EL CFDI YA EXISTA/);

    // Y los dos textos son distintos: si fueran el mismo, la distinción no
    // existiría para quien lee el resultado.
    expect(a.error).not.toBe(v.error);
  });

  it('el sondeo tiene TECHO: no gira para siempre esperando un folio que no llega', async () => {
    // `esperaUuidMs / intervaloMs` = 6 / 1 → seis vueltas y para. Sin techo, un
    // portal que nunca pinta el folio se lleva la invocación entera y con ella el
    // resto del lote.
    const m = montar({ uuid: undefined, uuidPrepintado: true, esperaUuidMs: 6 });
    const r = await m.adaptador.facturarVarios([{ codigo: CODIGO_A }], 'emitir');

    expect(r.ok).toBe(false);
    expect(m.primera().vecesQueLeyoUuid).toBe(6);
  });

  it('un folio con espacios alrededor se recorta, igual que antes', async () => {
    const m = montar({ uuidPrepintado: true, uuidVueltas: 1, uuid: '  B0800A68-1F2E-4C3A-9D77-0A1B2C3D4E5F  ' });
    const r = await m.adaptador.facturarVarios([{ codigo: CODIGO_A }], 'emitir');
    expect(r.cfdiUuid).toBe('B0800A68-1F2E-4C3A-9D77-0A1B2C3D4E5F');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('pre-vuelo de selectores', () => {
  it('con el botón de emitir movido, el fallo sale AL LLEGAR A ÉL — después de llenar y agregar, nunca antes de emitir', async () => {
    // `botonEmitir` salió de esta lista (ver el comentario de `preVuelo` en
    // capufe.ts): revisarlo con el formulario en blanco abortaba SIEMPRE,
    // porque ese botón no existe hasta que hay filas en "CÓDIGOS AGREGADOS".
    // La comprobación se movió a `hayBotonDeEmitir`, que corre cuando el
    // botón SÍ debería estar — después de llenar el receptor y agregar los
    // códigos. Lo que esta prueba protege no es que no se escriba nada: es
    // que NUNCA se apriete emitir sin haber confirmado que el botón está.
    const m = montar({ presentes: TODOS.filter((s) => s !== S.botonEmitir) });
    const r = await m.adaptador.facturarVarios([{ codigo: CODIGO_A }], 'ensayo');

    expect(r.ok).toBe(false);
    expect(r.error).toContain(S.botonEmitir);
    // Sí llegó a llenar el receptor y a agregar el código...
    expect(m.primera().escritos.map((e) => e.sel)).toEqual([S.rfc, S.nombre, S.codigoPostal, S.correo, S.codigo]);
    // ...pero JAMÁS tocó el botón de emitir.
    expect(m.primera().clics).not.toContain(S.botonEmitir);
    expect(m.primera().emitido).toBe(false);
  });

  it('los reporta TODOS juntos, no uno por corrida', async () => {
    const m = montar({ presentes: [S.rfc, S.codigo] });
    const r = await m.adaptador.facturarVarios([{ codigo: CODIGO_A }], 'ensayo');

    expect(r.error).toContain(S.nombre);
    expect(r.error).toContain(S.correo);
    expect(r.error).toContain(S.botonValidar);
    expect(r.error).toContain('actualizar el mapeo');
  });

  it('sin `existe()` el fallo sale igual al escribir, con el campo que lo delató', async () => {
    const m = montar({ sinPreVuelo: true, presentes: TODOS.filter((s) => s !== S.correo) });
    const r = await m.adaptador.facturarVarios([{ codigo: CODIGO_A }], 'ensayo');

    expect(r.ok).toBe(false);
    expect(r.error).toContain('Correo electrónico');
    expect(r.error).toContain(S.correo);
    // Y devuelve hasta dónde llegó: la otra mitad del diagnóstico.
    expect(r.capturado).toEqual({ rfc: 'GMX0902279I1', nombre: RECEPTOR.nombre, codigoPostal: '37000' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('los datos fiscales de la flota', () => {
  it('un RFC que no pasa el dígito verificador no abre el navegador', async () => {
    const m = montar({ receptor: { ...RECEPTOR, rfc: 'GMX0902279I9' } });
    const r = await m.adaptador.facturarVarios([{ codigo: CODIGO_A }], 'emitir');

    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/d[ií]gito verificador/);
    expect(m.abrirPagina).not.toHaveBeenCalled();
  });

  it('reporta TODOS los datos malos de una vez', () => {
    const malos = revisarReceptor({
      rfc: 'NOPE', nombre: 'X', codigoPostal: '370', regimenFiscal: '6A1', usoCfdi: '3', correo: 'nada',
    });
    expect(malos).toHaveLength(6);
  });

  it('acepta un régimen que NO está en el catálogo recortado de la suscripción', () => {
    // `saas/fiscal.ts` lista cinco regímenes: los que usa Likida para facturar
    // SU suscripción. Una flota puede tener otro perfectamente legal, y
    // rechazarlo aquí sería inventar una regla que el SAT no tiene.
    expect(revisarReceptor({ ...RECEPTOR, regimenFiscal: '620' })).toEqual([]);
  });

  it('un correo inválido se atrapa antes de emitir un CFDI que no llega a nadie', () => {
    expect(revisarReceptor({ ...RECEPTOR, correo: 'facturas@transportes' })).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('facturar() — la interfaz de un solo ticket', () => {
  it('saca el código de los campos y corre la misma sesión', async () => {
    const m = montar();
    const r = await m.adaptador.facturar(campos(CODIGO_A), 'ensayo');

    expect(r.ok).toBe(true);
    expect(m.primera().filas.map((f) => f.codigo)).toEqual([CODIGO_A]);
    expect(m.primera().emitido).toBe(false);
  });

  it('coteja también con el monto del ticket cuando viene en los campos', async () => {
    const m = montar({ respuestas: { [CODIGO_A]: { agrega: true, costo: '$246.00' } } });
    const r = await m.adaptador.facturar(
      [...campos(CODIGO_A), { clave: 'monto', etiqueta: 'Total', valor: '180.00', requerido: false }],
      'ensayo',
    );

    expect(r.discrepancias).toHaveLength(1);
  });

  it('un requerido vacío se rechaza sin abrir el navegador', async () => {
    const m = montar();
    const r = await m.adaptador.facturar(
      [{ clave: 'codigo', etiqueta: 'código del ticket', valor: null, requerido: true }],
      'emitir',
    );

    expect(r.ok).toBe(false);
    expect(r.error).toContain('código del ticket');
    expect(m.abrirPagina).not.toHaveBeenCalled();
  });

  it('sin campo `codigo` lo dice, en vez de abrir el portal a ver qué pasa', async () => {
    const m = montar();
    const r = await m.adaptador.facturar(
      [{ clave: 'folio', etiqueta: 'Folio', valor: '999', requerido: false }],
      'emitir',
    );

    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/18 caracteres/);
    expect(m.abrirPagina).not.toHaveBeenCalled();
  });

  it('declara el mapeo que la base exige, con el botón de emitir', () => {
    const { adaptador } = montar();
    expect(adaptador.comercio).toBe('capufe');
    expect(adaptador.portal).toBe(URL_CAPUFE_SIN_REGISTRO);
    // La raíz `/Capufe/` es un LOGIN. La facturación sin registro es otra URL.
    expect(adaptador.portal).toMatch(/facturacionrapida$/);
    expect(adaptador.mapeoDeCampos()).toMatchObject({ campos: { codigo: S.codigo }, botonEmitir: S.botonEmitir });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('parsearCosto', () => {
  it('lee lo que el portal imprime en la columna Costo', () => {
    expect(parsearCosto('$180.00')).toBe(180);
    expect(parsearCosto('$ 1,240.50')).toBe(1240.5);
    expect(parsearCosto(' 95 ')).toBe(95);
    expect(parsearCosto('$0.00')).toBe(0);
    expect(parsearCosto('1.234,50')).toBe(1234.5);
  });

  it('devuelve null —nunca cero— cuando no entiende lo que leyó', () => {
    // Un cero se suma sin quejarse y deja un total que se ve bien y está mal.
    expect(parsearCosto('N/D')).toBeNull();
    expect(parsearCosto('')).toBeNull();
    expect(parsearCosto(null)).toBeNull();
    expect(parsearCosto('   ')).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('registro en el agente', () => {
  it('queda registrado bajo la clave de `comercios.ts` Y bajo la flota que lo pidió', async () => {
    const { adaptadorDe, portalesAutomatizados } = await import('../agente');
    expect(adaptadorDe('flota-1', 'capufe')).toBeNull(); // no se registra al importar el módulo

    const a = registrarCapufe('flota-1', { abrirPagina: async () => new PortalDoble(), receptor: RECEPTOR });

    expect(adaptadorDe('flota-1', 'capufe')).toBe(a);
    expect(portalesAutomatizados('flota-1')).toContain('capufe');
    // Y la flota de al lado no lo hereda. El adaptador lleva DENTRO los datos
    // fiscales del receptor: heredarlo es emitir con el RFC de otra empresa.
    expect(adaptadorDe('flota-2', 'capufe')).toBeNull();
    expect(portalesAutomatizados('flota-2')).toEqual([]);

    // La clave tiene que ser la de `comercios.ts`; con otra, `facturarConAgente`
    // no lo encuentra y el ticket se va por mensaje al encargado para siempre.
    const { COMERCIOS } = await import('../comercios');
    expect(COMERCIOS.some((x) => x.clave === 'capufe')).toBe(true);
  });

  it('sin tenantId no se puede registrar: lanza en vez de caer a un cajón compartido', () => {
    // Un cajón por default —cadena vacía, "desconocido"— sería el bug otra vez:
    // dos flotas leyéndose el adaptador la una a la otra.
    expect(() => registrarCapufe('', { abrirPagina: async () => new PortalDoble(), receptor: RECEPTOR }))
      .toThrow(/tenantId/);
    expect(() => registrarCapufe('   ', { abrirPagina: async () => new PortalDoble(), receptor: RECEPTOR }))
      .toThrow(/tenantId/);
  });
});

function campos(codigo: string): CampoListo[] {
  return [{ clave: 'codigo', etiqueta: 'código del ticket', valor: codigo, requerido: true }];
}
