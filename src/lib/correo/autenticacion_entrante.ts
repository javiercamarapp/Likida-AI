// Autenticación del remitente de un correo ENTRANTE (SPF / DKIM), a partir de las cabeceras que deje el proveedor
// (`Authentication-Results`, RFC 8601). Pura y sin regex con retroceso: se parte el texto por `;` y espacios.
//
// Tres resultados, a propósito:
//   · 'verificado'   — hay información y SPF o DKIM pasaron para un dominio alineado con el From.
//   · 'rechazado'    — hay información y NINGUNO pasó (fail, softfail, none, o pasó para otro dominio): falla cerrado.
//   · 'sin_informacion' — el proveedor no mandó nada utilizable: el llamador conserva su comportamiento y lo registra.

export type AutenticacionRemitente = 'verificado' | 'rechazado' | 'sin_informacion';

export type CabecerasEntrantes = Record<string, unknown> | Array<{ name?: unknown; value?: unknown }> | null | undefined;

/** Valores de las cabeceras `Authentication-Results` (y `ARC-Authentication-Results` NO: la firma la puede poner cualquiera). */
export function resultadosDeAutenticacion(cabeceras: CabecerasEntrantes): string[] {
  if (!cabeceras || typeof cabeceras !== 'object') return [];
  const pares: Array<[string, unknown]> = Array.isArray(cabeceras)
    ? cabeceras.map((h) => [String(h?.name ?? ''), h?.value])
    : Object.entries(cabeceras);
  const salida: string[] = [];
  for (const [nombre, valor] of pares) {
    if (nombre.trim().toLowerCase() !== 'authentication-results') continue;
    if (typeof valor === 'string') salida.push(valor);
    else if (Array.isArray(valor)) for (const v of valor) if (typeof v === 'string') salida.push(v);
  }
  return salida;
}

interface Metodo { metodo: 'spf' | 'dkim'; resultado: string; dominio: string | null }

/** Extrae los métodos spf/dkim de UN valor de Authentication-Results. */
function metodosDe(valor: string): Metodo[] {
  const salida: Metodo[] = [];
  // Cada cláusula va separada por `;`. La primera es el id del servidor que autenticó.
  for (const clausula of valor.split(';').slice(1)) {
    const fichas = clausula.trim().split(/\s+/).filter(Boolean);
    const [primera, ...resto] = fichas;
    if (!primera) continue;
    const igual = primera.indexOf('=');
    if (igual <= 0) continue;
    const metodo = primera.slice(0, igual).toLowerCase();
    if (metodo !== 'spf' && metodo !== 'dkim') continue;
    const resultado = primera.slice(igual + 1).toLowerCase();
    let dominio: string | null = null;
    for (const f of resto) {
      const i = f.indexOf('=');
      if (i <= 0) continue;
      const clave = f.slice(0, i).toLowerCase();
      if (clave === 'smtp.mailfrom' || clave === 'header.d' || clave === 'header.i' || clave === 'header.from') {
        const v = f.slice(i + 1).replace(/[;"]/g, '').toLowerCase();
        dominio = v.includes('@') ? v.slice(v.lastIndexOf('@') + 1) : v.replace(/^@/, '');
        break;
      }
    }
    salida.push({ metodo, resultado, dominio });
  }
  return salida;
}

function alineado(dominioFirma: string | null, dominioFrom: string): boolean {
  // Sin dominio declarado en el resultado no hay con qué comparar: se acepta lo que el proveedor dio por pasado.
  if (!dominioFirma) return true;
  return dominioFirma === dominioFrom || dominioFrom.endsWith(`.${dominioFirma}`) || dominioFirma.endsWith(`.${dominioFrom}`);
}

/**
 * @param dominioFrom dominio de la dirección From ya normalizada (minúsculas), o null si no hay dirección inequívoca.
 */
export function autenticacionDeRemitente(cabeceras: CabecerasEntrantes, dominioFrom: string | null): AutenticacionRemitente {
  const metodos = resultadosDeAutenticacion(cabeceras).flatMap(metodosDe);
  if (metodos.length === 0) return 'sin_informacion';
  if (!dominioFrom) return 'rechazado';
  const paso = metodos.some((m) => m.resultado === 'pass' && alineado(m.dominio, dominioFrom));
  return paso ? 'verificado' : 'rechazado';
}
