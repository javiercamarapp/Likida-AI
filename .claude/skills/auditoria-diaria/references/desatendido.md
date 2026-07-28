# Modo desatendido

Corriendo sola de madrugada, la rutina no tiene a nadie que le diga "ya estuvo". Sin condición de terminación dura se queda puliendo hallazgos menores hasta agotar el presupuesto, y sin regla de reversión un arreglo malo se queda commiteado hasta que alguien lo note.

## Condición de terminación

La ronda **N** está terminada cuando **todas** son ciertas. Se verifica con comandos, no de memoria:

1. `docs/auditoria-N/00-SINTESIS.md` existe y tiene las 12 notas con su razón de movimiento.
2. Existen los 12 archivos de rubro. Un rubro sin archivo es un rubro sin auditar, y su nota no se mueve.
3. `docs/auditoria-N/tablero.html` existe **y** `tablero.png` existe — la captura es la prueba de que se renderizó.
4. Cada CRÍTICO y cada ALTO está en uno de tres estados, sin cuarta opción: commiteado con prueba que lo reproduce, o `pendiente` con la razón escrita, o `descartado` por falso con la razón escrita.
5. `npm test` y `npx tsc --noEmit` pasan sobre el árbol final. Se corren y se pega la salida.
6. Los commits están pusheados.

Si (5) falla, la ronda **no** está terminada: se revierte el último arreglo y se vuelve a evaluar. Dejar el árbol rojo y reportar éxito es el peor resultado posible de una corrida nocturna, porque la mañana siguiente empieza con el repo roto y sin saber por qué.

## Presupuesto

- **Tope duro: 3 vueltas de arreglo.** Si al terminar la tercera siguen quedando críticos, se detiene y se reportan como pendientes con lo que se aprendió de cada intento. Un crítico que resistió tres intentos necesita una decisión, no un cuarto intento.
- **Un arreglo, un commit.** Nunca dos hallazgos en el mismo commit: revertir uno sin arrastrar al otro es todo el punto.
- **Máximo un rubro reauditado por ronda.** Si un arreglo tocó código de un rubro ya calificado, se relanza **ese** auditor, no los doce.

## Retener o revertir

Después de cada arreglo, la suite completa. Ese es el criterio, y no admite matices:

- Verde y la prueba nueva falla sin el arreglo → **se retiene** y se commitea.
- Rojo, o la prueba nueva pasa igual sin el arreglo → **se revierte** (`git revert` o `git reset --hard` sobre ese commit), el hallazgo vuelve a `pendiente`, y se anota qué se intentó. Una prueba que pasa con y sin el arreglo no probó nada; retenerla es peor que no tenerla, porque da falsa seguridad.

No se acumulan arreglos sin verificar entre ellos. Tres cambios y una sola corrida al final es cómo se pierde de vista cuál fue el que rompió.

## Si truena a media ronda

El estado vive en `docs/auditoria-N/`, no en la conversación — por eso cada auditor escribe su archivo en cuanto termina en vez de reportar al final. Al reanudar:

1. Ver qué archivos de rubro ya existen. Esos auditores **no se relanzan**.
2. Leer `progreso.md` (una línea por acción con su sha) para saber qué arreglos ya entraron.
3. Continuar desde ahí.

`progreso.md` se escribe **mientras** avanza, no al cerrar. Un diario que se escribe al final no existe cuando se necesita.

## Árbol sucio

Si `git status` no está limpio al arrancar: la auditoría corre completa, el autofix queda apagado, y la síntesis lo dice en la primera línea. No se hace stash del trabajo de alguien más ni se commitea encima — un cambio a medias tuyo confundido con un arreglo de la ronda es un problema que aparece días después y no se puede desenredar.

## En la nube (routine de Claude)

El agente de la routine clona el repo y no tiene nada más: ni tu `~/.claude/`, ni el `.env`, ni la base. Tres diferencias con la corrida local, y ninguna es opcional:

- **La compuerta es `npm test` + `npx tsc --noEmit` + `npm run lint`, sin `npm run build`.** El build pide Supabase, OpenRouter, Facturapi y Upstash; allá no existen y su fallo no dice nada del código. Los tests sí corren: son offline y reproducibles por diseño.
- **Los arreglos van a rama `auditoria-N` y salen como PR**, nunca a `master`. Un arreglo que nadie miró entrando solo a la rama de producción, de madrugada, es exactamente el riesgo que la auditoría existe para bajar. El cuerpo del PR lleva la tabla de 12 notas, los críticos con su escenario y lo que quedó pendiente.
- **La skill viaja en el repo**, en `.claude/skills/auditoria-diaria/`. Si la editas en `~/.claude/skills/`, cópiala también acá o la nube seguirá corriendo la versión vieja sin avisar.

Todo lo demás —condición de terminación, tope de 3 vueltas, retener o revertir, `progreso.md`— aplica igual.

## Programarla en local

```
/loop 0 6 * * * /auditoria-diaria
```

Antes de dejarla suelta la primera vez, córrela una vez contigo presente: lo que se descubre en esa corrida es si algún auditor necesita más contexto, y eso es barato de arreglar de día y caro de noche.
