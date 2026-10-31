// El arnés ABORTA si lo que va a fotografiar no es la UI v2: sin el atributo [data-ui="v2"] (en el HTML) o sin las reglas
// que cuelgan de él (en el CSS compilado), una captura sale en v1 y "mide" ruido (error de las capturas premium a1/a2).
import { readFileSync } from 'node:fs';

export class ArnesSinV2 extends Error {}

/** Rangos [ini, fin) del HTML donde una etiqueta NO cuenta: comentarios, <script> y <style> (se recorren, no se borran). */
function rangosInertes(html: string): Array<[number, number]> {
  const rangos: Array<[number, number]> = [];
  for (const [abre, cierra] of [['<!--', '-->'], ['<script', '</script>'], ['<style', '</style>']] as const) {
    const bajo = html.toLowerCase();
    let desde = 0;
    for (;;) {
      const i = bajo.indexOf(abre, desde);
      if (i < 0) break;
      const j = bajo.indexOf(cierra, i + abre.length);
      const fin = j < 0 ? html.length : j + cierra.length;
      rangos.push([i, fin]);
      desde = fin;
    }
  }
  return rangos;
}

export function exigirV2Html(html: string, id: string): void {
  // La etiqueta de apertura del elemento raíz del chrome (`tema-neutro`) debe llevar data-ui="v2" (en cualquier orden de
  // atributos), FUERA de comentarios y scripts, y su contenido debe traer el shell.
  const inertes = rangosInertes(html);
  const reRaiz = /<div\b(?=[^>]*\bclass="[^"]*\btema-neutro\b)(?=[^>]*\bdata-ui="v2")[^>]*>/g;
  let m: RegExpExecArray | null;
  let raiz: RegExpExecArray | null = null;
  while ((m = reRaiz.exec(html)) !== null) {
    if (!inertes.some(([a, b]) => m!.index >= a && m!.index < b)) { raiz = m; break; }
  }
  if (!raiz) throw new ArnesSinV2(`ABORTO: la vista ${id} no trae data-ui="v2" en la raíz del chrome (.tema-neutro) (¿chrome v1?)`);
  const desdeRaiz = raiz.index + raiz[0].length;
  const reShell = /class="[^"]*\b(rv-sb|rv-cab-movil)\b/g;
  let hayShell = false;
  while ((m = reShell.exec(html)) !== null) {
    if (m.index >= desdeRaiz && !inertes.some(([a, b]) => m!.index >= a && m!.index < b)) { hayShell = true; break; }
  }
  if (!hayShell) throw new ArnesSinV2(`ABORTO: la raíz v2 de ${id} no contiene el shell (.rv-sb / .rv-cab-movil)`);
}

export function exigirV2Css(ruta: string): void {
  const css = readFileSync(ruta, 'utf8');
  if (!css.includes('[data-ui="v2"]') || !/--surface\s*:/.test(css)) throw new ArnesSinV2(`ABORTO: ${ruta} no contiene las reglas v2 ([data-ui="v2"] + tokens)`);
}

/** Se ejecuta DENTRO de la página ya cargada: devuelve null si todo está bien, o el motivo del aborto. */
export const comprobarPaginaV2 = () => {
  const raiz = document.querySelector('[data-ui="v2"]');
  if (!raiz) return 'la página no tiene [data-ui="v2"]';
  if (!getComputedStyle(raiz).getPropertyValue('--surface').trim()) return 'el CSS v2 no se aplicó: --surface vacío bajo [data-ui="v2"]';
  return null;
};
