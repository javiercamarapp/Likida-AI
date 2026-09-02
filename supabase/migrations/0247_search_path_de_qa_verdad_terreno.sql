-- ═══════════════════════════════════════════════════════════════════════════
-- 0247 — EL `search_path` QUE LE FALTÓ A `qa_verdad_terreno_valida`
--
-- QUÉ PASÓ. La 0239 creó la función que valida la verdad de terreno del banco
-- de fotos y la cableó a un CHECK de `qa_foto`. La escribió sin `set
-- search_path`, contra la convención de la casa que TODAS las demás funciones
-- del esquema respetan (`security invoker set search_path = public, pg_temp`,
-- ver 0243, 0236, 0231…). El linter de Supabase lo levantó como WARN
-- `function_search_path_mutable` en cuanto la migración se aplicó a
-- producción. Medido: de las funciones de `public` sin `search_path` fijo,
-- ésta es LA ÚNICA nuestra — las otras cuatro (`unaccent`, `unaccent_init`,
-- `unaccent_lexize`) pertenecen a la extensión y no se tocan.
--
-- POR QUÉ IMPORTA AUNQUE NO SEA `SECURITY DEFINER`. El riesgo clásico del
-- `search_path` mutable —escalar privilegios haciendo que una función
-- privilegiada llame a un objeto plantado por el atacante— aquí NO aplica:
-- `prosecdef = false`, la función corre con los permisos de quien la llama.
--
-- Lo que sí aplica, y es lo que la arregla, es OTRA cosa: esta función es el
-- cuerpo de una RESTRICCIÓN DE INTEGRIDAD. Un CHECK tiene que significar lo
-- mismo para todo el que escriba en la tabla. Con el `search_path` heredado
-- del llamador, el significado de la restricción depende de la sesión que
-- inserta — dos clientes con distinta configuración podrían obtener
-- veredictos distintos sobre la misma fila. Una regla de integridad cuyo
-- resultado depende de quién pregunta no es una regla de integridad.
--
-- POR QUÉ `alter function` Y NO `create or replace`. Para no tocar el cuerpo.
-- La lógica de la 0239 —la regla de las dos listas: toda clave en `null` está
-- en exactamente una de `ilegibles`/`noAplica`, y ninguna con valor está en
-- ninguna— es delicada y ya está probada. Reescribirla entera para cambiar
-- una cláusula de configuración es arriesgar una deriva silenciosa entre lo
-- que dice la 0239 y lo que corre. `alter function … set` cambia sólo lo que
-- hay que cambiar, y es idempotente: correrlo dos veces deja lo mismo.
--
-- `pg_temp` va AL FINAL a propósito, como en el resto del esquema: si fuera
-- primero, un objeto temporal de la sesión podría ensombrecer uno de `public`.
-- ═══════════════════════════════════════════════════════════════════════════

alter function public.qa_verdad_terreno_valida(jsonb)
  set search_path = public, pg_temp;

comment on function public.qa_verdad_terreno_valida(jsonb) is
  'Valida la verdad de terreno de una foto del banco de QA: clase conocida, las dos listas (ilegibles/noAplica) presentes como arreglos, y el invariante central — toda clave en null mencionada por EXACTAMENTE una de las dos listas, ninguna clave con valor mencionada por ninguna. Creada en la 0239; la 0247 le fijó el search_path porque es el cuerpo de un CHECK y una restriccion de integridad no puede significar cosas distintas segun quien inserte.';
