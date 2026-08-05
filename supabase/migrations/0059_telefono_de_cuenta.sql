-- 0059 — El número por el que se reconoce a una cuenta de oficina.
--
-- Hasta aquí el agente de WhatsApp solo sabía hablar con CHOFERES: `operador`
-- tenía teléfono y `app_user` no. Cualquier otro número recibía "no te tengo
-- registrado como operador" y ahí terminaba.
--
-- Eso dejaba inalcanzables los dos avisos que salen HACIA la oficina —"tu chofer
-- no aceptó el viaje" y "tienes tickets por facturar"—: se podían mandar (si
-- alguien pasaba el número a mano) pero la respuesta del jefe caía en el vacío.
-- Un aviso que no se puede contestar no es una conversación, es una alerta.
--
-- ── POR QUÉ ÚNICO GLOBAL Y NO POR FLOTA ─────────────────────────────────────
--
-- `operador` usa unique (tenant_id, telefono). Aquí NO se puede: un mensaje
-- entrante trae ÚNICAMENTE el número, y es ese número el que determina de qué
-- flota se está hablando. Un teléfono repetido entre dos tenants es un mensaje
-- que no se puede enrutar — y adivinar escribiría la operación de una flota en
-- la de otra. `resolveOperador` ya se niega ante esa ambigüedad (lanza
-- OperadorAmbiguo); esta restricción la vuelve imposible desde la base.
--
-- Parcial (`where telefono is not null`) porque la mayoría de las cuentas nunca
-- van a tener número: se entra por correo, el teléfono es opcional.

alter table public.app_user add column if not exists telefono text;

create unique index if not exists app_user_telefono_uniq
  on public.app_user (telefono)
  where telefono is not null;

comment on column public.app_user.telefono is
  'E.164 sin +. Por este número el agente de WhatsApp reconoce una cuenta de oficina. Único global: es la llave de enrutamiento de los mensajes entrantes.';
