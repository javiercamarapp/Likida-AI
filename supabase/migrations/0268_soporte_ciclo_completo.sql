-- ═══════════════════════════════════════════════════════════════════════════
-- 0268 — SOPORTE: cerrar el ciclo que la 0051 dejó abierto.
--
-- La 0051 construyó la tabla, el reloj de SLA y el hilo con notas internas.
-- Tres años de producto después (auditoría de dashboards, 29-ago-2026, H1) el
-- diagnóstico por grep contra `6b4b1b52` fue:
--
--   · `ticket_mensaje` — CERO escritores en todo `src/`. Dos lectores
--     (`agentes/faq.ts`, `agentes/exito.ts`) leyendo una tabla que nadie llena.
--   · `ticket_soporte.estado` — CERO UPDATEs en todo `src/`. Ningún ticket
--     podía salir jamás de 'abierto'; el dominio de cinco estados y el
--     constraint `ticket_cierre_coherente` describían transiciones que ningún
--     camino del producto podía ejecutar.
--   · Consecuencia medible: la alarma «sin respuesta» del agente de Éxito
--     (`exito.ts`, `cuentaComoRespuesta`) exige un mensaje PÚBLICO de un autor
--     distinto del solicitante. Sin escritores, esa condición era
--     INSATISFACIBLE POR CONSTRUCCIÓN: la alarma no se apagaba nunca, y una
--     alarma que no se puede apagar deja de leerse a las dos semanas.
--
-- Esta migración pone las DOS piezas de esquema que faltaban para que el
-- producto pueda cerrar ese ciclo. El resto (responder, tomar, cerrar,
-- reabrir) es código: `src/lib/likida/soporte.ts`.
--
-- ── 1. `asignado_a` — QUIÉN LO TOMÓ ────────────────────────────────────────
--
-- «Tomar un ticket» no es un estado, es una PERSONA. `estado='en_proceso'`
-- dice que alguien lo está viendo; no dice quién, y una cola donde tres
-- personas creen que lo tiene otra es una cola donde nadie contesta. Va como
-- FK a `app_user` con `on delete set null` —mismo criterio que
-- `abierto_por`—: si la cuenta se da de baja, el ticket queda SIN dueño y se
-- ve en la cola, en vez de desaparecer con ella.
--
-- ── 2. LA NOTA INTERNA NO LA VE EL CLIENTE — de verdad, no de palabra ──────
--
-- La 0051 escribió, textual: «una nota interna no la ve el cliente». Pero su
-- policy `tenant_data` era `for all` con un único predicado de tenant, y la
-- 0086 la reescribió conservando esa forma: un `flota_admin` con sesión de
-- navegador leía `interna=true` de SUS tickets igual que cualquier otro
-- mensaje. El comentario prometía una garantía que la policy no daba.
--
-- Aquí se parte en dos policies, y la lectura del cliente EXCLUYE `interna`:
--
--   · SELECT  — el tenant ve su hilo PÚBLICO; el superadmin ve el hilo entero.
--   · INSERT  — el tenant escribe solo mensajes públicos (no puede fabricar
--     una nota interna a nombre del equipo) Y FIRMADOS CON SU PROPIO uuid (no
--     puede fabricar una respuesta a nombre de otro); el superadmin, las dos.
--   · UPDATE/DELETE — sin policy, o sea DENIEGA-TODO para `authenticated`.
--     Es deliberado: el hilo de un ticket es el registro de qué se dijo y
--     cuándo. Un registro que su propia parte interesada puede editar después
--     no sirve para lo que existe. (Los borrados en cascada al eliminar el
--     ticket los ejecuta la acción referencial de la FK, que no pasa por RLS.)
--
-- COMO SIEMPRE, ESTA ES LA SEGUNDA RED. El producto consulta con
-- `service_role`, que SALTA RLS (`src/lib/supabase/admin.ts`): la primera red
-- es el `.eq('interna', false)` que `getHilo` pone a mano cuando quien mira es
-- la flota, probado en `src/lib/likida/soporte.test.ts`. Esta policy es la que
-- protege una sesión de navegador con `authenticated`, y se demuestra contra
-- Postgres real en el bloque 217 de `supabase/verificaciones.sql`.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Quién tomó el ticket ────────────────────────────────────────────────
alter table public.ticket_soporte
  add column if not exists asignado_a uuid references public.app_user(id) on delete set null;

comment on column public.ticket_soporte.asignado_a is
  'Quién de Likida tomó el ticket. NULL = nadie lo ha tomado todavía, y la cola lo dice: "sin tomar" no es "en proceso". on delete set null — si la cuenta se da de baja el ticket queda sin dueño y sigue visible, no desaparece con ella.';

-- La cola de "lo mío" y la de "sin tomar" se leen por esta columna; el índice
-- parcial deja fuera las filas NULL, que son la mayoría en una cola sana.
create index if not exists ticket_asignado_idx
  on public.ticket_soporte (asignado_a, estado) where asignado_a is not null;

-- ── 2. El hilo: la nota interna deja de ser visible para el cliente ────────
drop policy if exists tenant_data on public.ticket_mensaje;
-- Los `drop … if exists` de las policies NUEVAS no son ceremonia: sin ellos la
-- migración truena al reaplicarse ("policy already exists") y deja el trabajo a
-- medias — la de lectura creada y la de escritura no, que es exactamente el
-- estado en el que el ancla de autor NO existe. Mismo criterio que el resto del
-- archivo, donde todo va con `if not exists`.
drop policy if exists hilo_lectura on public.ticket_mensaje;
drop policy if exists hilo_escritura on public.ticket_mensaje;

create policy hilo_lectura on public.ticket_mensaje for select
  using (
    is_superadmin()
    or (
      exists (
        select 1 from public.ticket_soporte t
         where t.id = ticket_mensaje.ticket_id
           and t.tenant_id = any(get_user_tenant_ids())
      )
      and ticket_mensaje.interna = false
    )
  );

create policy hilo_escritura on public.ticket_mensaje for insert
  with check (
    is_superadmin()
    or (
      exists (
        select 1 from public.ticket_soporte t
         where t.id = ticket_mensaje.ticket_id
           and t.tenant_id = any(get_user_tenant_ids())
      )
      and ticket_mensaje.interna = false
      -- ── QUIEN ESCRIBE FIRMA CON SU PROPIO NOMBRE ─────────────────────────
      -- Revisión de Fable (29-ago-2026), demostrada en vivo contra Postgres
      -- con impersonación real: sin esta línea, un flota_admin con sesión de
      -- navegador insertaba un mensaje PÚBLICO firmado con el uuid de OTRO
      -- usuario — un compañero suyo, o un uuid de superadmin que se hubiera
      -- filtrado, y entonces `HiloSoporte` lo pinta como "Likida".
      --
      -- No es solo una firma falsa en pantalla: ese mensaje cumple
      -- `cuentaComoRespuesta` (interna=false, autor≠solicitante) y por lo
      -- tanto APAGA la alarma «sin respuesta» del agente de Éxito sin que
      -- nadie haya contestado. O sea que el hueco convertía la garantía que
      -- esta migración vino a construir en algo que el propio cliente podía
      -- desactivar. El `(select …)` es la forma que Postgres cachea una vez
      -- por consulta en vez de evaluar por fila.
      --
      -- La rama del superadmin NO lleva el ancla, a propósito: necesita poder
      -- escribir con `autor_id` NULL (mensajes de sistema) y ya tiene acceso a
      -- todas las flotas por definición — firmar por otro no le concede nada
      -- que no tuviera. Aquí el ancla existe contra la ESCALACIÓN, y del lado
      -- del tenant es donde había escalación que impedir.
      and ticket_mensaje.autor_id = (select auth.uid())
    )
  );
