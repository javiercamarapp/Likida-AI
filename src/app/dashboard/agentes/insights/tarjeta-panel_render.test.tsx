import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { TarjetaInsight, COLOR_TIPO, COLOR_SEVERIDAD, textoFuente } from './tarjeta-insight';
import { PanelInsights, TEXTO_VACIO, TEXTO_ERROR } from './panel-insights';
import { componer } from '@/lib/likida/insights/componer';
import { definirRegla } from '@/lib/likida/insights/regla';
import { TIPOS_INSIGHT, SEVERIDADES, type Insight, type Severidad } from '@/lib/likida/insights/tipos';

// Datos sintéticos: ninguna cifra ni nombre real.
const fuente = { tabla: 'tabla_sintetica', periodo: 'semana de prueba', n: 7 };
const base = {
  id: 'i1',
  agente: 'liquidacion' as const,
  severidad: 'atencion' as const,
  quePaso: 'Hubo 7 casos sintéticos.',
  queSignifica: 'Es una lectura de prueba.',
  queHacer: 'Revisar la lista.',
  fuente,
};
const dato: Insight = { ...base, tipo: 'dato' };
const candidato: Insight = {
  ...base,
  id: 'i2',
  tipo: 'candidato',
  queSignifica: 'Es un candidato a revisar, no una conclusión.',
  queHacer: 'Validar con el tarifario.',
};
const simulado: Insight = { ...base, id: 'i3', tipo: 'simulado', rotulo: 'Dato simulado para la demo' };

const pintar = (i: Insight) => renderToStaticMarkup(<TarjetaInsight insight={i} />);

describe('TarjetaInsight', () => {
  it('trae las tres líneas rotuladas Qué pasó / Qué significa / Qué hacer', () => {
    const h = pintar(dato);
    expect(h).toContain('Qué pasó');
    expect(h).toContain('Qué significa');
    expect(h).toContain('Qué hacer');
    expect(h).toContain('Hubo 7 casos sintéticos.');
    expect(h).toContain('Revisar la lista.');
  });

  it('muestra el chip «Candidato» y el texto de verificación', () => {
    const h = pintar(candidato);
    expect(h).toMatch(/data-chip="tipo"[^>]*>Candidato/);
    expect(h).toContain('Validar con el tarifario.');
  });

  it('el tipo se dice con palabras, no solo con color, para los cuatro tipos', () => {
    const rotulos = { dato: 'Dato', candidato: 'Candidato', ejemplo: 'Ejemplo', simulado: 'Simulado' };
    for (const t of TIPOS_INSIGHT) {
      const i = (t === 'ejemplo' || t === 'simulado'
        ? { ...base, tipo: t, rotulo: 'Rótulo visible' }
        : t === 'candidato' ? candidato : dato) as Insight;
      expect(pintar(i)).toContain(rotulos[t]);
    }
  });

  it('ejemplo/simulado muestran su rótulo visible', () => {
    expect(pintar(simulado)).toContain('Dato simulado para la demo');
  });

  it('pie de fuente con tabla, periodo y n', () => {
    expect(pintar(dato)).toContain('Fuente: tabla_sintetica · semana de prueba · n=7');
    expect(textoFuente({ archivo: 'a.xlsx', calculo: 'suma', periodo: 'mes', n: 3 })).toBe(
      'Fuente: a.xlsx + suma · mes · n=3',
    );
  });

  it('la severidad también se rotula con texto', () => {
    expect(pintar({ ...dato, severidad: 'urgente' })).toContain('Urgente');
  });

  it('botón de acción opcional: solo aparece si la regla lo trae', () => {
    expect(pintar(dato)).not.toContain('<a ');
    const h = pintar({ ...dato, accion: { rotulo: 'Abrir la cola', ruta: '/dashboard/agentes/liquidacion' } });
    expect(h).toContain('href="/dashboard/agentes/liquidacion"');
    expect(h).toContain('Abrir la cola');
  });

  it('es accesible: article con nombre y lista de definiciones', () => {
    const h = pintar(dato);
    expect(h).toContain('aria-labelledby="insight-i1-titulo"');
    expect(h).toContain('id="insight-i1-titulo"');
    expect(h).toContain('<dl');
  });
});

const regla = (id: string, severidad: Severidad) =>
  definirRegla<null>({
    id,
    agente: 'liquidacion',
    aplica: () => true,
    producir: () => ({ ...base, tipo: 'dato', id, severidad }) as Insight,
  });

describe('PanelInsights: estados', () => {
  it('vacío: lenguaje llano', () => {
    const h = renderToStaticMarkup(<PanelInsights estado="listo" resultado={componer<null>([], null)} />);
    expect(h).toContain(TEXTO_VACIO);
    expect(h).toContain('Aún no hay datos para interpretar.');
  });

  it('cargando: esqueleto anunciado como «Cargando»', () => {
    const h = renderToStaticMarkup(<PanelInsights estado="cargando" />);
    expect(h).toContain('aria-busy="true"');
    expect(h).toContain('aria-label="Cargando"');
  });

  it('error: role=alert con mensaje llano y sin jerga', () => {
    const h = renderToStaticMarkup(<PanelInsights estado="error" />);
    expect(h).toContain('role="alert"');
    expect(h).toContain(TEXTO_ERROR);
    expect(h).not.toMatch(/stack|undefined|Error:/);
  });

  it('error con mensaje propio', () => {
    expect(renderToStaticMarkup(<PanelInsights estado="error" mensaje="No se pudo leer el archivo." />)).toContain(
      'No se pudo leer el archivo.',
    );
  });

  it('listo: máximo 3 visibles y el resto en «Ver más»', () => {
    const r = componer(
      [regla('a', 'info'), regla('b', 'urgente'), regla('c', 'atencion'), regla('d', 'info'), regla('e', 'info')],
      null,
    );
    const h = renderToStaticMarkup(<PanelInsights estado="listo" resultado={r} />);
    expect(h).toContain('Ver más (2)');
    expect(h.match(/data-insight=/g)).toHaveLength(5);
    // los visibles van antes del <details>
    const antes = h.slice(0, h.indexOf('<details'));
    expect(antes.match(/data-insight=/g)).toHaveLength(3);
    expect(antes.indexOf('data-insight="b"')).toBeLessThan(antes.indexOf('data-insight="c"'));
  });

  it('sin excedente no hay «Ver más»', () => {
    const r = componer([regla('a', 'info')], null);
    expect(renderToStaticMarkup(<PanelInsights estado="listo" resultado={r} />)).not.toContain('Ver más');
  });
});

// ── Contraste: se mide contra globals.css, igual que contraste.test.ts ──────────
const CSS = readFileSync(fileURLToPath(new URL('../../../globals.css', import.meta.url)), 'utf8');
const lum = (hex: string) => {
  const c = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contraste = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
const idxOscuro = CSS.indexOf(':root[data-theme="dark"]');
const claro = CSS.slice(0, idxOscuro);
const oscuro = CSS.slice(idxOscuro);
function valor(zona: string, nombre: string): string {
  const m = zona.match(new RegExp(`${nombre}:\\s*(#[0-9a-fA-F]{6})`));
  expect(m, `no encontré ${nombre}`).not.toBeNull();
  return m![1].toLowerCase();
}
const resolver = (zona: string, ref: string) => {
  const nombre = ref.replace('var(', '').replace(')', '');
  if (nombre === '--ink') return valor(zona, zona === claro ? '--color-ink' : '--ink');
  if (nombre === '--muted') return valor(zona, zona === claro ? '--color-muted' : '--muted');
  return valor(zona, nombre);
};

describe('contraste de los chips (AA 4.5:1, claro y oscuro)', () => {
  const grupos = [
    ...TIPOS_INSIGHT.map((t) => [`tipo ${t}`, COLOR_TIPO[t]] as const),
    ...SEVERIDADES.map((s) => [`severidad ${s}`, COLOR_SEVERIDAD[s]] as const),
  ];
  for (const [nombre, { tinta, fondo }] of grupos) {
    for (const [modo, zona] of [['claro', claro], ['oscuro', oscuro]] as const) {
      it(`${nombre} en modo ${modo}`, () => {
        expect(contraste(resolver(zona, tinta), resolver(zona, fondo))).toBeGreaterThanOrEqual(4.5);
      });
    }
  }
});
