-- 0202 · FASE 6 (relojes legales) — el sello de "este vencimiento ya se avisó".
--
-- El barrido de vencimientos (`avisarVencimientos`, relojes_legales.ts) corre
-- cada hora dentro del cron de escalar. Sin un sello persistente, cada corrida
-- mandaría el MISMO WhatsApp de "la póliza vence en 7 días" 24 veces al día —
-- la forma más rápida de entrenar al jefe a ignorar el canal.
--
-- La FECHA DE VENCIMIENTO va en la llave a propósito: un documento RENOVADO
-- (fecha nueva) es un ciclo nuevo y vuelve a avisar en sus propios umbrales
-- (30/7/0), que es exactamente lo que se quiere. Y el umbral también: el aviso
-- de "30 días", el de "7" y el de "vencido" son tres avisos distintos, cada
-- uno una sola vez.
--
-- No lleva FK a unidad/operador/flota_poliza: el sello debe SOBREVIVIR al
-- borrado del objeto (si la unidad se da de baja y se recrea, su documento es
-- otro ciclo) y una FK con cascade borraría la memoria de qué ya se avisó.
-- `objeto_id` es un uuid suelto con el `objeto` que lo desambigua.

create table if not exists public.aviso_vigencia (
  tenant_id  uuid not null references public.tenant(id) on delete cascade,
  objeto     text not null,
  objeto_id  uuid not null,
  documento  text not null,
  umbral     int  not null,
  vence      date not null,
  avisado_en timestamptz not null default now(),
  primary key (tenant_id, objeto, objeto_id, documento, umbral, vence),
  constraint aviso_vigencia_objeto_dominio
    check (objeto in ('unidad', 'operador', 'flota_poliza')),
  constraint aviso_vigencia_documento_dominio
    check (documento in ('poliza', 'permiso_sict', 'verificacion', 'licencia', 'poliza_flota')),
  constraint aviso_vigencia_umbral_dominio
    check (umbral in (0, 7, 30))
);

comment on table public.aviso_vigencia is
  'Idempotencia de los avisos de vencimiento (Fase 6): cada (documento, umbral, fecha) avisa por WhatsApp UNA sola vez. La fecha en la llave hace que el documento renovado vuelva a avisar en su propio ciclo. Escrito solo por el barrido del cron (service_role).';

alter table public.aviso_vigencia enable row level security;
revoke all on public.aviso_vigencia from public, anon, authenticated;
grant select, insert, update, delete on public.aviso_vigencia to service_role;
