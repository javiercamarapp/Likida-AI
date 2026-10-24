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

## 3. Protección de `master`

> **ACTUALIZADO 24-oct-2026 (A37-L-15).** El repositorio volvió a ser **público** y `master` ya tiene un *ruleset* activo
> («master protegido», sin actores que lo salten): impide borrar la rama y los empujes no fast-forward, y exige los checks
> `verificar` y `Migraciones + aislamiento (Postgres efímero)`. Lo que sigue es el texto original del 23-ago-2026, conservado
> como historia de por qué se hizo; ya no describe el estado actual. Pendiente real: el ruleset no marca *«Require branches to
> be up to date»* (`strict_required_status_checks_policy: false`) ni exige PR; confirma si se quiere endurecer.

### Texto original (23-ago-2026)

`PUT /repos/.../branches/master/protection` responde **403: "Upgrade to GitHub Pro or
make this repository public to enable this feature."**

Hoy **cualquiera con acceso puede empujar directo a master sin un solo check**. Un `git push origin master` directo no pasa por ningún check.

Cuando el plan lo permita, la regla para `master` debe exigir estos dos checks:

  - `Verificar (typecheck, lint, pruebas, build)`   ← de `ci.yml`
  - `Migraciones + aislamiento (Postgres efímero)`  ← de `ci-postgres.yml`

El segundo es el que importa y el que hoy se puede saltar: `CI` no corre una sola
migración, así que sin él un PR entra a master con TypeScript verde y el RLS roto.
Marcar además *"Require branches to be up to date"* y *"Do not allow bypassing"*.
