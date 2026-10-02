# CSP con nonce (Ola 9, seguridad) — qué cambió, qué no, cómo revertir

Hallazgo de origen: auditoría ola 1 #5 (`script-src 'unsafe-inline'` en producción). Código: `src/lib/seguridad/csp.ts` y
`src/proxy.ts`. Pruebas: `src/proxy_csp_nonce.test.ts`, `src/lib/seguridad/csp.test.ts`.

## Qué hace ahora (Ola 9b, 2-oct-2026)

| Rutas | `script-src` |
|---|---|
| **Todas** las que pasan por el proxy (home, `/login`, `/aviso`, `/terminos`, `/privacidad`, blog, demo, `/dashboard`, `/admin`, `/vendedor`, …) | `'self' 'nonce-<por petición>' 'sha256-<tema>' 'strict-dynamic'` — **sin** `'unsafe-inline'` |
| `/api/*`, `/_next/static`, `/_next/image` | fuera del matcher del proxy: no llevan CSP de página (las API no sirven HTML) |
| Cualquier ruta con `LIKIDA_CSP_NONCE=0` | `'self' 'unsafe-inline'` (reversa de emergencia) |

- El proxy genera un nonce de 16 bytes por petición y lo pone en el header CSP de la **petición** (Next lo lee de ahí y lo
  estampa en sus propios `<script>`: bootstrap, streaming `__next_f.push`, chunks) y en la **respuesta**.
- El único `<script>` inline propio (tema oscuro, `app/layout.tsx`) va por **hash SHA-256** (`lib/seguridad/script_tema.ts`).
- **Decisión de Javier (2-oct-2026):** el nonce también en las públicas, aceptando perder la caché de CDN. Para que Next pueda
  estampar el nonce, el layout raíz es `async` y llama `await connection()`: **todo el sitio se renderiza por petición**.
- Scripts de terceros: se buscaron `next/script`, `<script`, `@vercel/analytics`, Speed Insights, Sentry de navegador, Cal.com,
  gtag, plausible, posthog e `<iframe>` en `src`/`package.json`: **no hay ninguno** en el navegador (Sentry y Cal.com son solo
  servidor). Por eso `connect-src 'self'` y `frame-src 'none'` no cambian.
  `img-src` es `'self' data: blob: https://*.supabase.co https://tile.openstreetmap.org`: Storage (avatares, fotos), los tiles del mapa de
  prospectos (`admin/mapa-prospectos/calles.tsx`) y `blob:` para la vista previa local del avatar (`admin/mi-perfil/avatar-uploader.tsx`).
  Solo esos orígenes: se buscaron `tileLayer`, `createObjectURL` y `<img src="https://…">` en `src` y no hay otros que se pinten.
  Si se agrega uno: `next/script` con nonce (se propaga solo en páginas dinámicas) y ampliar solo la directiva que use.
- `style-src 'self' 'unsafe-inline'` se queda: ~1,200 `style={{…}}` (atributos) que ni nonce ni hash cubren. Riesgo menor que scripts.
- No hay excepción de `'unsafe-inline'` en scripts en ninguna ruta de HTML.
- `sitemap.xml`, `robots.txt` e iconos son route handlers/metadatos: no ejecutan el layout, no se vuelven dinámicos por esto
  (reciben el header CSP inofensivo del proxy). `unsafe-eval` solo en `next dev`.

## Costo de caché (dicho, no escondido)

Las páginas públicas que eran estáticas (prerenderizadas, servidas desde CDN) ahora se renderizan en cada petición: más cómputo
de funciones, más latencia (TTFB) y sin caché de borde. La home, `/login` y `/aviso/[tenant]` ya eran `force-dynamic`. Las cifras de
rutas, medidas con `next build` antes y después de la Ola 9b: **242 rutas = 13 estáticas + 1 SSG + 228 dinámicas** antes (nonce solo en `/dashboard`, `/admin`, `/vendedor`) y
**4 estáticas + 0 SSG + 238 dinámicas** después (solo quedan estáticas `/apple-icon.png`, `/icon.svg`, `/robots.txt` y `/sitemap.xml`). Pasan a dinámicas `/blog`,
`/blog/[slug]`, `/calculadora`, `/demo`, `/privacidad`, `/seguridad`, `/sin-acceso`, `/terminos`, `/aviso/prospectos` y `/_not-found`. No se midió latencia ni costo en producción.

## Deuda residual

1. **`style-src 'unsafe-inline'`** (arriba).
2. **Verificación en navegador real** de la consola («Refused to execute»): `next start` con Playwright (Chromium) en `/`, `/login`, un artículo del blog y una 404 dio
   0 errores de CSP; el HTML con sesión real de `/dashboard`, `/admin` y `/vendedor` no se pudo verificar sin Supabase y lo cubren `proxy_csp_nonce.test.ts` y `csp.test.ts`.

## Revertir sin tocar código

`LIKIDA_CSP_NONCE=0` (variable de entorno de Vercel; requiere redeploy) devuelve **todas** las rutas (de sesión y públicas) a `script-src 'self' 'unsafe-inline'`. Revertir del todo la Ola 9b (volver a
públicas estáticas) exige además revertir el commit del layout raíz (`await connection()`).
Cualquier otro valor, o vacío, deja el nonce encendido: la reversa es explícita.

## Si agregas un `<script>` inline o `next/script`

La prueba `el ÚNICO <script> inline del repo es el del tema` falla. Un script inline nuevo en una ruta con sesión **no corre** (no
tiene nonce ni hash): usa un módulo normal, o agrega su hash en `csp.ts` si es una constante.
