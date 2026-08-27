-- ═══════════════════════════════════════════════════════════════════════════
-- 0227 — LA RESERVA DEL TIMBRE (claim-then-act) y una migración CORRECTIVA
-- del dominio del interruptor. Auditoría Fable ciclo 6 (c6-1, c6-7, c6-11).
--
-- ── 1. POR QUÉ HACE FALTA UN ESTADO 'pendiente' (c6-1, ALTO) ───────────────
--
-- La 0226 dejó el orden así: leer → armar → LLAMAR AL PAC → insertar. El
-- unique parcial `ccp_timbre_vigente_unico` solo entraba en juego DESPUÉS de
-- que el PAC ya había timbrado, así que dos botones concurrentes (dos
-- pestañas, un doble clic con red lenta) llamaban los DOS al PAC y emitían
-- DOS CFDIs reales; el segundo insert rebotaba y el código leía el timbre del
-- ganador y decía «ya existía» — descartando en silencio un folio fiscal
-- emitido de verdad, que el SAT ya tiene y que hay que cancelar.
--
-- El arreglo es de orden, no de `if`: se RESERVA la fila ANTES de llamar al
-- PAC. El perdedor de la carrera rebota contra el índice y NI SIQUIERA LLAMA
-- al PAC — no hay segundo CFDI que descartar. Para que el índice pueda
-- arbitrar antes de que exista el timbre, la reserva necesita un estado
-- propio ('pendiente') y que uuid/fecha/xml puedan faltar mientras dura.
--
-- LO QUE UNA RESERVA VIVA SIGNIFICA: «este viaje tiene un timbrado en curso o
-- con resultado ambiguo». Bloquea un segundo intento a ciegas — que es
-- exactamente la conducta que se busca cuando el PAC no contestó (clase
-- 'red'): el timbre pudo emitirse del otro lado y reintentar duplicaría el
-- CFDI. La reserva se BORRA sola cuando el PAC contesta que NO (rechazo,
-- credenciales): ahí no hay timbre y el humano corrige y vuelve.
--
-- ── 2. DE QUÉ FECHA HABLA `fecha_timbrado` (c6-7, BAJO) ────────────────────
--
-- El PAC devuelve la fecha en su JSON, pero la fecha que el SAT selló vive en
-- el TimbreFiscalDigital del XML timbrado. La 0226 caía al reloj del SERVIDOR
-- cuando el JSON venía sin fecha, y esa hora quedaba guardada con cara de
-- dato del SAT. Ahora la columna viene acompañada de su procedencia y el
-- fallback es DECLARADO, nunca disfrazado.
--
-- ── 3. LA TRAMPA LATENTE DEL DOMINIO DEL INTERRUPTOR (c6-11) ───────────────
--
-- La 0218 (éxito del cliente) y la 0219 (back office) fueron OLAS PARALELAS y
-- las dos recrean `interruptor_id_dominio` enumerando el catálogo completo.
-- En una base construida desde cero el orden numérico las salva: la 0219
-- corre después y su lista de 30 es la final. Pero en una base que ya tenía
-- la 0219 aplicada (PR de back office mergeado primero), la 0218 queda
-- PENDIENTE y se aplica DESPUÉS en tiempo real: su lista de 26 pisa la de 30
-- y BORRA del CHECK las cuatro palancas del back office
-- (vigilante_calidad, documentacion, legal_compliance, talento). El síntoma
-- no es un error visible: es que apagar uno de esos cuatro rebota con
-- check_violation el día del incidente, que es el peor día para descubrirlo.
--
-- Esta migración es la CORRECTIVA: vuelve a fijar el dominio con los 30
-- valores (la lista de la 0219, copiada tal cual) y le deja comentario. Al
-- ser la más alta, gana en los dos escenarios. No dice «esto ya estaba bien»:
-- dice que el orden de aplicación pudo dejarlo mal y lo repone.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. La reserva: estado 'pendiente' y los campos del hecho, anulables ────

-- El hecho del timbre (uuid, fecha, xml) NO existe mientras la reserva está
-- viva. Se relajan los NOT NULL y un CHECK de coherencia los vuelve a exigir
-- en cuanto la fila deja de ser una reserva: la garantía no se pierde, se
-- condiciona al estado. (Los CHECK de forma `ccp_timbre_uuid_forma` y
-- `ccp_timbre_xml_no_vacio` ya toleran NULL: un CHECK sobre NULL da NULL y
-- pasa — no hace falta tocarlos.)
alter table public.ccp_timbre alter column uuid_fiscal    drop not null;
alter table public.ccp_timbre alter column fecha_timbrado drop not null;
alter table public.ccp_timbre alter column xml            drop not null;

alter table public.ccp_timbre drop constraint ccp_timbre_estado_dominio;
alter table public.ccp_timbre add constraint ccp_timbre_estado_dominio
  check (estado in ('pendiente', 'vigente', 'cancelado'));

-- Un timbre que NO es reserva trae su hecho completo, siempre. Una reserva
-- puede traer el uuid a medias: cuando el PAC ya contestó y la consolidación
-- todavía no cerró, el uuid se persiste PRIMERO — es el dato que no se puede
-- perder (el CFDI ya existe ante el SAT), y sin esta permisividad habría que
-- elegir entre guardarlo o respetar el CHECK.
alter table public.ccp_timbre add constraint ccp_timbre_hecho_coherente
  check (
    estado = 'pendiente'
    or (uuid_fiscal is not null and fecha_timbrado is not null and xml is not null)
  );

-- Cuándo se reservó. Sirve para que un humano (o soporte) sepa si una reserva
-- lleva minutos —un timbrado en curso— o días —un ambiguo que nadie resolvió.
alter table public.ccp_timbre add column if not exists reservado_en timestamptz;

comment on column public.ccp_timbre.estado is
  'pendiente = RESERVA: el claim que se toma ANTES de llamar al PAC (0227) — bloquea un segundo intento y puede traer ya el uuid si el PAC contestó y la consolidación no cerró. vigente = el timbre, completo. cancelado = cancelado ante el SAT; libera el viaje para re-timbrar la corrección.';

-- ── 2. El árbitro: el índice cubre TAMBIÉN la reserva ──────────────────────
-- Este es el cambio que hace posible el claim-then-act. Antes solo arbitraba
-- entre timbres ya emitidos (demasiado tarde); ahora arbitra entre INTENTOS.
drop index if exists public.ccp_timbre_vigente_unico;
create unique index ccp_timbre_vigente_unico
  on public.ccp_timbre (tenant_id, viaje_id)
  where estado in ('pendiente', 'vigente');

comment on index public.ccp_timbre_vigente_unico is
  'UN intento vivo por viaje (0227): cubre la reserva (pendiente) y el timbre (vigente). Es el árbitro del claim-then-act — el perdedor de la carrera rebota AQUÍ y no llega a llamar al PAC, así que jamás se emiten dos CFDIs para el mismo viaje. Un timbre cancelado no ocupa el lugar: la corrección se puede volver a timbrar.';

-- El uuid único, ahora parcial: varias reservas sin uuid conviven (una por
-- viaje, por el índice de arriba) y el candado sigue vigente sobre los que sí
-- lo tienen. Sin el `where`, el índice se apoyaría en que los NULL no chocan
-- entre sí — cierto en Postgres, pero es una propiedad que el lector tiene
-- que recordar en vez de leer.
drop index if exists public.ccp_timbre_uuid_unico;
create unique index ccp_timbre_uuid_unico
  on public.ccp_timbre (tenant_id, lower(uuid_fiscal))
  where uuid_fiscal is not null;

-- ── 3. De qué reloj salió `fecha_timbrado` (c6-7) ──────────────────────────
alter table public.ccp_timbre
  add column if not exists fecha_timbrado_origen text;

alter table public.ccp_timbre add constraint ccp_timbre_fecha_origen_dominio
  check (fecha_timbrado_origen is null
         or fecha_timbrado_origen in ('tfd', 'pac', 'servidor'));

comment on column public.ccp_timbre.fecha_timbrado_origen is
  'De dónde salió fecha_timbrado: tfd = del TimbreFiscalDigital del XML timbrado (la del SAT, la buena) · pac = del JSON del proveedor · servidor = FALLBACK del reloj de Likida porque ninguna de las otras dos se pudo leer — ese caso NO es un dato fiscal y quien lo cite tiene que saberlo. NULL solo en filas anteriores a la 0227.';

comment on column public.ccp_timbre.reservado_en is
  'Cuándo se tomó la reserva (estado pendiente). Una reserva de minutos es un timbrado en curso; una de días es un resultado ambiguo que nadie resolvió y que está bloqueando el viaje a propósito.';

-- ── 4. CORRECTIVA: el dominio del interruptor, con sus 30 valores ──────────
-- Lista copiada de la 0219 tal cual. Enumerar el catálogo COMPLETO en cada
-- recreación es la regla de la casa desde la 0122; lo que esta migración
-- agrega es el seguro contra el orden de APLICACIÓN, no contra el de archivo.
alter table public.interruptor drop constraint interruptor_id_dominio;
alter table public.interruptor add constraint interruptor_id_dominio check (
  id in (
    'global',
    -- Los agentes de flota (0102/0105) y el Redactor (0122).
    'agente:liquidacion', 'agente:facturas', 'agente:cobranza',
    'agente:conductores', 'agente:peajes', 'agente:proveedores',
    'agente:ventas', 'agente:redactor',
    -- Los 4 financieros (0215).
    'agente:analista_metricas', 'agente:control_costos',
    'agente:tesoreria', 'agente:cierre_mensual',
    -- Los 4 de dirección (0216).
    'agente:kpi_whatsapp', 'agente:desempeno_startup',
    'agente:orquestador', 'agente:orquestador_semanal',
    -- La máquina de prospección (0217).
    'agente:enriquecedor', 'agente:sdr', 'agente:enviador',
    -- Los 6 de éxito del cliente (0218).
    'agente:soporte', 'agente:onboarding_cliente', 'agente:exito_cliente',
    'agente:atencion_faq', 'agente:cobranza_saas', 'agente:retencion',
    -- Los 4 del back office restante (0219).
    'agente:vigilante_calidad', 'agente:documentacion',
    'agente:legal_compliance', 'agente:talento'
  )
);

comment on constraint interruptor_id_dominio on public.interruptor is
  'El catálogo cerrado de palancas: global + los 29 agentes autónomos declarados hasta la 0219. Espeja INTERRUPTORES en src/lib/likida/interruptores.ts. Un valor de más no enciende nada (SIN FILA = ENCENDIDO); uno de menos rompe en silencio la palanca de otro agente. La 0227 lo REPONE porque la 0218 y la 0219 son olas paralelas: en una base que recibió la 0219 primero, la 0218 se aplica después y su lista más corta borra las cuatro palancas del back office.';
