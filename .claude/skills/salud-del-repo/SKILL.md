---
name: salud-del-repo
description: Revisión semanal de lo que se pudre despacio — tests intermitentes, dependencias con CVE, documentación que ya no describe el código, y costo por liquidación fuera de rango. Clasifica antes de alertar y se calla si no hay nada. Úsala los lunes, al preguntar cómo está el repo, cuando un test falle a veces, antes de cerrar una fase, o al revisar en qué se está yendo el gasto de modelo.
---

# Salud del repo

Cuatro cosas que nunca son urgentes hasta que lo son, y que ninguna auditoría diaria detecta porque solo se ven en el tiempo: un test que falla una de cada veinte veces, una dependencia con CVE, un documento que describe código que ya no existe, y el costo por liquidación subiendo sin que nadie lo mire.

## CRITICAL

- **Clasificar antes de notificar, o es una máquina de ruido.** Sin clasificador, esto se apaga en dos semanas. El delta está medido: pasar de diff crudo a clasificación por campo baja falsos positivos ~90%.
- **Se calla si no hay nada.** Una rutina que reporta "todo bien" cada lunes entrena a que la ignores, y el lunes que sí importa se pierde entre las otras.
- **Los números se calculan en código; el modelo solo interpreta.** Un reporte automático dijo "+200% de conversión" porque nunca filtró cuentas de prueba internas. Que el agente escriba el script de conteo, lo corra, y razone sobre la salida — no que estime.
- **Nada se mergea solo.** Todo sale como PR o como issue.

## 1 · Tests intermitentes

Correr la suite **cinco veces**. Un test que falla en algunas corridas y pasa en otras es intermitente; uno que falla en las cinco está roto y es un hallazgo distinto, más grave.

Lo intermitente se reporta con el conteo (`3 de 5`), no se pone en cuarentena solo — la suite de este repo es chica y offline, y una cuarentena silenciosa aquí esconde más de lo que ahorra. **No se revierte el commit sospechoso**: puede chocar con un arreglo hacia adelante.

Vale la pena mirar de verdad: en Google, cuando un test estable se vuelve intermitente y se rastrea a un commit, **una de cada seis veces es un bug real de producción**.

## 2 · Dependencias, con clasificador

`npm audit --json` y `npm outdated --json` primero. Luego un script determinista los parte antes de que el modelo lea nada:

- **Mecánico** — parche o menor sin cambio de API, con la suite verde. Va en un solo PR agrupado.
- **Necesita lectura** — mayor, o CVE con camino de explotación real en este código. Un issue por cada uno, con el camino descrito.
- **Ruido** — CVE en dependencia de desarrollo, o en una ruta que este producto no ejecuta. **Se descarta con la razón escrita**, no se silencia.

Ese tercer bucket es la mitad del trabajo. Doyensec midió **12% de hallazgos válidos** en Dependabot; NDSS 2026 midió que el **68.28%** de las alertas a nivel paquete son inalcanzables. Reenviarlas todas es cómo se pierde la confianza en la rutina.

## 3 · Deriva de documentación

Los `.md` de la raíz —`DOCUMENTO_MAESTRO`, `ROADMAP`, `DEPLOY`, `GUIA_BUILD`, `ESTADO_FINAL`, `DECISIONES_PENDIENTES`— describen un sistema que se mueve. Buscar afirmaciones que el código ya contradice: un archivo que se menciona y no existe, un comando que ya no está en `package.json`, una variable de entorno que se fue, un conteo de tests desactualizado, una decisión marcada pendiente que ya se tomó.

Solo cuenta lo que se puede verificar contra el repo. "Está desactualizado" sin señalar la línea no es hallazgo.

## 4 · Costo por liquidación

Si hay datos de producción, sumar tokens y pesos por liquidación cerrada de la semana contra la media móvil. Disparar fuera de rango.

El fallo que esto atrapa está medido: a un operador el script nunca pasaba el parámetro de modelo, así que **747 sesiones corrieron en el modelo caro por default** — de $15 a $65 al día, invisible hasta la factura. Sin datos de producción todavía, este bloque se salta y lo dice.

## Entrega

Un solo PR semanal con las dependencias mecánicas, e issues separados para lo que necesita lectura. Si las cuatro secciones vienen limpias, no se abre nada: se escribe el latido y se termina.

El super prompt está en `references/prompt.md`.
