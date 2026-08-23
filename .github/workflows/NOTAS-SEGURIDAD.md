# Las tres compuertas de seguridad y qué necesita cada una

**23-ago-2026.** Tres garantías del CI estaban apagadas por el **plan de GitHub**,
no por el código, y llevaban días en rojo sin que nadie las mirara. Un check rojo
permanente es peor que no tenerlo: enseña al equipo a ignorar la pestaña entera.

## 1. Dependency Review — RETIRADO, y no hace falta

Fallaba con *"Dependency review is not supported on this repository. Please ensure
that Dependency graph is enabled along with GitHub Advanced Security"*. En un repo
privado de cuenta personal eso exige Advanced Security, que se cobra aparte y caro.

**Su trabajo ya está hecho**: el job `verificar` de `ci.yml` corre
`npm audit --omit=dev --audit-level=high`, que pone el CI en rojo si una dependencia
de RUNTIME tiene una vulnerabilidad alta o crítica. Esa puerta se puso el 16-ago
después de descubrir que "CI verde" mentía sobre las dependencias, y sí funciona.

Mantener un segundo workflow que no puede correr, para cubrir lo mismo, solo
producía ruido. Si algún día se contrata Advanced Security, se vuelve a añadir.

## 2. CodeQL — falta HABILITARLO (un ajuste, no un pago, si el repo es público)

Falla con *"Code scanning is not enabled for this repository"*. No es un defecto del
workflow: el análisis está apagado en los ajustes.

**Settings → Code security and analysis → Code scanning → Set up.**

En repos **públicos** es gratis. En **privados** de cuenta personal necesita GitHub
Advanced Security. CodeQL sí aporta algo que `npm audit` no puede: analiza el código
propio, no las dependencias.

## 3. Protección de `master` — hoy NO EXISTE, y es lo más urgente

`PUT /repos/.../branches/master/protection` responde **403: "Upgrade to GitHub Pro or
make this repository public to enable this feature."**

Hoy **cualquiera con acceso puede empujar directo a master sin un solo check**. El
auto-merge de `auto-merge-rutina.yml` exige que todos los checks pasen, pero solo
cubre las ramas `mejora/*`: un `git push origin master` no pasa por ahí.

Cuando el plan lo permita, la regla para `master` debe exigir estos dos checks:

  - `Verificar (typecheck, lint, pruebas, build)`   ← de `ci.yml`
  - `Migraciones + aislamiento (Postgres efímero)`  ← de `ci-postgres.yml`

El segundo es el que importa y el que hoy se puede saltar: `CI` no corre una sola
migración, así que sin él un PR entra a master con TypeScript verde y el RLS roto.
Marcar además *"Require branches to be up to date"* y *"Do not allow bypassing"*.
