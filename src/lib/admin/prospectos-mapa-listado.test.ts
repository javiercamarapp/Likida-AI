// ═══════════════════════════════════════════════════════════════════════════
// FE-16 — EL CEREBRO DEJA DE MANDARLE EL UNIVERSO AL NAVEGADOR.
//
// Tres cosas fija esta prueba, y las tres se rompen sin ruido:
//
//  1. La carga inicial NO lleva los textos largos. `notas`, el mensaje de
//     WhatsApp y el correo redactados son 15.3 MB de los 33 que bajaba el
//     mapa; si alguien los vuelve a poner en el `select` del listado, nada
//     falla — la pantalla se ve igual, solo tarda. Aquí falla.
//  2. El delta pide `updated_at > desde` y devuelve SOLO lo cambiado, con la
//     marca de agua para la siguiente vuelta.
//  3. Los textos se piden por id, aparte, y ahí sí vienen completos.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect, vi, beforeEach } from 'vitest';

const NOTA_LARGA = 'DENUE: Autotransporte foráneo de carga general · 51 a 100 personas · 3 anuncios en el censo';
const MENSAJE_WA = 'Hola Ramón, soy Javier de Likida — TEXTO-DEL-AGENTE-EXPERTO';

const FILAS = [
  {
    id: '11111111-1111-1111-1111-111111111111',
    empresa: 'Fletes del Norte', ciudad: 'Escobedo, Nuevo León', lat: 25.8, lng: -100.3,
    telefono: '8112345678', correo: 'dg@fletes.mx', contacto_nombre: 'Ramón Treviño',
    vacante: 'Auxiliar de liquidaciones', estado: 'contactado', fuente: 'censo',
    notas: NOTA_LARGA, scian: '484121',
    mensaje_wa: MENSAJE_WA, mensaje_correo_asunto: 'ASUNTO-IA', mensaje_correo: 'CUERPO-IA',
    mensajes_generados_en: '2026-08-20T10:00:00.000Z',
    updated_at: '2026-08-21T10:00:00.000Z',
    prospecto_toque: [{ creado_en: '2026-08-19T08:00:00.000Z' }],
    sitio_verificado: true, num_unidades: 40, similitud_icp_pct: 80, necesidad_pct: 75,
  },
  {
    id: '22222222-2222-2222-2222-222222222222',
    empresa: 'Transportes Sur', ciudad: 'Mérida, Yucatán', lat: 21, lng: -89.6,
    telefono: null, correo: null, contacto_nombre: null,
    vacante: null, estado: 'nuevo', fuente: 'denue',
    notas: null, scian: null,
    mensaje_wa: null, mensaje_correo_asunto: null, mensaje_correo: null,
    mensajes_generados_en: null,
    updated_at: '2026-08-22T09:00:00.000Z',
    prospecto_toque: null,
    sitio_verificado: false, num_unidades: null, similitud_icp_pct: 10, necesidad_pct: 0,
  },
  {
    // Duplicado: la marca la escribe el deduplicador dentro de `notas` (0139).
    // No sale en el mapa, pero SÍ tiene que mover la marca de agua — si no, el
    // siguiente latido volvería a pedirlo, y el siguiente, para siempre.
    id: '33333333-3333-3333-3333-333333333333',
    empresa: 'Fletes del Norte SA', ciudad: null, lat: null, lng: null,
    telefono: null, correo: null, contacto_nombre: null,
    vacante: null, estado: 'nuevo', fuente: 'denue',
    notas: 'DUPLICADO: de 1111', scian: null,
    mensaje_wa: null, mensaje_correo_asunto: null, mensaje_correo: null,
    mensajes_generados_en: null,
    updated_at: '2026-08-22T11:00:00.000Z',
    prospecto_toque: null,
    sitio_verificado: false, num_unidades: null, similitud_icp_pct: 0, necesidad_pct: 0,
  },
];

/** Lo que la prueba espía del lado de PostgREST. */
const espia: {
  columnas: string[];
  gt: Array<{ col: string; val: string }>;
  conteos: number;
  ids: string[][];
} = { columnas: [], gt: [], conteos: 0, ids: [] };

/** Un constructor de consulta de mentiras, con las tres formas que usa el
 *  módulo: paginada (`.range`), de conteo (`head: true`) y por ids (`.in`). */
function consulta() {
  let filtroGt: { col: string; val: string } | null = null;
  let filtroIlike: string | null = null;
  let filtroIds: string[] | null = null;
  let head = false;
  let pedirConteo = false;

  const vigentes = () => {
    let f = FILAS;
    if (filtroGt) f = f.filter((x) => x.updated_at > filtroGt!.val);
    if (filtroIlike) f = f.filter((x) => (x.notas ?? '').includes('DUPLICADO:'));
    if (filtroIds) f = f.filter((x) => filtroIds!.includes(x.id));
    return f;
  };

  const b = {
    select(cols: string, opts?: { count?: string; head?: boolean }) {
      espia.columnas.push(cols);
      head = opts?.head === true;
      pedirConteo = opts?.count === 'exact';
      return b;
    },
    gt(col: string, val: string) { filtroGt = { col, val }; espia.gt.push({ col, val }); return b; },
    ilike(_col: string, patron: string) { filtroIlike = patron; return b; },
    in(_col: string, ids: string[]) { filtroIds = ids; espia.ids.push(ids); return b; },
    order() { return b; },
    range(d: number, h: number) {
      const f = vigentes();
      return Promise.resolve({
        data: f.slice(d, h + 1), error: null,
        count: pedirConteo ? f.length : undefined,
      });
    },
    // El camino de conteo: se espera al constructor mismo, sin `.range`.
    then(ok: (v: unknown) => unknown, mal?: (e: unknown) => unknown) {
      const f = vigentes();
      if (head) espia.conteos++;
      return Promise.resolve({ data: head ? null : f, error: null, count: f.length }).then(ok, mal);
    },
  };
  return b;
}

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: () => consulta() }) }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { getDatosMapa, getTextosProspectos, desempacar } = await import('./prospectos-mapa');

beforeEach(() => { espia.columnas = []; espia.gt = []; espia.conteos = 0; espia.ids = []; });

describe('la carga inicial es LIGERA — los textos largos no viajan', () => {
  it('el select del listado no pide los mensajes redactados (7.5 MB) pero sí `notas` (la usan los scores)', async () => {
    await getDatosMapa();
    const cols = espia.columnas[0];
    expect(cols).not.toContain('mensaje_wa');
    expect(cols).not.toContain('mensaje_correo');
    // `notas` se lee para giro/tamaño/urgencia/completitud y el filtro de
    // duplicados — lo que cambia es que se queda en el servidor.
    expect(cols).toContain('notas');
    expect(cols).toContain('updated_at');
    expect(cols).toContain('mensajes_generados_en');
  });

  it('lo que se serializa al cliente NO contiene ni una nota ni un mensaje', async () => {
    const datos = await getDatosMapa();
    const payload = JSON.stringify(datos);
    expect(payload).not.toContain(NOTA_LARGA);
    expect(payload).not.toContain(MENSAJE_WA);
    expect(payload).not.toContain('CUERPO-IA');
    // …y aun así el mapa sabe todo lo que pinta y filtra.
    const p = desempacar(datos.filas[0]);
    expect(p.empresa).toBe('Fletes del Norte');
    expect(p.entidad).toBe('Nuevo León');
    expect(p.giro).toBe('transportista');
    expect(p.tamano).toBe('51-100');
    expect(p.ultimoToque).toBe('2026-08-19T08:00:00.000Z');
    // La MARCA del mensaje sí viaja (el filtro "solo con mensaje IA" y el
    // sello de la tarjeta viven de ella); el TEXTO no.
    expect(p.mensajesGeneradosEn).toBe('2026-08-20T10:00:00.000Z');
  });

  it('el duplicado no sale en el mapa, pero sí mueve la marca de agua', async () => {
    const datos = await getDatosMapa();
    expect(datos.filas.map((f) => f[0])).toEqual([FILAS[0].id, FILAS[1].id]);
    expect(datos.delta).toBe(false);
    expect(datos.total).toBe(2);
    expect(datos.marca).toBe('2026-08-22T11:00:00.000Z');
  });

  it('la carga completa NO gasta un viaje extra en contar lo que acaba de leer', async () => {
    await getDatosMapa();
    expect(espia.conteos).toBe(0);
  });
});

describe('el refresco es un DELTA — solo lo que cambió desde la marca', () => {
  it('pregunta por updated_at > desde y devuelve únicamente eso', async () => {
    const datos = await getDatosMapa({ desde: '2026-08-21T23:00:00.000Z' });
    expect(espia.gt).toEqual([{ col: 'updated_at', val: '2026-08-21T23:00:00.000Z' }]);
    expect(datos.delta).toBe(true);
    // La fila del 21 no cambió: no viaja. La del 22 sí; el duplicado del 22
    // tampoco sale del mapa pero empuja la marca.
    expect(datos.filas.map((f) => f[0])).toEqual([FILAS[1].id]);
    expect(datos.marca).toBe('2026-08-22T11:00:00.000Z');
  });

  it('una cartera en reposo contesta CERO filas — no el universo', async () => {
    const datos = await getDatosMapa({ desde: '2026-08-23T00:00:00.000Z' });
    expect(datos.filas).toEqual([]);
    // Sin filas no hay marca nueva: el cliente conserva la que ya tenía.
    expect(datos.marca).toBeNull();
    expect(JSON.stringify(datos).length).toBeLessThan(200);
  });

  it('el delta trae el conteo del servidor — es lo único que delata una BAJA', async () => {
    const datos = await getDatosMapa({ desde: '2026-08-22T00:00:00.000Z' });
    // total = todo (3) menos los duplicados (1). Dos preguntas de cabecera,
    // ninguna fila viajando.
    expect(datos.total).toBe(2);
    expect(espia.conteos).toBe(2);
  });

  it('una marca vacía NO es una marca: se trata como carga completa', async () => {
    const datos = await getDatosMapa({ desde: '' });
    expect(espia.gt).toEqual([]);
    expect(datos.delta).toBe(false);
    expect(datos.filas).toHaveLength(2);
  });
});

describe('los textos largos se piden por id', () => {
  it('ahí sí vienen completos — y solo de los prospectos pedidos', async () => {
    const t = await getTextosProspectos([FILAS[0].id]);
    expect(espia.ids).toEqual([[FILAS[0].id]]);
    expect(t).toEqual([{
      id: FILAS[0].id,
      notas: NOTA_LARGA,
      mensajeWaIa: MENSAJE_WA,
      correoAsuntoIa: 'ASUNTO-IA',
      correoCuerpoIa: 'CUERPO-IA',
    }]);
  });

  it('sin ids no se toca la red', async () => {
    expect(await getTextosProspectos([])).toEqual([]);
    expect(espia.ids).toEqual([]);
  });
});
