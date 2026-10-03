\set ON_ERROR_STOP on
-- 0683 — `registrar_evento_seguridad` con un `detalle.desborde` NO booleano (ronda 15, bajo) contra Postgres REAL, rollback.
--   · un detalle con desborde = "si" / 1 / {} NO rompe el alta ni la de otro actor de la misma señal y ventana;
--   · la llave reservada se QUITA de la fila normal (no se puede disfrazar de desborde ni salir del conteo);
--   · el tope y el desborde de la 0681 siguen igual (100 distintos + 1 fila de desborde que cuenta el excedente).
begin;
do $$
declare
  t0 timestamptz := date_trunc('hour', now()) + interval '5 minutes';
  i int; n int; f record; r text;
begin
  -- Antes de la 0683 esta segunda alta reventaba con «invalid input syntax for type boolean».
  perform public.registrar_evento_seguridad('otro', 'firma_invalida', 'media', null, 'actor-1', '{"desborde": "si", "x": 1}'::jsonb, t0);
  perform public.registrar_evento_seguridad('otro', 'firma_invalida', 'media', null, 'actor-2', '{"desborde": 1}'::jsonb, t0);
  perform public.registrar_evento_seguridad('otro', 'firma_invalida', 'media', null, 'actor-3', '{"desborde": {}}'::jsonb, t0);
  perform public.registrar_evento_seguridad('otro', 'firma_invalida', 'media', null, 'actor-4', '[1,2]'::jsonb, t0);
  perform public.registrar_evento_seguridad('otro', 'firma_invalida', 'media', null, 'actor-5', null, t0);
  select count(*) into n from public.evento_seguridad where origen = 'otro' and tipo = 'firma_invalida';
  if n <> 5 then raise exception '0683: esperaba 5 filas distintas, hay %', n; end if;
  if exists (select 1 from public.evento_seguridad where origen = 'otro' and tipo = 'firma_invalida' and detalle ? 'desborde') then
    raise exception '0683: la llave reservada desborde no debía llegar a una fila normal';
  end if;
  select detalle into f from public.evento_seguridad where origen = 'otro' and tipo = 'firma_invalida' and actor = 'actor-1';
  if (f.detalle ->> 'x') <> '1' then raise exception '0683: el resto del detalle debía conservarse'; end if;

  -- El tope sigue: 100 distintos y el resto cuenta en UNA fila de desborde.
  for i in 1..130 loop
    perform public.registrar_evento_seguridad('otro', 'rate_limit', 'media', null, 'rota-' || i, '{"desborde": "si"}'::jsonb, t0);
  end loop;
  select count(*) into n from public.evento_seguridad where origen = 'otro' and tipo = 'rate_limit' and (detalle ->> 'desborde') is distinct from 'true';
  if n <> 100 then raise exception '0683: esperaba el tope de 100 filas normales, hay %', n; end if;
  select repeticiones into n from public.evento_seguridad where origen = 'otro' and tipo = 'rate_limit' and (detalle ->> 'desborde') = 'true';
  if n <> 30 then raise exception '0683: la fila de desborde debía contar 30, cuenta %', n; end if;
  select sum(repeticiones) into n from public.evento_seguridad where origen = 'otro' and tipo = 'rate_limit';
  if n <> 130 then raise exception '0683: la suma de repeticiones debía ser 130, es %', n; end if;
end $$;
rollback;
