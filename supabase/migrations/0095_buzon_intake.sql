-- ═══════════════════════════════════════════════════════════════════════════
-- EL BUZÓN DE INTAKE — la dirección de correo propia de cada flota
--
-- Los tres agentes que pidió Transportes Innovativos dependen de esto: las
-- facturas de talleres, refaccionarias y diésel llegan POR CORREO, no por
-- WhatsApp. Hasta hoy se subían a mano desde la bandeja del Agente de
-- Proveedores.
--
-- ── POR QUÉ UN TOKEN Y NO EL UUID DE LA FLOTA ────────────────────────────
--
-- La tentación obvia es `facturas+<tenant_id>@mail.likida.ai`: no cuesta nada y
-- el tenant sale de la propia dirección. El problema es que un `tenant_id`
-- aparece en URLs del panel, en logs y en cualquier export — y quien lo tenga
-- podría mandar correos a ESA dirección e inyectar facturas falsas en la
-- contabilidad de esa flota. El id de un tenant identifica; no autoriza.
--
-- El token es aleatorio, no se deriva de nada y no aparece en ningún otro
-- lugar. Adivinarlo es el único camino, y con 24 caracteres de base32 no hay
-- ninguno.
--
-- ── ES ROTABLE, Y ESO NO ES UN LUJO ──────────────────────────────────────
--
-- La dirección va a acabar escrita en el ERP de un proveedor, en la firma de un
-- correo y en un post-it. El día que se filtre y empiece a llegar basura, la
-- flota necesita poder cambiarla sin perder su cuenta. Por eso es una columna
-- que se puede reescribir, no algo derivado del id.
--
-- Nace NULL a propósito: una flota sin buzón simplemente no lo tiene encendido,
-- y la pantalla lo dice. Generarlo para todas al aplicar la migración crearía
-- 48 direcciones vivas que nadie pidió.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.tenant
  add column if not exists buzon_token text;

-- Único GLOBAL, no por flota: es una dirección de correo, y dos flotas con el
-- mismo token recibirían la una las facturas de la otra. El índice parcial deja
-- fuera los NULL, que son la mayoría.
create unique index if not exists tenant_buzon_token_unico
  on public.tenant (buzon_token)
  where buzon_token is not null;

alter table public.tenant
  drop constraint if exists tenant_buzon_token_forma;

-- Base32 en minúsculas, 24 caracteres. La forma se fija en la base y no solo en
-- el código porque esta columna decide A QUÉ FLOTA entra un gasto: un token
-- corto o con caracteres ambiguos (0/O, 1/l) sería adivinable o se transcribiría
-- mal al dictarlo por teléfono.
alter table public.tenant
  add constraint tenant_buzon_token_forma
  check (buzon_token is null or buzon_token ~ '^[a-hjkmnp-tv-z2-9]{24}$');

comment on column public.tenant.buzon_token is
  'Token aleatorio de la dirección de intake (f-<token>@mail.likida.ai). NO se deriva del tenant_id a propósito: un id identifica pero no autoriza, y quien lo conociera podría inyectar facturas falsas. Rotable: la dirección acaba escrita en el ERP de un proveedor y tiene que poder cambiarse.';
