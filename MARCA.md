# MARCA.md — la fuente de verdad de la marca Likida

> Consolidado el 16-ago-2026 desde `Documentos Likida/09-GTM-y-Fundraising/guia-de-marca.md`
> (verificada contra el producto real: `src/app/globals.css`, `src/app/logo.tsx`,
> `public/images/`) + el manual del agente `likida-marketing`. ESTA es la ruta canónica
> que leen el subagente `likida-marketing`, la skill `likida-post` y el agente de
> visuales del catálogo (0125). Si otro documento contradice a éste, gana éste.

## §1 · Nombre y voz

- La marca se escribe **Likida** ("LIKIDA" en mayúsculas solo en el wordmark del logo).
  Producto: **app.likida.ai** · sitio: **likida.ai**. "Likida.ai" solo para distinguir
  la empresa; en texto corrido, "Likida".
- **Voz "honesto-fiscal"**: cifra real con fuente, o decir qué falta. El lector (contralor,
  contador, dueño de flota) va a cruzar lo que lee contra su PDF — la voz nunca apuesta
  contra esa verificación. Español mexicano directo, vocabulario del gremio (liquidación,
  cuadre, casetas, operador, contralor), frases cortas, sin anglicismos de startup.
- Frases SÍ: "Deducible — LIF 2026, Art. 20-A" · "Sin capturar" · "Supuesto: ~4 min por
  documento — ajústalo con tu dato".
- Frases PROHIBIDAS: "ahorra hasta 90%" (sin fuente) · "IA revolucionaria" (humo) ·
  "cientos de flotas confían" (**Likida no tiene clientes**) · "el efectivo nunca es
  deducible" (la regla absoluta con excepción — el modo de falla dominante) · explicar el
  mecanismo interno del motor en material público.
- El referente de producto NO se nombra como competencia. La competencia es la del mapa:
  Uvicuo, Clara, GetCastores, Conectamos/IntegrAI, TMS legacy.

## §2 · Las tres paletas — y cuándo usar cuál

**2.1 PRODUCTO** (tokens reales de `globals.css`, contrastes medidos WCAG — no sustituir
por tonos "parecidos"): fondo `#fbfbfd`, superficie `#ffffff`, tinta `#17100d`, tinta-2
`#3f3f46`, muted `#6b7280`, faint `#73737c` (el gris más claro permitido para texto),
hairlines `#ececef/#e4e4e7`, **naranja de marca `#c2410c`** (5.18:1 — un naranja vivo tipo
#f97316 NO pasa), rampa de gráficas `#fdebd9→#c2410c`, ok `#137a38`, warn ÁMBAR `#9a5c00`
(la marca ya es naranja: un aviso naranja deja de avisar), bad `#b91c1c`. Un solo acento;
neutros fríos; hairlines 1px; **sin modo oscuro**; sin emojis como iconos.
→ Para: producto, landing, demos, capturas, contenido social, calculadora.

**2.2 DOCUMENTOS EJECUTIVOS** (pedido explícito de Javier: cero color, ni el naranja):
fondo `#FFFFFF`, tinta `#141414`, grises `#6B6B6B/#A3A3A3`, superficies `#F7F7F5`, bordes
`#E8E8E6`. Logo en monocromo negro.
→ Para: deck, informes de inversionistas, manuales, compliance, legal — el papel "de traje".

**2.3 ESTILO PAPEL** (la capa de ATENCIÓN del marketing — el papel es TÉCNICA: recorte,
textura, halftone, sombra dura; no una paleta distinta de marca):
```
Crema papel      #EDE4D3   fondo por defecto        ~60% del cuadro
Azul marino      #2A3F5F   estructura y texto       ~25%
Naranja ladrillo #E24A1B   SOLO acento              ~10% (nunca >15%)
Verde dinero     #4E9A3E   SOLO cifras recuperadas  ~5%
Azul Likida      #0B5FFF   solo logo, links, botón
```
Semántica: **naranja = el mundo del viaje** (carretera, chaleco, cono, ticket) · **azul =
el mundo del dinero** (estructura, fiscal, cierre, marca). Cada campaña lleva al menos una
pieza **con persona**. **Papel abre, producto cierra** — la capa de PRUEBA es la UI real,
nunca al revés.

**Regla de decisión en una línea**: prospecto/cliente en pantalla → paleta producto o
papel; documento que se imprime/firma/proyecta en consejo → blanco/negro/gris.

## §3 · Tipografía y cifras

Familia del sistema (`-apple-system, "SF Pro Text", Inter…`) — no se compra ni embebe
ninguna fuente. Display: peso 600, `letter-spacing: -0.01em`. Labels: MAYÚSCULAS 11px con
tracking. **Cifras SIEMPRE `tabular-nums`**, formato es-MX (`$14,500 MXN`, `4,205`), y el
formato vive en UN lugar (`lib/formato.ts` en producto).

## §4 · El logo: uso, piezas y variantes RETIRADAS

Archivos en `public/images/`: `logo.png` (726×149, marca completa negro/transparente),
`logo-icono.png` (161×149), `logo-texto.png` (565×149). El producto los pinta como
**máscara CSS** (ícono en `--marca`, wordmark en `--ink`) — nunca `<img>` crudo.

- Dos versiones válidas: **bicolor** (producto/marketing) y **monocromo negro** (documentos).
- Solo-ícono para avatares/favicon/espacios cuadrados; el wordmark solo, jamás como
  identificador principal.
- No estirar, no rotar, no recolorear fuera de los dos esquemas, no ponerlo sin contraste
  (sobre foto: placa blanca).
- **RETIRADAS — no existen y no se recrean**: cualquier variante inventada del ícono
  (cuadros azules con palomita, redibujos, gradientes). **El logo NUNCA se genera con un
  modelo: se deja el espacio vacío y se COMPONE el archivo oficial encima.** En HTML
  autocontenido, data URI.

## §5 · Producción con modelos (imagen y video) — el mejor modelo para cada pieza

Reglas duras primero: el copy se escribe COMPLETO con acentos ANTES de generar y se
verifica letra por letra DESPUÉS (el glifo `LIKİDA` con İ turca salió con el prompt bien
escrito); si hay cifras, la aritmética debe cerrar (`45.00 L × $23.45 = $1,055.25`); el
logo se pega, no se genera (§4); **nada se publica sin aprobación de Javier**.

| Pieza | Modelo | Ajustes de costo | Skill/proceso |
|---|---|---|---|
| Pieza de marca SIN texto | `nano_banana_2` (Nano Banana Pro) | **generaciones ilimitadas** — costo cero, el default | `likida-post` |
| Pieza CON texto quemado | `gpt_image_2` | `quality:"low"` + `1k` = 0.5 cr (high+4k = 12 cr, 24×); subir calidad SOLO en la pieza aprobada; ampliar con `upscale_image`, no regenerar | `likida-post` |
| **Character sheet / sequence sheet / hoja de referencia / storyboard** | `gpt_image_2` | la densidad y fidelidad de texto de las hojas lo exigen | **skill `sequence-sheet`** |
| Identidad de cara consistente | Soul ID (`--soul-id`) | entrenar una vez, reusar | `higgsfield-soul-id` |
| **Video** (ads, reels, animación de sheets, personajes consistentes) | `seedance_2_0` | `std` + `480p` + audio = 15 cr/5s (1080p = 45 — se ahorra en píxeles, NO en modo: el movimiento no se arregla después); aprobado → `upscale_video` (topaz) | **skills `producir-video` + `prompt-video-ia`**; narración SIEMPRE ElevenLabs (Javier), jamás voz del modelo |
| Video cinemático puntual | `veo_3_1` / `kling_3_0` | solo cuando seedance no alcanza — decidir con `costo-por-pieza` | `prompt-video-ia` |
| Trend/transición | fotograma inicial + final + transformación | — | `producir-video` (modo trend) |

Formatos: `1080x1350` (feed, el que más rinde), `1080x1920` (story/reel — zona segura 14%
arriba/20% abajo), `1080x1080`, `1584x396` (banner LinkedIn). `gpt_image_2` no da 4:5:
pedir 3:4 y `reframe`. Gotchas vivos: el `job_id` de Higgsfield caduca; el filtro NSFW
dispara aleatorio (reintentar); generar horizontal Y vertical por default. Verificar
`balance` antes de una tanda; presupuestar el lote con la skill `costo-por-pieza`.

## §6 · La cadena de producción (quién hace qué)

**Para VIDEO, la cadena es EL PROCESO DE JAVIER (dictado 16-ago-2026) — seis
etapas en orden, cada una consume la salida de la anterior:**

1. **Guiones** (`agente-guiones.md`, rutina `guiones-semanal`): Javier sube
   videos que le gustan a `likida-marketing-cola/referencias/`; el agente los
   transcribe (whisper local), destila HOOKS y estructuras al
   `banco-de-hooks.md`, y escribe el guion — hook en 3 segundos, narración
   para ElevenLabs, escenas numeradas. La cadena sigue sin esperar: el gate
   de Javier vive en la etapa 5.
2. **Character sheets**: los personajes del guion, con `gpt_image_2`
   (skill `sequence-sheet`); identidad consistente con Soul ID si hay cara
   recurrente.
3. **Lugares sheets**: las hojas de escenarios/locaciones del guion — mismo
   motor y skill que los characters; un sheet por locación con sus ángulos.
4. **Sequence sheets**: la secuencia escena a escena, componiendo personajes
   y lugares ya aprobados de las hojas anteriores.
5. **Animación**: **EL GATE DE JAVIER VIVE AQUÍ (decisión 16-ago)** — la
   cadena corre autónoma hasta las sequence sheets, y Javier autoriza
   SEQUENCE POR SEQUENCE (`estado: aprobada` en su .md); aprobar la sequence
   ES autorizar el gasto de animar esa escena. Lo aprobado se anima con el
   motor vigente de §5 (seedance) en **std/480p** — se ahorra en píxeles,
   NO en modo; el upscale va solo al corte final. Narración SIEMPRE
   ElevenLabs.
6. **Ensamblaje** (el que junta todo): cuando todas las escenas del video
   están animadas — clips + narración + export por canal. El corte final va
   a la **cola de publicar**, y publicar es el tap de Javier.

**Los canales (decididos el 16-ago)**: LinkedIn + Instagram + TikTok. Todo
post diario (carrusel de noticias, promo de beneficios, video) sale de las
rutinas a `likida-marketing-cola/publicar/<fecha>-<slug>/` con su `post.md`
de copy POR CANAL — publicar siempre es el tap de Javier, nunca del agente.

Para IMAGEN suelta (posts, piezas de marca) la cadena corta sigue viva:
`agente-visuales.md` dirige → el subagente **`likida-marketing`** ejecuta (lee
ESTE archivo) → pipeline `likida-post` (brief → copy → imagen → export →
**cola de aprobación**). Si la pieza lleva personaje recurrente, respeta las
hojas de las etapas 2-3 — no se reinventa la cara en cada pieza.

Toda pieza deja rastro en `bitacora-visuales.md` (fecha, slug, modelo, créditos,
quién aprobó, canal). La IA prepara; el humano aprueba — la misma regla de
todos los agentes.
