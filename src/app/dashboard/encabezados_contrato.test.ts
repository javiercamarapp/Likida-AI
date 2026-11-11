/* eslint-disable security/detect-non-literal-fs-filename -- lee el árbol de FUENTE del propio repo; ninguna ruta viene de entrada de usuario. */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fuentesDeProduccion, sinComentarios } from '@/lib/pruebas/codigo';
import { APOYO_MAX } from '../ui-v2/componentes';
import { TODAS_LAS_RUTAS, ENTRADAS_DASHBOARD } from './rutas';

// L2b · CONTRATO DE LOS ENCABEZADOS (super prompt A.R05 puntos 2 y 3; decisiones de Javier del 31-oct):
//   · UN solo encabezado por pantalla (`MarcoPagina` → `EncabezadoPagina`): etiqueta del área sobre el título, h1 = nombre del menú
//     y UNA línea de apoyo de ≤140 caracteres. Sin miga de pan, sin título repetido en una barra superior.
//   · Las pantallas migradas no vuelven a pintar su propio h1, su `BarraPagina` ni su saludo (`HeroSaludo`).
const RAIZ = join(process.cwd(), 'src/app/dashboard');
const fuente = (rel: string) => readFileSync(join(RAIZ, rel), 'utf8');
const todas = fuentesDeProduccion(RAIZ);

/** Diccionarios en español (todos los namespaces): `'clave': 'texto'`. Las pantallas migradas a i18n titulan con `titulo={t('clave')}`. */
const DICCIONARIO_ES = readdirSync(join(process.cwd(), 'src/lib/i18n/es'))
  .map((f) => readFileSync(join(process.cwd(), 'src/lib/i18n/es', f), 'utf8')).join('\n');
function textoDeClave(clave: string): string | null {
  const m = new RegExp(`'${clave.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}':\\s*'((?:[^'\\\\]|\\\\.)*)'`).exec(DICCIONARIO_ES);
  return m ? m[1].replace(/\\'/g, "'") : null;
}
/** El `titulo` de `<MarcoPagina>` o de un esqueleto F26 (que lo pasa al mismo marco): literal, o `{t('clave')}` resuelto contra el diccionario en español; `null` si es calculado. */
function tituloDeMarco(src: string): string | null {
  const lit = /<(?:MarcoPagina|Esqueleto\w+)\b[^>]*?\btitulo="([^"]*)"/s.exec(src);
  if (lit) return lit[1];
  const dic = /<(?:MarcoPagina|Esqueleto\w+)\b[^>]*?\btitulo=\{\s*\w+\('([^']+)'\)\s*\}/s.exec(src);
  return dic ? textoDeClave(dic[1]) : null;
}

/** Las pantallas del panel que ya usan el marco único (se agregan aquí al migrarlas; una que vuelva atrás rompe la prueba). */
const MIGRADAS = [
  'viajes/vista.tsx', 'despacho/vista.tsx', 'operadores/vista.tsx', 'unidades/vista.tsx', 'patios/vista.tsx', 'jornada/vista.tsx',
  'mapa/vista.tsx', 'viajes-en-vivo/vista.tsx', 'carta-porte/vista.tsx', 'carta-porte/documentos/vista.tsx', 'whatsapp/vista.tsx',
  'convenios/vista.tsx', 'huerfanos/vista.tsx', 'rentabilidad/vista.tsx', 'clientes/vista.tsx', 'facturacion/vista.tsx', 'cotizaciones/page.tsx',
  'timbrado/page.tsx', 'reglas/page.tsx', 'descarga-sat/vista.tsx', 'descarga-sat/bandeja/vista.tsx', 'combustible-casetas/page.tsx',
  'conocimiento/vista.tsx', 'conexiones/vista.tsx', 'llaves-api/page.tsx', 'sesiones-mcp/page.tsx', 'usuarios/vista.tsx', 'politicas/page.tsx',
  'arco/page.tsx', 'legal/page.tsx', 'conversaciones/page.tsx', 'soporte/page.tsx', 'suscripcion/page.tsx', 'configuracion/page.tsx',
  'emergencias/page.tsx', 'asistencia/page.tsx', 'mi-perfil/page.tsx', 'arranque/vista.tsx',
  'agentes/liquidacion/vista.tsx', 'agentes/facturas/vista.tsx', 'agentes/cobranza/vista.tsx', 'agentes/conductores/vista.tsx',
  'agentes/vigia/vista.tsx', 'agentes/peajes/vista.tsx', 'agentes/carta-porte/vista.tsx', 'agentes/proveedores/vista.tsx',
  'agentes/conductores/configuracion/vista.tsx', 'agentes/conductores/estadias/vista.tsx', 'agentes/conductores/sitios/vista.tsx',
  'agentes/liquidacion/configuracion/vista.tsx', 'agentes/liquidacion/formato/vista.tsx', 'agentes/peajes/configuracion/vista.tsx',
  'agentes/peajes/reclamacion/vista.tsx', 'agentes/vigia/historial/vista.tsx', 'agentes/vigia/avisos/vista.tsx', 'agentes/vigia/sin-atender/vista.tsx', 'agentes/vigia/importacion/vista.tsx', 'agentes/vigia/programa/vista.tsx', 'agentes/liquidacion/desgloses.tsx', 'agentes/carta-porte/catalogo/vista.tsx',
  'agentes/carta-porte/referencia/vista.tsx', 'agentes/carta-porte/configuracion/vista.tsx',
  'contador/inicio-contador.tsx', '[id]/detalle.tsx', 'proximamente/proximamente.tsx', 'resumen-v2.tsx', 'puesta-en-marcha/page.tsx',
  'carta-porte/documentos/[id]/vista.tsx',
];

describe('las pantallas migradas usan el encabezado único', () => {
  for (const rel of MIGRADAS) {
    it(`${rel}: MarcoPagina (o EncabezadoPagina), sin BarraPagina, HeroSaludo ni h1 propio`, () => {
      const f = sinComentarios(fuente(rel));
      expect(f, 'debe pintar el encabezado único').toMatch(/<MarcoPagina\b|<EncabezadoPagina\b|<MarcoConfigAgente\b|<Esqueleto(?:Portada|TablaMaestra|PanelCifras|Ficha|Configuracion)\b/);
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
      if (!/export (const metadata\b|async function generateMetadata\b)/.test(src)) sinTitulo.push(page); // generateMetadata: el título sale del diccionario (i18n)
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

// H5 · el h1 ES el nombre de la ENTRADA del menú (rutas.ts, PLAN-MAESTRO §3.3 regla 3) y TODO apoyo —literal o con plantilla/ternario— cabe en 140 caracteres.
// Fase 8: las pantallas hermanas son pestañas de una entrada y su título es el de la entrada («Viajes» sobre Despacho, Registro, Mapa…).
// TRANSICIÓN: mientras los paquetes de cada área (P-DAS-OP-*, F9-F11) migran sus pantallas, una pantalla que todavía titula con el
// nombre que tenía en el menú de 49 entradas (`TODAS_LAS_RUTAS`) se acepta; no se acepta ningún otro título. El día que todas titulen
// con el de su entrada, `NOMBRE_ANTERIOR` se vacía y la prueba queda estricta.
describe('el título es el nombre exacto de la entrada del menú', () => {
  const NOMBRE_ENTRADA = new Map(ENTRADAS_DASHBOARD.flatMap((e) => e.pestanas.map((p) => [p.href, e.nombre] as const)));
  const NOMBRE_ANTERIOR = new Map(TODAS_LAS_RUTAS.map((i) => [i.href, i.nombre]));
  // Ronda 4 de F26 (calco de Rovaq): en un hub el eyebrow es el grupo y el h1 es el nombre de la PESTAÑA («Operadores», «Mesa de control»).
  const NOMBRE_PESTANA = new Map(ENTRADAS_DASHBOARD.flatMap((e) => e.pestanas.map((p) => [p.href, p.nombre] as const)));
  it('cada vista que ES la pantalla de una entrada (o pestaña) titula con el nombre de su entrada', () => {
    const mal: string[] = [];
    let comparadas = 0;
    for (const rel of MIGRADAS) {
      const dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
      const href = dir === '' ? '/dashboard' : `/dashboard/${dir}`;
      const entrada = NOMBRE_ENTRADA.get(href);
      const anterior = NOMBRE_ANTERIOR.get(href);
      // Las subpantallas que el menú anterior no nombraba (p. ej. `agentes/vigia/avisos`) conservan su título descriptivo hasta que la
      // fase que las migra (F10 para Automatización) las lleve al nombre de su entrada.
      if (!entrada || !anterior) continue;
      const titulo = tituloDeMarco(fuente(rel));
      if (titulo === null) continue; // título calculado (detalle)
      comparadas++;
      if (titulo !== entrada && titulo !== anterior && titulo !== NOMBRE_PESTANA.get(href)) mal.push(`${rel}: «${titulo}» ≠ entrada «${entrada}» (ni su nombre anterior «${anterior}»)`);
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
