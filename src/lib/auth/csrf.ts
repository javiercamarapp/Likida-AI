// ═══════════════════════════════════════════════════════════════════════════
// ¿ESTA ESCRITURA LA PIDIÓ NUESTRA PROPIA PÁGINA?
//
// AUDITORÍA PROD (22-ago-2026) · SEG-9. Las rutas que escriben y se autentican
// por COOKIE —`/api/admin/palette` (apagar un interruptor) y `/v1/*` cuando
// entra un navegador con sesión— no miraban de dónde venía la petición. La
// cookie de Supabase es `sameSite: 'lax'`, y eso YA bloquea el caso clásico
// (un `fetch` cross-site no la lleva), pero `lax` es una mitigación del
// navegador, no una decisión nuestra:
//
//   · un navegador viejo, o uno con la política relajada por configuración
//     empresarial, no la aplica;
//   · `lax` deja pasar la navegación de alto nivel (un `<form method=POST>`
//     enviado por un link) en algunas combinaciones;
//   · y el día que alguien necesite `sameSite: 'none'` para embeber algo, la
//     única defensa desaparece sin que ninguna prueba se ponga roja.
//
// Esta comprobación es NUESTRA y se ve en el código de la ruta.
//
// ── CÓMO SE DECIDE, Y POR QUÉ ASÍ ────────────────────────────────────────
//
//  1. `Sec-Fetch-Site` manda cuando viene. Lo pone el NAVEGADOR y una página
//     atacante no lo puede falsear (es una cabecera prohibida para JS).
//     `same-origin` y `none` (el usuario tecleó la URL) pasan; `cross-site` y
//     `same-site` no — `likida.ai` y `app.likida.ai` son el mismo sitio y
//     orígenes distintos, y la landing no tiene por qué escribir aquí.
//  2. Si no viene, se mira `Origin` contra el host de la propia petición.
//     Cubre a los navegadores que aún no mandan `Sec-Fetch-*`.
//  3. Si no viene NINGUNO de los dos, pasa. No es un agujero: un ataque CSRF
//     ES un navegador, y un navegador siempre manda `Origin` en un POST
//     cross-site. Sin ninguna de las dos cabeceras quien llama es `curl`, un
//     TMS o un cron — que no tiene cookies de nadie y, si trae credencial, es
//     porque se la dieron. Rechazar ahí rompería a los integradores sin
//     cerrarle la puerta a nadie.
// ═══════════════════════════════════════════════════════════════════════════

/** El host público de ESTA petición. Detrás de Vercel, `host` ya es el
 *  dominio real; `x-forwarded-host` gana cuando hay otro proxy delante. */
function hostPropio(req: Request): string | null {
  const h = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  return h ? h.toLowerCase() : null;
}

/** El host de un `Origin`. `null` si es la cadena "null" (iframe aislado) o
 *  si no es una URL: en la duda, no coincide con nada. */
function hostDeOrigen(origen: string): string | null {
  if (origen === 'null') return null;
  try { return new URL(origen).host.toLowerCase(); } catch { return null; }
}

/**
 * `true` si la petición NO parece venir de otro sitio.
 *
 * Pensada para envolver ESCRITURAS autenticadas por cookie. En lecturas no
 * hace falta (no hay efecto) y en peticiones con `Authorization: Bearer`
 * tampoco (esa cabecera el navegador no la pone solo: no hay CSRF que valga).
 */
export function vieneDeNuestroSitio(req: Request): boolean {
  const sfs = req.headers.get('sec-fetch-site');
  if (sfs) return sfs === 'same-origin' || sfs === 'none';

  const origen = req.headers.get('origin');
  if (!origen) return true; // no es un navegador; ver la cabecera del archivo

  const propio = hostPropio(req);
  const deOrigen = hostDeOrigen(origen);
  return propio !== null && deOrigen !== null && propio === deOrigen;
}

/** Los métodos que cambian algo. Un GET no necesita esta puerta. */
export function escribe(metodo: string): boolean {
  return metodo !== 'GET' && metodo !== 'HEAD' && metodo !== 'OPTIONS';
}
