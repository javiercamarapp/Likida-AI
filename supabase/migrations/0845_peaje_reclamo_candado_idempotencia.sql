-- ═══════════════════════════════════════════════════════════════════════════
-- 0845 — PEAJES: candado de idempotencia en `peaje_reclamo` (auditoría
-- adversarial, HALLAZGO ALTO #1).
--
-- El botón «Registrar reclamo» (A2, reclamación de peajes) dispara un INSERT
-- real (`crearReclamoDeCategoria`, repo.ts) y el formulario de antes NUNCA
-- deshabilitaba el botón mientras la acción corría (`<form action={...}>`
-- plano, sin `useActionState`/`useFormStatus`). Ese doble clic ya se corrigió
-- en la pantalla, pero es defensa de UI: dos pestañas, un doble POST de red o
-- un reintento siguen pudiendo llegar aquí dos veces, y `crearReclamoDeCategoria`
-- no comprobaba nada antes de insertar — dos reclamos gemelos por el mismo
-- desglose y categoría, cada uno reclamando el mismo dinero por duplicado.
--
-- El candado real vive en la BASE, mismo molde que 0815 (`peaje_candidato_accion`):
-- un índice único parcial hace que el segundo INSERT choque con `23505` en vez
-- de escribir una fila gemela. `revision_cobros.ts` ya traduce ese choque a un
-- motivo legible.
--
-- Parcial `where estado <> 'rechazado'`: un reclamo rechazado no cuenta para el
-- candado — si el proveedor lo rechazó, hace falta poder volver a reclamar la
-- misma categoría del mismo desglose más adelante (otra evidencia, otro portal).
-- Un `desglose_id` en NULL (desglose anulado, 0777 pone `on delete set null`)
-- tampoco choca entre sí: NULL nunca es igual a NULL en un índice único.
--
-- Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

create unique index if not exists peaje_reclamo_activo_unico
  on public.peaje_reclamo (tenant_id, desglose_id, categoria)
  where estado <> 'rechazado';

comment on index public.peaje_reclamo_activo_unico is
  '0845: un reclamo ACTIVO (no rechazado) por flota+desglose+categoría. Hace idempotente el doble envío de "Registrar reclamo" (defensa de base, además de useActionState en el formulario).';
