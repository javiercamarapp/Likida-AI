# Las compuertas de seguridad del CI y su estado

> **Reescrita por A37-S01-05 (auditoría 37).** La versión del 23-ago-2026
> afirmaba que el repo era privado y que `master` no tenía protección. Ya no es
> cierto: el repo `javiercamarapp/Likida-AI` es **PÚBLICO** (verificado con
> `gh repo view`, ver también el aviso en `.gitignore`) y `master` tiene un
> **ruleset activo** («master protegido»). Antes de decidir un control con base
> en esta nota, vuelve a verificar con `gh api repos/javiercamarapp/Likida-AI/rulesets`.

## 1. Dependency Review — RETIRADO

Fallaba por falta de Advanced Security cuando el repo era privado. Su trabajo lo
cubre el job `verificar` de `ci.yml`: `npm audit --omit=dev --audit-level=high`
pone el CI en rojo si una dependencia de RUNTIME tiene una vulnerabilidad alta o
crítica. Con el repo público, Dependency Review podría volver a habilitarse
(gratis); no se ha decidido.

## 2. CodeQL

Existe el workflow `codeql.yml`. En repos públicos el análisis es gratuito;
si falla con *"Code scanning is not enabled"*, se habilita en **Settings → Code
security and analysis → Code scanning**. CodeQL analiza el código propio, lo que
`npm audit` no puede.

## 3. Protección de `master`

Hay un ruleset activo con: borrado prohibido, sin force-push (`non_fast_forward`)
y checks requeridos `verificar` y `Migraciones + aislamiento (Postgres efímero)`.
El segundo es el que importa: `CI` no corre una sola migración, así que sin él un
PR entra a master con TypeScript verde y el RLS roto.

Para desplegar a producción el camino es un PR (ver `CLAUDE.md`), no un push
directo. Qué falta, si algo, se decide leyendo el ruleset vivo, no esta nota.
