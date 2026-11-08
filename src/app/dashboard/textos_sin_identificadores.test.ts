// Guarda: ningún texto VISIBLE de /dashboard (pantallas de cliente) nombra una tabla de la base ni un número de migración.
//
// También las variables de entorno del servidor (`RESEND_EMAIL_DOMAIN`, `LIKIDA_*`…): configuración que el cliente no toca.
// Auditoría en vivo (7-nov-2026): «KPIs del piloto» imprimía `viaje_hito.fuente (...)` y la bandeja de descarga SAT
// `sat_cfdi_descargado_casado_coherente (0231)`. El contralor no sabe qué es una tabla; el nombre interno es ruido y además
// regala el esquema. Acotada a propósito para no dar falsos positivos:
//  · nombres de tabla = los `create table` multi-palabra (con guion bajo) de supabase/migrations, leídos de forma estática;
//  · solo texto que se PINTA: texto JSX, cadenas dentro de {…} de JSX y atributos title/aria-label/placeholder/alt/label;
//  · NO se miran columnas de plantillas CSV (`radio_m`, `numero_empleado`…): son el contrato del archivo que el cliente sube.
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const RAIZ = path.resolve(__dirname, '../../..');

function tablasDeMigraciones(): Set<string> {
  const dir = path.join(RAIZ, 'supabase/migrations');
  const out = new Set<string>();
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.sql')) continue;
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const m of sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?([a-z][a-z0-9_]*)"?/gi)) {
      if (m[1].includes('_')) out.add(m[1].toLowerCase());
    }
  }
  return out;
}

const NUM_MIGRACION = /\(\s*0\d{3}\s*\)|migraci[oó]n\s+0\d{3}|\bmig\.\s*0\d{3}/gi;
const ATRIBUTOS_VISIBLES = new Set(['title', 'aria-label', 'placeholder', 'alt', 'label', 'apoyo', 'titulo', 'mensaje', 'detalle', 'nota']);
/** Variables de entorno del servidor: el cliente no las configura ni debe leerlas. */
const VARIABLE_ENTORNO = /\b(?:LIKIDA|RESEND|PEAJES|WHATSAPP|SUPABASE|NEXT_PUBLIC|DEMO|CRON|FACTURACION)_[A-Z0-9_]+\b/g;

/** Los textos que el usuario lee dentro de un archivo TSX. */
export function textosVisibles(codigo: string, nombre = 'x.tsx'): string[] {
  const sf = ts.createSourceFile(nombre, codigo, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const textos: string[] = [];
  const visitar = (n: ts.Node): void => {
    if (n.kind === ts.SyntaxKind.JsxText) textos.push((n as ts.JsxText).text);
    else if (ts.isJsxExpression(n) && n.expression) {
      const e = n.expression;
      if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) textos.push(e.text);
      else if (ts.isTemplateExpression(e)) textos.push(e.head.text, ...e.templateSpans.map((s) => s.literal.text));
    } else if (ts.isJsxAttribute(n) && ATRIBUTOS_VISIBLES.has(n.name.getText()) && n.initializer) {
      // Cadena directa o cualquier literal dentro de la expresión (`apoyo={x ? 'a' : 'b'}`).
      const recoger = (m: ts.Node): void => {
        if (ts.isStringLiteral(m) || ts.isNoSubstitutionTemplateLiteral(m)) textos.push(m.text);
        else if (ts.isTemplateHead(m) || ts.isTemplateMiddle(m) || ts.isTemplateTail(m)) textos.push(m.text);
        ts.forEachChild(m, recoger);
      };
      recoger(n.initializer);
    }
    ts.forEachChild(n, visitar);
  };
  visitar(sf);
  return textos;
}

export function hallazgos(texto: string, tablas: Set<string>): string[] {
  const out: string[] = [];
  for (const m of texto.matchAll(/[a-z][a-z0-9]*(?:_[a-z0-9]+)+/g)) if (tablas.has(m[0])) out.push(m[0]);
  for (const m of texto.matchAll(NUM_MIGRACION)) out.push(m[0]);
  for (const m of texto.matchAll(VARIABLE_ENTORNO)) out.push(m[0]);
  return out;
}

/** Pantallas que SOLO ve el superadmin de Likida (nunca un cliente): `tenantExiste === false` solo ocurre con la flota demo borrada. */
const SOLO_SUPERADMIN = new Set(['src/app/dashboard/sin-flota.tsx']);

function archivosTsx(dir: string, acc: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) archivosTsx(p, acc);
    else if (p.endsWith('.tsx') && !p.endsWith('.test.tsx')) acc.push(p);
  }
  return acc;
}

describe('textos visibles de /dashboard sin identificadores internos', () => {
  const tablas = tablasDeMigraciones();

  it('la guarda sí detecta lo que debe (y no lo que no)', () => {
    expect(tablas.size).toBeGreaterThan(50);
    expect(hallazgos('candado: sat_cfdi_descargado_casado_coherente (0231)', new Set(['sat_cfdi_descargado_casado_coherente']))).toEqual([
      'sat_cfdi_descargado_casado_coherente', '(0231)',
    ]);
    expect(hallazgos('Columnas: radio_m, numero_empleado', new Set(['viaje_hito']))).toEqual([]);
    expect(hallazgos('Falta RESEND_EMAIL_DOMAIN en el servidor', new Set())).toEqual(['RESEND_EMAIL_DOMAIN']);
    const tsx = 'export const A = () => <p title="viaje_hito">hola <b>{`ok`}</b><code>{"viaje_hito"}</code><M apoyo={x ? "LIKIDA_PAC_X" : `b`} /></p>;';
    const t = textosVisibles(tsx).join('|');
    expect(t).toContain('viaje_hito');
    expect(t).toContain('LIKIDA_PAC_X');
  });

  it('ninguna pantalla de cliente nombra una tabla ni un número de migración', () => {
    const malos: string[] = [];
    for (const f of archivosTsx(path.join(RAIZ, 'src/app/dashboard'))) {
      if (SOLO_SUPERADMIN.has(path.relative(RAIZ, f))) continue;
      for (const t of textosVisibles(fs.readFileSync(f, 'utf8'), f)) {
        for (const h of hallazgos(t, tablas)) malos.push(`${path.relative(RAIZ, f)}: ${h}`);
      }
    }
    expect(malos).toEqual([]);
  });
});
