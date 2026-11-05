import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';

// ═══════════════════════════════════════════════════════════════════════════
// PT-08 (F2): test de copy de términos prohibidos en las pantallas del cliente.
//
// Regla: lo que el cliente lee sale del dato medido o dice «no medido» / «por conectar»; nunca habla
// de nuestra cocina. Esta prueba recorre el árbol sintáctico de cada `.tsx` de /dashboard y
// /ui-v2 (los comentarios NO cuentan: solo el texto JSX, los literales de texto y los atributos
// title / aria-label / alt / placeholder) y falla si aparece jerga interna: migraciones por número,
// el cron, variables de entorno, «stand-by», marcadores de trabajo pendiente, «Próximamente»
// suelto, nombres de tablas con punto (`viaje_hito.interpretacion`).
//
// Las pantallas de /admin son del equipo de Likida y quedan fuera (su revisión es de F5 / L5D).
// Los encabezados de CSV que el cliente debe teclear (`clave_externa`, `geocerca_codigo`) son
// parte del contrato de la plantilla y NO son jerga: por eso no se veta el guion bajo en general.
// ═══════════════════════════════════════════════════════════════════════════

const RAIZ = process.cwd();
const CARPETAS = ['src/app/dashboard', 'src/app/ui-v2'];

export const TERMINOS_PROHIBIDOS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bmigraci[oó]n(es)?\s+(n[uú]m(ero)?\.?\s*)?0\d{3}\b/i, 'migración por número'],
  [/\bmig\.\s*0\d{3}\b/i, 'migración por número (mig. NNNN)'],
  [/falta(n)? aplicar/i, 'falta aplicar (migración pendiente en pantalla)'],
  [/\bvariables? de entorno\b/i, 'variable de entorno'],
  [/\b(process\.env|NEXT_PUBLIC_|SUPABASE_|CRON_SECRET|SERVICE_ROLE)\w*/i, 'nombre de variable de entorno'],
  [/\bel cron\b|\bcron de\b|\bcrons?\b/i, 'cron'],
  [/\bstand-?by\b/i, 'stand-by'],
  [/\b(TODO|FIXME|XXX|TBD|WIP)\b/, 'marcador de trabajo pendiente'],
  [/lorem ipsum/i, 'texto de relleno'],
  [/\bservice[_ ]role\b|\bRLS\b|\bRPC\b/i, 'jerga de base de datos'],
  [/\b[a-z]+_[a-z]+\.[a-z_]+\b/, 'tabla.columna visible'],
  [/\(provisional\)|\bpor completar\b/i, 'marcador de texto provisional'],
];

/** Textos conocidos que usan una palabra vetada como CONTENIDO legítimo. Cada excepción lleva su motivo. */
const EXCEPCIONES: ReadonlyArray<{ archivo: RegExp; texto: RegExp; motivo: string }> = [];

function archivos(dir: string): string[] {
  const salida: string[] = [];
  for (const nombre of readdirSync(dir)) {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) { salida.push(...archivos(ruta)); continue; }
    if (/\.tsx$/.test(nombre) && !/\.test\./.test(nombre)) salida.push(ruta);
  }
  return salida;
}

const ATRIBUTOS_DE_TEXTO = new Set(['title', 'aria-label', 'alt', 'placeholder']);

/** Los textos que un cliente puede leer en un `.tsx`: nunca comentarios, nunca imports, nunca tipos. */
export function textosVisibles(codigo: string, nombre = 'x.tsx'): string[] {
  const sf = ts.createSourceFile(nombre, codigo, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const textos: string[] = [];
  const visitar = (n: ts.Node): void => {
    if (ts.isImportDeclaration(n) || ts.isExportDeclaration(n) || ts.isTypeNode(n) || ts.isInterfaceDeclaration(n) || ts.isTypeAliasDeclaration(n)) return;
    let texto: string | null = null;
    if (ts.isJsxText(n)) texto = n.getText();
    else if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) {
      const padre = n.parent;
      if (ts.isJsxAttribute(padre)) { if (ATRIBUTOS_DE_TEXTO.has(padre.name.getText())) texto = n.text; }
      else if (!(ts.isPropertyAssignment(padre) && padre.name === n) && !ts.isElementAccessExpression(padre)) texto = n.text;
    } else if (ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) texto = n.text;
    if (texto && /\s/.test(texto.trim())) textos.push(texto.trim().replace(/\s+/g, ' '));
    ts.forEachChild(n, visitar);
  };
  visitar(sf);
  return textos;
}

export function violaciones(codigo: string, nombre = 'x.tsx'): string[] {
  const salida: string[] = [];
  for (const t of textosVisibles(codigo, nombre)) {
    for (const [re, motivo] of TERMINOS_PROHIBIDOS) {
      if (!re.test(t)) continue;
      if (EXCEPCIONES.some((e) => e.archivo.test(nombre) && e.texto.test(t))) continue;
      salida.push(`${motivo}: «${t.slice(0, 90)}»`);
    }
  }
  return salida;
}

describe('PT-08 — copy de las pantallas del cliente sin términos prohibidos', () => {
  it('ninguna pantalla de /dashboard ni /ui-v2 habla de migraciones, crons, variables de entorno ni marcadores', () => {
    const todas: string[] = [];
    let revisados = 0;
    for (const carpeta of CARPETAS) {
      for (const archivo of archivos(join(RAIZ, carpeta))) {
        revisados++;
        for (const v of violaciones(readFileSync(archivo, 'utf8'), archivo)) todas.push(`${relative(RAIZ, archivo)} → ${v}`);
      }
    }
    expect(revisados).toBeGreaterThan(100);
    expect(todas).toEqual([]);
  });

  it('el detector atrapa jerga interna (control negativo) y no marca comentarios ni encabezados de CSV', () => {
    expect(violaciones('export const A = () => <p>Falta aplicar la migración 0938 en la base.</p>')).not.toEqual([]);
    expect(violaciones('export const A = () => <p>El cron de rastreo corre cada 5 minutos.</p>')).not.toEqual([]);
    expect(violaciones('export const A = () => <p title="Esto es stand-by hoy">hola</p>')).not.toEqual([]);
    expect(violaciones('export const A = () => <p>TODO poner el texto final aquí</p>')).not.toEqual([]);
    expect(violaciones("const f = 'viaje_hito.interpretacion (validación)';")).not.toEqual([]);
    expect(violaciones('// La migración 0938 y el cron viven aquí\n/* stand-by */\nexport const A = () => <p>Hola mundo cliente</p>')).toEqual([]);
    expect(violaciones("export const A = () => <code>clave_externa, geocerca_codigo</code>")).toEqual([]);
  });
});
