-- 0063 — Los tres huecos que impiden operar de verdad.
--
-- Salieron de tres auditorías distintas. Ninguno se nota con 8 viajes de
-- prueba; los tres muerden el primer día con una flota real.
--
-- ═══ 1. LA COLA DE FACTURACIÓN SE BLOQUEA A SÍ MISMA ═══════════════════════
--
-- `/api/cron/facturar` elige los 8 gastos más viejos sin CFDI. Pero
-- `facturarAlVuelo` NO marca nada cuando la decisión es "no procede"
-- (requiere_cuenta, confianza_baja, sin_adaptador). Así que esos 8 se vuelven a
-- elegir en cada corrida, para siempre: bloqueo de cabeza de línea.
--
-- Con 660 comprobantes al día, la facturación automática deja de alcanzar
-- comprobantes NUEVOS en la primera hora, y la única señal habría sido un
-- contador creciendo dentro de un `logger.info` que nadie lee.
--
-- Se marca el INTENTO, no el resultado: un ticket que no procede hoy puede
-- proceder mañana (llega su adaptador, o alguien captura el dato que faltaba),
-- así que la marca ordena la cola en vez de sacarlo de ella.
--
-- ═══ 2. LAS RETENCIONES NO SE PUEDEN CALCULAR ══════════════════════════════
--
-- El autotransporte de carga retiene IVA al 4%, y el panel del contador no lo
-- puede mostrar porque `gasto` solo guarda impuestos TRASLADADOS
-- (`iva_traslado`, `ieps_traslado`). El nodo `cfdi:Retenciones` del XML se
-- descarta al importar aunque el proveedor lo mande.
--
-- `subtotal × 0.04` habría sido inventar la cifra: la retención depende de
-- quién es el receptor y del tipo de servicio, no de una multiplicación. Se
-- guarda lo que el CFDI declare, o nada.
--
-- ═══ 3. LOS 11 PORTALES QUE PIDEN CUENTA ═══════════════════════════════════
--
-- De los 35 portales del registro, 11 exigen sesión. Hoy esos van por mensaje
-- al encargado, que entra a mano. Para automatizarlos hace falta guardar la
-- credencial de la flota — y eso es lo más delicado de todo el producto.
--
-- POR QUÉ LA CONTRASEÑA NO SE GUARDA AQUÍ: esta tabla guarda el USUARIO y una
-- REFERENCIA al secreto, nunca el secreto. La contraseña de una flota en su
-- portal fiscal es una llave a su contabilidad; en una columna de Postgres
-- queda en los respaldos, en el WAL y en cualquier consulta de soporte. Va en
-- el gestor de secretos de la plataforma, y aquí solo su nombre.
--
-- Sin esa disciplina, un día alguien hace `select * from portal_credencial`
-- para depurar y las contraseñas de sus clientes acaban en un log.

-- ── 1 ──────────────────────────────────────────────────────────────────────
alter table public.gasto add column if not exists autofactura_intentada_en timestamptz;

comment on column public.gasto.autofactura_intentada_en is
  'Cuando el cron de facturacion intento este gasto, proceda o no. Ordena la cola: sin esto los que no proceden se re-eligen en cada corrida y bloquean a los nuevos.';

-- El indice de la 0060 se reemplaza: la cola ahora se ordena por el intento
-- (los nunca intentados primero, con `nulls first`), no por antiguedad a secas.
drop index if exists public.gasto_por_facturar_idx;
create index if not exists gasto_por_facturar_idx
  on public.gasto (autofactura_intentada_en nulls first, created_at)
  where cfdi_uuid is null;

-- ── 2 ──────────────────────────────────────────────────────────────────────
alter table public.gasto add column if not exists iva_retenido numeric(12,2);
alter table public.gasto add column if not exists isr_retenido numeric(12,2);

comment on column public.gasto.iva_retenido is
  'Retencion de IVA que declara el CFDI (nodo cfdi:Retenciones, Impuesto=002). NULL = el comprobante no la declara, que NO es lo mismo que cero.';

-- ── 3 ──────────────────────────────────────────────────────────────────────
create table if not exists public.portal_credencial (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant(id) on delete cascade,
  -- La clave del comercio en `facturacion/comercios.ts`. Texto y no enum: el
  -- registro de portales vive en el codigo y cambia mas seguido que el esquema.
  comercio text not null,
  usuario text not null,
  -- NOMBRE de la variable de entorno o del secreto, NUNCA el secreto.
  secreto_ref text not null,
  activa boolean not null default true,
  -- Para saber si la sesion sigue sirviendo sin tener que probarla a ciegas.
  ultimo_uso_en timestamptz,
  ultimo_error text,
  created_at timestamptz not null default now(),
  unique (tenant_id, comercio)
);

alter table public.portal_credencial enable row level security;

-- Ni una politica de lectura para roles de aplicacion, a proposito: esta tabla
-- la lee UNICAMENTE el proceso de facturacion con service-role. Un contador o
-- un flota_admin no tienen por que ver ni el usuario con el que entra el robot.
comment on table public.portal_credencial is
  'Credenciales de portales que exigen cuenta. Guarda usuario y REFERENCIA al secreto, jamas el secreto. Sin politicas RLS: solo la toca el proceso de facturacion con service-role.';

-- Que nadie meta una contrasena aqui por descuido. No es criptografia, es un
-- pasamanos: atrapa el error honesto, que es el que de verdad ocurre.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.portal_credencial'::regclass and conname = 'secreto_ref_no_parece_secreto'
  ) then
    alter table public.portal_credencial add constraint secreto_ref_no_parece_secreto
      check (secreto_ref !~ '[^A-Za-z0-9_.-]' and length(secreto_ref) <= 120);
  end if;
end $$;
