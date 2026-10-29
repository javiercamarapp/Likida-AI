// El arnés ABORTA si lo que va a fotografiar no es la UI v2: sin el atributo [data-ui="v2"] (en el HTML) o sin las reglas
// que cuelgan de él (en el CSS compilado), una captura sale en v1 y "mide" ruido (error de las capturas premium a1/a2).
import { readFileSync } from 'node:fs';

export class ArnesSinV2 extends Error {}

export function exigirV2Html(html: string, id: string): void {
  // No basta con que la cadena aparezca (comentario, texto, otro elemento): debe estar en la etiqueta de apertura del elemento
  // raíz del chrome (`tema-neutro`), en cualquier orden de atributos.
  const raiz = /<div\b(?=[^>]*\bclass="[^"]*\btema-neutro\b)(?=[^>]*\bdata-ui="v2")[^>]*>/;
  if (!raiz.test(html)) throw new ArnesSinV2(`ABORTO: la vista ${id} no trae data-ui="v2" en la raíz del chrome (.tema-neutro) (¿chrome v1?)`);
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
