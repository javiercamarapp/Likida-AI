import { describe, it, expect } from 'vitest';
import { correrPrevuelo, chequeosDe, renderizarReporte, entradaDeRegistro, sanearHtml, type PaginaVerificable } from './verificacion_corrida';
import { huellaDeGuion } from './verificacion';
import type { GuionPortal } from '../facturacion/adaptadores/guion';

const G: GuionPortal = {
  comercio: 'prueba', portal: 'https://portal.example/', verificado: null,
  campos: { numeroTicket: { selector: ['#t'] }, monto: { selector: '#m' } },
  receptor: { rfc: { selector: '#rfc' } },
  buscar: { boton: '#buscar', que: 'el botón Buscar', esperar: '.res' },
  botonEmitir: ['#emitir'], uuid: '.uuid', error: '.err', xml: { boton: ['#xml'] },
};
const AHORA = () => new Date('2026-10-02T15:00:00Z');

function pagina(presentes: string[], extra: { falla?: boolean } = {}): PaginaVerificable & { visitas: string[] } {
  const visitas: string[] = [];
  return {
    visitas,
    async abrir(u) { visitas.push(u); if (extra.falla) throw new Error('net::ERR_NAME_NOT_RESOLVED'); },
    async existe(s) { return presentes.includes(s); },
    async inventario() { return { url: 'x', titulo: 't', campos: [], botones: [], captcha: [], texto: '' }; },
    async captura() { return '/tmp/captura.jpg'; },
    async titulo() { return 'Portal'; },
    urlActual() { return 'https://portal.example/'; },
    async html() { return '<html/>'; },
  };
}
const TODOS_LOS_DEBE = ['#rfc', '#t', '#m', '#buscar', '#emitir'];

describe('correrPrevuelo', () => {
  it('graduable: todos los selectores que DEBEN estar resuelven y no hay CAPTCHA; UUID/error/XML no cuentan (solo aparecen al emitir)', async () => {
    const p = pagina(TODOS_LOS_DEBE);
    const r = await correrPrevuelo(G, p, AHORA);
    expect(r.veredicto).toBe('graduable');
    expect(r.sinResolver).toEqual([]);
    expect(r.resueltos).toContain('campo del ticket · monto');
    expect(p.visitas).toEqual(['https://portal.example/']); // UNA visita
  });
  it('un selector que debe estar y no está: no graduar, y dice cuál', async () => {
    const r = await correrPrevuelo(G, pagina(['#rfc', '#t', '#buscar', '#emitir']), AHORA);
    expect(r.veredicto).toBe('no_graduar_selectores');
    expect(r.sinResolver).toEqual(['campo del ticket · monto']);
  });
  it('CAPTCHA a la vista: no graduar aunque todo lo demás resuelva (modo asistido)', async () => {
    const r = await correrPrevuelo(G, pagina([...TODOS_LOS_DEBE, '.g-recaptcha']), AHORA);
    expect(r.veredicto).toBe('no_graduar_captcha');
    expect(r.captcha).toContain('.g-recaptcha');
  });
  it('el portal no abre: no_abrio, y el reporte dice que NO se marca nada', async () => {
    const r = await correrPrevuelo(G, pagina([], { falla: true }), AHORA);
    expect(r.veredicto).toBe('no_abrio');
    expect(renderizarReporte(r)).toContain('NO se marca nada como verificado');
  });
  it('el reporte es determinista y lleva el veredicto', async () => {
    const r = await correrPrevuelo(G, pagina(TODOS_LOS_DEBE), AHORA);
    expect(renderizarReporte(r)).toBe(renderizarReporte(r));
    expect(renderizarReporte(r)).toContain('VEREDICTO graduable');
  });
});

describe('chequeosDe', () => {
  it('lo que solo aparece al emitir NO es obligatorio con el formulario en blanco', () => {
    const c = chequeosDe(G);
    for (const q of ['contenedor del UUID', 'cuadro de error', 'botón de bajar el XML', 'resultado de la búsqueda']) expect(c.find((x) => x.que === q)?.espera).toBe('no-todavia');
    expect(c.find((x) => x.que === 'botón de emitir')?.espera).toBe('debe');
  });
});

describe('entradaDeRegistro', () => {
  it('de una corrida graduable sale la entrada con la huella de la tabla medida y el sha256 del reporte', async () => {
    const r = await correrPrevuelo(G, pagina(TODOS_LOS_DEBE), AHORA);
    const texto = renderizarReporte(r);
    const e = entradaDeRegistro({ guion: G, resultado: r, confirmadoPor: 'Javier', reporteRel: 'x/reporte.txt', reporteTexto: texto });
    expect(e).toMatchObject({ fecha: '2026-10-02', nivel: 'prevuelo', huellaGuion: huellaDeGuion(G), confirmadoPor: 'Javier' });
    expect(e.evidencia.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
  it('de una corrida NO graduable lanza: no se gradúa a la fuerza', async () => {
    const r = await correrPrevuelo(G, pagina(['#rfc']), AHORA);
    expect(() => entradaDeRegistro({ guion: G, resultado: r, confirmadoPor: 'Javier', reporteRel: 'x', reporteTexto: 'x' })).toThrow(/no es graduable/);
  });
});

describe('sanearHtml: lo que llega a git no trae datos ni código', () => {
  const sucio = `<!-- token abc --><html><head><meta name="csrf-token" content="SECRETO"><script>var t="SECRETO"</script></head>
<body onload="x()"><form><input name="rfc" value="ABC010101AB1"><input type="hidden" name="__VIEWSTATE" value="MUCHOSECRETO">
<input name="correo" value="persona@empresa.com" autocomplete="on"><textarea>nota privada</textarea>
<iframe src="https://www.google.com/recaptcha/api2/anchor"></iframe><p>Escríbenos a ventas@portal.com.mx UUID fe4e71b0-8959-4fb9-8091-f5ac4fb0fef8</p></form></body></html>`;
  it('quita scripts, iframes, comentarios, eventos, valores, tokens, correos, RFC y folios', () => {
    const s = sanearHtml(sucio);
    for (const malo of ['SECRETO', 'MUCHOSECRETO', 'persona@empresa.com', 'ventas@portal.com.mx', 'ABC010101AB1', 'fe4e71b0', '<script', '<iframe', 'onload', 'nota privada', '<!--']) {
      expect(s, malo).not.toContain(malo);
    }
    expect(s).toContain('name="rfc"');
    expect(s).toContain('<form>');
  });
  it('un fragmento anidado no reconstruye la etiqueta tras el saneo (<scr<script></script>ipt>)', () => {
    const s = sanearHtml('<p>a</p><scr<script></script>ipt>alert(1)</scr<script></script>ipt><div on<script></script>click="x()">b</div><!<!-- -->-- c -->');
    expect(s).not.toMatch(/<script/i);
    expect(s).not.toMatch(/<!--/);
    expect(s).not.toMatch(/\son[a-z]+\s*=/i);
  });
  it('un < o > suelto queda escapado como texto y un script sin cierre se descarta completo', () => {
    const s = sanearHtml('<p>1 < 2 > 0</p><script>var x="</p>');
    expect(s).toBe('<p>1 &lt; 2 &gt; 0</p>');
  });
});
