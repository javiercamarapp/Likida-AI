-- Reporte de aprendizaje de la guía (SPEC-ONBOARDING-GUIA 2.8). SOLO LECTURA: únicamente SELECT sobre `onboarding_evento` (0984).
-- Uso: supabase db query --linked -f scripts/guia/reporte-aprendizaje.sql
-- Sin PII: el actor es un seudónimo (hmac de 16 hex) y no hay texto libre. Mientras `GUIA_EVENTOS` esté apagado en el código la tabla
-- está vacía y el reporte sale vacío: eso es lo esperado, no un error.

-- 1. Por pista: quién empezó y quién terminó (personas distintas = actores distintos).
select pista,
       count(distinct actor) filter (where tipo = 'guia_inicio')    as iniciaron,
       count(distinct actor) filter (where tipo = 'guia_terminada') as terminaron
  from public.onboarding_evento
 group by pista
 order by pista;

-- 2. Cómo se resolvieron los pasos: medido por señal, confirmado por la persona, ya hecho, omitido o sin dato.
select pista, paso_id,
       count(*) filter (where tipo = 'paso_hecho_senal')      as por_senal,
       count(*) filter (where tipo = 'paso_hecho_confirmado') as confirmados,
       count(*) filter (where tipo = 'paso_ya_hecho')         as ya_hechos,
       count(*) filter (where tipo = 'paso_omitido')          as omitidos,
       count(*) filter (where tipo = 'paso_sin_dato')         as sin_dato
  from public.onboarding_evento
 where paso_id is not null
 group by pista, paso_id
 order by pista, paso_id;

-- 3. Dónde abandonan: último paso visto por quien empezó y no terminó.
with ultimo as (
  select distinct on (actor, recorrido) actor, recorrido, pista, paso_id
    from public.onboarding_evento
   where tipo = 'paso_visto' and recorrido is not null
   order by actor, recorrido, creado_en desc
), terminados as (
  select distinct actor, recorrido from public.onboarding_evento where tipo = 'guia_terminada'
)
select u.pista, u.paso_id, count(*) as abandonos
  from ultimo u
  left join terminados t on t.actor = u.actor and t.recorrido = u.recorrido
 where t.actor is null
 group by u.pista, u.paso_id
 order by abandonos desc, u.pista, u.paso_id;

-- 4. Mediana de milisegundos hasta lograr un paso por señal (cuánto tarda de verdad cada acción).
select pista, paso_id,
       count(*)                                                  as casos,
       percentile_cont(0.5) within group (order by valor_ms)     as mediana_ms
  from public.onboarding_evento
 where tipo = 'paso_hecho_senal' and valor_ms is not null
 group by pista, paso_id
 order by pista, paso_id;
