-- PERFIL EDITABLE — nombre y foto de perfil, hoy solo lo usa Javier
-- (superadmin) desde /admin/mi-perfil, pero la columna vive en `app_user`
-- así que cualquier rol la puede usar el día que su propio panel tenga
-- edición de perfil.
--
-- `avatar_url` guarda la URL pública del archivo en el bucket `avatares`
-- (o null si no ha subido foto — el círculo con la inicial sigue siendo
-- el fallback, nunca una imagen inventada).

alter table app_user add column if not exists avatar_url text;

-- Bucket PÚBLICO a propósito (a diferencia de `comprobantes`, que es
-- privado): una foto de perfil no trae RFC ni datos fiscales, es la
-- misma sensibilidad que un avatar de cualquier app — servirla sin URL
-- firmada evita tener que regenerar una firma cada vez que se pinta el
-- círculo del sidebar.
insert into storage.buckets (id, name, public)
values ('avatares', 'avatares', true)
on conflict (id) do nothing;

-- Cada usuario autenticado sube/reemplaza/borra SOLO su propio avatar —
-- la carpeta del archivo es su propio `auth.uid()`, no el nombre que él
-- elija, así que no puede pisar el de alguien más aunque adivine la ruta.
-- CREATE POLICY no soporta IF NOT EXISTS en Postgres (a diferencia de
-- CREATE TABLE/INDEX) — drop-then-create es el idiom estándar para que la
-- migración sea repetible.
drop policy if exists "avatares_propio_insert" on storage.objects;
create policy "avatares_propio_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatares' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "avatares_propio_update" on storage.objects;
create policy "avatares_propio_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'avatares' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "avatares_propio_delete" on storage.objects;
create policy "avatares_propio_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatares' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "avatares_lectura_publica" on storage.objects;
create policy "avatares_lectura_publica" on storage.objects
  for select to public
  using (bucket_id = 'avatares');
