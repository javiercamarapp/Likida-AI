-- ═══════════════════════════════════════════════════════════════════════════
-- 0024 — La clave natural del canal: un teléfono, un operador.
--
-- CRÍTICO de la auditoría 5 (modelo de datos).
--
-- QUÉ ESTÁ MAL HOY. La única unicidad de `operador` es la de 0001:35,
-- `unique (tenant_id, telefono)`, y es sobre el TEXTO CRUDO. El mismo número
-- mexicano circula en tres formas distintas y ninguna es igual a la otra para
-- Postgres:
--
--     '529993700779'    (lo que hay hoy en la fila de Javier)
--     '5219993700779'   (lo que manda Meta en el `wa_id`)
--     '+521111111101'   (lo que hay hoy en las dos filas del seed)
--
-- Así que la restricción no ve un duplicado donde una persona sí lo ve.
--
-- EL ESCENARIO CON VALORES. Se da de alta a Javier en el tenant del prospecto
-- para el demo del 6-ago, o alguien lo captura con el "1" tal como llega de
-- Meta. El INSERT pasa: distinto tenant, o distinta cadena. Entonces llega un
-- mensaje de ese número y `resolveOperador` (conv.ts:59-69) hace
--
--     .in('telefono', variantesTelefono(telefono))   -- empata las DOS filas
--     .eq('activo', true)
--     .limit(1)                                      -- recorta a una ANTES
--     .maybeSingle()                                 -- por eso NO lanza el 406
--
-- y devuelve una arbitraria — la que el plan haya sacado primero. Con esa fila
-- se decide el `tenant_id` con el que se escriben el gasto y la liquidación.
-- Los tickets del operador acaban en la flota equivocada, con la RLS intacta
-- (la fila NACE con ese tenant, ninguna policy la detiene) y sin un solo error
-- en el log. El contralor de la flota B ve gasto de la flota A.
--
-- Fíjate en que `resolveOperador` NO filtra por tenant — no puede: el tenant es
-- justo lo que está tratando de averiguar. Por eso la unicidad que hace falta
-- es GLOBAL entre operadores activos, no por tenant. Una restricción por tenant
-- dejaría vivo exactamente el caso que rompe el dinero.
--
-- POR QUÉ UN ÍNDICE FUNCIONAL Y NO NORMALIZAR LA COLUMNA. Normalizar el texto
-- guardado obligaría a tocar `src/` (todo escritor tendría que normalizar) y a
-- reescribir filas de producción a nueve días del demo. El índice funcional
-- consigue lo mismo sin tocar una sola fila: la columna sigue guardando lo que
-- capturó la persona, y la BASE impone que dos capturas del mismo número no
-- puedan coexistir. Y las lecturas siguen funcionando tal cual, porque
-- `variantesTelefono` ya genera las cuatro formas (con y sin "1", con y sin "+")
-- y el `.in()` las empata todas contra el texto crudo.
--
-- Reversible: `drop index uq_operador_telefono_activo, uq_operador_tenant_telefono_norm;`
-- y después `drop function telefono_normalizado(text);`
-- ═══════════════════════════════════════════════════════════════════════════

-- ── La forma canónica ───────────────────────────────────────────────────────
-- Es la MISMA regla que ya viven `variantesTelefono` (conv.ts:43-55) y
-- `destinatarioWhatsApp` (meta/client.ts:63-67): quitar todo lo que no sea
-- dígito y, si queda un `521` + 10 dígitos (el "1" mexicano que Meta agrega al
-- entregar y RECHAZA al enviar), colapsarlo a `52` + 10.
--
-- Tiene que ser IMMUTABLE para poder indexarla, y lo es: `regexp_replace` y
-- `right` no dependen de nada externo. `returns null on null input` la hace
-- STRICT; las dos columnas donde se usa son `not null`, así que nunca aplica.
create or replace function telefono_normalizado(p_telefono text)
returns text
language sql
immutable
parallel safe
returns null on null input
as $$
  select case
           when regexp_replace(p_telefono, '\D', '', 'g') ~ '^521\d{10}$'
             then '52' || right(regexp_replace(p_telefono, '\D', '', 'g'), 10)
           else regexp_replace(p_telefono, '\D', '', 'g')
         end
$$;

comment on function telefono_normalizado(text) is
  'Forma canónica de un teléfono de WhatsApp. Misma regla que variantesTelefono y destinatarioWhatsApp: solo dígitos, y 521+10 se colapsa a 52+10 (el "1" que Meta agrega al entregar y rechaza al enviar). IMMUTABLE para poder indexarla.';

-- ── Comprobación contra los datos vivos ─────────────────────────────────────
-- Antes de imponer nada, decir en voz alta si la base ya está en el estado que
-- la restricción prohíbe. Un `create unique index` que falla solo dice "could
-- not create unique index"; esto dice CUÁLES números y en qué flotas, que es lo
-- que se necesita para arreglarlo.
--
-- Medido el 28-jul-2026 contra el proyecto de Likida: 3 operadores
-- ('+521111111101', '+521111111102', '529993700779'), tres formas canónicas
-- distintas, CERO duplicados. Esta migración no rompe nada hoy.
do $$
declare r record; msg text := '';
begin
  for r in
    select telefono_normalizado(telefono) as norm,
           count(*) as n,
           string_agg(distinct telefono, ', ') as crudos,
           count(distinct tenant_id) as flotas
    from operador
    where activo
    group by 1
    having count(*) > 1
  loop
    msg := msg || format(E'\n  %s → %s filas activas en %s flota(s): %s',
                         r.norm, r.n, r.flotas, r.crudos);
  end loop;

  if msg <> '' then
    raise exception E'Hay teléfonos que son el MISMO número escrito distinto, y hoy cada uno es un operador aparte:%\n\nMientras existan, `resolveOperador` elige uno arbitrariamente con `.limit(1)` y los gastos se escriben en la flota que salga primero. Desactiva (activo=false) el que no deba responder, o borra la fila duplicada, y vuelve a aplicar.', msg;
  end if;
end $$;

-- ── La restricción que faltaba ──────────────────────────────────────────────
-- GLOBAL, no por tenant, y solo sobre los ACTIVOS: es exactamente la forma de
-- la consulta de `resolveOperador` (`.in(variantes).eq('activo', true)`). Un
-- operador dado de baja en la flota A puede reaparecer en la flota B — eso es
-- una rotación normal y sigue permitido. Lo que queda prohibido es que dos
-- filas ACTIVAS respondan al mismo número, que es el único caso en el que el
-- producto tiene que adivinar.
--
-- OJO PARA EL DEMO: esto impide dar de alta el mismo celular en dos flotas a la
-- vez. Es a propósito — hoy eso corrompe el tenant del gasto en silencio —, pero
-- si en el ensayo hace falta el mismo número en dos tenants, hay que poner
-- `activo = false` en uno de los dos.
create unique index if not exists uq_operador_telefono_activo
  on operador (telefono_normalizado(telefono))
  where activo;

comment on index uq_operador_telefono_activo is
  'Un teléfono = un operador ACTIVO, en TODA la base. Global a propósito: resolveOperador no filtra por tenant porque el tenant es lo que está averiguando. Sin esto, dos filas activas del mismo número hacen que el gasto se escriba en la flota que el plan devuelva primero.';

-- La versión por tenant, sobre TODAS las filas (activas o no): es la de 0001:35
-- pero leyendo el número, no la cadena. Impide que la misma flota acabe con dos
-- fichas del mismo operador —una con el "1" y otra sin él— y con el historial
-- partido entre las dos.
create unique index if not exists uq_operador_tenant_telefono_norm
  on operador (tenant_id, telefono_normalizado(telefono));

comment on index uq_operador_tenant_telefono_norm is
  'Versión normalizada de unique(tenant_id, telefono) de 0001. La original compara texto crudo, así que "529993700779" y "5219993700779" pasaban como dos operadores distintos de la misma flota.';
