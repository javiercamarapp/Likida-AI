-- ═══════════════════════════════════════════════════════════════════════════
-- 07 — Vigía (servicio al cliente) y configuración del Conductor.
--
-- Vigía: tres clientes CRÍTICOS con su conversación sembrada en los tres estados
-- que el guion enseña: (1) sin respuesta >10 min => escalada a gerencia,
-- (2) cliente molesto, (3) atendida a tiempo. Modo «siempre» = copiloto: el
-- agente SUGIERE (pendiente_aprobacion) y una persona envía. El histórico de
-- los grupos de WhatsApp NO vive aquí: es un archivo exportado (.txt/.zip) y se
-- carga con el importador (archivos-muestra/whatsapp/).
--
-- Conductor: parámetros del ciclo y los dos niveles de escalamiento (jefe de
-- tráfico y jefe de flota por terminal). Teléfonos con la marca de demo 289994… (ver abajo).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── NADIE REAL RECIBE UN MENSAJE ───────────────────────────────────────────
-- 1. TODOS los teléfonos del demo (clientes 289991…, operadores 289992…, contactos del Vigía 289993…, jefes de tráfico
--    289994…) llevan el prefijo 28999: el código de país 289 no está asignado a ningún país, así que no es de nadie.
--    Antes eran 52155595…/52155596…/52155597…, con forma válida de móvil de CDMX (México no reserva un rango para ficción).
-- 2. El envío REAL (meta/client.ts y el cron wa-outbox) rechaza cualquier destinatario 28999… antes de llamar a Meta.
-- 3. El Vigía y el Conductor del tenant demo vienen APAGADOS (vigia_config.habilitado = false,
--    agente_conductor_config.activo = false): ningún cron los procesa. Para enseñarlos funcionando:
--    `sembrar.sh --encender-agentes` (o el interruptor «habilitado» del panel del Vigía), SOLO en una base local; aun
--    encendidos, la guarda del punto 2 impide cualquier envío a estos teléfonos.

-- OJO: aviso_privacidad_url queda NULL a propósito. El CHECK vigia_config_aviso_url
-- (0400) usa `{1,480}` y el motor de regex de Postgres limita las repeticiones a
-- 255: con cualquier URL no nula el INSERT revienta con «invalid repetition
-- count(s)». Hallazgo para el stream del Vigía (reportado en la ronda 03).
insert into vigia_config (tenant_id, habilitado, modo_aprobacion, autoenviar_min_aprobaciones, sla_respuesta_min,
                          escalar_nivel2_min, retencion_dias, updated_at)
values (current_setting('inn.tenant')::uuid, false, 'siempre', 5, 10, 30, 180, current_setting('inn.ancla')::timestamptz)
on conflict (tenant_id) do nothing;

insert into vigia_contacto (id, tenant_id, cliente_id, telefono, telefono_hash, nombre, estado,
                            consentimiento_en, consentimiento_origen, aviso_privacidad_en, created_at, updated_at)
select innovativos_sim.uid('vigiacontacto:' || v.cli), current_setting('inn.tenant')::uuid, innovativos_sim.uid('cliente:' || v.cli),
       v.tel, innovativos_sim.sha(v.tel), v.nombre, 'activo',
       current_setting('inn.ancla')::timestamptz - interval '30 days', 'alta_flota',
       current_setting('inn.ancla')::timestamptz - interval '30 days',
       current_setting('inn.ancla')::timestamptz - interval '30 days', current_setting('inn.ancla')::timestamptz
from (values ('c05', '2899930000001', 'Coordinadora Ficticia de Logística Silao'),
             ('c10', '2899930000002', 'Gerente Ficticio de Embarques Ramos Arizpe'),
             ('c12', '2899930000003', 'Jefa Ficticia de CEDIS Apodaca')) v(cli, tel, nombre)
on conflict (id) do nothing;

insert into vigia_conversacion (id, tenant_id, contacto_id, cliente_id, viaje_id, estado, control,
                                ultima_entrada_en, ultima_salida_en, sin_respuesta_desde, entradas_sin_respuesta,
                                molestia_nivel, molestia_motivos, molestia_en, escalamiento_nivel, escalado_en,
                                created_at, updated_at)
select innovativos_sim.uid('vigiaconv:' || v.cli), current_setting('inn.tenant')::uuid,
       innovativos_sim.uid('vigiacontacto:' || v.cli), innovativos_sim.uid('cliente:' || v.cli),
       (select vi.id from viaje vi where vi.tenant_id = current_setting('inn.tenant')::uuid and vi.estatus = 'abierto'
          and vi.cliente_id = innovativos_sim.uid('cliente:' || v.cli) order by vi.folio limit 1),
       'activa', 'agente',
       current_setting('inn.ancla')::timestamptz - v.hace_entrada,
       case when v.cli = 'c12' then current_setting('inn.ancla')::timestamptz - interval '2 minutes' end,
       case when v.cli <> 'c12' then current_setting('inn.ancla')::timestamptz - v.hace_entrada end,
       v.sin_resp, v.molestia, v.motivos,
       case when v.molestia > 0 then current_setting('inn.ancla')::timestamptz - interval '24 minutes' end,
       v.esc, case when v.esc > 0 then current_setting('inn.ancla')::timestamptz - interval '2 minutes' end,
       current_setting('inn.ancla')::timestamptz - interval '2 hours', current_setting('inn.ancla')::timestamptz
from (values ('c05', interval '14 minutes', 2, 0, '{}'::text[], 1),
             ('c10', interval '26 minutes', 1, 2, array['retraso_entrega', 'tono_molesto'], 2),
             ('c12', interval '9 minutes',  0, 0, '{}'::text[], 0)) v(cli, hace_entrada, sin_resp, molestia, motivos, esc)
on conflict (id) do nothing;

insert into vigia_mensaje (id, tenant_id, conversacion_id, direccion, autor, tipo, texto, intencion, confianza, clasificador,
                           estado, riesgo, via, enviado_en, autoenviado, datos_respaldo, created_at)
select innovativos_sim.uid('vigiamsg:' || m.cli || ':' || m.n), current_setting('inn.tenant')::uuid,
       innovativos_sim.uid('vigiaconv:' || m.cli), m.dir, m.autor, 'texto', m.texto, m.intencion, m.conf, m.clasif,
       m.estado, m.riesgo, m.via, case when m.estado = 'enviado' then current_setting('inn.ancla')::timestamptz - m.hace end,
       (m.estado = 'enviado' and m.autor = 'agente'), m.respaldo, current_setting('inn.ancla')::timestamptz - m.hace
from (values
  ('c05', 1, 'entrante', 'cliente', '¿Ya salió la unidad de las 6? Nadie me contesta.',                       'eta',    0.93, 'reglas', 'recibido', null,   null,    interval '16 minutes', null::jsonb),
  ('c05', 2, 'entrante', 'cliente', 'Necesito la hora de llegada, es urgente, la línea está parada.',        'queja',  0.88, 'reglas', 'recibido', null,   null,    interval '14 minutes', null),
  ('c05', 3, 'saliente', 'agente',  'Buen día. Su unidad va en tránsito; reviso la ubicación y le confirmo la hora estimada en unos minutos.', 'eta', 0.90, 'modelo', 'pendiente_aprobacion', 'bajo', null, interval '13 minutes', '{"fuente":"gps_tabla_propia","nota":"borrador sugerido; una persona lo envía"}'::jsonb),
  ('c10', 1, 'entrante', 'cliente', 'Llevamos 3 horas esperando la unidad, esto es inaceptable. Voy a levantar queja.', 'queja', 0.97, 'reglas', 'recibido', null, null, interval '26 minutes', null),
  ('c12', 1, 'entrante', 'cliente', '¿Me confirman las placas de la unidad que viene a cargar?',               'documentos', 0.91, 'reglas', 'recibido', null, null, interval '9 minutes', null),
  ('c12', 2, 'saliente', 'agente',  'Claro. Viene la unidad IN-070. Le comparto la placa en cuanto el operador confirme su llegada a patio.', 'documentos', 0.92, 'modelo', 'enviado', 'bajo', 'texto', interval '2 minutes', null)
) m(cli, n, dir, autor, texto, intencion, conf, clasif, estado, riesgo, via, hace, respaldo)
on conflict (id) do nothing;

-- ── Conductor: parámetros del ciclo y escalamiento a jefe de tráfico / de flota ──
insert into agente_conductor_config (tenant_id, activo, avisar_oficina_llegada, avisar_oficina_salida, escalar_tras_min,
                                     segundo_nivel_min, validar_ubicacion, tolerancia_ubicacion_m, estadia_alerta_carga_min,
                                     estadia_alerta_descarga_min, updated_at)
values (current_setting('inn.tenant')::uuid, false, true, true, 60, 30, true, 250, 120, 120, current_setting('inn.ancla')::timestamptz)
on conflict (tenant_id) do nothing;

insert into conductor_contacto_trafico (id, tenant_id, terminal_id, nivel, nombre, telefono, activo)
select innovativos_sim.uid('trafico:' || t.cod || ':' || n.nivel), current_setting('inn.tenant')::uuid,
       innovativos_sim.uid('terminal:' || t.cod), n.nivel,
       case n.nivel when 1 then 'Jefe de Tráfico Ficticio ' else 'Jefe de Flota Ficticio ' end || t.nombre,
       '289994' || lpad((t.ord * 10 + n.nivel)::text, 7, '0'), true
from (values ('GDL', 'Tlaquepaque', 1), ('SIL', 'Silao', 2), ('APO', 'Apodaca', 3)) t(cod, nombre, ord)
cross join (values (1), (2)) n(nivel)
on conflict (id) do nothing;
