import { describe, it, expect, vi } from 'vitest';
import {
  pantallaDeLogin, clasificarFallo, recortarEstadoAlPortal, unirEstados,
} from './vinculo_senales';
import type { InventarioPagina } from './adaptadores/playwright_base';

vi.mock('@/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ═══════════════════════════════════════════════════════════════════════════
// LAS SEÑALES DEL VÍNCULO. Lo que se fija aquí:
//
//   · qué cuenta como "el portal me sacó" y qué no (un password OCULTO no
//     cuenta: Megasur trae uno en su formulario y contarlo diría «login» en
//     pantallas donde no lo hay);
//   · que «se venció la sesión» y «nunca la vinculaste» se separen por si el
//     lote ARRANCÓ con sesión — son dos mensajes distintos para la persona;
//   · que «el portal cambió» NO se confunda con ninguna de las dos: ahí no
//     hay nada que re-vincular y el arreglo es de Likida;
//   · que las cookies de un portal no acaben guardadas en la fila de otro.
// ═══════════════════════════════════════════════════════════════════════════

const INV = (p: Partial<InventarioPagina> = {}): InventarioPagina => ({
  url: 'https://facturacion.lagas.com.mx/tickets',
  titulo: 'Facturación',
  campos: [{ tag: 'input', type: 'text', id: 'folio', name: 'folio', placeholder: '', etiqueta: 'Folio', visible: true, opciones: [] }],
  botones: [{ tag: 'button', id: 'buscar', name: '', texto: 'Buscar', visible: true }],
  captcha: [],
  texto: 'Facturación electrónica',
  ...p,
});

const PASSWORD = { tag: 'input', type: 'password', id: 'Password', name: 'Password', placeholder: '', etiqueta: 'Contraseña', visible: true, opciones: [] };

describe('pantallaDeLogin', () => {
  it('estando dentro no ve nada — y eso es lo que no puede fallar', () => {
    expect(pantallaDeLogin(INV())).toBeNull();
  });

  it('un campo de contraseña VISIBLE es la señal fuerte, y nombra el campo', () => {
    const r = pantallaDeLogin(INV({ campos: [PASSWORD] }));
    expect(r).toMatch(/contraseña/i);
    expect(r).toContain('Password');
  });

  it('un password OCULTO no cuenta: Megasur trae uno y NO es su pantalla de entrar', () => {
    // Pre-vuelo del 20-ago-2026: el formulario de facturación de Megasur trae
    // un password oculto. Contarlo mandaría a re-vincular en cada corrida.
    const oculto = { ...PASSWORD, visible: false };
    expect(pantallaDeLogin(INV({ campos: [oculto] }))).toBeNull();
  });

  it('la dirección basta aunque el campo todavía no haya renderizado', () => {
    const r = pantallaDeLogin(INV({ url: 'http://megasur.com.mx:8029/Account/Login' }));
    expect(r).toMatch(/pantalla de entrar/i);
  });

  it('una URL que solo CONTIENE la palabra no dispara (facturacion.com/loginguide)', () => {
    expect(pantallaDeLogin(INV({ url: 'https://x.mx/loginguide/ayuda' }))).toBeNull();
  });

  it('la seña de estar dentro, ausente, es la tercera señal — y solo si se declara', () => {
    const inv = INV();
    expect(pantallaDeLogin(inv, 'Cerrar sesión')).toMatch(/seña de estar dentro/i);
    expect(pantallaDeLogin(inv), 'sin seña declarada, esta señal no existe').toBeNull();
  });

  it('…y presente, no dispara: se busca en texto, botones y campos', () => {
    expect(pantallaDeLogin(INV({ texto: 'Hola, TRANSPORTES SA · Cerrar sesión' }), 'Cerrar sesión')).toBeNull();
    expect(pantallaDeLogin(INV({ botones: [{ tag: 'a', id: 'salir', name: '', texto: 'Cerrar sesión', visible: true }] }), 'salir')).toBeNull();
  });
});

describe('clasificarFallo', () => {
  it('login SIN sesión guardada = nunca se vinculó', () => {
    const f = clasificarFallo({ loginVisto: 'campo de contraseña', arrancoConSesion: false });
    expect(f?.clase).toBe('requiere_vinculacion');
    expect(f?.queHacer).toMatch(/no teclea contraseñas/i);
  });

  it('login CON sesión guardada = se venció, y el mensaje lo dice', () => {
    const f = clasificarFallo({ loginVisto: 'campo de contraseña', arrancoConSesion: true });
    expect(f?.clase).toBe('sesion_caducada');
    expect(f?.queHacer).toMatch(/ya no sirve/i);
  });

  it('dentro pero sin los selectores del mapeo = EL PORTAL CAMBIÓ, y es problema nuestro', () => {
    const f = clasificarFallo({ loginVisto: null, arrancoConSesion: true, selectoresFaltantes: ['#rfc', '#uso'] });
    expect(f?.clase).toBe('portal_cambio');
    expect(f?.evidencia).toContain('#rfc');
    expect(f?.queHacer, 'mandar a re-vincular aquí sería mandarla a un login que ya funciona')
      .toMatch(/NO SE ARREGLA VOLVIENDO A ENTRAR/);
  });

  it('el orden importa: si estamos en el login, los selectores que faltan NO son "el portal cambió"', () => {
    // En la pantalla de entrar faltan TODOS los selectores del formulario. Sin
    // esta precedencia, cada caducidad se reportaría como un bug de mapeo.
    const f = clasificarFallo({ loginVisto: 'campo de contraseña', arrancoConSesion: true, selectoresFaltantes: ['#rfc'] });
    expect(f?.clase).toBe('sesion_caducada');
  });

  it('dentro y con todo en su sitio: no pasó nada', () => {
    expect(clasificarFallo({ loginVisto: null, arrancoConSesion: true })).toBeNull();
    expect(clasificarFallo({ loginVisto: null, arrancoConSesion: false, selectoresFaltantes: [] })).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════

const cookie = (name: string, domain: string, path = '/') => ({ name, value: 'x', domain, path });

describe('recortarEstadoAlPortal', () => {
  const estado = JSON.stringify({
    cookies: [
      cookie('ASP.NET_SessionId', 'megasur.com.mx'),
      cookie('lg_session', '.lagas.com.mx'),
      cookie('otra', 'facturacion.lagas.com.mx'),
    ],
    origins: [
      { origin: 'https://facturacion.lagas.com.mx', localStorage: [{ name: 'u', value: '1' }] },
      { origin: 'http://megasur.com.mx:8029', localStorage: [] },
    ],
  });

  it('se queda SOLO con lo del portal pedido — dominio con punto y sin punto', () => {
    const r = JSON.parse(recortarEstadoAlPortal(estado, 'https://facturacion.lagas.com.mx/')!);
    expect(r.cookies.map((c: { name: string }) => c.name).sort()).toEqual(['lg_session', 'otra']);
    expect(r.origins).toHaveLength(1);
  });

  it('y la fila del otro portal no se lleva nada ajeno', () => {
    const r = JSON.parse(recortarEstadoAlPortal(estado, 'http://megasur.com.mx:8029/')!);
    expect(r.cookies.map((c: { name: string }) => c.name)).toEqual(['ASP.NET_SessionId']);
  });

  it('sin nada del portal devuelve null: guardar una bolsa vacía diría «vinculado» sobre nada', () => {
    expect(recortarEstadoAlPortal(estado, 'https://otro.mx/')).toBeNull();
  });

  it('un JSON roto o una URL que no es URL devuelven null, no lanzan', () => {
    expect(recortarEstadoAlPortal('{no json', 'https://x.mx/')).toBeNull();
    expect(recortarEstadoAlPortal(estado, 'no-una-url')).toBeNull();
    expect(recortarEstadoAlPortal(JSON.stringify({ cookies: 'x' }), 'https://x.mx/')).toBeNull();
  });
});

describe('unirEstados', () => {
  it('junta las cookies de varios portales en una sola bolsa', () => {
    const a = JSON.stringify({ cookies: [cookie('a', 'uno.mx')], origins: [{ origin: 'https://uno.mx' }] });
    const b = JSON.stringify({ cookies: [cookie('b', 'dos.mx')], origins: [] });
    const r = JSON.parse(unirEstados([a, b])!);
    expect(r.cookies).toHaveLength(2);
    expect(r.origins).toHaveLength(1);
  });

  it('la misma cookie dos veces no se duplica, y gana la última', () => {
    const vieja = JSON.stringify({ cookies: [{ ...cookie('s', 'uno.mx'), value: 'vieja' }], origins: [] });
    const nueva = JSON.stringify({ cookies: [{ ...cookie('s', 'uno.mx'), value: 'nueva' }], origins: [] });
    const r = JSON.parse(unirEstados([vieja, nueva])!);
    expect(r.cookies).toHaveLength(1);
    expect(r.cookies[0].value).toBe('nueva');
  });

  it('una sesión corrupta se salta y NO deja sin las suyas a los demás portales', () => {
    const bueno = JSON.stringify({ cookies: [cookie('a', 'uno.mx')], origins: [] });
    const r = JSON.parse(unirEstados(['{roto', bueno])!);
    expect(r.cookies).toHaveLength(1);
  });

  it('sin nada que unir devuelve null (no un objeto vacío que parezca sesión)', () => {
    expect(unirEstados([])).toBeNull();
    expect(unirEstados([JSON.stringify({ cookies: [], origins: [] })])).toBeNull();
  });
});
