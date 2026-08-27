import { describe, it, expect, vi } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// EL INVESTIGADOR (0217) — el contrato que lo define es la COMPUERTA LITERAL:
// un correo que el modelo devuelva y que no aparezca textualmente en las
// páginas descargadas (o en las notas) NO existe. Es la defensa de código
// contra el contacto inventado — el fallo que ya quemó un lead real (un
// correo de OTRA empresa pegado por error de scraping).
// ═══════════════════════════════════════════════════════════════════════════

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: () => ({}) }) }));
vi.mock('../interruptores', () => ({ estaApagado: async () => false }));
vi.mock('@/lib/llm/openrouter', () => ({ generateStructured: vi.fn() }));
vi.mock('./corridas', () => ({ registrarCorrida: vi.fn() }));

const { textoVisible, enlacesInstitucionales, correosVerificados, cosecharCorreosDeNotas } = await import('./investigador');

describe('correosVerificados — la compuerta literal contra el contacto inventado', () => {
  const paginas = [{ url: 'https://x.mx/contacto', texto: 'Escríbenos a VENTAS@x.mx o llama al 8112345678' }];

  it('deja pasar el correo que SÍ está en la página (sin importar mayúsculas) y anota la URL como fuente', () => {
    const r = correosVerificados(
      [{ correo: 'ventas@x.mx', contacto_nombre: null, puesto: null, fuente: 'https://x.mx/contacto' }],
      paginas, null,
    );
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ correo: 'ventas@x.mx', fuente: 'https://x.mx/contacto' });
  });

  it('DESCARTA el correo que el modelo "recuerde" y no esté en ninguna página ni en las notas', () => {
    const r = correosVerificados(
      [{ correo: 'director@x.mx', contacto_nombre: 'Juan', puesto: 'Director', fuente: 'https://x.mx' }],
      paginas, null,
    );
    expect(r).toHaveLength(0);
  });

  it('las notas del prospecto también son fuente literal válida', () => {
    const r = correosVerificados(
      [{ correo: 'gerencia@x.mx', contacto_nombre: null, puesto: null, fuente: 'lo que sea' }],
      paginas, 'Contacto de ANIQ: gerencia@x.mx (gerente)',
    );
    expect(r).toHaveLength(1);
    expect(r[0].fuente).toBe('notas del prospecto');
  });

  it('descarta formatos rotos y deduplica', () => {
    const r = correosVerificados(
      [
        { correo: 'no-es-correo', contacto_nombre: null, puesto: null, fuente: 'x' },
        { correo: 'ventas@x.mx', contacto_nombre: null, puesto: null, fuente: 'x' },
        { correo: 'VENTAS@X.MX', contacto_nombre: null, puesto: null, fuente: 'x' },
      ],
      paginas, null,
    );
    expect(r).toHaveLength(1);
  });
});

describe('cosecharCorreosDeNotas — la cosecha gratis que ya está pagada', () => {
  it('extrae y deduplica los correos del texto de las notas', () => {
    expect(cosecharCorreosDeNotas('Correo: a@b.mx; también A@B.MX y ventas@c.com.mx')).toEqual(['a@b.mx', 'ventas@c.com.mx']);
  });
  it('sin notas, lista vacía — no un invento', () => {
    expect(cosecharCorreosDeNotas(null)).toEqual([]);
  });
});

describe('textoVisible y enlacesInstitucionales — el rastreo mínimo', () => {
  it('quita scripts/estilos/etiquetas y colapsa espacios', () => {
    expect(textoVisible('<script>var x=1</script><p>Hola  <b>mundo</b></p><style>.a{}</style>'))
      .toBe('Hola mundo');
  });

  it('solo sigue enlaces del MISMO dominio que huelen a contacto/nosotros', () => {
    const html = `
      <a href="/contacto">Contacto</a>
      <a href="https://x.mx/nosotros">Nosotros</a>
      <a href="https://otro.com/contacto">Ajeno</a>
      <a href="/blog/post-1">Blog</a>`;
    const r = enlacesInstitucionales(html, new URL('https://x.mx'));
    expect(r).toEqual(['https://x.mx/contacto', 'https://x.mx/nosotros']);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA FABLE CICLO 5 — c5-4 (compuerta de dominio) y c5-11 (SSRF).
// ═══════════════════════════════════════════════════════════════════════════
const { separarPorDominio, esIpPrivada, MAX_CORREOS_EMPRESA } = await import('./investigador');

describe('c5-4 — la compuerta de dominio: correos de terceros JAMÁS entran a la lista de envío', () => {
  const correo = (c: string) => ({ correo: c, contacto_nombre: null, puesto: null, fuente: 'https://www.empresa.mx/contacto' });

  it('el webmaster de la agencia del pie NO es de la empresa — va a ajenos', () => {
    const { propios, ajenos } = separarPorDominio(
      [correo('ventas@empresa.mx'), correo('webmaster@agenciadigital.com')],
      'https://www.empresa.mx', 'contacto@empresa.mx',
    );
    expect(propios.map((c) => c.correo)).toEqual(['ventas@empresa.mx']);
    expect(ajenos.map((c) => c.correo)).toEqual(['webmaster@agenciadigital.com']);
  });

  it('el dominio del correo PRINCIPAL también permite (pymes con gmail)', () => {
    const { propios } = separarPorDominio(
      [correo('otro@gmail.com')],
      'https://www.empresa.mx', 'dueno@gmail.com',
    );
    expect(propios.map((c) => c.correo)).toEqual(['otro@gmail.com']);
  });

  it('sin sitio ni principal, TODO es ajeno — nada entra a ciegas', () => {
    const { propios, ajenos } = separarPorDominio([correo('x@y.mx')], null, null);
    expect(propios).toHaveLength(0);
    expect(ajenos).toHaveLength(1);
  });

  it('www. no estorba la coincidencia', () => {
    const { propios } = separarPorDominio([correo('a@empresa.com.mx')], 'https://www.empresa.com.mx/inicio', null);
    expect(propios).toHaveLength(1);
  });

  it('el tope por empresa existe y es finito (sitio hostil con cientos de correos)', () => {
    expect(MAX_CORREOS_EMPRESA).toBeGreaterThan(0);
    expect(MAX_CORREOS_EMPRESA).toBeLessThanOrEqual(30);
  });
});

describe('c5-11 — la frontera SSRF: IPs privadas jamás se visitan', () => {
  it('clasifica las privadas/loopback/link-local como privadas', () => {
    for (const ip of ['127.0.0.1', '10.0.0.5', '172.16.9.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '0.0.0.0', '::1', 'fd00::1', 'fe80::1']) {
      expect(esIpPrivada(ip), ip).toBe(true);
    }
  });
  it('las públicas pasan', () => {
    for (const ip of ['8.8.8.8', '104.18.32.7', '201.150.36.1', '2607:f8b0::1']) {
      expect(esIpPrivada(ip), ip).toBe(false);
    }
  });
  it('172.15 y 172.32 NO son privadas (el /12 es exacto)', () => {
    expect(esIpPrivada('172.15.0.1')).toBe(false);
    expect(esIpPrivada('172.32.0.1')).toBe(false);
  });
});
