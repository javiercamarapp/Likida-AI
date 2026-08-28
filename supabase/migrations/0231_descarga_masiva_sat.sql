-- ═══════════════════════════════════════════════════════════════════════════
-- 0231 — LA DESCARGA MASIVA DEL SAT: los comprobantes que el comercio YA
-- timbró entran solos (decisión de Javier, 27-ago-2026).
--
-- EL PROBLEMA QUE RESUELVE. Hoy la flota persigue factura ticket por ticket
-- en 37 portales (uno solo automatizado, 0063). Pero todo CFDI que un
-- comercio ya timbró al RFC de la flota YA ESTÁ en el buzón del SAT: no hay
-- que pedirlo, hay que recogerlo. La descarga masiva lo recoge en bloque y el
-- gasto se cruza solo contra el ticket que el chofer ya fotografió.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- LA CREDENCIAL: POR QUÉ ESTA TABLA NO TIENE DÓNDE GUARDAR UNA e.firma
--
-- La e.firma (FIEL) es LA FIRMA ELECTRÓNICA DEL CONTRIBUYENTE. Con ella se
-- presentan declaraciones, se aceptan cancelaciones y se firman actos ante el
-- SAT: no es "una credencial más", es la identidad jurídica de la flota. El
-- CSD del timbrado (0226) ya se resolvió por el único camino que no obliga a
-- custodiarla: vive en la BÓVEDA DEL PAC, y Likida solo dispara. Esta
-- migración toma exactamente el mismo camino, verificado contra la
-- documentación del proveedor:
--
--   SW Sapien expone `POST /gestion/v1/api/certificates/create/fiel` —una
--   bóveda de FIEL indexada por RFC— y `GET /certificates/rfc/{rfc}` para
--   consultarla. Las solicitudes de descarga masiva
--   (`/massiveservicemanager/request/create/webservice`) viajan con `taxId`,
--   NO con la llave: la FIEL nunca sale de la bóveda del proveedor.
--
-- Por eso la flota carga su e.firma EN EL PORTAL DEL PAC, igual que su CSD, y
-- Likida no la recibe, no la transporta y no la guarda — ni en claro ni
-- cifrada. Lo único que se persiste aquí es la REFERENCIA que el proveedor
-- devuelve (número de certificado y vigencia), que sirve para dos cosas
-- honestas: decir en pantalla "sí hay e.firma cargada, vence el X" y avisar
-- antes de que caduque. El CHECK `sat_descarga_config_certificado_forma` la
-- acota a 20 dígitos: un .key en base64 no cabe ahí NI POR ERROR, y esa es
-- justamente la garantía que solo la base puede dar.
--
-- (`src/lib/likida/conectores/cofre.ts` —AES-256-GCM con LIKIDA_COFRE_LLAVE—
-- sigue siendo el camino si algún día entra un proveedor que EXIJA mandar la
-- FIEL en cada solicitud. SW no lo exige, así que no se usa: cifrar bien algo
-- que no hace falta tener es peor que no tenerlo.)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- CUATRO PIEZAS:
--   1. `sat_descarga_config` — qué flota tiene descarga masiva encendida, con
--      qué proveedor y modo, contra qué RFC, y hasta qué día llegó la última
--      descarga COMPLETADA (de ahí arranca la siguiente: null = nunca).
--   2. `sat_descarga_solicitud` — cada solicitud al SAT como hecho citable.
--      El SAT tarda (hasta 6 días por web service): una solicitud es un
--      trámite en curso, no una llamada. Un único trámite vivo por rango
--      (índice parcial): el cron corre cada 6 h y no puede pedir dos veces lo
--      mismo mientras el SAT lo procesa.
--   3. `sat_cfdi_descargado` — EL SELLO DE DEDUP y el comprobante disponible.
--      `unique (tenant_id, cfdi_uuid)`: el mismo folio fiscal no entra dos
--      veces aunque dos rangos se traslapen, aunque el cron se repita, aunque
--      el ticket ya hubiera llegado por WhatsApp. Idempotencia por
--      constraint, no por `if`.
--   4. `peaje_cierre_aviso` — el sello del aviso de cierre de mes de peaje.
--      NO es parte de la descarga: es su contracara honesta. PASE extingue el
--      derecho a facturar EL ÚLTIMO DÍA DEL MES EN CURSO (regla vigente desde
--      dic-2021), así que conciliar a mes vencido llega tarde SIEMPRE. Mismo
--      patrón que `aviso_vigencia` (0202) y los relojes legales: se avisa una
--      vez por (flota, mes, umbral), y un mes nuevo es un ciclo nuevo.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. La configuración de la descarga, por flota ──────────────────────────
create table if not exists public.sat_descarga_config (
  -- Una fila por flota: la conexión ES de la flota (PK = tenant, patrón 0226).
  tenant_id             uuid primary key references public.tenant(id) on delete cascade,
  -- Identificador corto del proveedor, espeja LIKIDA_SAT_PROVEEDOR y se
  -- persiste en cada solicitud: cambiar de proveedor no reescribe el pasado.
  proveedor             text not null default 'sw',
  -- Contra qué servicio del SAT pide este proveedor. Los topes son distintos
  -- y la pantalla los declara: webservice = 200,000 CFDI por petición y hasta
  -- 6 días de espera; portal = 2,000 documentos por día y ~48 h.
  modo                  text not null default 'webservice',
  -- El RFC cuyo buzón se descarga. Se declara aquí y no se lee de
  -- `flota_fiscal` a propósito: aquél es el RFC con el que la flota EMITE, y
  -- una flota puede recibir en una razón social distinta de la que factura.
  -- Confundirlos descargaría el buzón equivocado en silencio.
  rfc                   text not null,
  -- LA REFERENCIA A LA e.firma EN LA BÓVEDA DEL PROVEEDOR — nunca la e.firma.
  -- Es el `serialNumber` que el PAC devuelve al consultar sus certificados:
  -- 20 dígitos. NULL = todavía no se ha verificado que exista, y la pantalla
  -- lo dice con esas palabras (null ≠ "no hay").
  certificado_numero    text,
  -- Vigencia que reportó el proveedor. Sirve para avisar ANTES de que caduque:
  -- una e.firma vencida deja de descargar sin decir por qué.
  certificado_vence_en  date,
  -- Cuándo se confirmó por última vez, contra el proveedor, que la e.firma
  -- sigue cargada. NULL = nunca se preguntó.
  verificada_en         timestamptz,
  -- Hasta qué DÍA llegó la última descarga COMPLETADA e ingerida. La
  -- siguiente solicitud arranca aquí. NULL significa NUNCA SE HA DESCARGADO
  -- —no "desde el principio de los tiempos"—: el código toma una ventana
  -- inicial acotada y lo declara.
  ultima_descarga_hasta date,
  -- La anticipación con la que el contralor quiere el aviso de cierre de mes
  -- de peaje. Acotada a 1..25 días: el aviso es sobre un derecho que muere el
  -- último día del mes, y avisar con 26 días es avisar el día 5.
  peaje_dias_aviso      smallint not null default 7,
  -- Apagar la descarga sin borrar la configuración ni el historial.
  activa                boolean not null default true,
  actualizado_en        timestamptz not null default now(),
  -- Quién la declaró; se conserva aunque la cuenta se borre (patrón 0207/0213).
  actualizado_por       uuid references public.app_user(id) on delete set null,
  constraint sat_descarga_config_proveedor_dominio
    check (proveedor in ('sw')),
  constraint sat_descarga_config_modo_dominio
    check (modo in ('webservice', 'portal')),
  constraint sat_descarga_config_rfc_forma
    check (rfc ~ '^[A-ZÑ&0-9]{12,13}$'),
  -- EL CANDADO DE LA CREDENCIAL: la referencia son 20 dígitos y nada más. Una
  -- llave privada, un .cer en base64 o una contraseña NO caben aquí — no por
  -- convención de código, por estructura.
  constraint sat_descarga_config_certificado_forma
    check (certificado_numero is null or certificado_numero ~ '^[0-9]{20}$'),
  constraint sat_descarga_config_peaje_dias_sano
    check (peaje_dias_aviso between 1 and 25)
);

comment on table public.sat_descarga_config is
  'La descarga masiva del SAT por flota (0231): proveedor, modo, RFC del buzón y hasta dónde llegó. NO GUARDA LA e.firma NI SU CONTRASEÑA, por diseño: la FIEL vive en la bóveda del PAC (se carga en SU portal, igual que el CSD del timbrado) y Likida solo dispara solicitudes con el RFC. Lo único que se persiste es la referencia que el proveedor devuelve.';
comment on column public.sat_descarga_config.certificado_numero is
  'El número de serie del certificado de e.firma TAL COMO LO REPORTA EL PROVEEDOR (20 dígitos). Es una REFERENCIA a la bóveda del PAC, no la credencial: con este número no se firma nada. El CHECK de forma impide estructuralmente que alguien pegue aquí una llave o una contraseña.';
comment on column public.sat_descarga_config.ultima_descarga_hasta is
  'Último día YA descargado e ingerido. NULL significa NUNCA SE HA DESCARGADO — jamás se lee como "desde el inicio": el código abre una ventana inicial acotada y la declara en pantalla.';
comment on column public.sat_descarga_config.modo is
  'webservice = 200,000 CFDI por petición, hasta 6 días de espera del SAT. portal = 2,000 documentos por día, ~48 h. Los topes son del SAT/proveedor, no de Likida, y la pantalla los dice cuando se alcanzan.';
comment on column public.sat_descarga_config.peaje_dias_aviso is
  'Días de anticipación del aviso de cierre de mes de peaje. Existe aquí porque es la misma pantalla del contralor; sin fila se usa el default del código (7 días), así que una flota sin descarga masiva TAMBIÉN recibe el aviso.';

-- Mismo doble candado que 0196/0198/0226/0229: RLS deny-all + solo service_role.
alter table public.sat_descarga_config enable row level security;
revoke all on table public.sat_descarga_config from public, anon, authenticated;
grant select, insert, update, delete on table public.sat_descarga_config to service_role;

-- ── 2. Cada solicitud al SAT, como hecho citable ───────────────────────────
create table if not exists public.sat_descarga_solicitud (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenant(id) on delete cascade,
  proveedor          text not null default 'sw',
  -- El identificador que devuelve el proveedor. NULL mientras la llamada no
  -- ha contestado: una solicitud sin id es un intento, no un trámite.
  request_id         text,
  tipo               text not null,
  desde              date not null,
  hasta              date not null,
  estado             text not null default 'solicitada',
  -- Los paquetes que el proveedor reporta listos (sus `pathFile`). Se guardan
  -- tal cual para poder reintentar la descarga sin re-solicitar al SAT.
  paquetes           jsonb,
  -- Conteos de la INGESTA. NULL = todavía no se ingirió; 0 = se ingirió y no
  -- había nada. La distinción es la regla de la casa (null ≠ 0).
  cfdis_nuevos       integer,
  cfdis_repetidos    integer,
  intentos           integer not null default 0,
  -- El mensaje del proveedor TAL CUAL, jamás resumido ni traducido: el
  -- contador que lee "305 - Certificado inválido" puede actuar.
  proveedor_mensaje  text,
  solicitada_en      timestamptz not null default now(),
  verificada_en      timestamptz,
  descargada_en      timestamptz,
  constraint sat_descarga_solicitud_proveedor_dominio
    check (proveedor in ('sw')),
  constraint sat_descarga_solicitud_tipo_dominio
    check (tipo in ('recibidos', 'emitidos')),
  -- Los seis estados del trámite. 'expirada' es del SAT: un paquete listo
  -- caduca, y llamarlo 'error' escondería que el trámite SÍ funcionó.
  constraint sat_descarga_solicitud_estado_dominio
    check (estado in ('solicitada', 'en_proceso', 'lista', 'descargada', 'error', 'expirada')),
  constraint sat_descarga_solicitud_rango_sano
    check (hasta >= desde and hasta - desde <= 366),
  constraint sat_descarga_solicitud_conteos_sanos
    check ((cfdis_nuevos is null or cfdis_nuevos >= 0)
       and (cfdis_repetidos is null or cfdis_repetidos >= 0)),
  constraint sat_descarga_solicitud_intentos_sanos
    check (intentos >= 0 and intentos <= 100),
  -- La llave que hace posibles las FK compuestas de la casa (0028/0145).
  constraint sat_descarga_solicitud_id_tenant_key unique (id, tenant_id)
);

-- El mismo requestId del mismo proveedor no se registra dos veces por flota.
create unique index if not exists uq_sat_solicitud_request
  on public.sat_descarga_solicitud (tenant_id, proveedor, request_id)
  where request_id is not null;

-- UN SOLO TRÁMITE VIVO POR RANGO. El cron corre cada 6 h y el SAT tarda hasta
-- 6 días: sin esto, cada corrida volvería a pedir el mismo rango y quemaría
-- el tope diario de la flota contra el mismo periodo. Los estados terminales
-- (descargada/error/expirada) SÍ dejan volver a pedirlo — un reintento
-- deliberado es legítimo.
create unique index if not exists uq_sat_solicitud_viva
  on public.sat_descarga_solicitud (tenant_id, tipo, desde, hasta)
  where estado in ('solicitada', 'en_proceso', 'lista');

create index if not exists sat_solicitud_pendientes_idx
  on public.sat_descarga_solicitud (tenant_id, estado, solicitada_en)
  where estado in ('solicitada', 'en_proceso', 'lista');

comment on table public.sat_descarga_solicitud is
  'Cada solicitud de descarga masiva como TRÁMITE, no como llamada: el SAT tarda hasta 6 días por web service, así que el cron pide, vuelve, verifica y descarga. El índice parcial uq_sat_solicitud_viva impide pedir dos veces el mismo rango mientras uno sigue en curso.';
comment on column public.sat_descarga_solicitud.proveedor_mensaje is
  'El mensaje del proveedor TAL CUAL. Regla de la casa: un error del PAC/SAT no se resume ni se traduce — el código del SAT es lo que le permite a un contador actuar.';
comment on column public.sat_descarga_solicitud.cfdis_nuevos is
  'Cuántos folios fiscales entraron NUEVOS en esta solicitud. NULL = no se ha ingerido todavía; 0 = se ingirió y el SAT no tenía nada en ese rango. Confundirlos haría que "no llegó nada" y "no se ha preguntado" se leyeran igual.';

alter table public.sat_descarga_solicitud enable row level security;
revoke all on table public.sat_descarga_solicitud from public, anon, authenticated;
grant select, insert, update, delete on table public.sat_descarga_solicitud to service_role;

-- ── 3. El sello de dedup y el comprobante disponible ───────────────────────
create table if not exists public.sat_cfdi_descargado (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenant(id) on delete cascade,
  -- El folio fiscal, en minúsculas como TODO uuid de CFDI en esta base
  -- (regla de la 0158). Es la llave natural del comprobante ante el SAT.
  cfdi_uuid      text not null,
  solicitud_id   uuid,
  rfc_emisor     text,
  rfc_receptor   text,
  -- Total del comprobante. Es la cifra contra la que se cruza el ticket.
  total          numeric(12,2),
  fecha          date,
  tipo_comprobante text,
  -- El gasto con el que casó, si casó. NULL con estatus 'disponible' es un
  -- hallazgo por derecho propio: un comprobante que nadie reportó como gasto.
  gasto_id       uuid,
  estatus        text not null default 'disponible',
  -- Cuando el cruce es AMBIGUO (dos o más gastos empatan), aquí van los
  -- candidatos y NO SE LIGA NADA: lo ambiguo lo decide el humano. Mismo
  -- criterio que `cfdi_consolidado_linea.candidatos` (0076).
  candidatos     jsonb,
  resuelto_por   uuid references public.app_user(id) on delete set null,
  resuelto_en    timestamptz,
  created_at     timestamptz not null default now(),
  -- EL SELLO DE DEDUP. El mismo folio fiscal no entra dos veces por flota,
  -- pase lo que pase: rangos traslapados, cron repetido, o un ticket que ya
  -- había llegado por WhatsApp con su XML. Idempotencia por constraint.
  constraint sat_cfdi_descargado_unico unique (tenant_id, cfdi_uuid),
  constraint sat_cfdi_descargado_uuid_minuscula
    check (cfdi_uuid = lower(cfdi_uuid)),
  constraint sat_cfdi_descargado_uuid_forma
    check (cfdi_uuid ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  constraint sat_cfdi_descargado_estatus_dominio
    check (estatus in ('casado', 'disponible', 'ambiguo', 'ignorado')),
  -- 'casado' EXIGE con qué casó, y solo 'casado' puede traerlo. Sin esto,
  -- un estatus podría afirmar un cruce que no existe — que es exactamente la
  -- cifra inventada que este producto no se permite.
  constraint sat_cfdi_descargado_casado_coherente
    check ((estatus = 'casado' and gasto_id is not null)
        or (estatus <> 'casado' and gasto_id is null)),
  constraint sat_cfdi_descargado_total_sano
    check (total is null or total >= 0),
  -- La FK COMPUESTA de la casa (0028/0145): el comprobante de la flota A no
  -- puede casar con un gasto de la flota B.
  constraint sat_cfdi_descargado_gasto_tenant_fkey
    foreign key (gasto_id, tenant_id) references public.gasto (id, tenant_id)
    on delete set null,
  constraint sat_cfdi_descargado_solicitud_tenant_fkey
    foreign key (solicitud_id, tenant_id)
    references public.sat_descarga_solicitud (id, tenant_id)
    on delete set null
);

create index if not exists sat_cfdi_descargado_pendientes_idx
  on public.sat_cfdi_descargado (tenant_id, estatus, fecha)
  where estatus in ('disponible', 'ambiguo');

comment on table public.sat_cfdi_descargado is
  'Todo CFDI que bajó del buzón del SAT (0231), con su suerte: casado con un gasto ya registrado, disponible (nadie reportó ese gasto — eso TAMBIÉN es hallazgo), ambiguo (varios candidatos: lo decide el contralor) o ignorado. El unique (tenant_id, cfdi_uuid) es el sello de dedup de toda la feature.';
comment on constraint sat_cfdi_descargado_casado_coherente on public.sat_cfdi_descargado is
  'Un comprobante NO puede decir que casó sin decir con qué gasto, ni traer un gasto sin declararse casado. El cruce es una afirmación sobre el dinero de alguien: o está sostenida por una fila, o no se hace.';
comment on column public.sat_cfdi_descargado.candidatos is
  'Los gastos que empataron cuando el cruce fue ambiguo, para que el contralor elija. Mientras haya candidatos, gasto_id es NULL: ante la duda no se adivina (mismo criterio que la conciliación de consolidados, 0076).';

alter table public.sat_cfdi_descargado enable row level security;
revoke all on table public.sat_cfdi_descargado from public, anon, authenticated;
grant select, insert, update, delete on table public.sat_cfdi_descargado to service_role;

-- ── 4. El sello del aviso de cierre de mes de peaje ────────────────────────
-- POR QUÉ ESTO VIVE EN LA MIGRACIÓN DE LA DESCARGA MASIVA: es su contracara.
-- La descarga resuelve lo que el comercio YA timbró solo (monederos de
-- combustible con complemento ECC, TeleVía tras el alta fiscal, PASE en
-- modalidad mensual). Lo que NO cae solo —PASE prepago, PASE pospago por
-- cruce, IAVE/CAPUFE bajo demanda— sigue exigiendo que alguien entre al
-- portal, Y ESE DERECHO CADUCA: PASE extingue la posibilidad de facturar el
-- último día del mes en curso. Una pantalla que solo concilia a mes vencido
-- llega tarde por diseño. Este sello es lo que permite avisar ANTES, una vez
-- por umbral, sin convertirse en spam.
--
-- Mismo patrón que `aviso_vigencia` (0202): SIN FK a nada que se pueda
-- borrar, y el CICLO en la llave — un mes nuevo vuelve a avisar.
create table if not exists public.peaje_cierre_aviso (
  tenant_id  uuid not null references public.tenant(id) on delete cascade,
  -- El PRIMER DÍA del mes cuyo derecho a facturar se está por perder. Es el
  -- ciclo: septiembre y octubre son dos avisos distintos, no una repetición.
  periodo    date not null,
  -- Con cuántos días de anticipación se avisó. Dos umbrales del mismo mes son
  -- dos avisos legítimos (el de "faltan 7" y el de "es hoy").
  umbral     smallint not null,
  -- Cuántos gastos de caseta sin CFDI se reportaron en ese aviso. Es
  -- evidencia de lo que se dijo, no un recálculo posterior.
  gastos     integer not null,
  avisado_en timestamptz not null default now(),
  primary key (tenant_id, periodo, umbral),
  -- El periodo es un mes, y un mes empieza el día 1. Guardar el 15 haría que
  -- el mismo mes tuviera dos ciclos y el aviso se repitiera.
  constraint peaje_cierre_aviso_periodo_es_mes
    check (periodo = date_trunc('month', periodo)::date),
  constraint peaje_cierre_aviso_umbral_sano
    check (umbral between 0 and 25),
  constraint peaje_cierre_aviso_gastos_sano
    check (gastos >= 0)
);

comment on table public.peaje_cierre_aviso is
  'El sello del aviso de cierre de mes de peaje (0231), patrón 0202: el derecho a facturar un cruce de PASE se extingue el último día del mes en curso, así que conciliar a mes vencido llega SIEMPRE tarde. Se avisa una vez por (flota, mes, umbral) y un mes nuevo es un ciclo nuevo. Sin FK a gasto a propósito: el sello debe sobrevivir a que el gasto se borre.';

alter table public.peaje_cierre_aviso enable row level security;
revoke all on table public.peaje_cierre_aviso from public, anon, authenticated;
grant select, insert, update, delete on table public.peaje_cierre_aviso to service_role;

-- ── 5. La palanca del nuevo autónomo ───────────────────────────────────────
-- El cron de descarga habla con el SAT a través del PAC y ESCRIBE
-- comprobantes: sin palanca propia, apagarlo obligaría a apagar el
-- interruptor global (y con él la facturación entera). Enumerar el catálogo
-- COMPLETO en cada recreación es la regla de la casa desde la 0122: la
-- recreación más alta gana, y una lista corta borra en silencio las de otros.
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
    'agente:legal_compliance', 'agente:talento',
    -- Los 10 de crecimiento (0230). Se enumeran aquí porque esta migración
    -- RECREA el dominio: una que enumerara solo los suyos borraría en
    -- silencio las palancas anteriores (el incidente que la 0227 corrigió).
    'agente:contenido_fiscal', 'agente:lead_magnet', 'agente:seo_distribucion',
    'agente:guiones', 'agente:noticias_mercado', 'agente:promos_diarias',
    'agente:visuales', 'agente:video_demo', 'agente:video_marketing',
    'agente:alianzas',
    -- La descarga masiva del SAT (0231).
    'agente:descarga_sat'
  )
);

comment on constraint interruptor_id_dominio on public.interruptor is
  'El dominio COMPLETO de palancas (41 al 0231). Cada migración que enciende agentes lo RECREA enumerando todo el catálogo: la recreación más alta gana, y una que enumere solo los suyos borraría en silencio las palancas anteriores (el incidente que la 0227 corrigió). El espejo en código es INTERRUPTORES en src/lib/likida/interruptores.ts.';
