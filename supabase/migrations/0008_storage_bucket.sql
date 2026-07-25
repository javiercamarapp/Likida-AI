-- Bucket privado para los PDF de liquidación (B6 del audit: antes no se versionaba,
-- se creaba a mano). Privado → los PDF se sirven por createSignedUrl con TTL.

insert into storage.buckets (id, name, public)
values ('liquidaciones', 'liquidaciones', false)
on conflict (id) do nothing;
