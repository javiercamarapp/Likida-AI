import ts from 'typescript';

// ═══════════════════════════════════════════════════════════════════════════
// MEDIDOR DE DEUDA i18n — SOLO LO USAN PRUEBAS Y EL SCRIPT DE REGENERACIÓN; la app no lo importa.
//
// Deuda = texto en ESPAÑOL escrito dentro de un archivo de pantalla en vez de salir de un diccionario (`src/lib/i18n/es/*`).
// Mismo método que `scratchpad/i18n/ast-conteo.cjs` (la referencia del plan), con tres diferencias deliberadas:
//   · cuenta solo lo que parece español (acentos, ¿¡ o palabras vacías del español): una clase CSS o un identificador no son deuda;
//   · no cuenta dos veces un texto (un atributo visible con su `{...}` adentro);
//   · mide por ARCHIVO, para que la base se compare archivo a archivo y no se pueda compensar una subida con una bajada.
// Es una cota con imprecisión conocida (±30 %, plan §2): no ve palabras sueltas sin acento ni palabras vacías («Guardar»). Lo
// que fija la guarda no es la cifra exacta sino que NO SUBA.
// ═══════════════════════════════════════════════════════════════════════════

const ATRIBUTOS_VISIBLES = new Set([
  'title', 'aria-label', 'aria-description', 'placeholder', 'alt', 'label', 'apoyo', 'titulo', 'mensaje', 'detalle', 'nota',
  'descripcion', 'etiqueta', 'texto', 'subtitulo', 'cta', 'ayuda',
]);

const PALABRAS_VACIAS = new Set([
  'de', 'la', 'el', 'los', 'las', 'del', 'que', 'en', 'para', 'con', 'por', 'una', 'un', 'se', 'al', 'su', 'sus', 'no', 'es', 'más',
  'sin', 'como', 'este', 'esta', 'tu', 'tus', 'hay', 'falta', 'aún', 'todavía', 'ya', 'si', 'o', 'y', 'ha', 'han', 'ser', 'son',
]);

/** ¿Parece texto en español? Acento/ñ/¿¡, o al menos dos palabras vacías del español (una sola da falsos positivos con «no», «en»). */
export function pareceEspanol(texto: string): boolean {
  if (!/[a-záéíóúñü]{2,}/i.test(texto)) return false;
  if (/[áéíóúñ¿¡]/i.test(texto)) return true;
  const palabras = texto.toLowerCase().split(/[^a-záéíóúñü]+/).filter(Boolean);
  return palabras.filter((p) => PALABRAS_VACIAS.has(p)).length >= 2;
}

const NO_ES_TEXTO = /^[\w\-./:@#?=&%*+,;()[\]{}<>|!$^~\\]+$/;
const SQL = /^\s*(select|insert|update|delete|create|alter|from|with|drop)\b/i;

function esFrase(texto: string): boolean {
  const t = texto.replace(/\s+/g, ' ').trim();
  if (t.length < 4 || NO_ES_TEXTO.test(t) || SQL.test(t)) return false;
  return pareceEspanol(t);
}

/** Cuántos textos en español hay en el código de UN archivo. */
export function medirDeuda(codigo: string, nombre = 'x.tsx'): number {
  const sf = ts.createSourceFile(nombre, codigo, ts.ScriptTarget.Latest, true, nombre.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  let n = 0;

  const contarLiterales = (raiz: ts.Node): void => {
    const rec = (m: ts.Node): void => {
      if (ts.isStringLiteral(m) || ts.isNoSubstitutionTemplateLiteral(m)) { if (esFrase(m.text)) n++; }
      else if (ts.isTemplateExpression(m)) {
        const junto = [m.head.text, ...m.templateSpans.map((s) => s.literal.text)].join(' ');
        if (esFrase(junto)) n++;
        m.templateSpans.forEach((s) => rec(s.expression));
        return;
      }
      ts.forEachChild(m, rec);
    };
    rec(raiz);
  };

  const visitar = (nodo: ts.Node): void => {
    if (ts.isImportDeclaration(nodo) || ts.isExportDeclaration(nodo) || ts.isLiteralTypeNode(nodo) || ts.isTypeNode(nodo)) return;
    if (nodo.kind === ts.SyntaxKind.JsxText) {
      if (esFrase((nodo as ts.JsxText).text)) n++;
      return;
    }
    if (ts.isJsxAttribute(nodo)) {
      if (nodo.initializer && ATRIBUTOS_VISIBLES.has(nodo.name.getText())) { contarLiterales(nodo.initializer); return; }
      if (nodo.initializer && ts.isStringLiteral(nodo.initializer)) return; // className="…", href="…": no es texto visible
    }
    if (ts.isPropertyAssignment(nodo) || ts.isPropertySignature(nodo)) {
      // El valor cuenta; el nombre de la clave no.
      if ('initializer' in nodo && nodo.initializer) visitar(nodo.initializer);
      return;
    }
    if (ts.isElementAccessExpression(nodo)) { visitar(nodo.expression); return; }
    if (ts.isStringLiteral(nodo) || ts.isNoSubstitutionTemplateLiteral(nodo) || ts.isTemplateExpression(nodo)) {
      contarLiterales(nodo);
      return;
    }
    ts.forEachChild(nodo, visitar);
  };
  visitar(sf);
  return n;
}
