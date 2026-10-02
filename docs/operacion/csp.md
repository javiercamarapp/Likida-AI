# CSP con nonce (Ola 9, seguridad) — qué cambió, qué no, cómo revertir

Hallazgo de origen: auditoría ola 1 #5 (`script-src 'unsafe-inline'` en producción). Código: `src/lib/seguridad/csp.ts` y
`src/proxy.ts`. Pruebas: `src/proxy_csp_nonce.test.ts`, `src/lib/seguridad/csp.test.ts`.

## Qué hace ahora

| Rutas | `script-src` |
|---|---|
| `/dashboard`, `/admin`, `/vendedor` (con sesión) | `'self' 'nonce-<por petición>' 'sha256-<tema>' 'strict-dynamic'` — **sin** `'unsafe-inline'` |
| Todo lo demás (landing, blog, login, aviso, demo, …) | `'self' 'unsafe-inline'` (igual que antes) |

- El proxy genera un nonce de 16 bytes por petición y lo pone en el header CSP de la **petición** (Next lo lee de ahí y lo
  estampa en sus propios `<script>`: bootstrap, streaming `__next_f.push`, chunks) y en la **respuesta** (la que obedece el navegador).
- El único `<script>` inline propio del repo —el que aplica el tema oscuro antes del primer paint, en `app/layout.tsx`— va por
  **hash SHA-256** calculado del mismo string (`lib/seguridad/script_tema.ts`). Así el layout raíz no lee headers y las páginas
  públicas siguen siendo estáticas.
- Las demás directivas no cambian (`default-src 'self'`, `connect-src 'self'`, `frame-ancestors 'none'`, `object-src 'none'`, …).
  `unsafe-eval` solo en `next dev`.

## Por qué solo las rutas con sesión

Next solo puede poner un nonce en páginas **dinámicas**. Las tres secciones con sesión ya lo son (leen la cookie y sus layouts
exportan `force-dynamic`; una prueba lo exige). Las públicas son estáticas/prerenderizadas: llevar nonce ahí obliga a que el layout
raíz lea headers y **todo el sitio se vuelva dinámico** (más cómputo, sin caché de CDN). Eso es una decisión de costo de Javier, no de
este paquete.

## Deuda residual (dicha, no escondida)

1. **Rutas públicas con `'unsafe-inline'`** en scripts. Cierre posible: nonce en el layout raíz (todo dinámico) o la
   alternativa experimental de Next con hashes SRI (docs de Next, «Content Security Policy», sección SRI). Decidir con Javier.
2. **`style-src 'unsafe-inline'`**: ~1,200 `style={{…}}` (atributos); ni nonce ni hash los cubren. Es riesgo menor que scripts.
3. **No se corrió `next build` ni se vio la pantalla en un navegador** en este paquete (restricción de recursos de la ronda). Lo que sí
   se probó: el proxy (nonce, hash, headers de petición y respuesta), que ningún otro `<script>` inline ni `next/script` existe en
   `src/app`, y que las tres secciones fuerzan render dinámico. **Antes de producción:** `next build` + abrir `/dashboard` y `/admin`
   con la consola del navegador abierta; no debe haber «Refused to execute inline script».

## Revertir sin tocar código

`LIKIDA_CSP_NONCE=0` (variable de entorno de Vercel; requiere redeploy) devuelve **todas** las rutas a la política anterior.
Cualquier otro valor, o vacío, deja el nonce encendido: la reversa es explícita.

## Si agregas un `<script>` inline o `next/script`

La prueba `el ÚNICO <script> inline del repo es el del tema` falla. Un script inline nuevo en una ruta con sesión **no corre** (no
tiene nonce ni hash): usa un módulo normal, o agrega su hash en `csp.ts` si es una constante.
