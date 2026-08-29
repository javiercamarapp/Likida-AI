-- ═══════════════════════════════════════════════════════════════════════════
-- 0248 — EL VIGILANTE DE PORTALES ENTRA AL CATÁLOGO DE CRONS.
--
-- Nace `/api/cron/portales-vivos`: una pasada semanal que comprueba que las
-- URLs de facturación del catálogo sigan llevando a un portal. Lo único que la
-- base necesita saber de él es que su latido es legítimo.
--
-- ── POR QUÉ ESTA MIGRACIÓN EXISTE, Y POR QUÉ NO ES OPCIONAL ───────────────
--
-- `cron_latido_id_dominio` es una lista CERRADA de ids. Un cron cuyo id no esté
-- aquí llama a `registrarLatido` y la base lo rechaza — y `registrarLatido`
-- atrapa el error y solo lo `warn`ea (es best-effort a propósito: un latido que
-- tumbara la corrida sería peor que no tenerlo). O sea que el cron correría
-- perfectamente, la base rechazaría cada latido en silencio, y `/api/health`
-- no podría llamarlo muerto porque nunca tendría un latido suyo que juzgar.
--
-- Eso no es una hipótesis: le pasó a `asistencia` y a `descarga-sat`, que
-- llevaban SEMANAS así hasta que la 0241 lo cazó. Añadir el vigilante sin pasar
-- por aquí sería repetir ese bug a sabiendas — y con especial ironía, porque el
-- cron que se estaría silenciando es precisamente el que existe para que nada
-- se pudra en silencio.
--
-- ── SE ENUMERA EL CATÁLOGO COMPLETO ──────────────────────────────────────
--
-- Once valores: los diez de la 0241 más `portales-vivos`. Es la lección de la
-- 0227 con `interruptor_id_dominio` y la de la 0241 con este mismo CHECK: una
-- lista corta NO falla ruidosamente, silencia latidos. Se escribe entera cada
-- vez que se toca, aunque duela repetirla, porque el modo de falla de olvidar
-- uno es invisible.
--
-- Espejo de `CRONS` en `src/lib/admin/salud.ts`, y `salud.test.ts` compara las
-- dos listas —lee el ÚLTIMO `add constraint cron_latido_id_dominio` de todo
-- `supabase/migrations/`, así que esta migración es la que manda a partir de
-- ahora—. Si divergen, la prueba falla diciendo qué id sobra o falta.
--
-- ── LO QUE ESTA MIGRACIÓN NO HACE ────────────────────────────────────────
--
-- NO crea tabla para el historial de las pasadas. Se consideró y se dejó fuera
-- a propósito: el resultado de cada pasada va al log estructurado y los rotos
-- salen por `alertarOperador`, que es el mismo camino por el que ya gritan los
-- demás crons. Una tabla de historial solo se gana su sitio cuando alguien
-- quiera preguntarle algo —«¿cuántas semanas lleva parpadeando este portal?»—
-- y esa pregunta todavía no existe. Crearla antes sería una tabla que nadie
-- lee, con su RLS y su purga, para adivinar un uso futuro.
-- ═══════════════════════════════════════════════════════════════════════════

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'cron_latido_id_dominio' and conrelid = 'public.cron_latido'::regclass
  ) then
    alter table public.cron_latido drop constraint cron_latido_id_dominio;
  end if;
  alter table public.cron_latido
    add constraint cron_latido_id_dominio
    check (id in (
      'wa-pendientes',
      'wa-outbox',
      'escalar',
      'facturar',
      'purgar',
      'runner',
      'gps',
      'asistencia',
      'descarga-sat',
      'jornada',
      'portales-vivos'
    ));
end $$;

comment on constraint cron_latido_id_dominio on public.cron_latido is
  'El catálogo COMPLETO de ids de cron, espejo de CRONS en lib/admin/salud.ts. Se enumera entero al tocarlo: una lista corta no falla ruidosamente, silencia el latido de los crons que faltan (le pasó a asistencia y a descarga-sat, corregido en la 0241). La 0248 añade portales-vivos.';
