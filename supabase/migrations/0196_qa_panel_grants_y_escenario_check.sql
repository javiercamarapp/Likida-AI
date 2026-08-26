-- 0196 · DATOS (Auditoría 19, barrido MEDIO/BAJO) — dos huecos quirúrgicos
-- de la 0185 que ninguna otra tabla del panel de QA repite:
--
-- 1. `qa_foto`/`qa_corrida`/`qa_corrida_paso` nunca tuvieron `revoke`: solo
--    RLS las protege, a diferencia del patrón ya establecido en 0186
--    (`agente_mutacion_idempotencia`, `llm_presupuesto_reserva`). Una
--    política RLS mal escrita en el futuro sería la única capa entre
--    `authenticated`/`anon` y un banco de fotos que guarda OCR con RFC y
--    domicilio real. Doble candado, mismo patrón que ya usa el repo.
--
-- 2. `qa_corrida.escenario` es `text` sin CHECK, a diferencia de `carril`
--    y `estado` en la misma tabla. Hoy la app ya restringe a los mismos 3
--    valores vía `ESCENARIOS_VALIDOS` (`qa-tipos.ts`) — el CHECK es
--    defensa en profundidad, no una restricción nueva sobre lo que la app
--    permite hoy. Ampliar el catálogo (11 escenarios planeados) requerirá
--    una migración que amplíe este CHECK, igual que ya pasa con
--    `carril`/`estado` y con `prospecto_estado_dominio`.

revoke all on public.qa_foto         from public, anon, authenticated;
revoke all on public.qa_corrida      from public, anon, authenticated;
revoke all on public.qa_corrida_paso from public, anon, authenticated;
grant select, insert, update, delete on public.qa_foto         to service_role;
grant select, insert, update, delete on public.qa_corrida      to service_role;
grant select, insert, update, delete on public.qa_corrida_paso to service_role;

alter table public.qa_corrida
  add constraint qa_corrida_escenario_dominio
  check (escenario in ('feliz', 'demo_guion', 'foto_duplicada'));
