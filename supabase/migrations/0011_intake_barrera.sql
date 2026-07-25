-- Barrera de ráfaga: contador de OCR de fotos EN VUELO por viaje. Las fotos
-- corren en PARALELO (rápido); el "listo" espera a que el contador llegue a 0
-- antes de cuadrar, para no cerrar sobre datos parciales. (El mutex por viaje no
-- garantizaba orden: el "listo" se colaba a media ráfaga.)

alter table viaje add column if not exists intake_pendientes int not null default 0;

-- Incremento/decremento atómico; devuelve el nuevo contador (nunca < 0).
create or replace function intake_delta(p_viaje uuid, p_delta int)
returns int
language plpgsql
as $$
declare n int;
begin
  update viaje set intake_pendientes = greatest(0, intake_pendientes + p_delta)
  where id = p_viaje
  returning intake_pendientes into n;
  return coalesce(n, 0);
end $$;
