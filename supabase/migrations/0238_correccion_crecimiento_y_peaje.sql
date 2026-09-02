-- ═══════════════════════════════════════════════════════════════════════════
-- 0238 — CORRECTIVA DEL CICLO 7: el ranking de plazas que no era el ranking,
-- y el sello del aviso de peaje que se preguntaba en vez de reservarse.
--
-- IDEMPOTENTE: segura de re-correr (estándar de la casa desde la 0145).
--
-- ── POR QUÉ ESTA MIGRACIÓN EXISTE ─────────────────────────────────────────
--
-- La auditoría adversarial del ciclo 7 encontró que el parte semanal del
-- agente `alianzas` publicaba un TOP-5 DE PLAZAS QUE NO ERA EL TOP-5 (c7-4,
-- crítico). El motor traía 5,000 prospectos de los 33,071 vivos —sin `order`,
-- o sea en orden físico arbitrario y contiguo por orden de importación— y
-- contaba las ciudades sobre esa rebanada. Medido contra producción el
-- 28-ago-2026:
--
--   lo que el parte diría : Tijuana 159 · Aguascalientes 142 · Guadalajara 110
--                           · Apodaca 86 · Mexicali 77
--   la realidad (33,071)  : Tijuana 928 · Nuevo Laredo 689 · Manzanillo 629
--                           · Guadalajara 561 · Puebla 537
--
-- Nuevo Laredo, Manzanillo y Puebla —tres de las cinco plazas reales, y
-- justamente los nodos logísticos que a un gremio como CANACAR le importan—
-- DESAPARECÍAN del parte, y entraban tres que no lo son. Ese parte es el
-- material que Javier le enseñaría a un aliado, bajo el rótulo «EL MAPA QUE YA
-- TENEMOS CAPTURADO (material real del acercamiento)». Una cifra inventada con
-- cara de dato es la regla 1 de la casa rota en el peor sitio: hacia afuera.
--
-- Un `.order()` NO lo arregla: ordenar la rebanada no la vuelve representativa,
-- solo la vuelve una rebanada ordenada. La única forma honesta de conocer el
-- top-5 de un censo de 33,071 filas es CONTARLO ENTERO, y eso se hace donde
-- viven las filas. De ahí esta función.
--
-- ── POR QUÉ UNA FUNCIÓN Y NO UNA VISTA ────────────────────────────────────
--
-- Una vista `group by ciudad` obligaría a PostgREST a traer TODAS las ciudades
-- distintas y a ordenar y recortar del lado del cliente en cada corrida, y
-- —peor— no podría devolver en la misma lectura el total de vivos y los que no
-- traen ciudad, que son las dos cifras que el parte necesita decir por separado
-- («un prospecto sin ciudad no vive en ninguna»). Con tres lecturas separadas
-- las tres cifras podrían venir de tres instantes distintos y sumar mal. Una
-- función que devuelve el objeto entero las calcula sobre la MISMA foto.
--
-- SECURITY INVOKER (el default, y es deliberado): no lleva `security definer`
-- porque no lo necesita — el único llamador es el motor de agentes con
-- `service_role`, que ya salta RLS por su cuenta. Marcarla `definer` abriría
-- una superficie de salto de RLS a cambio de nada.
--
-- ── EL SEGUNDO ARREGLO: EL SELLO DEL AVISO DE PEAJE ───────────────────────
--
-- La 0231 creó `peaje_cierre_aviso` con `primary key (tenant_id, periodo,
-- umbral)` — la restricción está bien y NO se toca. Lo que estaba mal era el
-- ORDEN en el que el código la usaba: preguntaba si el sello existía, mandaba
-- el WhatsApp, y sellaba al final (c7-17). Dos invocaciones solapadas del cron
-- leen las dos «no hay sello», las dos mandan el mensaje, y la segunda rebota
-- en el 23505 cuando el WhatsApp duplicado YA ESTÁ en el teléfono. La regla 6
-- de la casa: la idempotencia es una restricción, no un `if`.
--
-- El código pasa al patrón claim-then-act que la 0227 ya usa para el timbre:
-- se RESERVA el sello con un insert (la PK arbitra), se manda, y si el envío no
-- sale se SUELTA la reserva borrando la fila para que la corrida siguiente
-- reintente. Aquí solo se actualiza el comentario de la tabla para que diga la
-- verdad de cómo se usa: la fila ya no es solo la constancia de un aviso que
-- salió, es también la reserva del intento — y una reserva que no llegó a
-- mensaje se borra, nunca se deja puesta. Un sello sobre un mensaje que no
-- salió sería una mentira que entierra el aviso del mes.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. El mapa de plazas, contado en la base ───────────────────────────────
--
-- Devuelve un ÚNICO objeto jsonb con las tres cifras que el parte necesita:
--
--   { "total": 33071, "sin_ciudad": 412,
--     "top": [ {"ciudad":"Tijuana","n":928}, … ] }
--
-- `total` cuenta los prospectos VIVOS con exactamente el mismo criterio que el
-- motor usaba (`duplicado_de is null and estado <> 'perdido'`): un duplicado
-- contaría dos veces la misma empresa, y un perdido no es material de
-- acercamiento. `sin_ciudad` se reporta aparte y NO se reparte entre las demás.
--
-- El `btrim`/`nullif` espeja letra por letra lo que hacía la función pura de
-- TypeScript (`armarMapaCiudades`): una ciudad con espacios de sobra es la
-- misma ciudad, y una cadena vacía es «sin ciudad», no una plaza llamada «».
--
-- El desempate por `ciudad` asc con el mismo conteo es el mismo que el de la
-- función pura, para que dos corridas den el mismo orden y el parte sea
-- reproducible.
create or replace function public.prospecto_mapa_ciudades(p_top integer default 5)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  with vivos as (
    select nullif(btrim(coalesce(ciudad, '')), '') as ciudad
    from public.prospecto
    where duplicado_de is null
      and estado <> 'perdido'
  ),
  agregado as (
    select ciudad, count(*)::bigint as n
    from vivos
    where ciudad is not null
    group by ciudad
    order by n desc, ciudad asc
    limit greatest(coalesce(p_top, 5), 0)
  )
  select jsonb_build_object(
    'total',      (select count(*) from vivos),
    'sin_ciudad', (select count(*) from vivos where ciudad is null),
    'top',        coalesce(
                    (select jsonb_agg(jsonb_build_object('ciudad', ciudad, 'n', n))
                     from agregado),
                    '[]'::jsonb)
  );
$$;

comment on function public.prospecto_mapa_ciudades(integer) is
  'El mapa de plazas del censo de prospectos, CONTADO ENTERO en la base (0238). Existe porque el agente `alianzas` calculaba su top-5 sobre una rebanada arbitraria de 5,000 de 33,071 filas y publicaba un ranking que no era el ranking (auditoría ciclo 7, c7-4): tres de las cinco plazas reales desaparecían del parte. Devuelve total de vivos, cuántos NO traen ciudad (se dice, no se reparte) y el top-N real, todo sobre la misma foto. Solo service_role la ejecuta.';

-- El doble candado de la casa sobre todo lo nuevo: ni `anon` ni
-- `authenticated` la pueden ejecutar. Esta función lee el pipeline de ventas de
-- LIKIDA entero, sin filtro de flota — es de la empresa, no de un tenant, y una
-- sesión de navegador no tiene por qué poder contarlo.
revoke all on function public.prospecto_mapa_ciudades(integer) from public;
revoke all on function public.prospecto_mapa_ciudades(integer) from anon;
revoke all on function public.prospecto_mapa_ciudades(integer) from authenticated;
grant execute on function public.prospecto_mapa_ciudades(integer) to service_role;

-- ── 2. El sello del aviso de peaje, dicho como de verdad se usa ────────────
comment on table public.peaje_cierre_aviso is
  'El sello del aviso de cierre de mes de peaje (0231), patrón 0202: el derecho a facturar un cruce de PASE se extingue el último día del mes en curso, así que conciliar a mes vencido llega SIEMPRE tarde. Se avisa una vez por (flota, mes, umbral) y un mes nuevo es un ciclo nuevo. Sin FK a gasto a propósito: el sello debe sobrevivir a que el gasto se borre. DESDE LA 0238 LA FILA ES TAMBIÉN LA RESERVA DEL INTENTO (claim-then-act, patrón 0227): el barrido inserta ANTES de mandar —la PK (tenant_id, periodo, umbral) es el árbitro, no un `if`— y si el WhatsApp no sale, BORRA la fila para que la corrida siguiente reintente. Antes se preguntaba, se mandaba y se sellaba al final, y dos corridas solapadas mandaban el mismo WhatsApp dos veces (auditoría ciclo 7, c7-17). Una fila viva significa: este aviso SALIÓ.';
