# `normas/` — la memoria normativa de Likida

Una ficha por cada norma que el código **cita** o de la que **depende una cifra**.
Es una carpeta en git, no una base de datos: se lee, se revisa en un pull request
y se versiona junto al código que la usa.

## Para qué existe

Un agente que le dice a un contralor "esto sí es deducible" está emitiendo una
opinión con consecuencias económicas. Estas fichas son de dónde saca el
fundamento — y, más importante, **de dónde saca la duda**: cada una declara si
está verificada contra la fuente primaria o no.

Y resuelve un problema propio de México: **las reglas se renumeran cada año.**
La factura global era la RMF 2.7.1.24 hasta 2021 y hoy es la 2.7.1.21 (la
2.7.1.24 ahora trata devolución de IVA a turistas). Una cita aprendida se pudre;
una ficha con `version_anterior` y `cambio_de_numero` no.

## Estados de verificación

| Estado | Qué significa | ¿Puede el producto afirmarlo? |
|---|---|---|
| `verificado_fuente_primaria` | Se leyó el texto en el DOF, el SAT o diputados.gob.mx | **Sí** |
| `evidencia_corroborante` | Varias fuentes secundarias coinciden, sin leer el original | Sí, condicionado |
| `sin_verificar` | Viene de un blog, de un competidor o de una sola fuente | **No.** Marcar como pendiente |
| `contradicho` | Dos fuentes se contradicen y no se resolvió | **No.** Nunca |

## Jerarquía — la confusión que sale cara

`jerarquia` NO es un adorno. Confundir estos tres niveles es el error más caro
del dominio, y ya se cometió dos veces en este proyecto:

| Nivel | Tipo | Ejemplo |
|---|---|---|
| 1 | Ley | LISR art. 27 fr. III |
| 2 | Reglamento | RLISR |
| 3 | Regla general (RMF) o **facilidad administrativa** (RFA) | RFA 2026 regla 2.9 |
| 4 | Anexo | Anexo 3 de la RMF |
| 5 | Criterio **no vinculativo** | 1/LIF/PI |
| 6 | **Política de un tercero** (cero fuerza legal) | Plazo del portal de una gasolinera |

Una regla de nivel 1 escrita como absoluta puede tener una excepción de nivel 3
que vale dinero: el diésel en efectivo **no es deducible** por LISR 27-III… salvo
hasta el 15% por RFA 2026 regla 2.9. El motor tiene que ver las dos.

Y al revés: un plazo de nivel 6 —"esta gasolinera factura en 7 días"— **no es
una obligación fiscal** y nunca debe presentarse como tal.

## Cómo se usa

- `usado_en_codigo` apunta a los archivos y líneas que dependen de la ficha.
  Si cambias la norma, ese es tu impacto.
- Antes del cierre de cada ejercicio hay que revisar las fichas de tipo `rfa` y
  `regla_general`: la RFA se republica cada febrero y la RMF renumera anexos.
- Ninguna ficha `sin_verificar` debe sostener una cifra que el producto imprima.

## Pendientes

Las fichas marcadas `sin_verificar` traen en `nota_verificacion` **qué falta
exactamente** para cerrarlas. No están vacías por descuido: están declaradas.
