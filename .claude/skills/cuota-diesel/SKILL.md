---
name: cuota-diesel
description: Baja del DOF la cuota semanal disminuida del estímulo de IEPS al diésel, la escribe con su rango de vigencia y abre PR si cambió. Úsala los viernes por la noche, cuando el motor necesite la cuota vigente de una fecha, al preguntar cuánto es el estímulo de diésel esta semana, cuando una liquidación caiga fuera del rango cubierto, o al revisar por qué el cálculo del IEPS se negó a correr.
---

# Cuota semanal del diésel

El estímulo del LIF 2026 art. 20-A es **cuota semanal disminuida × litros**. No es el IEPS trasladado del CFDI — la ficha `normas/lif-2026-20-A.yaml`, marcada `verificado_fuente_primaria`, lo dice literal.

La cuota pasó de **$6.2858** (27-jun-2026) a **$2.0925/L** (25-jul-2026). Tres veces en cinco semanas. Sobre 10,000 litros son ~$40,000 de diferencia en una sola liquidación, en la cifra que el contralor mira primero.

## CRITICAL

- **Sin cuota vigente para la fecha, el motor NO calcula.** Nunca cae al último valor conocido. Un número viejo se ve idéntico a uno correcto y sale impreso citando un artículo — es el peor fallo posible de este producto.
- **La edición es la VESPERTINA.** Los 10 acuerdos verificados salieron ahí. Barrer solo la matutina es no barrer.
- **El SIDOF devuelve `200` con arrays vacíos cuando falla.** No se distingue "no hubo DOF" de "la API no respondió". Hay que cruzar contra `/diarios/porFecha/` antes de concluir que no se publicó nada.
- **Un viernes hábil sin acuerdo es una alarma, no un silencio.** Se han publicado 10 de 10 viernes consecutivos. Que falte uno significa que algo se rompió, casi nunca que no lo publicaron.

## El procedimiento

```
GET https://sidofqa.segob.gob.mx/dof/sidof/notas/{DD-MM-AAAA}
```
JSON sin autenticación. Filtrar por título que contenga `cuotas disminuidas` y `combustibles`. Luego:
```
GET https://sidofqa.segob.gob.mx/dof/sidof/notas/nota/{codNota}
```
El HTML íntegro viene en `cadenaContenido`. La cifra sale con `Di[ée]sel\s+\$([\d.]+)` — probado limpio en los 10 acuerdos verificados.

Escribir en `normas/cuota-ieps-diesel.yaml` una entrada con `cuota`, `vigencia_desde`, `vigencia_hasta` (sábado a viernes), `cod_nota`, `fecha_publicacion` y `url`. **Se agrega, no se sobrescribe**: el histórico es lo que permite liquidar un viaje de hace tres semanas con la cuota que estaba vigente ese día.

## Cuando no encuentra el acuerdo

Antes de reportar que no hubo publicación, cruzar contra `/dof/sidof/diarios/porFecha/{fecha}`. Si ese endpoint dice que sí hubo edición vespertina y el de notas viene vacío, es fallo de la API: se reporta `INFRA`, no `sin cambios`. Confundir las dos cosas deja al motor sin cuota sin que nadie se entere.

Reintentar el viernes y el sábado antes de escalar. Si el sábado sigue sin aparecer, el PR se abre igual con estado `FALTA CUOTA` y la lista de fechas descubiertas — porque a partir del sábado hay liquidaciones que el motor no va a poder calcular, y eso hay que saberlo antes de que lo descubra un cliente.

## Verificación antes de cerrar

Un número extraído por regex no se cree hasta compararlo. Tres chequeos, los tres baratos:

1. **Rango sano.** La cuota histórica vive entre $0 y ~$8/L. Fuera de eso, el regex agarró otra cifra del documento.
2. **Contra la anterior.** Un salto de más de 2x se reporta en el PR de forma destacada — no se bloquea, porque el salto de junio a julio fue real, pero merece que alguien lo mire.
3. **La vigencia empalma.** El `vigencia_desde` de la nueva es el día siguiente del `vigencia_hasta` de la anterior. Un hueco significa un viernes perdido.

## Entrega

PR contra `master` desde rama `claude/cuota-diesel-<AAAA-MM-DD>`, con la cuota nueva, el `codNota`, el enlace al DOF y la comparación contra la semana pasada. Si no cambió nada respecto a lo ya registrado, **no se abre PR**: se escribe el latido y se termina.

El super prompt de la routine está en `references/prompt.md`.
