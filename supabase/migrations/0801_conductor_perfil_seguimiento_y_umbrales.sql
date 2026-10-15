-- ═══════════════════════════════════════════════════════════════════════════
-- 0801 — Conductor: perfil de seguimiento, umbrales de «sin señal de vida» y perillas de la flota.
--
-- 1. `perfil_seguimiento`: 'completo' (los 5 hitos del ciclo, el comportamiento de siempre) o 'esenciales'
--    (solo lo básico: «ya cargó», «dónde está» y «si no se ha reportado»). Los esenciales son un SUBCONJUNTO del
--    ciclo, no otro alcance. El valor de partida es 'completo'.
-- 2. Umbrales de la escalera de señal de vida, en minutos (de 5 a 720). Los valores de partida (45/60/20/20/120)
--    son SUPUESTOS, no mediciones: la flota los ajusta con sus tiempos reales.
-- 3. Perillas que otras tareas del frente leen: `mostrar_estados_frontera`, `aplicar_salida_del_tms`
--    (ambas apagadas) y la línea base de llamadas por viaje (nula hasta que se registre).
--
-- 4. Redefine `sembrar_hitos_conductor` (0380 §9, su única definición previa) para que la siembra respete el perfil:
--    con `completo` (o sin fila de configuración) siembra los cinco hitos `esperado` como siempre; con `esenciales` solo
--    `salida_carga` nace `esperado` y los otros cuatro nacen `omitido`/`fuera_de_perfil` (el CHECK `viaje_hito_omitido_motivo`
--    de 0380 exige motivo). Al cambiar de perfil CONCILIA los viajes abiertos sin duplicar (UNIQUE (viaje_id, tipo)): pasar a
--    `esenciales` omite lo pendiente y conserva lo registrado; volver a `completo` reactiva lo omitido por el perfil, salvo si
--    un hito posterior ya se registró (queda `omitido` con `inferido_por_<hito>`). Devuelve los hitos SEMBRADOS. No toca
--    `maquina.ts` ni `cerrar_hitos_viajes_vencidos` (0661). Va en esta misma migración (R-11) porque la 0801 aún no se aplica.
--
-- Las columnas son aditivas e idempotentes; la función se redefine con `create or replace`. El código lee la fila completa y trata una columna
-- ausente como su valor de partida: contra la base sin migrar el agente sigue funcionando como hoy.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.agente_conductor_config
  add column if not exists perfil_seguimiento text not null default 'completo',
  add column if not exists gps_obsoleto_min smallint not null default 45,
  add column if not exists detenido_min smallint not null default 60,
  add column if not exists segundo_aviso_min smallint not null default 20,
  add column if not exists escalar_senal_min smallint not null default 20,
  add column if not exists silencio_respuesta_min smallint not null default 120,
  add column if not exists mostrar_estados_frontera boolean not null default false,
  add column if not exists aplicar_salida_del_tms boolean not null default false,
  add column if not exists linea_base_llamadas_por_viaje numeric null,
  add column if not exists linea_base_registrada_en date null;

alter table public.agente_conductor_config drop constraint if exists conductor_config_perfil_seguimiento;
alter table public.agente_conductor_config add constraint conductor_config_perfil_seguimiento
  check (perfil_seguimiento in ('esenciales', 'completo'));

alter table public.agente_conductor_config drop constraint if exists conductor_config_umbrales_senal;
alter table public.agente_conductor_config add constraint conductor_config_umbrales_senal
  check (gps_obsoleto_min between 5 and 720
     and detenido_min between 5 and 720
     and segundo_aviso_min between 5 and 720
     and escalar_senal_min between 5 and 720
     and silencio_respuesta_min between 5 and 720);

alter table public.agente_conductor_config drop constraint if exists conductor_config_linea_base_llamadas;
alter table public.agente_conductor_config add constraint conductor_config_linea_base_llamadas
  check (linea_base_llamadas_por_viaje is null or (linea_base_llamadas_por_viaje >= 0 and linea_base_llamadas_por_viaje <= 1000));

comment on column public.agente_conductor_config.perfil_seguimiento is
  '0801: ''completo'' = los 5 hitos del ciclo (defecto); ''esenciales'' = solo salida de carga, dónde está y señal de vida (subconjunto del ciclo).';
comment on column public.agente_conductor_config.gps_obsoleto_min is
  '0801: minutos sin muestra de GPS para considerar la señal obsoleta. 45 por omisión (supuesto, no medición); de 5 a 720.';
comment on column public.agente_conductor_config.detenido_min is
  '0801: minutos detenido fuera de un sitio del viaje para considerar la unidad detenida. 60 por omisión (supuesto, no medición); de 5 a 720.';
comment on column public.agente_conductor_config.segundo_aviso_min is
  '0801: minutos entre el primer aviso al chofer y el segundo. 20 por omisión (supuesto, no medición); de 5 a 720.';
comment on column public.agente_conductor_config.escalar_senal_min is
  '0801: minutos tras el segundo aviso sin respuesta para avisar al jefe de tráfico. 20 por omisión (supuesto, no medición); de 5 a 720.';
comment on column public.agente_conductor_config.silencio_respuesta_min is
  '0801: minutos de silencio del chofer tras los avisos para dar el episodio por sin respuesta. 120 por omisión (supuesto, no medición); de 5 a 720.';
comment on column public.agente_conductor_config.mostrar_estados_frontera is
  '0801: mostrar los estados de frontera como hito OPCIONAL visible (no escala). Apagado por omisión.';
comment on column public.agente_conductor_config.aplicar_salida_del_tms is
  '0801: aplicar la salida que reporta el TMS como hito del viaje. Apagado por omisión.';
comment on column public.agente_conductor_config.linea_base_llamadas_por_viaje is
  '0801: llamadas de seguimiento por viaje medidas ANTES del agente (línea base para comparar). Nulo hasta que se registre.';
comment on column public.agente_conductor_config.linea_base_registrada_en is
  '0801: fecha en que se registró la línea base de llamadas por viaje.';

create or replace function public.sembrar_hitos_conductor(p_limite integer default 500)
returns integer
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_n integer;
  v_orden constant text[] := array['llegada_carga', 'salida_carga', 'llegada_descarga', 'salida_descarga', 'regreso'];
begin
  if p_limite is null or p_limite < 1 then raise exception 'p_limite inválido'; end if;

  -- 1 y 2. Viajes abiertos y aceptados que aún no tienen hitos, con el estado que dicta el perfil de su flota.
  with candidatos as (
    select v.id, v.tenant_id,
           coalesce((select c.perfil_seguimiento from public.agente_conductor_config c where c.tenant_id = v.tenant_id), 'completo') as perfil
      from public.viaje v
     where v.estatus = 'abierto'
       and v.aceptado_en is not null
       and coalesce((select c.activo from public.agente_conductor_config c where c.tenant_id = v.tenant_id), true)
       and not exists (select 1 from public.viaje_hito h where h.viaje_id = v.id)
     order by v.aceptado_en
     limit p_limite
  ), tipos(tipo) as (
    values ('llegada_carga'), ('salida_carga'), ('llegada_descarga'), ('salida_descarga'), ('regreso')
  )
  insert into public.viaje_hito (tenant_id, viaje_id, tipo, estado, omitido_motivo)
  select c.tenant_id, c.id, t.tipo,
         case when c.perfil = 'esenciales' and t.tipo <> 'salida_carga' then 'omitido' else 'esperado' end,
         case when c.perfil = 'esenciales' and t.tipo <> 'salida_carga' then 'fuera_de_perfil' else null end
    from candidatos c cross join tipos t
  on conflict (viaje_id, tipo) do nothing;
  get diagnostics v_n = row_count;

  -- 3a. Flotas que pasaron a `esenciales`: lo pendiente fuera del perfil se omite (lo registrado se conserva).
  update public.viaje_hito h
     set estado = 'omitido', omitido_motivo = 'fuera_de_perfil', updated_at = now()
   where h.id in (
     select h2.id
       from public.viaje_hito h2
       join public.viaje v on v.id = h2.viaje_id and v.tenant_id = h2.tenant_id
       join public.agente_conductor_config c on c.tenant_id = v.tenant_id
      where c.perfil_seguimiento = 'esenciales' and c.activo
        and v.estatus = 'abierto' and v.aceptado_en is not null
        and h2.tipo <> 'salida_carga'
        and h2.estado in ('esperado', 'escalado')
      order by v.aceptado_en, h2.id
      limit p_limite
   );

  -- 3b. Flotas en `completo` (o sin configuración): lo omitido por el perfil vuelve, salvo que algo posterior ya se registró.
  update public.viaje_hito h
     set estado = case when p.posterior is null then 'esperado' else 'omitido' end,
         omitido_motivo = case when p.posterior is null then null else 'inferido_por_' || p.posterior end,
         updated_at = now()
    from (
      select h2.id,
             (select h3.tipo
                from public.viaje_hito h3
               where h3.viaje_id = h2.viaje_id
                 and h3.estado in ('recibido', 'validado')
                 and array_position(v_orden, h3.tipo) > array_position(v_orden, h2.tipo)
               order by array_position(v_orden, h3.tipo)
               limit 1) as posterior
        from public.viaje_hito h2
        join public.viaje v on v.id = h2.viaje_id and v.tenant_id = h2.tenant_id
       where h2.estado = 'omitido' and h2.omitido_motivo = 'fuera_de_perfil'
         and v.estatus = 'abierto' and v.aceptado_en is not null
         and coalesce((select c.perfil_seguimiento from public.agente_conductor_config c where c.tenant_id = v.tenant_id), 'completo') = 'completo'
         and coalesce((select c.activo from public.agente_conductor_config c where c.tenant_id = v.tenant_id), true)
       order by v.aceptado_en, h2.id
       limit p_limite
    ) p
   where h.id = p.id;

  return v_n;
end $$;
revoke all on function public.sembrar_hitos_conductor(integer) from public, anon, authenticated;
grant execute on function public.sembrar_hitos_conductor(integer) to service_role;

comment on function public.sembrar_hitos_conductor(integer) is
  '0801: siembra los hitos de los viajes abiertos y aceptados según el perfil de seguimiento de la flota (esenciales: solo salida_carga esperado, el resto omitido/fuera_de_perfil) y concilia los viajes que ya tenían hitos al cambiar el perfil. Devuelve los hitos sembrados.';
