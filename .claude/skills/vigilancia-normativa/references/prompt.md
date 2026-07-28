# Super prompt — vigilancia normativa

El que dispara la routine diaria. Trae dentro la lógica de cadencia: el barrido corre todos los días, el `ETag` del SAT los lunes, la deriva de ley el día 1 de cada trimestre.

```
Vigila si alguna de las fichas de `normas/` dejó de ser cierta. Invoca la skill
`vigilancia-normativa` y sigue sus reglas; `references/fuentes.md` trae los endpoints
ya probados con curl y las rutas que están muertas — no las redescubras.

POR QUÉ. Las fichas no se rompen con un error: se vuelven mentira en silencio. El SAT
publica, el código sigue igual, y el PDF que ve el contralor sigue citando un artículo
que ya dice otra cosa.

## Qué corre hoy

- SIEMPRE: barrido del DOF del día anterior.
- Si hoy es LUNES: además, el ETag del minisitio del SAT.
- Si hoy es 1 de ENE, ABR, JUL u OCT: además, la deriva de los textos de ley.

## 1. Barrido del DOF — 7 días, 3 ediciones

    GET https://sidofqa.segob.gob.mx/dof/sidof/notas/{DD-MM-AAAA}

Cubre desde el día siguiente al último barrido (léelo de `normas/.latido-vigilancia`)
hasta ayer. NO saltes fines de semana: la RMF 2026 completa salió en DOMINGO. NO te
quedes con la matutina: la LIF, la reforma al CFF y las cuotas de diésel salieron en
VESPERTINA.

Disparadores en el título: Miscelánea Fiscal · facilidades administrativas · Ley de
Ingresos · Código Fiscal · Impuesto sobre la Renta · valor agregado · producción y
servicios · datos personales · autotransporte · Anexo · Nota Aclaratoria · Fe de erratas.

ANTI-SILENCIO, obligatorio: el SIDOF devuelve 200 con arrays vacíos igual si no hubo DOF
que si se cayó. Para cada día sin notas, cruza contra
`…/dof/sidof/diarios/porFecha/{fecha}`. Si diarios dice que hubo edición y notas viene
vacío → INFRA, no "sin cambios". Un día hábil con 0 notas es SIEMPRE un fallo.

## 2. Lunes — anticipadas del SAT

HEAD a `https://www.sat.gob.mx/minisitio/NormatividadRMFyRGCE/normatividad_rmf_rgce2026.html`
Compara el `ETag` contra el guardado. Si cambió: baja la página, diffea la lista de PDFs,
descarga los nuevos y búscales las reglas de las fichas.

Esto cierra una ventana ciega de 4.5 meses: la 1ª modificación a la RMF 2026 vivió en ese
portal del 23-feb al 9-jul CON EFECTOS JURÍDICOS, sin pasar por el DOF.

## 3. Trimestral — deriva de ley

HEAD a los PDFs de CFF, LISR, LIVA y LFPDPPP en diputados.gob.mx/LeyesBiblio/pdf/.
Si cambió `Last-Modified`, diffea el historial en ref/*.htm.

## 4. Qué haces con lo que encuentras

Para cada publicación que toque los disparadores de una ficha:
- `estado_verificacion: contradicho`, y actualiza `verificado_el`.
- Pega el texto nuevo y el codNota.
- LISTA LOS ARCHIVOS DE `usado_en_codigo`. Ese es el radio de impacto y es lo que
  convierte una alerta en trabajo accionable.

NUNCA subas una ficha a `verificado_fuente_primaria`. Solo puedes marcar `contradicho`.
Firmar una ficha exige que una persona lea la fuente.

NO INTERPRETES LA LEY. Que el 15% de combustible en efectivo pase a 10% es una lectura de
contador. Tu trabajo es detectar que se movió y decir qué código depende de eso.

Revisa también la RENUMERACIÓN: `rmf-2026-2.7.1.21` ya migró desde 2.7.1.24. Un diff de
texto no ve que el número cambió de tema. Verifica que cada número siga apuntando a lo
que la ficha dice.

## 5. Entrega

Con hallazgos: rama `claude/normativa-<AAAA-MM-DD>` (el prefijo `claude/` es obligatorio
o el push rebota), PR contra master, título `Normativa: N fichas contradichas`, cuerpo con
una sección por ficha — qué cambió, el codNota con enlace, y los archivos afectados.

Sin hallazgos: NO abras PR. Escribe el latido y termina. Esta rutina acierta 4–6% de las
veces por diseño; se mide por el mes en que atrapa una, no por su ratio diario.

## 6. Cierra

Escribe siempre `normas/.latido-vigilancia` con: fecha del último día barrido, cuántas
notas se revisaron, cuántas dispararon, ETag actual del SAT, y estado —
`OK` · `SIN CAMBIOS` · `INFRA <qué falló>` · `PARCIAL <qué faltó>`.
Sin ese archivo, un scraper roto se ve idéntico a un mes tranquilo.

Cierra tu mensaje con: días barridos y cuántas notas por edición (con la salida real),
las fichas tocadas, lo que NO pudiste verificar, y el link del PR salido de `gh pr list`.
```
