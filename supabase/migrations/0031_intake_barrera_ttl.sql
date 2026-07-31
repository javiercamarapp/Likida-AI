-- ═══════════════════════════════════════════════════════════════════════════
-- EL CONTADOR DE LA BARRERA NO TENÍA CÓMO OLVIDAR UN `-1` PERDIDO.
--
-- La 0011 dejó un contador puro: `+1` al entrar la foto, `-1` al terminar el
-- OCR. El `-1` vive en un `finally` (processor.ts:492), y el comentario de
-- `esperarIntake` presume de eso: "un OCR que truena igual libera su +1".
--
-- Un `finally` no corre cuando el proceso no vuelve. La función del webhook
-- tiene `maxDuration = 120`: si Vercel la mata por tope, por memoria o por un
-- despliegue a media ráfaga, el `+1` queda escrito y el `-1` nunca se ejecuta.
-- No hay nada que lo limpie: ni TTL, ni reset, ni barrido. El mutex del viaje SÍ
-- expira por lease (0005) — el contador de al lado, no.
--
-- ── LO QUE CUESTA, Y ES PARA SIEMPRE ───────────────────────────────────────
--
-- El viaje queda con `intake_pendientes = 1` de por vida. A partir de ahí, CADA
-- "listo" de ese viaje:
--
--   1. espera los 20s completos de la barrera (el contador nunca baja a 0),
--   2. se come un sexto del presupuesto de la función, y
--   3. devuelve `false` → el operador recibe "cuadré con los N que alcancé a
--      procesar" sobre una liquidación que estaba COMPLETA.
--
-- Es decir: el aviso de liquidación corta se convierte en permanente y falso
-- justo en el viaje que ya sufrió una caída. Y es el peor sitio para un aviso
-- falso, porque es el que enseña a ignorarlos.
--
-- ── EL ARREGLO: UNA MARCA DE TIEMPO, Y OLVIDAR LO VIEJO ─────────────────────
--
-- Cada `+1` sella `intake_pendientes_en`. Antes de aplicar cualquier delta, si
-- ese sello tiene más de 10 minutos el contador arranca de cero: nada que se
-- registró hace diez minutos puede seguir en vuelo cuando el tope de la función
-- son 120 segundos. Son 5× de margen sobre el peor caso legítimo.
--
-- El olvido ocurre TAMBIÉN en el sondeo (`p_delta = 0`), que es como lo llama
-- `esperarIntake`: así el primer "listo" después de la caída ya encuentra la
-- barrera abierta, sin esperar a que llegue una foto nueva.
--
-- Por qué el sello NO se refresca al decrementar: un `-1` es trabajo que
-- TERMINA, no evidencia de que quede algo vivo. Refrescarlo dejaría que una
-- ráfaga larga mantuviera vivo indefinidamente el `+1` huérfano de otra.
-- ═══════════════════════════════════════════════════════════════════════════

alter table viaje add column if not exists intake_pendientes_en timestamptz;

comment on column viaje.intake_pendientes_en is
  'Cuándo se registró el último OCR en vuelo (+1). Si tiene más de 10 minutos, intake_delta() considera muerto el contador y lo reinicia: el -1 vive en un finally y un finally no corre si el proceso muere.';

create or replace function intake_delta(p_viaje uuid, p_delta int)
returns int
language plpgsql
as $$
declare n int;
begin
  update viaje
     set intake_pendientes = greatest(0,
           case
             -- Sello vencido (o nunca sellado con un contador vivo, que solo
             -- pasa con filas anteriores a esta migración): el conteo previo es
             -- basura de un proceso que no volvió. Se arranca de cero.
             when intake_pendientes > 0
              and (intake_pendientes_en is null
                   or intake_pendientes_en < now() - interval '10 minutes')
             then 0
             else intake_pendientes
           end + p_delta),
         -- Solo un incremento sella: es lo único que afirma "hay algo en vuelo".
         intake_pendientes_en = case when p_delta > 0 then now() else intake_pendientes_en end
   where id = p_viaje
   returning intake_pendientes into n;
  return coalesce(n, 0);
end $$;

comment on function intake_delta(uuid, int) is
  'Contador atómico de OCR en vuelo por viaje (barrera de ráfaga). Reinicia el conteo si el último +1 tiene más de 10 minutos: sin eso, un proceso muerto entre el +1 y el -1 deja el viaje esperando la barrera completa y avisando "liquidación corta" para siempre. Ver 0011 y 0031.';

-- `create or replace` conserva dueño y permisos, así que los grants de la 0012
-- siguen puestos. Se repiten igual: son idempotentes, y la 0022 ya enseñó lo que
-- cuesta suponer sobre firmas de funciones —`int` es alias de `integer`, así que
-- esto REEMPLAZA la de la 0011 en vez de dejar dos vivas, que es lo que hace que
-- toda llamada falle con "is not unique"—. Repetirlo aquí lo vuelve verificable
-- leyendo un solo archivo.
revoke execute on function intake_delta(uuid, integer) from public, anon, authenticated;
grant execute on function intake_delta(uuid, integer) to service_role;
