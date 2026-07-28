# El super prompt

Tres formas del mismo disparo. Usa la corta cuando la skill ya esté instalada; la larga cuando quieras que funcione aunque la skill no exista o no dispare.

---

## Diario (el que vas a usar)

```
/auditoria-diaria
```

---

## Programada

```
/loop 0 6 * * * /auditoria-diaria
```

---

## Autocontenido

Pégalo tal cual. No depende de que la skill dispare, pero si está instalada la usa.

```
Corre la auditoría diaria de ~/javiercamarapp/cuadra (Likida) en modo desatendido.
Invoca la skill `auditoria-diaria` y sigue sus references; lo que sigue es el
encargo de esta corrida.

ANCLAJE. Lee docs/auditoria-2/00-SINTESIS.md para las notas previas — sin delta la
calificación flota. Corre npm test, npx tsc --noEmit, npm run lint, npm run build y
guarda la salida real como línea base. Crea docs/auditoria-3/ y actualiza MAPA.md
con lo que cambió desde la ronda anterior. Si `git status` no está limpio, la
auditoría corre igual pero el autofix queda apagado y la síntesis lo dice en la
primera línea.

DOCE AUDITORES EN PARALELO, contexto fresco, uno por rubro: frontend · backend y
API · sistema agéntico y orquestación · tool calling · seguridad · cumplimiento
fiscal · cumplimiento legal · arquitectura y mantenibilidad · pruebas ·
operabilidad y DX · rendimiento y costo · modelo de datos y esquema.

Cada uno recibe el MAPA, su sección de references/rubros.md, su nota previa y sus
hallazgos abiertos; usa el prompt de references/auditor-prompt.md tal cual. Los
doce se lanzan en un solo mensaje. Cada uno escribe UN archivo,
docs/auditoria-3/<rubro>.md, y ninguno toca código: encuentran y califican, arreglo
es de otra fase. Fiscal va con las fichas de normas/ abiertas y compara texto
normativo contra línea de código. Nadie corre pruebas-manuales/*.prueba.ts: son
llamadas reales de pago.

Un hallazgo sin archivo:línea y sin escenario de falla con valores concretos no es
hallazgo, es opinión, y se descarta.

VERIFICA CADA HALLAZGO tú mismo abriendo el archivo antes de anotarlo. En la
auditoría 2 uno resultó falso. Los falsos entran a la síntesis como descartados con
la razón — es lo que mantiene honestos a los auditores de mañana.

TABLERO en docs/auditoria-3/tablero.html, autocontenido, doce rubros con delta,
serie histórica, hallazgos por severidad y estado de la suite. Ábrelo, captúralo
como tablero.png y MÍRALO: cuenta los rubros y verifica que las notas del tablero
son las de la síntesis. Un tablero que nunca se renderizó no es evidencia.

ARREGLA CRÍTICOS Y ALTOS, uno a la vez: prueba que reproduce el bug → arreglo →
prueba verde → suite completa → commit atómico citando el ID del hallazgo. Si la
prueba nueva pasa igual sin el arreglo, no probó nada: revierte. Si la suite se
pone roja, revierte ese commit y el hallazgo vuelve a pendiente con la razón. Lo
que no se pudo reproducir NO se arregla, se propone. Medios y bajos quedan
propuestos en el tablero. Tope: 3 vueltas de arreglo; lo que resista tres intentos
necesita una decisión mía, no un cuarto intento.

Escribe docs/auditoria-3/progreso.md MIENTRAS avanzas, una línea por acción con su
sha, para poder reanudar si truena a media ronda.

RECALIFICA los 12 rubros, escala 0–10, global con un decimal. Cada movimiento de
nota lleva una de tres razones escritas: se atacó y subió · deuda que cobró factura
(algo marcado como advertencia antes, que ya ocurrió) · mirada más profunda (el
código no cambió, la nota anterior estaba inflada — dilo con esas palabras). Sin
una de las tres, la nota se queda igual. La explicación pesa más que el número, y
que baje es un resultado válido.

TERMINASTE cuando: existen los 12 archivos de rubro, 00-SINTESIS.md con las 12
notas y su razón, tablero.html y tablero.png, cada crítico y alto en uno de tres
estados (commiteado con prueba / pendiente con razón / descartado por falso), npm
test y npx tsc --noEmit pasando sobre el árbol final con la salida pegada, y los
commits pusheados. Si la suite quedó roja, NO terminaste: revierte el último
arreglo y vuelve a evaluar.

Cierra con: nota global y delta, la tabla de 12 con flechas, qué se arregló con su
sha, qué quedó pendiente y por qué, y lo que no alcanzaste a revisar. Separa lo
verificado de lo no verificado — si algo no lo comprobaste con un comando, dilo.
```
