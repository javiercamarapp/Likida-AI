-- REVERSA: recrear las 4 políticas con el texto de la 0046 (+ initplan de la 0126):
--   create policy "avatares_propio_insert" on storage.objects for insert to authenticated with check (bucket_id = 'avatares' and (storage.foldername(name))[1] = (select auth.uid())::text);
--   create policy "avatares_propio_update" on storage.objects for update to authenticated using (bucket_id = 'avatares' and (storage.foldername(name))[1] = (select auth.uid())::text);
--   create policy "avatares_propio_delete" on storage.objects for delete to authenticated using (bucket_id = 'avatares' and (storage.foldername(name))[1] = (select auth.uid())::text);
--   create policy "avatares_lectura_publica" on storage.objects for select to public using (bucket_id = 'avatares');
-- Aplicación doble: segura (drop policy if exists).
-- ═══════════════════════════════════════════════════════════════════════════
-- 0948 — SEGURIDAD OLA 1 · A1 (B-11, SEG-3-03): el bucket `avatares` deja de tener políticas sobre storage.objects.
--
-- Las 4 políticas de la 0046 no tienen consumidor: el producto sube, reemplaza y borra avatares con `supabaseAdmin()` (service_role)
-- (`dashboard/mi-perfil/page.tsx`, `admin/mi-perfil/page.tsx`, `perfil/avatar_huerfanos.ts`) y los sirve por `getPublicUrl`. El bucket
-- sigue siendo `public = true`: Storage sirve /object/public/avatares/... SIN evaluar políticas, así que las fotos se siguen viendo.
-- Lo que se cierra: (1) LISTAR el bucket con la anon key (la política SELECT `to public` enumeraba todos los UUID), y (2) que cualquier
-- cuenta de Supabase Auth escriba directo en un bucket público sin tope de cantidad. El único navegador-Storage del producto
-- (`browser-storage.ts`) usa `uploadToSignedUrl` con un token que firma el servidor y no depende de estas políticas.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

drop policy if exists "avatares_propio_insert"  on storage.objects;
drop policy if exists "avatares_propio_update"  on storage.objects;
drop policy if exists "avatares_propio_delete"  on storage.objects;
drop policy if exists "avatares_lectura_publica" on storage.objects;

commit;
