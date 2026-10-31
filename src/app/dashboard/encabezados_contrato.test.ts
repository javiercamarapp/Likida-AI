/* eslint-disable security/detect-non-literal-fs-filename -- lee el árbol de FUENTE del propio repo; ninguna ruta viene de entrada de usuario. */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fuentesDeProduccion, sinComentarios } from '@/lib/pruebas/codigo';
import { APOYO_MAX } from '../ui-v2/componentes';
import { TODAS_LAS_RUTAS } from './rutas';

// L2b · CONTRATO DE LOS ENCABEZADOS (super prompt A.R05 puntos 2 y 3; decisiones de Javier del 31-oct):
//   · UN solo encabezado por pantalla (`MarcoPagina` → `EncabezadoPagina`): etiqueta del área sobre el título, h1 = nombre del menú
//     y UNA línea de apoyo de ≤140 caracteres. Sin miga de pan, sin título repetido en una barra superior.
//   · Las pantallas migradas no vuelven a pintar su propio h1, su `BarraPagina` ni su saludo (`HeroSaludo`).
const RAIZ = join(process.cwd(), 'src/app/dashboard');
const fuente = (rel: string) => readFileSync(join(RAIZ, rel), 'utf8');
const todas = fuentesDeProduccion(RAIZ);

/** Las pantallas del panel que ya usan el marco único (se agregan aquí al migrarlas; una que vuelva atrás rompe la prueba). */
const MIGRADAS = [
  'viajes/vista.tsx', 'despacho/vista.tsx', 'operadores/vista.tsx', 'unidades/vista.tsx', 'patios/vista.tsx', 'jornada/vista.tsx',
  'mapa/vista.tsx', 'viajes-en-vivo/vista.tsx', 'carta-porte/vista.tsx', 'carta-porte/documentos/vista.tsx', 'whatsapp/vista.tsx',
  'convenios/vista.tsx', 'huerfanos/vista.tsx', 'rentabilidad/vista.tsx', 'clientes/vista.tsx', 'facturacion/vista.tsx', 'cotizaciones/page.tsx',
  'timbrado/page.tsx', 'reglas/page.tsx', 'descarga-sat/vista.tsx', 'descarga-sat/bandeja/vista.tsx', 'combustible-casetas/page.tsx',
  'conocimiento/vista.tsx', 'conexiones/vista.tsx', 'llaves-api/page.tsx', 'sesiones-mcp/page.tsx', 'usuarios/vista.tsx', 'politicas/page.tsx',
  'arco/page.tsx', 'legal/page.tsx', 'conversaciones/page.tsx', 'soporte/page.tsx', 'suscripcion/page.tsx', 'configuracion/page.tsx',
  'emergencias/page.tsx', 'asistencia/page.tsx', 'notificaciones/lista.tsx', 'mi-perfil/page.tsx', 'arranque/vista.tsx',
  'agentes/liquidacion/vista.tsx', 'agentes/facturas/vista.tsx', 'agentes/cobranza/vista.tsx', 'agentes/conductores/vista.tsx',
  'agentes/vigia/vista.tsx', 'agentes/peajes/vista.tsx', 'agentes/carta-porte/vista.tsx', 'agentes/proveedores/vista.tsx',
  'agentes/conductores/configuracion/vista.tsx', 'agentes/conductores/estadias/vista.tsx', 'agentes/conductores/sitios/vista.tsx',
  'agentes/liquidacion/configuracion/vista.tsx', 'agentes/liquidacion/formato/vista.tsx', 'agentes/peajes/configuracion/vista.tsx',
  'agentes/peajes/reclamacion/vista.tsx', 'agentes/vigia/historial/vista.tsx', 'agentes/vigia/avisos/vista.tsx', 'agentes/vigia/importacion/vista.tsx', 'agentes/vigia/programa/vista.tsx', 'agentes/liquidacion/desgloses.tsx', 'agentes/carta-porte/catalogo/vista.tsx',
  'agentes/carta-porte/referencia/vista.tsx', 'agentes/carta-porte/configuracion/vista.tsx', 'inicio-contenido.tsx', 'inicio-operacion.tsx',
  'contador/inicio-contador.tsx', '[id]/detalle.tsx', 'proximamente/proximamente.tsx', 'resumen-v2.tsx', 'puesta-en-marcha/vista.tsx',
];

describe('las pantallas migradas usan el encabezado único', () => {
  for (const rel of MIGRADAS) {
    it(`${rel}: MarcoPagina (o EncabezadoPagina), sin BarraPagina, HeroSaludo ni h1 propio`, () => {
      const f = sinComentarios(fuente(rel));
      expect(f, 'debe pintar el encabezado único').toMatch(/<MarcoPagina\b|<EncabezadoPagina\b/);
      expect(f, 'la miga/barra superior ya no existe').not.toMatch(/<BarraPagina\b|<HeroSaludo\b/);
      expect(f, 'el h1 lo pone el encabezado único').not.toMatch(/<h1\b/);
    });
  }
});

describe('la línea de apoyo cabe en una oración (≤140 caracteres)', () => {
  it('ninguna `apoyo="…"` literal de /dashboard pasa del tope', () => {
    const pasadas: string[] = [];
    for (const ruta of todas) {
      const f = readFileSync(ruta, 'utf8');
      for (const m of f.matchAll(/\bapoyo="([^"]*)"/g)) if (m[1].length > APOYO_MAX) pasadas.push(`${ruta.replace(RAIZ + '/', '')}: ${m[1].length} → ${m[1].slice(0, 50)}…`);
    }
    expect(pasadas).toEqual([]);
  });

  it('el tope es el del super prompt (140)', () => {
    expect(APOYO_MAX).toBe(140);
  });
});

describe('título de pestaña por pantalla «<Pantalla> · Likida»', () => {
  it('el layout de /dashboard pone la plantilla y las pantallas migradas exportan su `metadata.title`', () => {
    expect(fuente('layout.tsx')).toMatch(/template: '%s · Likida'/);
    const sinTitulo: string[] = [];
    for (const rel of MIGRADAS) {
      const dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
      const page = join(dir, 'page.tsx');
      let src = '';
      try { src = fuente(page); } catch { continue; } // la vista no cuelga de un page.tsx de su carpeta (p. ej. subcomponentes)
      if (!/export const metadata\b/.test(src)) sinTitulo.push(page);
    }
    expect(sinTitulo).toEqual([]);
  });
});

describe('sin miga de pan en el marco', () => {
  it('la barra superior de escritorio no pinta el título ni la ruta (solo plegar, Guía, campana y fecha)', () => {
    const f = sinComentarios(readFileSync(join(RAIZ, 'shell/cabecera-escritorio.tsx'), 'utf8'));
    expect(f).not.toMatch(/<h1|miga|breadcrumb/i);
  });
});

// H5 · el h1 ES el nombre del menú (rutas.ts) y TODO apoyo —literal o con plantilla/ternario— cabe en 140 caracteres.
describe('el título es el nombre exacto del menú', () => {
  const NOMBRE_POR_RUTA = new Map(TODAS_LAS_RUTAS.map((i) => [i.href, i.nombre]));
  it('cada vista que ES la pantalla de una entrada del menú titula con ese nombre', () => {
    const mal: string[] = [];
    let comparadas = 0;
    for (const rel of MIGRADAS) {
      const dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
      const href = dir === '' ? '/dashboard' : `/dashboard/${dir}`;
      const nombre = NOMBRE_POR_RUTA.get(href);
      if (!nombre) continue;
      const m = /<MarcoPagina\b[^>]*?\btitulo="([^"]*)"/s.exec(fuente(rel));
      if (!m) continue; // título calculado (detalle)
      comparadas++;
      if (m[1] !== nombre) mal.push(`${rel}: «${m[1]}» ≠ menú «${nombre}»`);
    }
    expect(comparadas).toBeGreaterThan(30);
    expect(mal).toEqual([]);
  });
});

describe('apoyo con plantilla o ternario', () => {
  /** Los literales de texto de una expresión `apoyo={…}`; cada `${…}` cuenta como 20 caracteres. */
  function literales(expr: string): string[] {
    return [...expr.matchAll(/(['"`])((?:\\.|(?!\1)[^\\])*)\1/g)].map((m) => m[2].replace(/\$\{[^}]*\}/g, 'x'.repeat(20)));
  }
  it('ninguna expresión apoyo={…} tiene un literal de más de 140 caracteres', () => {
    const pasadas: string[] = [];
    let expresiones = 0;
    for (const ruta of todas) {
      const f = readFileSync(ruta, 'utf8');
      for (const m of f.matchAll(/\bapoyo=\{/g)) {
        let d = 1, i = m.index! + m[0].length;
        while (i < f.length && d > 0) { if (f[i] === '{') d++; else if (f[i] === '}') d--; i++; }
        expresiones++;
        for (const l of literales(f.slice(m.index! + m[0].length, i - 1))) if (l.length > APOYO_MAX) pasadas.push(`${ruta.replace(RAIZ + '/', '')}: ${l.length}`);
      }
    }
    expect(expresiones).toBeGreaterThan(3);
    expect(pasadas).toEqual([]);
  });
});
