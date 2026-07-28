# Super prompt — salud del repo

Dispara los lunes. Cuatro bloques independientes: si uno falla, los otros tres siguen.

```
Corre la revisión semanal de salud del repo. Invoca la skill `salud-del-repo` y sigue
sus reglas.

REGLA QUE MANDA SOBRE TODO: clasifica antes de alertar, y CÁLLATE SI NO HAY NADA. Una
rutina que reporta "todo bien" cada lunes entrena a que la ignoren, y el lunes que sí
importa se pierde. Sin clasificador esto se apaga en dos semanas.

Los cuatro bloques son independientes. Si uno truena, sigue con los otros tres y dilo.

## Bloque 1 — Tests intermitentes

Corre `npm test` CINCO veces. Clasifica cada fallo:
- Falla en las 5 → ROTO. Es un hallazgo grave y va primero.
- Falla en algunas → INTERMITENTE. Repórtalo con el conteo exacto (`3 de 5`).
- Pasa en las 5 → sano.

No pongas nada en cuarentena y no reviertas commits: la suite es chica y offline, una
cuarentena silenciosa aquí esconde más de lo que ahorra, y un revert puede chocar con un
arreglo hacia adelante. Para cada intermitente, di qué lo hace no determinista si lo ves
— reloj, orden de ejecución, estado compartido.

## Bloque 2 — Dependencias, con clasificador determinista PRIMERO

Corre `npm audit --json` y `npm outdated --json`. Antes de razonar sobre nada, parte la
lista en tres con criterios mecánicos:

- MECÁNICO: parche o menor, sin cambio de API, suite verde después de subir. Un solo PR
  agrupado con todos.
- NECESITA LECTURA: mayor, o CVE con camino de explotación REAL en este código. Un issue
  cada uno, describiendo el camino. Si no puedes trazar el camino, no es este bucket.
- RUIDO: CVE en dependencia de desarrollo, o en una ruta que este producto no ejecuta.
  DESCÁRTALO CON LA RAZÓN ESCRITA en el resumen. No lo silencies.

Ese tercer bucket es la mitad del trabajo y es lo que salva la rutina: se midió 12% de
hallazgos válidos en Dependabot y 68% de alertas inalcanzables a nivel paquete.
Reenviarlas todas es cómo se pierde la confianza.

## Bloque 3 — Deriva de documentación

Revisa los .md de la raíz contra el código: DOCUMENTO_MAESTRO, ROADMAP, DEPLOY,
GUIA_BUILD, ESTADO_FINAL, DECISIONES_PENDIENTES, README.

Busca solo lo VERIFICABLE: un archivo mencionado que no existe, un comando que ya no está
en package.json, una variable de entorno que se fue del .env.example, un conteo de tests
desactualizado, una decisión marcada pendiente que el código ya resolvió.

"Está desactualizado" sin señalar `archivo:línea` no es hallazgo. Descártalo.

## Bloque 4 — Costo por liquidación

Si no hay credenciales ni datos de producción en este entorno, SÁLTALO y dilo. No estimes.

Si los hay: ESCRIBE UN SCRIPT que sume tokens y pesos por liquidación cerrada de la
semana, córrelo, y razona sobre su salida. No calcules de cabeza. Un reporte automático
dijo "+200% de conversión" porque nunca filtró cuentas de prueba internas.

Compara contra la media móvil de 4 semanas. Fuera de ±40%, repórtalo destacado.

## Entrega

- Dependencias mecánicas → UN PR, rama `claude/salud-<AAAA-MM-DD>` (prefijo obligatorio).
- Lo que necesita lectura → un issue cada uno, con `gh issue create`.
- Nada que reportar → NO abras nada. Latido y termina.

## Cierra

Escribe `.latido-salud` con: fecha, corridas de test y su resultado, conteo por bucket de
dependencias, hallazgos de docs, y estado — `OK` · `SIN CAMBIOS` · `PARCIAL <qué bloque
falló>`.

Cierra tu mensaje con: los cuatro bloques y su resultado, la salida real de los comandos
que corriste, lo que NO verificaste, y los links de PR e issues salidos de `gh pr list` y
`gh issue list` — no de tu memoria.
```
