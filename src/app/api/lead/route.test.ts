import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// EL LEAD DE /getdemo — lo que se fija:
//  · CORS cerrado: solo likida.ai recibe la cabecera. Este endpoint ESCRIBE.
//  · Un lead confirmado devuelve `accepted: true`; una base caída devuelve
//    503 explícito para que la landing muestre reintento/fallback y no invente
//    una conversión.
//  · `unidades`, `empleados` y `urgencia` son dominios cerrados y se filtran
//    AQUÍ: un valor fuera de dominio no puede tirar el insert entero y
//    llevarse el prospecto.
//  · El canal se deduce de la atribución, y un click id manda sobre el utm_*
//    porque lo pega la plataforma, no quien armó la URL.
//  · Deduplicar solo AGREGA: jamás borra el teléfono del censo ni repinta el
//    estado que el vendedor ya movió.
// ═══════════════════════════════════════════════════════════════════════════

const llamadas: Array<{ op: string; payload: Record<string, unknown> }> = [];
const respuestas: Array<{ data: unknown; error: { message: string } | null }> = [];

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => {
      const b: Record<string, unknown> = {};
      Object.assign(b, {
        select: () => b,
        eq: () => b,
        limit: () => b,
        update: (p: Record<string, unknown>) => { llamadas.push({ op: 'update', payload: p }); return b; },
        insert: (p: Record<string, unknown>) => { llamadas.push({ op: 'insert', payload: p }); return b; },
        then: (res: (x: unknown) => unknown, rej: (e: unknown) => unknown) =>
          Promise.resolve().then(() => respuestas.shift() ?? { data: [], error: null }).then(res, rej),
      });
      return b;
    },
  }),
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
// rateLimit REAL en miniatura (contador por llave), no un "sí" fijo: la
// llave natural del doble clic (B3) se prueba contra él.
const contadores = new Map<string, number>();
vi.mock('@/lib/ratelimit', () => ({
  rateLimit: async (key: string, limit: number) => {
    const n = (contadores.get(key) ?? 0) + 1;
    contadores.set(key, n);
    return n <= limit;
  },
  bodyExcede: () => false,
  clientIp: () => '1.2.3.4',
}));

const { POST, OPTIONS } = await import('./route');

const LANDING = 'https://likida.ai';

function postear(cuerpo: unknown, origen: string | null = LANDING) {
  return POST(new Request('https://app.likida.ai/api/lead', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(origen ? { origin: origen } : {}) },
    body: typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo),
  }));
}

const LEAD = {
  empresa: 'Transportes GAL', nombre: 'Alejandro', apellido: 'Vargas',
  correo: 'a@gal.mx', whatsapp: '8112345678',
  unidades: '101-250', empleados: '4-10', urgencia: 'inmediata',
};

/** Cola: primero la lectura de duplicados, luego la escritura. */
function nuevoLead() { respuestas.push({ data: [], error: null }, { data: null, error: null }); }

beforeEach(() => { llamadas.length = 0; respuestas.length = 0; contadores.clear(); });

describe('CORS: la lista de orígenes es cerrada', () => {
  it('likida.ai sí recibe la cabecera', async () => {
    nuevoLead();
    expect((await postear(LEAD)).headers.get('Access-Control-Allow-Origin')).toBe(LANDING);
  });

  it('un origen cualquiera NO la recibe: escribir en prospecto no es para todos', async () => {
    nuevoLead();
    const r = await postear(LEAD, 'https://sitio-ajeno.example');
    expect(r.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('el preflight contesta 204', async () => {
    const r = await OPTIONS(new Request('https://app.likida.ai/api/lead', {
      method: 'OPTIONS', headers: { origin: LANDING },
    }));
    expect(r.status).toBe(204);
  });
});

describe('el lead se guarda con lo que califica', () => {
  it('entra con unidades, urgencia y fuente landing', async () => {
    nuevoLead();
    await postear(LEAD);
    expect(llamadas[0].op).toBe('insert');
    expect(llamadas[0].payload).toMatchObject({
      empresa: 'Transportes GAL',
      contacto_nombre: 'Alejandro Vargas',
      telefono: '8112345678',
      unidades: '101-250',
      empleados: '4-10',
      urgencia: 'inmediata',
      fuente: 'landing',
      estado: 'nuevo',
    });
  });

  it('la ETIQUETA traducida no pasa: solo el código estable', async () => {
    // "5 a 30 unidades" / "5 to 30 trucks" son la MISMA respuesta escrita
    // distinto según el idioma. Guardar la etiqueta parte el dato en dos.
    nuevoLead();
    await postear({ ...LEAD, unidades: '5 a 30 unidades' });
    expect(llamadas[0].payload.unidades).toBeNull();
  });

  it('un empleados inventado se cae solo y NO tira el lead (mismo criterio que unidades)', async () => {
    nuevoLead();
    await postear({ ...LEAD, empleados: '1000+' });
    expect(llamadas[0].payload.empleados).toBeNull();
    expect(llamadas[0].payload.empresa).toBe('Transportes GAL');
  });

  it('una urgencia inventada se cae sola y NO tira el lead', async () => {
    nuevoLead();
    await postear({ ...LEAD, urgencia: 'urgentisimo' });
    expect(llamadas[0].payload.urgencia).toBeNull();
    expect(llamadas[0].payload.empresa).toBe('Transportes GAL');
  });
});

describe('de dónde vino: el canal se deduce, el detalle se guarda', () => {
  it('un fbclid es ads-meta', async () => {
    nuevoLead();
    await postear({ ...LEAD, atribucion: { fbclid: 'abc123', utm_campaign: 'flotas-mx' } });
    expect(llamadas[0].payload.fuente).toBe('ads-meta');
    expect(llamadas[0].payload.atribucion).toEqual({ fbclid: 'abc123', utm_campaign: 'flotas-mx' });
  });

  it('un gclid es ads-google', async () => {
    nuevoLead();
    await postear({ ...LEAD, atribucion: { gclid: 'xyz' } });
    expect(llamadas[0].payload.fuente).toBe('ads-google');
  });

  it('el click id MANDA sobre el utm_source, que cualquiera escribe a mano', async () => {
    nuevoLead();
    await postear({ ...LEAD, atribucion: { gclid: 'xyz', utm_source: 'facebook' } });
    expect(llamadas[0].payload.fuente).toBe('ads-google');
  });

  it('utm sin click id es "campana", no "ads": decir ads inventaría un gasto', async () => {
    nuevoLead();
    await postear({ ...LEAD, atribucion: { utm_source: 'boletin', utm_medium: 'email' } });
    expect(llamadas[0].payload.fuente).toBe('campana');
  });

  it('las claves desconocidas se tiran: no es un basurero', async () => {
    nuevoLead();
    await postear({ ...LEAD, atribucion: { utm_source: 'meta', password: 'x', ['a'.repeat(50)]: 'y' } });
    expect(llamadas[0].payload.atribucion).toEqual({ utm_source: 'meta' });
  });

  it('sin atribución no se inventa nada', async () => {
    nuevoLead();
    await postear(LEAD);
    expect(llamadas[0].payload.atribucion).toBeNull();
    expect(llamadas[0].payload.fuente).toBe('landing');
  });
});

describe('deduplicar sin destruir', () => {
  it('un DOBLE CLIC (dos POST seguidos, ambos leen vacío) escribe UNA fila, y los dos reciben 200 (B3)', async () => {
    // Sin unique en `prospecto`, la lectura previa no protege de la carrera:
    // los dos leen `[]`. La llave natural en el rateLimit sí.
    nuevoLead(); nuevoLead();
    const [a, b] = await Promise.all([postear(LEAD), postear(LEAD)]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(llamadas.filter((l) => l.op === 'insert')).toHaveLength(1);
  });

  it('la llave del doble clic es el correo (o la empresa, sin correo): otra empresa no se bloquea', async () => {
    nuevoLead(); nuevoLead();
    await postear(LEAD);
    await postear({ ...LEAD, empresa: 'Fletes del Norte', correo: 'x@norte.mx' });
    expect(llamadas.filter((l) => l.op === 'insert')).toHaveLength(2);
  });

  it('un correo conocido ACTUALIZA, no inserta un segundo prospecto', async () => {
    respuestas.push({ data: [{ id: 'p-1', estado: 'negociacion' }], error: null }, { data: null, error: null });
    await postear(LEAD);
    expect(llamadas).toHaveLength(1);
    expect(llamadas[0].op).toBe('update');
  });

  it('no toca `estado` ni `fuente`: eso borraría el avance y el origen real', async () => {
    respuestas.push({ data: [{ id: 'p-1', estado: 'negociacion' }], error: null }, { data: null, error: null });
    await postear({ ...LEAD, atribucion: { fbclid: 'z' } });
    expect(llamadas[0].payload).not.toHaveProperty('estado');
    expect(llamadas[0].payload).not.toHaveProperty('fuente');
  });

  it('un lead SIN whatsapp no borra el teléfono que el censo ya traía', async () => {
    respuestas.push({ data: [{ id: 'p-1', estado: 'nuevo' }], error: null }, { data: null, error: null });
    await postear({ ...LEAD, whatsapp: '', unidades: '' });
    expect(llamadas[0].payload).not.toHaveProperty('telefono');
    expect(llamadas[0].payload).not.toHaveProperty('unidades');
  });
});

describe('la red de seguridad de la 0137 (y la 0275)', () => {
  it('con las CUATRO columnas ausentes, el lead se salva y lo perdido va a notas', async () => {
    respuestas.push(
      { data: [], error: null },
      { data: null, error: { message: 'column "unidades" of relation "prospecto" does not exist' } },
      { data: null, error: { message: 'column "empleados" of relation "prospecto" does not exist' } },
      { data: null, error: { message: 'column "urgencia" of relation "prospecto" does not exist' } },
      { data: null, error: { message: 'column "atribucion" of relation "prospecto" does not exist' } },
      { data: null, error: null },
    );
    const r = await postear({ ...LEAD, atribucion: { fbclid: 'abc' } });
    expect(r.status).toBe(200);
    const ultima = llamadas[llamadas.length - 1].payload;
    expect(ultima).not.toHaveProperty('unidades');
    expect(ultima).not.toHaveProperty('empleados');
    expect(ultima).not.toHaveProperty('urgencia');
    expect(ultima).not.toHaveProperty('atribucion');
    expect(String(ultima.notas)).toContain('101-250');
    expect(String(ultima.notas)).toContain('4-10');
    expect(String(ultima.notas)).toContain('inmediata');
    // El canal NO se pierde: vive en `fuente`, que existe desde la 0105.
    expect(ultima.fuente).toBe('ads-meta');
  });

  it('reconoce la redacción de PostgREST, que es la que sale en un INSERT real', async () => {
    // Esta prueba existe porque en producción se perdió un lead: la ruta solo
    // sabía el texto de Postgres («column prospecto.x does not exist»), y el
    // INSERT lo contesta PostgREST con otra redacción. Es el mensaje LITERAL
    // que devolvió la base el 18-ago-2026.
    respuestas.push(
      { data: [], error: null },
      { data: null, error: { message: "Could not find the 'urgencia' column of 'prospecto' in the schema cache" } },
      { data: null, error: null },
    );
    const r = await postear({ ...LEAD, unidades: '' });
    expect(r.status).toBe(200);
    expect(llamadas).toHaveLength(2);
    expect(llamadas[1].payload).not.toHaveProperty('urgencia');
    expect(String(llamadas[1].payload.notas)).toContain('inmediata');
  });

  it('si lo que falta NO es de la 0137, GRITA: la tabla no es la que se cree', async () => {
    respuestas.push(
      { data: [], error: null },
      { data: null, error: { message: 'column "empresa" of relation "prospecto" does not exist' } },
    );
    const r = await postear(LEAD);
    expect(r.status).toBe(503);
    expect(llamadas).toHaveLength(1); // …pero no se reintentó una fila coja
  });
});

describe('el lead nunca falla en silencio', () => {
  it('si la base falla, contesta 503 y obliga a mostrar reintento/fallback', async () => {
    respuestas.push({ data: null, error: { message: 'db down' } });
    const r = await postear(LEAD);
    expect(r.status).toBe(503);
    expect(await r.json()).toMatchObject({ ok: false, accepted: false, retryable: true });
  });

  it('sin empresa es un payload inválido y no se escribe nada', async () => {
    const r = await postear({ ...LEAD, empresa: '   ' });
    expect(r.status).toBe(400);
    expect(llamadas).toHaveLength(0);
  });

  it('un JSON roto sí es 400: eso es el formulario mal armado', async () => {
    expect((await postear('{roto')).status).toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA PROD (22-ago-2026) · SEG-2 — un formulario público no reescribe
// un prospecto.
//
// Este endpoint no tiene sesión: bastaba acertarle al correo de un prospecto
// (o al nombre de su empresa) para cambiarle `telefono`, `empresa`,
// `contacto_nombre`, `unidades`, `urgencia` y `atribucion`. El daño no es
// "spam en el CRM": el teléfono es AL QUE LLAMA EL VENDEDOR, y cambiárselo a
// un prospecto en negociación es desviar la llamada.
//
// La regla: un lead entrante solo AGREGA. Sobre un hueco, rellena; sobre un
// dato distinto que ya existía, NO se aplica — se anota en `notas`, fechado y
// marcado como sin verificar, y una persona decide.
// ═══════════════════════════════════════════════════════════════════════════
describe('SEG-2 — el lead público solo rellena huecos', () => {
  /** Un prospecto que YA tiene todo, como el que viene del censo o el que un
   *  vendedor ya trabajó. */
  const YA_TIENE = {
    id: 'p-1', estado: 'negociacion', empresa: 'Transportes GAL',
    contacto_nombre: 'Alejandro Vargas', correo: 'a@gal.mx',
    telefono: '9991112233', unidades: '11-50', urgencia: 'explorando',
    atribucion: { utm_source: 'censo' }, notas: 'Habló Javier el martes: pide propuesta.',
  };

  it('NO le cambia el teléfono al prospecto en negociación', async () => {
    respuestas.push({ data: [YA_TIENE], error: null }, { data: null, error: null });
    await postear({ ...LEAD, whatsapp: '5500000000' });

    expect(llamadas[0].op).toBe('update');
    expect(llamadas[0].payload).not.toHaveProperty('telefono');
  });

  it('tampoco la empresa, el contacto, las unidades, los empleados ni la urgencia', async () => {
    respuestas.push({ data: [{ ...YA_TIENE, empleados: '11-30' }], error: null }, { data: null, error: null });
    await postear({ ...LEAD, empresa: 'Otra Cosa SA', nombre: 'Quien', apellido: 'Sea', unidades: '500+', empleados: '30+', urgencia: 'inmediata' });

    const p = llamadas[0].payload;
    for (const campo of ['empresa', 'contacto_nombre', 'unidades', 'empleados', 'urgencia']) {
      expect(p, `pisó ${campo}`).not.toHaveProperty(campo);
    }
  });

  it('lo que llegó distinto queda ANOTADO, con fecha y marcado sin verificar', async () => {
    respuestas.push({ data: [YA_TIENE], error: null }, { data: null, error: null });
    await postear({ ...LEAD, whatsapp: '5500000000', empresa: 'Otra Cosa SA' });

    const notas = String(llamadas[0].payload.notas);
    expect(notas).toContain('sin verificar');
    expect(notas).toContain('telefono=5500000000');
    expect(notas).toContain('empresa=Otra Cosa SA');
    // Y la nota del vendedor sigue completa, debajo.
    expect(notas).toContain('Habló Javier el martes');
  });

  it('un HUECO sí se rellena: el lead agrega información, ese es su trabajo', async () => {
    respuestas.push(
      // Con el resto IGUAL a lo que manda el formulario: lo único que cambia
      // aquí son los dos huecos.
      { data: [{ ...YA_TIENE, telefono: null, unidades: '', urgencia: 'inmediata' }], error: null },
      { data: null, error: null },
    );
    await postear(LEAD);

    expect(llamadas[0].payload).toMatchObject({ telefono: '8112345678', unidades: '101-250' });
    // Nada distinto que anotar: la nota del vendedor no se toca.
    expect(llamadas[0].payload).not.toHaveProperty('notas');
  });

  it('el mismo dato repetido no ensucia las notas (volver a mandar el formulario)', async () => {
    respuestas.push(
      { data: [{ ...YA_TIENE, telefono: '8112345678', unidades: '101-250', urgencia: 'inmediata', empresa: 'Transportes GAL', contacto_nombre: 'Alejandro Vargas' }], error: null },
      { data: null, error: null },
    );
    await postear(LEAD);
    expect(llamadas[0].payload).not.toHaveProperty('notas');
  });

  it('`notas` tiene techo: un endpoint público no hace crecer una fila sin fin', async () => {
    const { notaConLoNoAplicado } = await import('./mezcla');
    const larga = notaConLoNoAplicado('x'.repeat(50_000), ['telefono=5500000000']);
    expect(larga.length).toBeLessThanOrEqual(4_000);
    // Lo NUEVO es lo que se conserva: la línea de hoy va arriba.
    expect(larga.startsWith('[')).toBe(true);
  });
});
