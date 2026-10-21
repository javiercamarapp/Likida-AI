// ═══════════════════════════════════════════════════════════════════════════
// ¿DE QUÉ COMERCIO ES ESTE TICKET?
//
// Primer paso de todo el módulo: sin comercio no se sabe qué campos pedirle al
// extractor ni a qué portal ir.
//
// Mandar un ticket al comercio equivocado NO falla de forma visible: falla
// pidiéndole a la oficina un "Web ID" que ese ticket nunca tuvo, y nadie
// entiende por qué. Por eso, sin respuesta única, no se adivina.
// ═══════════════════════════════════════════════════════════════════════════

import { COMERCIOS, type Comercio } from './comercios';

export interface SeñalesTicket {
  /** Liga de facturación (del QR o leída del papel). La señal más fuerte. */
  urlFacturacion?: string;
  /** RFC del emisor, ya validado con dígito verificador. */
  rfcEmisor?: string;
  /** Texto crudo del ticket. La señal más débil: pasó por visión. */
  textoTicket?: string;
}

/**
 * Prioridad deliberada: dominio → RFC → texto.
 *
 * El dominio viene del QR y no pasó por OCR. El RFC pasó por OCR pero lo
 * respalda el dígito verificador. El texto es lo único que puede confundirse
 * con la publicidad impresa de otra marca en el mismo papel.
 */
export function identificarComercio(señales: SeñalesTicket): Comercio | null {
  const url = señales.urlFacturacion?.toLowerCase() ?? '';
  if (url) {
    // GANA EL DOMINIO MÁS ESPECÍFICO, NO EL QUE ESTÉ ANTES EN LA LISTA.
    //
    // Un ticket de G500 Sureste (Mérida, 18-ago-2026) trae los DOS: la marca de
    // agua de la red —`www.g500network.com`, repetida por todo el papel, o sea
    // lo que el OCR lee con más probabilidad— y el pie de la franquicia,
    // `g500sureste.com.mx`. Con `find` ganaba `g500` por estar antes en
    // `COMERCIOS`, y `g500` declara `requiereCuenta: true` y apunta a un portal
    // donde ese ticket NO se factura — su propio comentario lo dice. El
    // operador acababa en el portal equivocado, que es exactamente lo que el
    // encabezado de este archivo promete no hacer.
    //
    // El dominio más largo es el más específico por construcción: la franquicia
    // que monta su propio sistema tiene siempre un host más particular que el de
    // la red que la agrupa.
    const porDominio = COMERCIOS
      .map((c) => ({ c, d: masLargo((c.reconocer.dominios ?? []).filter((d) => url.includes(d.toLowerCase()))) }))
      .filter((x): x is { c: Comercio; d: string } => x.d !== null)
      .sort((a, b) => b.d.length - a.d.length)[0];
    if (porDominio) return porDominio.c;
  }

  const rfc = señales.rfcEmisor?.trim().toUpperCase() ?? '';
  if (rfc) {
    const porRfc = COMERCIOS.find((c) => c.reconocer.rfc?.some((r) => r.toUpperCase() === rfc));
    if (porRfc) return porRfc;
  }

  const texto = señales.textoTicket?.toUpperCase() ?? '';
  if (texto) {
    // Palabra completa, no subcadena: "ADO" (autobuses) es substring literal de
    // "OPERADORA" — un ticket real de café con emisor "OPERADORA DE CAFE
    // PENINSULAR" se identificaba como la línea de camiones ADO y mandaba al
    // operador a un portal que le pedía "número de boleto" a un café. Cualquier
    // token corto (3-4 letras) puede colisionar así contra palabras comunes en
    // español que lo contienen.
    const esPalabraCompleta = (t: string) => {
      const escapado = t.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`\\b${escapado}\\b`).test(texto);
    };
    const coincidencias = COMERCIOS
      .map((c) => ({ c, t: masLargo((c.reconocer.texto ?? []).filter(esPalabraCompleta)) }))
      .filter((x): x is { c: Comercio; t: string } => x.t !== null);
    if (coincidencias.length === 1) return coincidencias[0].c;

    // DOS MARCAS EN EL MISMO PAPEL SIGUEN SIN TENER RESPUESTA ÚNICA. Pero
    // "G500" y "G500 MEGASUR" NO son dos marcas: son la red y su franquicia, y
    // el token de una está DENTRO del de la otra.
    //
    // Sin esta distinción, el emisor literal del ticket del sureste —el mismo
    // que el catálogo cita como verificado, timbrado el 29-jul-2026— casaba con
    // las dos entradas y se iba a `null`: sin portal, a que lo facture una
    // persona, teniendo la ficha correcta escrita al lado.
    //
    // Y la prueba que debía cazarlo no lo cazaba: `identificar.test.ts` compara
    // tokens IDÉNTICOS entre comercios, así que nunca vio que uno case DENTRO
    // de otro, que es lo que hace `\b…\b` en tiempo de ejecución.
    //
    // Anidado = refinamiento de la misma marca → gana el específico. No anidado
    // = dos marcas de verdad → sigue sin adivinarse.
    if (coincidencias.length > 1) {
      const [mayor, ...resto] = [...coincidencias].sort((a, b) => b.t.length - a.t.length);
      const todosDentro = resto.every((x) => mayor.t.toUpperCase().includes(x.t.toUpperCase()));
      if (todosDentro) return mayor.c;
    }
  }

  return null;
}

/** El más largo de los que casaron —o sea el más específico—, o `null`. */
function masLargo(casaron: string[]): string | null {
  if (!casaron.length) return null;
  return [...casaron].sort((a, b) => b.length - a.length)[0];
}

/**
 * ¿El HOSTNAME de `url` es, literalmente o como subdominio, alguno de
 * `dominiosVerificados`?
 *
 * SEGURIDAD (hallazgo 21-oct-2026, cola-jefe.tsx «Abrir el portal»):
 * `urlFacturacion` puede venir de un QR fotografiado por cualquiera que le
 * mande una foto al número de intake — nunca pasó por una persona de la
 * oficina. El botón de la cola del jefe la abre con PRIORIDAD sobre el portal
 * fijo del catálogo, así que antes de confiar en ella hay que saber que
 * pertenece al mismo comercio que ya se identificó, no solo que `includes()`
 * encontró la subcadena en algún lado del string (eso es lo que hace
 * `identificarComercio`, y es exactamente lo que un atacante puede fabricar
 * metiendo el dominio real en la RUTA o la QUERY de un host ajeno).
 *
 * Deliberadamente NO compara contra un solo dominio (el de `portal`): un
 * comercio puede tener varios dominios registrados que NO son subdominio uno
 * del otro y van al MISMO portal — ver `megasur` (`reconocer.dominios:
 * ['megasur.com.mx', 'g500sureste.com.mx']`, dos marcas del sureste, un solo
 * formulario). Compararla solo contra `portal` rechazaría ese caso legítimo.
 *
 * Usa `new URL(...).hostname`, no `.includes()`: el hostname es lo único que
 * el navegador usa para decidir a dónde conecta. Una URL que no parsea se
 * trata como no confiable (fail closed).
 */
export function hostnameDeConfianza(url: string, dominiosVerificados: string[]): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (!host) return false;
  return dominiosVerificados.some((d) => {
    const base = d.trim().toLowerCase();
    return base !== '' && (host === base || host.endsWith(`.${base}`));
  });
}
