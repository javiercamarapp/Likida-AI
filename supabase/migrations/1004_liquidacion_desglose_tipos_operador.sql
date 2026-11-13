-- REVERSA: `alter table public.liquidacion_desglose drop constraint if exists liquidacion_desglose_tipo_operador_dominio, add constraint liquidacion_desglose_tipo_operador_dominio check (tipo_operador is null or tipo_operador in ('foraneo', 'local', 'permisionario'));` Falla si ya hay filas con rabon, posturero o cargador: antes hay que poner su tipo_operador en NULL.
-- ═══════════════════════════════════════════════════════════════════════════
-- 1004 — A1 (LIQUIDACIÓN POR CORREO): DOMINIO DE TIPO DE OPERADOR AMPLIADO (piloto del webhook, 11-nov-2026).
--
-- El sistema de transporte del cliente piloto maneja Local, Foráneo, Rabón, Posturero y Cargador, y además identifica permisionarios.
-- El CHECK `liquidacion_desglose_tipo_operador_dominio` (0786) solo aceptaba foraneo | local | permisionario, así que una bitácora
-- de un rabón, posturero o cargador habría fallado al insertar el encabezado del desglose. El dominio pasa a:
--
--     foraneo | local | permisionario | rabon | posturero | cargador   (o NULL = el tipo no vino)
--
-- Solo cambia el dominio: NO cambia quién recibe la liquidación. `liquidacion_correo_config.tipos_que_reciben` conserva su defecto
-- {foraneo,local}; un tipo nuevo queda retenido con `tipo_sin_regla` hasta que la flota lo habilite en la configuración.
--
-- Idempotente (drop if exists + add) y aditiva: ampliar el dominio no invalida ninguna fila existente. Sin dependencia de
-- `auth.users`. Va ANTES del [deploy] que acepta los tipos nuevos.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.liquidacion_desglose drop constraint if exists liquidacion_desglose_tipo_operador_dominio;
alter table public.liquidacion_desglose add constraint liquidacion_desglose_tipo_operador_dominio check (
  tipo_operador is null or tipo_operador in ('foraneo', 'local', 'permisionario', 'rabon', 'posturero', 'cargador')
);
