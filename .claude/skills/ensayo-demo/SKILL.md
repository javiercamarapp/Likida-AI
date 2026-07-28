---
name: ensayo-demo
description: Recorre el guion del demo de punta a punta contra el entorno real, captura cada paso y compara contra el ensayo anterior para detectar lo que se rompió o se ve distinto. Úsala a diario hasta el 6 de agosto, antes de enseñarle el producto a alguien, después de tocar el motor de cuadre o el PDF, cuando quieras saber si el demo todavía corre, o al preguntar si algo se rompió desde ayer.
---

# Ensayo del demo

Los tests dicen que las funciones hacen lo que deben. El ensayo dice qué va a ver el contralor el 6 de agosto en la pantalla. No son la misma pregunta, y la suite verde ha convivido con demos rotos muchas veces.

Corre **en local**, no en la nube: necesita el `.env` con WhatsApp, OpenRouter, Supabase y Facturapi. Es la diferencia entre probar el sistema y probar el camino.

## CRITICAL

- **Se mira, no se mide.** Una captura que nadie abrió es un test que siempre pasa. El paso final de esta skill es abrir las imágenes y verlas, y si no se hizo, el ensayo no ocurrió.
- **El guion manda, no el código.** `GUION_DEMO.md` define el arco de 6 a 8 minutos. Si el guion pide algo que el código ya no hace, eso es un hallazgo del guion, no un error del ensayo — y hay que decidir cuál de los dos se mueve.
- **Diferencia contra el ensayo de ayer, no contra la idea del ideal.** Lo valioso es *"esto se veía distinto ayer"*, porque eso apunta a un commit concreto. "Podría verse mejor" es otra conversación y no va aquí.
- **Nada de datos de Innovativos.** Los datos del demo son DEMO. Ver `GUION_DEMO.md` §Datos.

## El recorrido

Leer `GUION_DEMO.md` y `GUIA_BUILD.md` §8 (checklist de antes de entrar a la sala). Recorrer el arco narrativo completo, y en cada punto donde el guion dice que el contralor mira algo:

1. Capturar la pantalla o el artefacto —mensaje de WhatsApp, PDF, panel.
2. Guardar en `pruebas-manuales/ensayo/<AAAA-MM-DD>/<NN>-<paso>.png`.
3. Anotar cuánto tardó. El presupuesto de tiempo es parte del demo: un paso que tarda 40 segundos en una sala con gente se siente eterno.

El PDF se abre y se mira completo, no solo se verifica que se generó. Es el entregable que el contralor se lleva.

## Qué es un hallazgo

Lo que rompe el demo, en orden de gravedad:

- **Un paso que no completa.** El camino se cortó.
- **Una cifra distinta** a la del ensayo anterior con los mismos datos de entrada. Esto es lo más grave que puede encontrar esta skill: significa que el motor cambió de opinión sin que nadie lo pidiera.
- **Un texto que llega al destinatario equivocado** — un veredicto fiscal del contralor narrado al chofer, por ejemplo.
- **Un paso que tarda más de lo que tardaba.** Con el número, no con la impresión.
- **Algo que se ve mal**: texto cortado, cifra sin formato, estado vacío sin explicación.

## Comparar contra ayer

Si existe el directorio del ensayo anterior, comparar imagen contra imagen. Las diferencias visuales se listan con el paso y qué cambió. Un cambio esperado —porque tú tocaste eso— se anota como esperado; uno que nadie pidió es un hallazgo.

## Cierre

`pruebas-manuales/ensayo/<fecha>/RESULTADO.md`: los pasos recorridos, cuáles pasaron, cuáles no, el tiempo de cada uno, y las diferencias contra el ensayo anterior. Si el ensayo no pudo correr —falta una credencial, un servicio caído— eso se dice en la primera línea. Un ensayo que no corrió no es un demo sano.

Antes de declarar nada, `evidencia`: comando y salida real, o se dice que no se verificó.

## Cómo correrla

```
/ensayo-demo
```

Diaria hasta el 6 de agosto, y otra vez después de cualquier cambio a `cuadre/`, `liquidacion/pdf.ts` o `agents/prompts.ts` — los tres archivos que pueden cambiar lo que se ve sin romper un test.
