-- ═══════════════════════════════════════════════════════════════════════════
-- 0081 — pod: la subida del chofer amarra el tenant del POD al del viaje
--
-- `operador_sube_su_pod` (0047) es la ÚNICA escritura RLS que le queda al
-- chofer. Su with check verificaba que el viaje fuera SUYO (por operador_id)
-- pero NO que el tenant_id del POD coincidiera con el del viaje: un chofer con
-- la anon key podía insertar `{ tenant_id: '<flota B>', viaje_id: '<su viaje
-- de A>' }` — el viaje es suyo (pasa), y la fila quedaba en la flota B con un
-- viaje de A. La auditoría 13 (seguridad/datos) lo confirmó.
--
-- El fix amarra ambos: el viaje tiene que ser del chofer Y el tenant_id del
-- POD tiene que ser el tenant del viaje.
-- ═══════════════════════════════════════════════════════════════════════════
drop policy if exists operador_sube_su_pod on public.pod;
create policy operador_sube_su_pod on public.pod for insert
  with check (
    viaje_id in (select id from public.viaje where operador_id = get_user_operador_id())
    and tenant_id = (select tenant_id from public.viaje where id = viaje_id)
  );
