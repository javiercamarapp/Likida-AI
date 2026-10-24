// A37-S31-04 · Quitar los bloques <script>/<style> de un HTML de un tercero en TIEMPO LINEAL.
//
// `/<(script|style)[\s\S]*?<\/\1>/gi` es cuadrático con muchos «<script » sin cierre: cada apertura recorre el resto del
// texto buscando un cierre que no existe. Aquí cada etiqueta se busca UNA vez; si ya no hay más cierres de ese tipo, las
// aperturas siguientes se dejan tal cual (lo mismo que hacía la expresión: sin cierre no coincide).

/** Más allá de esto un correo/HTML no es un documento de embarque: se recorta antes de procesarlo. */
export const MAX_CHARS_HTML = 2_000_000;

export function quitarScriptYEstilo(html: string): string {
  const entrada = html.length > MAX_CHARS_HTML ? html.slice(0, MAX_CHARS_HTML) : html;
  const apertura = /<(script|style)/gi;
  const cierre: Record<string, RegExp> = { script: /<\/script>/gi, style: /<\/style>/gi };
  const sinCierre = new Set<string>();
  let salida = '';
  let desde = 0;
  for (;;) {
    apertura.lastIndex = desde;
    const a = apertura.exec(entrada);
    if (!a) break;
    const etiqueta = a[1].toLowerCase();
    if (sinCierre.has(etiqueta)) { salida += entrada.slice(desde, a.index + a[0].length); desde = a.index + a[0].length; continue; }
    const re = cierre[etiqueta];
    re.lastIndex = a.index + a[0].length;
    const c = re.exec(entrada);
    if (!c) { sinCierre.add(etiqueta); salida += entrada.slice(desde, a.index + a[0].length); desde = a.index + a[0].length; continue; }
    salida += `${entrada.slice(desde, a.index)} `;
    desde = c.index + c[0].length;
  }
  return salida + entrada.slice(desde);
}

/** Cualquier etiqueta `<...>` sin otro `<` adentro: acotado, a diferencia de `<[^>]+>` (cuadrático con muchos «<» sueltos). */
export const ETIQUETA_HTML = /<[^<>]*>/g;
