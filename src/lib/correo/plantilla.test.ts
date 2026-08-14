import { describe, it, expect } from 'vitest';
import { armarHtml, aTextoPlano, esc, hrefSeguro, type Correo } from './plantilla';

const BASE: Correo = {
  asunto: 'Papeles por vencer',
  avance: '2 unidades necesitan atención',
  titulo: 'Dos unidades tienen papeles por vencer',
  parrafos: ['La T-042 trae la verificación vencida desde hace 8 días.'],
  porQueLoRecibes: 'Recibes este aviso porque administras la flota en Likida.',
};

describe('el logo va arriba a la IZQUIERDA y sobrevive a los clientes de correo', () => {
  const html = armarHtml(BASE);

  it('la banda del logo está alineada a la izquierda', () => {
    expect(html).toMatch(/<td align="left"[^>]*>\s*<img[^>]*logo\.png/);
  });

  it('el logo lleva alt="Likida": con las imágenes bloqueadas se lee la marca', () => {
    // Outlook corporativo bloquea imágenes por defecto. Sin alt, el encabezado
    // del correo queda vacío.
    expect(html).toMatch(/<img[^>]+alt="Likida"/);
  });

  it('lleva ancho y alto en ATRIBUTOS, no solo en el estilo', () => {
    // Con la imagen bloqueada, los atributos son lo único que conserva el
    // espacio; sin ellos el encabezado colapsa y el correo se ve roto.
    expect(html).toMatch(/<img[^>]+width="104"[^>]+height="21"/);
  });

  it('la banda tiene fondo claro EXPLÍCITO', () => {
    // El PNG de marca es negro sobre transparente: en un cliente con tema
    // oscuro, sin fondo propio, el logo desaparece.
    expect(html).toMatch(/bgcolor="#ffffff"[^>]*>\s*<img/);
  });

  it('la URL del logo es absoluta — un correo no resuelve rutas relativas', () => {
    expect(html).toMatch(/src="https?:\/\/[^"]+\/images\/logo\.png"/);
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

describe('el tono cambia el acento, no la estructura', () => {
  it('urgente pinta rojo y neutral pinta la marca', () => {
    expect(armarHtml({ ...BASE, tono: 'urgente' })).toContain('#b91c1c');
    expect(armarHtml({ ...BASE, tono: 'neutral' })).toContain('#c2410c');
  });

  it('sin tono declarado, el default es la marca', () => {
    expect(armarHtml(BASE)).toContain('#c2410c');
  });
});
