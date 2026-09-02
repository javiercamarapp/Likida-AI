-- AUDITORÍA 19 (OP-19c2-3): el estado 'dead' del outbox de WhatsApp (0180) no
-- tenía consumidor ni alerta. `finalizar_wa_outbox` devolvía solo `boolean`
-- (¿se pudo actualizar la fila?), así que la app nunca sabía si esa
-- actualización dejó la fila en 'pending' (reintenta sola) o en 'dead'
-- (nadie la va a volver a intentar). Un mensaje al chofer o al jefe que
-- agota sus 8 reintentos se pierde en silencio: el cron sigue en verde
-- porque procesó la fila con éxito, solo que el resultado fue enterrarla.
--
-- El arreglo es de CONTRATO, no de lógica: la condición `intentos >= 8` que
-- decide 'dead' es la misma de la 0180, sin tocar. Se amplía el retorno de
-- `finalizar_wa_outbox` de `boolean` a `table(ok boolean, muerta boolean)`
-- para que el llamador (route.ts) pueda avisar con `alertarOperador`
-- exactamente cuando la fila muere — el mismo patrón que ya usan los otros
-- cinco crons (gps, escalar, purgar, facturar, wa-pendientes).

drop function if exists public.finalizar_wa_outbox(uuid, uuid, text, text);

create or replace function public.finalizar_wa_outbox(
  p_id uuid, p_token uuid, p_message_id text default null, p_error text default null
) returns table(ok boolean, muerta boolean)
language plpgsql security invoker set search_path=public,pg_catalog as $$
declare
  v_estado text;
begin
  if p_message_id is not null then
    update wa_outbox set estado='sent', provider_message_id=p_message_id, enviada_en=now(),
      lease_expires_at=null, ultimo_error=null where id=p_id and lease_token=p_token and estado='sending'
      returning wa_outbox.estado into v_estado;
  else
    update wa_outbox set estado=case when intentos >= 8 then 'dead' else 'pending' end,
      proximo_intento_en=now()+make_interval(secs=>least(3600, 15 * power(2, least(intentos, 8))::int)),
      lease_expires_at=null, ultimo_error=left(coalesce(p_error,'fallo de envío'),500)
      where id=p_id and lease_token=p_token and estado='sending'
      returning wa_outbox.estado into v_estado;
  end if;
  return query select found, coalesce(v_estado, '') = 'dead';
end $$;

revoke all on function public.finalizar_wa_outbox(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.finalizar_wa_outbox(uuid,uuid,text,text) to service_role;
