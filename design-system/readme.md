# likida.ai — Design System

Sistema de diseño de la marca y la landing. Se deriva de dos documentos del repo:

- **`../MARCA.md`** — gobierna la marca hacia afuera (landing, ads, video, orgánico).
- **`../DESIGN.md`** — gobierna el producto por dentro (dashboard, demo, portal).

Si algo se contradice, dentro de la app gana `DESIGN.md`; en la landing gana `MARCA.md`.

---

> **La landing corre en su propio registro.** `templates/landing/index.html` está en clave
> monocroma premium de plataforma enterprise — casi negro sobre blanco, botón píldora, esquinas
> rectas, titular grande y apretado, revelado por scroll. Es una decisión explícita de Javier y
> se aparta de `MARCA.md` §3.1, que manda papel recortado como estilo primario. El archivo es
> autónomo: no enlaza `styles.css`. Todo lo demás de este sistema (el de papel) sigue vigente
> para ads, video y orgánico. Si algún día se unifican, hay que decidir cuál gana.

## La idea central: dos pieles, una marca

`MARCA.md` §3.1 decide un solo estilo primario y subordina los demás. Este sistema lo
implementa como dos pieles que se alternan por sección y **nunca se mezclan dentro del
mismo bloque**:

| Piel | Clase | Dónde | Señas |
|---|---|---|---|
| **Papel** (primaria) | *(por defecto)* | Hero, dolor, cifras, cierre | Crema `#EDE4D3`, tinta marino, acento ladrillo, sombra dura con desplazamiento, radio 2–3 px, grano de papel |
| **Producto** | `.skin-producto` | Capturas, tabla de cuadre, entrega | Blanco, tinta `#0E1A2B`, azul `#0B5FFF`, sombra difusa, radio 12 px, sin grano |
| **Marino** | `.skin-marino` | Bloque de cifras, cierre, pie | Fondo `#2A3F5F`, texto crema |

La razón: el papel es táctil, mexicano y es literalmente el material del problema — el ticket
que se pierde. El azul es competente y de nadie. Pero un contralor no compra metáforas: compra
ver su liquidación cuadrada. De ahí que el producto tenga su propia piel, sin textura.

---

## Contenido

```
styles.css                    Todos los tokens y componentes. Único CSS.
theme.json                    Parámetros del tema para Claude Design.
foundations/color.html        Paletas + las variantes que sí pasan AA.
foundations/type.html         Jost, escala, cifras tabulares, la anáfora.
foundations/layout.html       Espacio, radio, las dos elevaciones, movimiento.
components/buttons.html       Botones, el CTA de WhatsApp, etiquetas de semáforo.
components/cards.html         Tarjeta numerada, tarjeta de dolor, papel recortado.
components/table.html         Tabla de liquidación y de cuadre por viaje.
components/figures.html       Las cifras — el activo #1 del copy.
components/forms.html         Campos, error que nombra el comprobante, segmentado.
components/navigation.html    Barra, lockups del logo, reglas de uso.
templates/landing/index.html  La landing completa.
```

---

## Decisiones que se tomaron aquí (y por qué)

**Tipografía: Jost.** `MARCA.md` §3.3 pide una geométrica de palo seco, humanista, con «a» de
un piso, y ofrece Inter / Poppins / SF Pro como sustitutos seguros. Inter tiene «a» de dos
pisos, así que no cumple la regla propia del documento. Jost sí: geométrica, «a» de un piso,
y con mucho más carácter que Poppins. Poppins queda como respaldo aprobado.

**Contraste.** Los swatches de marca son para tinta y pantalla grande. Sobre crema, el ladrillo
puro da 3.18:1 y el verde dinero 2.75:1 — insuficientes para texto. El sistema añade dos
variantes que sí pasan AA sin salirse del territorio: `#C93F16` para relleno de botón (5.02:1
con blanco) y `#3E7D31` para cifras (4.01:1). El ladrillo puro se conserva para gráficos,
reglas y display grande.

**El verde de WhatsApp es la única excepción a §3.2.** `#25D366` no está en la paleta a
propósito: es el color del canal y la gente lo reconoce. Solo aparece en el CTA de WhatsApp.

**La marquesina «Cada …» sustituye al carrusel de logos de clientes.** El patrón de landing B2B
pone logos de clientes bajo el hero. Likida todavía no tiene logotipos de clientes que mostrar,
y `MARCA.md` §2.1 dice que la anáfora es lo mejor que tiene la marca. Se usa esa en su lugar:
es honesto y es más nuestro.

---

## Arquitectura de la landing

Sigue el patrón de landing B2B de plataformas de agentes (hero → dolor → cifras → plataforma →
diferenciador → el flujo a detalle → casos → integración → preguntas → cierre). El copy, las
cifras y el contenido son propios, sacados de `MARCA.md`; lo que se adopta es la secuencia de
secciones y el registro visual monocromo, que es lo que funciona para vender operación
automatizada a un comprador escéptico.

### El sistema de movimiento

Todo corre sobre una sola curva, `cubic-bezier(.16, 1, .3, 1)` — expo-out: arranca rápido y se
asienta sin rebotar. Es lo que hace que se sienta nativo en vez de animado.

| Efecto | Cómo | Duración |
|---|---|---|
| Barra pegajosa | `IntersectionObserver` sobre un centinela; aparece el hairline y sube el desenfoque | 400 ms |
| Titular del héroe | Máscara por línea, `translateY(105%)` → 0 | 1050 ms, escalonado |
| Revelado por scroll | `.rv` + `IntersectionObserver`, escalón vía `data-d="1..5"` | 900 ms |
| Cifras | Cuenta ascendente con quart-out, dispara al 50 % de visibilidad | 1500 ms |
| Acordeón | `grid-template-rows: 0fr → 1fr` — altura animada sin JS | 550 ms |
| Marquesina | `translateX(-50%)` en bucle, se pausa al pasar el cursor, máscara en los bordes | 42 s |
| Botones | Elevación de 1 px + la flecha se desliza 4 px | 300 / 400 ms |
| Enlaces de nav | Subrayado que barre de izquierda a derecha | 450 ms |

Todo respeta `prefers-reduced-motion`: el JS detecta la preferencia y salta directo al estado
final en vez de animar.

1. **Hero** — «Liquidar era un día. Ahora es un mensaje.» + hoja de liquidación y hilo de WhatsApp
2. **Marquesina** — la anáfora «Cada …»
3. **La realidad de hoy** — los cuatro dolores de `MARCA.md` §2.3
4. **Lo que cambia** — las cifras reales de §2.4, sobre marino
5. **La plataforma** — dos capas: lectura/validación y cuadre por viaje
6. **Lo que nos separa** — precisión verificable, la respuesta a «90 % de precisión»
7. **Cómo funciona** — comparativa hoy/Likida + los seis pasos del ciclo
8. **La diferencia en pantalla** — tabla de cuadre, piel producto
9. **Dónde aplica** — seis tipos de operación
10. **Entrega** — WhatsApp entra, PDF y póliza salen
11. **Video** — ranura pendiente
12. **Preguntas** — las objeciones reales
13. **Cierre** — «Cada viaje, cuadrado.» + WhatsApp

---

## Pendientes antes de publicar

Estos bloques llevan `data-verificar` en el HTML. No se inventó nada para llenarlos.

- [ ] **ERPs** — confirmar cuáles están conectados hoy antes de nombrar ninguno. Hoy dice «por confirmar».
- [ ] **Tiempo de arranque** — la pregunta frecuente está sin responder a propósito.
- [ ] **Video de 44 s** — hay guion, voz y sequence sheets en `~/Desktop/LIKIDA KIT/_notas`. Falta montarlo a 1080p.
- [ ] **Capturas reales del producto** — `MARCA.md` §7: de 1,708 assets, cero muestran la pantalla real. La tabla de cuadre de la landing está construida en HTML, no es una captura. Sustituirla por producto real en cuanto exista.
- [ ] **Prueba social** — no hay logos de clientes, prensa ni caso de éxito. No se pusieron ranuras falsas.

Y el checklist de `MARCA.md` §8 aplica completo, en especial: acentos y `¿ ¡` en todo,
un solo logo en minúsculas, y ninguna cifra que no se pueda reproducir en el demo.
