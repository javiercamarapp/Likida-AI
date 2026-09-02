-- ═══════════════════════════════════════════════════════════════════════════
-- 0241 — REGISTRO DE JORNADA DE LOS OPERADORES (LFT 132 fr. XXXIV)
--
-- ── POR QUÉ EXISTE, CON LA FUENTE EN LA MANO ──────────────────────────────
--
-- El artículo 132 fracción XXXIV de la Ley Federal del Trabajo —ADICIONADO por
-- el decreto del DOF del 1 de mayo de 2026, el mismo de la reducción de
-- jornada— obliga al patrón, literalmente:
--
--     «Registrar de manera electrónica la jornada laboral de cada persona
--      trabajadora, incluyendo el horario de inicio y finalización; así como
--      proporcionarlo a la autoridad cuando se le requiera.»
--
-- El texto vigente está transcrito en `normas/lft-132-XXXIV-jornada.yaml`
-- (verificado contra diputados.gob.mx, LFT con última reforma DOF 14-05-2026).
-- Su incumplimiento tiene multa propia desde el mismo decreto: art. 994 fr. IV
-- Bis, de 250 a 5,000 UMA.
--
-- En una fábrica eso es un reloj checador en la puerta. En el autotransporte de
-- carga no hay puerta: el operador arranca de un patio a las 4 de la mañana,
-- come en una caseta y termina en un CEDIS a 900 km. Hoy nadie lo anota.
--
-- Y el riesgo grande no es la multa, son los artículos 784, 804 y 805. El 804
-- fr. III obliga a conservar los controles de asistencia; el 805 dice que
-- incumplirlo «establecerá la presunción de ser ciertos los hechos que el actor
-- exprese en su demanda […] salvo la prueba en contrario». Un registro que no
-- existe no es un hueco neutral: es una presunción en contra. Y uno que se
-- puede editar sin dejar rastro es peor que no tenerlo, porque destruye su
-- propia credibilidad.
--
-- ── LA PIEZA QUE MANDÓ EL DISEÑO: EL TERCER PÁRRAFO DE LA FRACCIÓN ────────
--
--     «El contenido del registro electrónico hará prueba plena si se acredita
--      que fue acordado entre la persona trabajadora y empleadora.»
--
-- Por eso `jornada_dia` guarda la CONFORMIDAD DEL OPERADOR con su propio
-- message_id de WhatsApp. Sin ese acuerdo acreditado el registro sigue siendo
-- válido, pero no es prueba plena — y el reporte lo dice, en vez de dejar que
-- la flota lo suponga.
--
-- ── LO QUE ESTA MIGRACIÓN DELIBERADAMENTE NO HACE ─────────────────────────
--
-- NO inventa una hora. El día sin marcas queda SIN REGISTRO DECLARADO — no con
-- una jornada supuesta de ocho horas. `null` jamás se vuelve 0: «no reportó» y
-- «trabajó cero horas» son dos afirmaciones distintas y la segunda es falsa.
--
-- NO afirma cumplimiento. Los topes que el motor sí puede citar (arts. 61, 63,
-- 68 y 69, y la tabla del Transitorio Segundo) están verificados y viven en la
-- ficha; pero el motor solo emite EXCESO o DATO INSUFICIENTE — nunca «cumple».
-- Quien certifica que una flota cumple es su abogado, no este software.
--
-- NO evalúa la NOM-087-SCT-2-2017. La NOM mide TIEMPO DE CONDUCCIÓN (numeral
-- 4.7: máximo 14 h en 24 h) y este registro mide JORNADA, que es otra cosa —
-- el art. 58 de la LFT la define como el tiempo a disposición del patrón, esté
-- o no manejando. Likida no sabe cuántas de esas horas fueron volante, así que
-- no emite juicio sobre la NOM: lo dice y para ahí. Ver
-- `normas/nom-087-sct-2-2017.yaml`.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. EL DÍA DE JORNADA — el expediente, no las horas ─────────────────────
--
-- Las horas NO viven aquí: viven en los asientos, cada una con su origen. Esta
-- tabla es el contenedor, el estado de cierre y la conformidad del operador.
-- Separarlos es lo que permite que el expediente tenga DOS marcas de inicio con
-- procedencias distintas —una que el chofer declaró y otra que el hito del
-- viaje derivó— y que el contralor vea las dos, en vez de una sola cifra que ya
-- perdió de dónde salió.
--
-- El DÍA es el de México, no el UTC del servidor (misma lección de la 0193, la
-- 0205 y `hoyMx()`): una jornada que arranca a las 19:30 de Mérida ya es
-- «mañana» en UTC, y partirla ahí movería horas de un día a otro en el
-- documento que se le enseña a un inspector.
create table if not exists public.jornada_dia (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenant(id) on delete cascade,
  operador_id   uuid not null,
  -- Día natural en hora de México (AAAA-MM-DD).
  dia           date not null,
  estado        text not null default 'abierto',
  cerrado_en    timestamptz,
  cerrado_por   uuid references public.app_user(id) on delete set null,
  -- El correo del que cerró, CONGELADO. `cerrado_por` se anula si el usuario se
  -- borra (ARCO, baja) y entonces el expediente ya no diría quién lo firmó. En
  -- un juicio, «lo cerró alguien» no es una firma.
  cerrado_por_email text,

  -- ── LA CONFORMIDAD DEL OPERADOR (art. 132 fr. XXXIV, párrafo tercero) ────
  -- El acuerdo entre trabajador y patrón es lo que vuelve PRUEBA PLENA el
  -- contenido del registro. Aquí se guarda cuándo lo dio y CON QUÉ MENSAJE:
  -- el id de WhatsApp es la evidencia, no un adorno. NULL = no lo ha dado, y
  -- eso el reporte lo dice — jamás se supone.
  conforme_operador_en   timestamptz,
  conforme_wa_message_id text,

  created_at    timestamptz not null default now(),

  constraint jornada_dia_estado_dominio
    check (estado in ('abierto', 'cerrado')),

  -- Cerrado y sin fecha de cierre —o al revés— sería un expediente que miente
  -- sobre su propio estado. Se prohíbe en la base, no en un `if`.
  constraint jornada_dia_cierre_coherente
    check ((estado = 'cerrado') = (cerrado_en is not null)),

  -- La firma del cierre sobrevive al borrado del usuario (ver arriba).
  constraint jornada_dia_cierre_firmado
    check (estado <> 'cerrado' or cerrado_por_email is not null),

  -- Conformidad sin el mensaje que la acredita no es conformidad acreditada:
  -- es una casilla marcada. Falla cerrado — sin id, no hay conformidad.
  constraint jornada_dia_conformidad_acreditada
    check ((conforme_operador_en is null) = (conforme_wa_message_id is null)),

  -- La FK COMPUESTA de la casa (0028/0145): sin ella, un autenticado de la
  -- flota A podría colgar un día de jornada del operador de la flota B.
  --
  -- `on delete restrict` A PROPÓSITO, y no cascade: este es el documento que la
  -- LFT obliga a conservar «durante el último año y un año después de que se
  -- extinga la relación laboral» (art. 804, último párrafo). Que dar de baja a
  -- un chofer borrara su registro de jornada sería la forma más fácil de
  -- destruir justo la prueba que el 805 castiga no exhibir.
  -- `viaje.operador_id` ya restringe el borrado por una razón parecida, así que
  -- esto no cierra ningún DELETE que hoy funcione.
  constraint jornada_dia_operador_tenant_fkey
    foreign key (operador_id, tenant_id) references public.operador (id, tenant_id)
    on delete restrict,

  -- `jornada_asiento` le apunta con su compuesta: necesita esta llave.
  constraint jornada_dia_id_tenant_key unique (id, tenant_id)
);

-- LA IDEMPOTENCIA ES UNA RESTRICCIÓN, NO UN `if`. Un operador tiene UN
-- expediente por día. Dos corridas solapadas del derivador (o el chofer
-- declarando su inicio mientras el cron deriva el hito) arrancan las dos con
-- «¿ya existe el día?»; sin este índice las dos contestan que no y quedan dos
-- expedientes del mismo día, cada uno con la mitad de las marcas.
create unique index if not exists jornada_dia_unica
  on public.jornada_dia (tenant_id, operador_id, dia);

-- El barrido del derivador y el del panel: los días de una flota en una
-- ventana. Lo que se lee siempre es «esta flota, estas fechas».
create index if not exists jornada_dia_tenant_dia_idx
  on public.jornada_dia (tenant_id, dia);

comment on table public.jornada_dia is
  'Un expediente de jornada por operador y día — el registro electrónico que exige la LFT 132 fr. XXXIV (adicionada DOF 01-05-2026). NO guarda horas: las guarda jornada_asiento, cada una con su procedencia. Un día sin asientos NO significa cero horas: significa que nadie reportó, y así se dice.';
comment on column public.jornada_dia.estado is
  'abierto | cerrado. El cierre es el acto del contralor que da por bueno el día. No borra nada ni impide corregir después: una corrección posterior queda anotada, con su autor y su hora.';
comment on column public.jornada_dia.cerrado_por_email is
  'El correo del que firmó el cierre, CONGELADO al firmar. `cerrado_por` se vuelve NULL si el usuario se borra; sin esta copia el expediente perdería la firma justo cuando más falta hace.';
comment on column public.jornada_dia.conforme_operador_en is
  'Cuándo el OPERADOR dijo estar de acuerdo con el registro de su día. Es lo que el tercer párrafo de la LFT 132 fr. XXXIV pide para que el registro «haga prueba plena». NULL = no lo ha dado; el reporte lo dice y jamás lo supone.';
comment on column public.jornada_dia.conforme_wa_message_id is
  'El mensaje de WhatsApp con el que el operador dio su conformidad. ES la evidencia del acuerdo: sin él no se sella la conformidad (falla cerrado).';

-- ── 2. EL ASIENTO — una marca y de dónde salió ─────────────────────────────
--
-- LA PROCEDENCIA NO ES UN ADORNO. Es la diferencia entre un documento que
-- prueba y una hoja de cálculo. Cuatro valores, y ninguno se mezcla con otro:
--
--   · `declarado_operador`   — el chofer lo dijo por WhatsApp. Es su
--                              declaración, con la hora del MENSAJE.
--   · `hito_viaje`           — se DERIVA de un hito que él mismo selló
--                              («ya llegué», 0090) o de la aceptación del
--                              viaje. Es observación, no declaración de
--                              jornada: él nunca dijo «empecé a trabajar».
--   · `gps`                  — se DERIVA de posiciones de su unidad. Prueba
--                              que la unidad se movió, NO que él la manejara.
--   · `capturado_contralor`  — lo capturó una persona de oficina. Lleva su
--                              correo y su hora, siempre.
--
-- Ninguna cifra derivada se presenta junto a una declarada sin decir cuál es
-- cuál — ni en la pantalla, ni en el CSV, ni en el mensaje de WhatsApp.
create table if not exists public.jornada_asiento (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenant(id) on delete cascade,
  jornada_id     uuid not null,
  tipo           text not null,
  -- El instante de la marca. timestamptz: el día MX se calcula al leer, con la
  -- misma conversión que la 0205 usa para las posiciones.
  momento        timestamptz not null,
  procedencia    text not null,

  -- ── DE DÓNDE SALIÓ, MATERIALMENTE ────────────────────────────────────────
  -- `origen_ref` es la coordenada del hecho que produjo la marca derivada
  -- ('viaje:<uuid>:llegada_en', 'gps:<unidad>:2026-08-27:primera'). Es la llave
  -- de idempotencia del derivador: el mismo hecho, dos corridas, un asiento.
  origen_ref     text,
  wa_message_id  text,
  viaje_id       uuid,
  unidad_id      uuid,
  -- Contexto legible para el expediente (la frase del chofer, cuántas
  -- posiciones sostienen la derivación). Nada que no toque al hecho.
  detalle        jsonb,

  -- ── QUIÉN LO CAPTURÓ (solo `capturado_contralor`) ───────────────────────
  registrado_por       uuid references public.app_user(id) on delete set null,
  -- Congelado, por la misma razón que `cerrado_por_email`: la firma no puede
  -- depender de que la cuenta siga existiendo.
  registrado_por_email text,
  nota                 text,

  -- ── LA CORRECCIÓN SE ANOTA, NO SE SOBREESCRIBE ──────────────────────────
  -- `momento` NUNCA se actualiza. Corregir es: anular el asiento viejo (con
  -- motivo, autor y hora) e insertar uno nuevo que apunte al anulado con
  -- `corrige_a`. Así el expediente conserva las dos versiones y quién movió
  -- cuál — que es justo lo que un registro editable en silencio no puede
  -- demostrar, y lo que un juez le va a preguntar al perito.
  corrige_a          uuid,
  anulado_en         timestamptz,
  anulado_por        uuid references public.app_user(id) on delete set null,
  anulado_por_email  text,
  anulado_motivo     text,

  created_at     timestamptz not null default now(),

  constraint jornada_asiento_tipo_dominio
    check (tipo in ('inicio_jornada', 'fin_jornada', 'inicio_descanso', 'fin_descanso')),
  constraint jornada_asiento_procedencia_dominio
    check (procedencia in ('declarado_operador', 'hito_viaje', 'gps', 'capturado_contralor')),

  -- Anulado sin motivo es una corrección sin explicación: media anotación.
  constraint jornada_asiento_anulacion_coherente
    check ((anulado_en is null) = (anulado_motivo is null)),
  -- Y sin firma no es anotación: es una edición anónima, que es la enfermedad.
  constraint jornada_asiento_anulacion_firmada
    check (anulado_en is null or anulado_por_email is not null),
  -- Una captura de oficina SIEMPRE lleva quién la hizo. Se exige el correo
  -- (texto, que sobrevive) y no el uuid: exigir el uuid haría que borrar al
  -- usuario reventara el `on delete set null` — el bug de la 0236, por otro
  -- camino.
  constraint jornada_asiento_captura_firmada
    check (procedencia <> 'capturado_contralor' or registrado_por_email is not null),
  -- Un asiento DERIVADO tiene que decir de qué hecho se derivó. Sin
  -- `origen_ref` sería una hora sin origen, que es exactamente lo que esta
  -- migración existe para impedir.
  constraint jornada_asiento_derivado_con_origen
    check (procedencia not in ('hito_viaje', 'gps') or origen_ref is not null),

  -- ── LAS FK COMPUESTAS (0028/0145) ───────────────────────────────────────
  constraint jornada_asiento_jornada_tenant_fkey
    foreign key (jornada_id, tenant_id) references public.jornada_dia (id, tenant_id)
    on delete cascade,
  -- `on delete set null` CON LISTA DE COLUMNAS. A secas anularía también
  -- `tenant_id`, que es NOT NULL, y el DELETE del viaje reventaría — el bug
  -- exacto que arregló la 0236 y que no se reintroduce aquí. Borrar un viaje
  -- no borra la jornada: la hora trabajada sigue siendo cierta, solo se queda
  -- sin su referencia.
  constraint jornada_asiento_viaje_tenant_fkey
    foreign key (viaje_id, tenant_id) references public.viaje (id, tenant_id)
    on delete set null (viaje_id),
  constraint jornada_asiento_unidad_tenant_fkey
    foreign key (unidad_id, tenant_id) references public.unidad (id, tenant_id)
    on delete set null (unidad_id),
  -- La autorreferencia de la corrección, también compuesta: un asiento no
  -- puede corregir el de otra flota. `restrict` porque borrar el corregido
  -- dejaría al corrector hablando de un hecho que ya no está en el expediente.
  constraint jornada_asiento_corrige_tenant_fkey
    foreign key (corrige_a, tenant_id) references public.jornada_asiento (id, tenant_id)
    on delete restrict,

  constraint jornada_asiento_id_tenant_key unique (id, tenant_id)
);

-- ── LOS TRES CANDADOS DE IDEMPOTENCIA (índices, no `if`s) ─────────────────
--
-- 1. El mismo mensaje de WhatsApp reentregado por Meta no duplica la marca.
--    Parcial: los asientos SIN mensaje (derivados, capturados) no compiten.
create unique index if not exists jornada_asiento_wa_unico
  on public.jornada_asiento (jornada_id, wa_message_id)
  where wa_message_id is not null;

-- 2. UN inicio y UN fin de jornada VIVOS por expediente. Los descansos son
--    varios en un día y por eso no entran aquí. El `anulado_en is null` es lo
--    que permite corregir: se anula el viejo y entonces —y solo entonces— el
--    nuevo cabe.
--
--    Este índice es además el que hace que la DECLARACIÓN GANE sobre la
--    derivación sin necesidad de un `if` en la app: si el chofer ya declaró su
--    inicio, el asiento derivado del hito rebota con 23505 y el derivador lo
--    lee como «ya estaba», no como fallo.
create unique index if not exists jornada_asiento_marca_unica
  on public.jornada_asiento (jornada_id, tipo)
  where tipo in ('inicio_jornada', 'fin_jornada') and anulado_en is null;

-- 3. El derivador es idempotente por el HECHO del que deriva, no por la hora:
--    dos corridas del cron sobre el mismo hito producen UN asiento.
create unique index if not exists jornada_asiento_origen_unico
  on public.jornada_asiento (jornada_id, origen_ref)
  where origen_ref is not null;

-- La lectura del expediente y del reporte: todos los asientos de un día, en
-- orden cronológico.
create index if not exists jornada_asiento_jornada_idx
  on public.jornada_asiento (jornada_id, momento);

comment on table public.jornada_asiento is
  'Una marca de jornada (inicio, fin, descansos) CON SU PROCEDENCIA. Append-only por convención: `momento` nunca se actualiza — corregir es anular (con motivo, autor y hora) e insertar uno nuevo con `corrige_a`. En un juicio laboral un registro sin origen no prueba nada, y uno editable en silencio prueba en contra.';
comment on column public.jornada_asiento.procedencia is
  'declarado_operador (lo dijo el chofer) · hito_viaje (derivado de un hito que él selló) · gps (derivado de posiciones de su unidad: prueba que la unidad se movió, NO que él la manejara) · capturado_contralor (lo capturó oficina, con correo y hora). Nunca se mezclan al presentarlas.';
comment on column public.jornada_asiento.origen_ref is
  'La coordenada del hecho que produjo una marca DERIVADA (viaje:<uuid>:llegada_en, gps:<unidad>:<dia>:primera). Es la llave de idempotencia del derivador y la que permite reconstruir de dónde salió cada hora. Obligatoria para hito_viaje y gps.';
comment on column public.jornada_asiento.anulado_en is
  'Cuándo se anuló esta marca. NULL = vigente. Anular NO borra: el asiento se queda en el expediente con su motivo y su firma, y el que lo sustituye lo apunta con corrige_a.';
comment on index public.jornada_asiento_marca_unica is
  'Un inicio y un fin VIVOS por día. Es también lo que hace que la declaración del chofer le gane a la derivación sin un `if` en la app: si ya declaró, el derivado rebota con 23505 y el motor lo lee como "ya estaba".';

-- ── 3. LOS UMBRALES PROPIOS DE LA FLOTA ────────────────────────────────────
--
-- ESTA TABLA NO REEMPLAZA A LA LEY, LA COMPLEMENTA. Los topes que Likida SÍ
-- puede citar están verificados contra el texto vigente y viven en el código
-- con su ficha (`normas/lft-132-XXXIV-jornada.yaml`): art. 61 (ocho horas la
-- jornada diurna, siete la nocturna, siete y media la mixta), art. 63 (media
-- hora de descanso, por lo menos, en la jornada continua), art. 68 («la suma de
-- las jornadas ordinaria y extraordinaria, en ningún caso podrá ser mayor a
-- doce horas diarias»), art. 69 (un día de descanso por cada seis) y la tabla
-- del Transitorio Segundo del decreto del 01-05-2026 para el tope semanal —que
-- en 2026 sigue siendo 48 h, aunque el art. 59 ya diga 40.
--
-- Lo que esta tabla guarda es lo OTRO: el tope que la flota se pone a sí misma
-- —por contrato colectivo, por póliza de seguro, por política interna— que
-- puede ser más estricto que la ley y que Likida no tiene forma de conocer.
--
-- NULL = NO DECLARADO. Sin umbral propio el motor no calla: sigue evaluando
-- los topes de la LFT. Lo que no hace jamás es inventar un umbral de flota ni
-- decir «cumple».
create table if not exists public.jornada_politica (
  id                            uuid primary key default gen_random_uuid(),
  tenant_id                     uuid not null references public.tenant(id) on delete cascade,
  -- Horas máximas de jornada que la flota se fija a sí misma.
  horas_max_jornada             numeric(4,2),
  -- Minutos mínimos de descanso DENTRO de la jornada.
  minutos_min_descanso          integer,
  -- Horas mínimas entre el fin de una jornada y el inicio de la siguiente.
  horas_min_entre_jornadas      numeric(4,2),
  -- Qué dice la flota que fundamenta sus números. TEXTO DE ELLA, no de Likida:
  -- el producto lo transcribe en el reporte tal cual, sin validarlo y sin
  -- hacerlo suyo. Likida no da asesoría jurídica.
  fundamento                    text,
  declarada_por                 uuid references public.app_user(id) on delete set null,
  declarada_por_email           text,
  declarada_en                  timestamptz not null default now(),

  -- Un umbral de 0 horas o NaN no es un umbral: es un error de captura que
  -- marcaría excedido TODO. Se rebota en la base.
  constraint jornada_politica_horas_sanas
    check (horas_max_jornada is null
           or (horas_max_jornada > 0 and horas_max_jornada <= 24 and horas_max_jornada <> 'NaN'::numeric)),
  constraint jornada_politica_descanso_sano
    check (minutos_min_descanso is null
           or (minutos_min_descanso >= 0 and minutos_min_descanso <= 1440)),
  constraint jornada_politica_entre_jornadas_sano
    check (horas_min_entre_jornadas is null
           or (horas_min_entre_jornadas >= 0 and horas_min_entre_jornadas <= 24
               and horas_min_entre_jornadas <> 'NaN'::numeric)),
  -- Declarar un umbral es un acto con consecuencia: queda firmado, y la firma
  -- es el correo (texto) para que sobreviva al borrado de la cuenta.
  constraint jornada_politica_firmada
    check (declarada_por_email is not null)
);

-- Una política viva por flota: dos filas dirían dos umbrales del mismo
-- concepto, y el reporte no sabría cuál enseñó. El escritor hace
-- update-luego-insert apoyado en este índice.
create unique index if not exists jornada_politica_flota_unica
  on public.jornada_politica (tenant_id);

comment on table public.jornada_politica is
  'Los umbrales que LA FLOTA se fija a sí misma (contrato colectivo, póliza, política interna), que pueden ser más estrictos que la ley. NO reemplaza a los topes de la LFT, que viven verificados en el código con su ficha. NULL = no declarado: el motor sigue evaluando la LFT y nunca inventa un umbral de flota.';
comment on column public.jornada_politica.fundamento is
  'Lo que la FLOTA dice que fundamenta sus números. Se transcribe tal cual en el reporte, sin validarlo: Likida registra y avisa, no dictamina. Quien certifica el cumplimiento es el abogado de la flota.';

-- ── 4. EL LATIDO DEL CRON NUEVO — y dos que llevaban meses mudos ──────────
--
-- `cron_latido_id_dominio` es una lista cerrada de ids de cron, y estaba
-- ATRASADA respecto de `lib/admin/salud.ts`: el catálogo de la base tenía siete
-- valores y `CRONS` ya tenía nueve. Los latidos de `asistencia` (el reloj de
-- emergencias, cada 5 min) y de `descarga-sat` rebotaban contra este CHECK en
-- cada corrida — y `registrarLatido` atrapa el error y solo lo `warn`ea, así
-- que los dos crons llevaban semanas sin poder reportar que estaban vivos.
-- `/api/health` no podía llamarlos muertos porque nunca tuvo un latido suyo
-- que juzgar: exactamente el modo de falla que la RES-7 vino a cerrar, otra
-- vez, por la puerta de atrás.
--
-- Se enumera el catálogo COMPLETO (la lección de la 0227 con
-- `interruptor_id_dominio`): diez valores, los nueve de `CRONS` más `jornada`,
-- que entra con esta migración. Una lista corta aquí no da error visible —
-- silencia latidos, que es peor.
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'cron_latido_id_dominio' and conrelid = 'public.cron_latido'::regclass
  ) then
    alter table public.cron_latido drop constraint cron_latido_id_dominio;
  end if;
  alter table public.cron_latido
    add constraint cron_latido_id_dominio
    check (id in (
      'wa-pendientes',
      'wa-outbox',
      'escalar',
      'facturar',
      'purgar',
      'runner',
      'gps',
      'asistencia',
      'descarga-sat',
      'jornada'
    ));
end $$;

comment on constraint cron_latido_id_dominio on public.cron_latido is
  'El catálogo COMPLETO de ids de cron, espejo de CRONS en lib/admin/salud.ts. Se enumera entero al tocarlo: una lista corta no falla ruidosamente, silencia el latido de los crons que faltan (le pasó a asistencia y a descarga-sat, corregido en la 0241).';

-- ── 5. RLS deny-all + grants SOLO a service_role (patrón 0186/0196/0198) ───
--
-- Doble candado. `service_role` bypassa RLS, así que el aislamiento real de
-- estas tres tablas lo pone el filtro `tenant_id` que la app escribe a mano en
-- cada consulta (y que `consultas_admin_filtran_tenant.test.ts` escanea). RLS
-- deny-all es lo que impide que una sesión de navegador —`authenticated`, con
-- la llave publicable— lea el registro de jornada de OTRA flota si mañana
-- alguien expusiera estas tablas por PostgREST. Y aquí el dato no es una cifra
-- de negocio: es el horario de una persona identificada, dato personal del
-- art. 3 fr. V de la LFPDPPP.
alter table public.jornada_dia      enable row level security;
alter table public.jornada_asiento  enable row level security;
alter table public.jornada_politica enable row level security;

revoke all on public.jornada_dia      from public, anon, authenticated;
revoke all on public.jornada_asiento  from public, anon, authenticated;
revoke all on public.jornada_politica from public, anon, authenticated;

grant select, insert, update, delete on public.jornada_dia      to service_role;
grant select, insert, update, delete on public.jornada_asiento  to service_role;
grant select, insert, update, delete on public.jornada_politica to service_role;
