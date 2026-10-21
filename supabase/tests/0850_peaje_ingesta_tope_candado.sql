\set ON_ERROR_STOP on
-- 0850 — `peaje_archivo_encolar` contra Postgres REAL (hallazgo crítico de la auditoría adversarial,
-- 21-oct-2026): dedup por huella, tope de 50 pendientes/procesando por flota, y que ni `fallida` ni
-- `procesada` cuenten para el tope. La CONCURRENCIA real (dos envíos simultáneos) va en el script
-- `.sh` de este mismo número — este archivo es la corrección secuencial.
begin;

insert into public.tenant (id, nombre) values
  ('85000000-0000-4000-8000-0000000000a1', 'Flota A 0850'),
  ('85000000-0000-4000-8000-0000000000a2', 'Flota B 0850');

do $$
declare
  A constant uuid := '85000000-0000-4000-8000-0000000000a1';
  B constant uuid := '85000000-0000-4000-8000-0000000000a2';
  -- `huella` exige forma `^[0-9a-f]{64}$` (sha256 real en producción): aquí se simula con dos md5
  -- concatenados (32 + 32 = 64 hex), uno por «etiqueta» para que cada caso de la prueba sea distinto.
  h0 constant text := md5('h0') || md5('H0');
  hnueva51 constant text := md5('nueva-51') || md5('NUEVA-51');
  hliberar constant text := md5('tras-liberar') || md5('TRAS-LIBERAR');
  hfallida constant text := md5('tras-fallida') || md5('TRAS-FALLIDA');
  hb0 constant text := md5('hb0') || md5('HB0');
  h1 constant text := md5('h1') || md5('H1');
  h2 constant text := md5('h2') || md5('H2');
  r1 record; r2 record; r3 record;
  i integer;
begin
  -- (a) el primer archivo entra sin problema: no es duplicado, estado pendiente.
  select * into r1 from public.peaje_archivo_encolar(A, h0, 'uno.csv', 'PASE', 'api', 10, '\x01'::bytea);
  if r1.duplicado or r1.estado <> 'pendiente' or r1.id is null then
    raise exception '0850 a: el primer archivo no entró como se esperaba (%)', r1;
  end if;

  -- (b) la MISMA huella (archivo reenviado, aunque cambie el nombre) es el mismo registro: duplicado=true, mismo id, SIN insertar otra fila.
  select * into r2 from public.peaje_archivo_encolar(A, h0, 'copia-renombrada.csv', null, 'panel', 10, '\x01'::bytea);
  if not r2.duplicado or r2.id <> r1.id then
    raise exception '0850 b: el reenvío del mismo archivo NO se detectó como duplicado (%)', r2;
  end if;
  if (select count(*) from public.peaje_ingesta_archivo where tenant_id = A) <> 1 then
    raise exception '0850 b: el reenvío insertó una fila de más';
  end if;

  -- (c) llenar la flota A hasta el tope (50 pendientes/procesando: la de (a) + 49 más).
  for i in 1..49 loop
    insert into public.peaje_ingesta_archivo (tenant_id, huella, nombre, proveedor, origen, bytes, contenido, estado)
      values (A, md5('relleno' || i) || md5('RELLENO' || i), 'relleno' || i || '.csv', 'PASE', 'api', 10, '\x01'::bytea, 'pendiente');
  end loop;
  if (select count(*) from public.peaje_ingesta_archivo where tenant_id = A and estado in ('pendiente','procesando')) <> 50 then
    raise exception '0850 c: no quedó la flota A en 50 pendientes';
  end if;

  -- (d) un archivo NUEVO (huella nunca vista) con la flota ya en 50 choca con el tope (54000), y NO inserta fila.
  begin
    perform public.peaje_archivo_encolar(A, hnueva51, 'cincuentayuno.csv', 'PASE', 'api', 10, '\x01'::bytea);
    raise exception '0850 d: el archivo 51 NO chocó con el tope — el candado no está funcionando';
  exception when sqlstate '54000' then null; end;
  if (select count(*) from public.peaje_ingesta_archivo where tenant_id = A) <> 50 then
    raise exception '0850 d: el intento que chocó con el tope insertó una fila de todos modos';
  end if;

  -- (e) un archivo reenviado (huella YA conocida) sigue contestando duplicado aunque la flota esté en el tope: el dedup no topa.
  select * into r3 from public.peaje_archivo_encolar(A, h0, 'otra-vez.csv', null, 'api', 10, '\x01'::bytea);
  if not r3.duplicado or r3.id <> r1.id then
    raise exception '0850 e: el dedup de un archivo ya conocido topó con la flota llena (%)', r3;
  end if;

  -- (f) marcar uno como `procesada` (ya no pendiente/procesando) libera un lugar: ahora sí entra uno nuevo.
  update public.peaje_ingesta_archivo set estado = 'procesada', contenido = null where tenant_id = A and huella = md5('relleno1') || md5('RELLENO1');
  select * into r3 from public.peaje_archivo_encolar(A, hliberar, 'nuevo.csv', 'PASE', 'api', 10, '\x01'::bytea);
  if r3.duplicado or r3.estado <> 'pendiente' then
    raise exception '0850 f: no entró tras liberar un lugar (%)', r3;
  end if;

  -- (g) `fallida` tampoco cuenta para el tope: marcar OTRO como fallida y confirmar que un archivo nuevo sigue entrando.
  update public.peaje_ingesta_archivo set estado = 'fallida' where tenant_id = A and huella = md5('relleno2') || md5('RELLENO2');
  select * into r3 from public.peaje_archivo_encolar(A, hfallida, 'otro-nuevo.csv', 'PASE', 'api', 10, '\x01'::bytea);
  if r3.duplicado or r3.estado <> 'pendiente' then
    raise exception '0850 g: `fallida` contó para el tope (%)', r3;
  end if;

  -- (h) otra flota (B) no se ve afectada por el tope de A: entra sin problema aunque A esté llena.
  select * into r3 from public.peaje_archivo_encolar(B, hb0, 'b.csv', 'PASE', 'api', 10, '\x01'::bytea);
  if r3.duplicado or r3.estado <> 'pendiente' then
    raise exception '0850 h: la flota B fue bloqueada por el tope de la flota A (%)', r3;
  end if;
end $$;

rollback;
