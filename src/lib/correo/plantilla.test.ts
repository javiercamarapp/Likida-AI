import { describe, it, expect } from 'vitest';
import { armarHtml, aTextoPlano, esc, hrefSeguro, type Correo } from './plantilla';

const BASE: Correo = {
  asunto: 'Papeles por vencer',
  avance: '2 unidades necesitan atención',
  titulo: 'Dos unidades tienen papeles por vencer',
  parrafos: ['La T-042 trae la verificación vencida desde hace 8 días.'],
  porQueLoRecibes: 'Recibes este aviso porque administras la flota en Likida.',
};

describe('el wordmark va arriba a la IZQUIERDA y NO puede romperse', () => {
  const html = armarHtml(BASE);

  it('es el logo REAL, incrustado (cid:), no enlazado a un dominio', () => {
    // Un <img src="https://…"> depende de que el cliente autorice imágenes
    // externas. El archivo respondía HTTP 200 y aun así llegó roto, porque
    // Gmail las bloquea por defecto para un remitente nuevo.
    expect(html).toMatch(/<img src="cid:likida-logo"/);
    expect(html).not.toContain('https://app.likida.ai/images/');
  });

  it('el texto alterno LLEVA ESTILO: el peor caso es el wordmark, no un ícono roto', () => {
    // Cuando un cliente no pinta la imagen, la mayoría aplica los estilos del
    // <img> a su alt. Así no queda un estado feo posible.
    expect(html).toMatch(/<img[^>]+alt="LIKIDA"/);
    expect(html).toMatch(/<img[^>]+letter-spacing:0\.34em/);
    expect(html).toMatch(/<img[^>]+font-family:'Inter Tight'/);
  });

  it('va alineado a la IZQUIERDA y antes que la tarjeta', () => {
    const posLogo = html.indexOf('cid:likida-logo');
    // La tarjeta se localiza por su fondo de papel con radio — el número
    // exacto del radio es decisión de diseño, no contrato.
    const posTarjeta = html.search(/bgcolor="#ffffff"[^>]*border-radius/);
    expect(posLogo).toBeGreaterThan(-1);
    expect(posLogo).toBeLessThan(posTarjeta);
    expect(html).toMatch(/<td align="left"[^>]*>\s*<img src="cid:/);
  });

  it('lleva ancho y alto en ATRIBUTOS, para que el hueco no colapse', () => {
    expect(html).toMatch(/<img[^>]+width="112"[^>]+height="23"/);
  });

  it('usa el NEGRO de las consolas, no el naranja de los tokens', () => {
    // Las dos consolas corren bajo `.tema-neutro`, que pivota --marca a
    // #18181b. El naranja #c2410c vive en globals.css pero no es lo que el
    // usuario ve, así que un correo naranja no se parecía al producto.
    expect(html).toContain('#18181b');
    expect(html).not.toContain('#c2410c');
  });

  it('la tipografía de titulares es la de la app (Inter Tight primero)', () => {
    expect(html).toMatch(/<h1[^>]+font-family:'Inter Tight',Inter/);
  });
});

describe('HTML que los clientes de correo de verdad entienden', () => {
  const html = armarHtml(BASE);

  it('la estructura son <table>, no <div> con flex', () => {
    // Outlook renderiza con el motor de Word: sin flexbox ni grid.
    expect(html).toContain('<table role="presentation"');
    expect(html).not.toContain('display:flex');
    expect(html).not.toContain('display:grid');
  });

  it('no usa custom properties: var() no existe en Outlook', () => {
    expect(html).not.toContain('var(--');
  });

  it('no hay <style> en el head — Gmail lo borra', () => {
    expect(html).not.toMatch(/<style/i);
  });

  it('trae el avance oculto para la bandeja de entrada', () => {
    // Sin él, Gmail muestra como resumen la primera línea del cuerpo, que sería
    // el texto alterno del logo.
    expect(html).toContain('2 unidades necesitan atención');
    expect(html).toMatch(/max-height:0;overflow:hidden/);
  });
});

describe('los datos de la base son DATOS, nunca marcado', () => {
  it('escapa el contenido que viene de la base', () => {
    // Un operador registrado con un nombre malicioso no puede inyectar nada en
    // el correo que le llega al dueño de la flota.
    const html = armarHtml({
      ...BASE,
      titulo: '<script>alert(1)</script>',
      parrafos: ['El folio <img src=x onerror=alert(1)> llegó'],
    });
    // Lo que importa NO es que la cadena "onerror" desaparezca —dentro de texto
    // escapado es inofensiva—, sino que no se pueda FORMAR una etiqueta: el
    // `<` se volvió `&lt;` y el navegador de correo ya no ve marcado.
    expect(html).not.toContain('<script>');
    expect(html).not.toMatch(/<img[^>]*onerror/i);
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('escapa también las comillas, que romperían un atributo', () => {
    expect(esc('a"b\'c')).toBe('a&quot;b&#39;c');
  });

  it('escapa el ampersand ANTES que lo demás, sin doble escape', () => {
    expect(esc('Talleres & Refacciones')).toBe('Talleres &amp; Refacciones');
    expect(esc('<a>')).toBe('&lt;a&gt;');
  });

  it('los datos de la tabla también se escapan', () => {
    const html = armarHtml({ ...BASE, datos: [['Unidad', '<b>T-042</b>']] });
    expect(html).not.toContain('<b>T-042</b>');
    expect(html).toContain('&lt;b&gt;T-042&lt;/b&gt;');
  });
});

describe('hrefSeguro — el botón no puede ser un vector', () => {
  it('deja pasar http y https', () => {
    expect(hrefSeguro('https://app.likida.ai/dashboard')).toBe('https://app.likida.ai/dashboard');
  });

  it('BLOQUEA javascript: y data:', () => {
    // Un enlace así, firmado con nuestro remitente, es una inyección con
    // nuestra marca de aval.
    expect(hrefSeguro('javascript:alert(1)')).not.toContain('javascript');
    expect(hrefSeguro('data:text/html,<script>')).not.toContain('data:');
  });

  it('un href vacío o basura cae a la app, no a un enlace roto', () => {
    expect(hrefSeguro('   ')).toMatch(/^https?:\/\//);
    expect(hrefSeguro('vaya')).toMatch(/^https?:\/\//);
  });

  it('escapa las comillas de una URL para no romper el atributo', () => {
    expect(hrefSeguro('https://x.com/"onmouseover="alert(1)')).not.toContain('"onmouseover');
  });
});

describe('la parte de texto plano', () => {
  it('existe y trae lo esencial', () => {
    // Un correo sin parte de texto puntúa peor en los filtros de spam, y hay
    // clientes que solo leen esa.
    const txt = aTextoPlano({ ...BASE, boton: { texto: 'Ver unidades', href: 'https://app.likida.ai/dashboard/unidades' } });
    expect(txt).toContain('Dos unidades tienen papeles por vencer');
    expect(txt).toContain('https://app.likida.ai/dashboard/unidades');
    expect(txt).toContain('Recibes este aviso porque');
  });

  it('incluye los renglones de datos', () => {
    const txt = aTextoPlano({ ...BASE, datos: [['Unidad', 'T-042'], ['Vence', 'hace 8 días']] });
    expect(txt).toContain('Unidad: T-042');
    expect(txt).toContain('Vence: hace 8 días');
  });
});

describe('el pie dice por qué llegó', () => {
  it('siempre aparece — es lo que separa transaccional de marketing', () => {
    expect(armarHtml(BASE)).toContain('Recibes este aviso porque administras la flota');
  });
});

describe('el tono es un micro-rótulo, no una banda de color', () => {
  it('urgente pone la palabra, y el correo NO se llena de rojo', () => {
    // La versión anterior ponía un filo rojo de 3px y un botón rojo: el correo
    // gritaba, y tres avisos seguidos parecían tres alarmas.
    const html = armarHtml({ ...BASE, tono: 'urgente' });
    expect(html).toContain('Urgente');
    expect(html).toContain('#b91c1c');
    // El botón sigue siendo negro, no rojo.
    expect(armarHtml({ ...BASE, tono: 'urgente', boton: { texto: 'Ver', href: 'https://app.likida.ai' } }))
      .toMatch(/bgcolor="#18181b"/);
  });

  it('neutral no pone rótulo ninguno', () => {
    expect(armarHtml({ ...BASE, tono: 'neutral' })).not.toContain('Requiere atención');
    expect(armarHtml({ ...BASE, tono: 'neutral' })).not.toContain('Urgente');
  });

  it('atención pinta ámbar y nombra su estado', () => {
    const html = armarHtml({ ...BASE, tono: 'atencion' });
    expect(html).toContain('Requiere atención');
    expect(html).toContain('#b45309');
  });
});

describe('lo que un correo de ACCESO necesita y un aviso no', () => {
  const ACCESO: Correo = {
    ...BASE,
    asunto: 'Tu acceso a Likida',
    titulo: 'Entra a Likida',
    boton: { texto: 'Entrar a Likida', href: 'https://abc.supabase.co/auth/v1/verify?token=t&type=magiclink' },
    enlaceLiteral: true,
    nota: 'Si no fuiste tú, ignora este correo.',
  };

  it('la liga va TAMBIÉN en texto: los escáneres corporativos queman el href', () => {
    // Defender y Proofpoint reescriben —y a veces VISITAN— el enlace del
    // botón. Un enlace de un solo uso ya visitado deja fuera al humano.
    const html = armarHtml(ACCESO);
    expect(html).toContain('&iquest;El bot&oacute;n no abre?');
    expect(html).toContain(esc(ACCESO.boton!.href));
  });

  it('la liga literal se parte: una URL de verificación desborda los 600px', () => {
    expect(armarHtml(ACCESO)).toContain('word-break:break-all');
  });

  it('sin `enlaceLiteral` no aparece — un aviso no la necesita', () => {
    expect(armarHtml({ ...ACCESO, enlaceLiteral: false })).not.toContain('&iquest;El bot&oacute;n no abre?');
  });

  it('la nota de seguridad va en su propio bloque, no como un párrafo más', () => {
    const html = armarHtml(ACCESO);
    const posBoton = html.indexOf('Entrar a Likida');
    const posNota = html.indexOf('Si no fuiste t');
    expect(posNota).toBeGreaterThan(posBoton);
    expect(html).toMatch(/bgcolor="#f9f9fa"[^>]*>Si no fuiste t/);
  });

  it('el código se pinta en mono, grande y espaciado — se teclea a mano', () => {
    const html = armarHtml({ ...ACCESO, codigo: '123456' });
    expect(html).toMatch(/font-family:'IBM Plex Mono'[^"]*;font-size:27px/);
    expect(html).toContain('letter-spacing:0.2em');
    expect(html).toContain('123456');
    expect(html).toContain('C&oacute;digo de un solo uso');
  });

  it('el código y la nota también van en la parte de texto plano', () => {
    const texto = aTextoPlano({ ...ACCESO, codigo: '123456' });
    expect(texto).toContain('Código: 123456');
    expect(texto).toContain('Si no fuiste tú');
  });

  it('el código se escapa: es un dato, no marcado', () => {
    expect(armarHtml({ ...ACCESO, codigo: '<img onerror=x>' })).not.toContain('<img onerror');
  });
});

describe('el logo enlazado — solo para las plantillas del panel de Supabase', () => {
  it('por default sigue siendo incrustado', () => {
    expect(armarHtml(BASE)).toContain('src="cid:likida-logo"');
  });

  it('en modo url apunta a producción, y conserva el alt con estilo', () => {
    // Ese correo sale por el SMTP de Supabase: no hay forma de adjuntarle
    // nada. El peor caso sigue siendo el wordmark, no un ícono roto.
    const html = armarHtml(BASE, { logo: 'url' });
    expect(html).toContain('src="https://app.likida.ai/images/logo.png"');
    expect(html).not.toContain('cid:likida-logo');
    expect(html).toMatch(/<img[^>]+alt="LIKIDA"[^>]*/);
    expect(html).toMatch(/letter-spacing:0\.34em/);
  });
});
