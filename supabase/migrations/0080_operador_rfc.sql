-- ═══════════════════════════════════════════════════════════════════════════
-- 0080 — operador.rfc: el RFC del trabajador, para RLISR 57
--
-- La rama buena de RLISR 57 (viático timbrado al RFC del OPERADOR, trabajador
-- subordinado → deducción válida) era inalcanzable: `engine.ts` la exige vía
-- `input.operadorRfc` y NADIE lo producía — `operador` no tenía columna de RFC
-- y `desde_db.ts` no pasaba el campo. Todo viático a nombre del operador
-- caía en 'revisar' sin poder confirmarse, aunque el reglamento lo conceda.
--
-- La columna es opcional (null = no se ha capturado): sin RFC no se puede
-- confirmar NI descartar, y el motor ya trata ese caso con el aviso honesto
-- de `viatico_rfc_operador` en vez de quitar la deducción.
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.operador add column if not exists rfc text;

comment on column public.operador.rfc is
  'RFC del trabajador (persona física). Opcional: lo captura la flota. Sin el no se puede confirmar la rama buena de RLISR 57 (viatico timbrado al RFC del operador subordinado) y el motor lo deja en revisar con aviso.';
