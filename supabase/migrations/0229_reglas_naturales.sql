-- ═══════════════════════════════════════════════════════════════════════════
-- 0229 · REGLAS DE AUDITORÍA EN LENGUAJE NATURAL (A19).
--
-- El dueño o el contador escribe "avísame si una unidad sale a viaje sin
-- póliza vigente" y Likida lo vigila. Lo que esta migración guarda NO es esa
-- frase: es la ESTRUCTURA a la que un modelo la tradujo UNA vez —plantilla
-- del catálogo cerrado (`src/lib/likida/reglas/catalogo.ts`) más sus
-- parámetros tipados— y que una persona CONFIRMÓ antes de activarla.
--
-- ── POR QUÉ LA FRASE NO ES LA REGLA ───────────────────────────────────────
--
-- Guardar el texto libre y releerlo con un modelo en cada corrida es la
-- versión que se demuestra sola en una demo y se cae en producción: el mismo
-- texto se interpreta distinto entre corridas, nadie puede auditar por qué
-- avisó, y el gasto de modelo crece con las horas del día. Aquí el modelo
-- traduce una vez (con presupuesto declarado y cobrado al tenant, patrón
-- OCR) y después NO vuelve a aparecer: quien vigila es SQL sobre columnas.
-- `texto_original` se conserva sólo para poder CITARLE a la persona lo que
-- ella escribió — jamás se vuelve a interpretar.
--
-- ── LA CONFIRMACIÓN HUMANA LA EXIGE LA BASE ───────────────────────────────
--
-- `regla_activa_confirmada` es el candado que hace verdadera la promesa del
-- diseño: una regla sólo puede salir de 'pendiente' si trae quién la
-- confirmó y cuándo. No es un `if` en una server action que alguien pueda
-- rodear con un POST directo — es un CHECK. Una vigilancia que empieza a
-- mandar WhatsApps sin que un humano haya leído su interpretación es
-- exactamente el modo de falla que este producto no se puede permitir.
--
-- ── DÓNDE CORRE (decisión declarada) ──────────────────────────────────────
--
-- El vigilante NO es un agente del catálogo de la compañía y por eso no lleva
-- fila en `agente_definicion` ni palanca propia en `interruptor`: es una
-- FEATURE DEL PRODUCTO que la flota compra, no un empleado autónomo de Likida
-- que gaste modelo por su cuenta. Corre como cuarto barrido del cron de
-- `escalar` (cada hora), junto a los relojes legales, con el mismo criterio
-- que ya está escrito ahí para `avisarVencimientos`: "no es un agente del
-- catálogo, es un reloj — la global lo apaga con todo lo demás". Un agente
-- nuevo hubiera exigido kill switch, techo en USD y bandeja de aprobación
-- para un motor que no llama a ningún modelo.
--
-- ── EL SELLO (patrón 0202) ────────────────────────────────────────────────
--
-- `regla_disparo` es la memoria de "esto ya se avisó". La llave lleva un
-- `clave` que es el CICLO —la fecha de vencimiento, el conteo de viajes, la
-- hora de llegada—, exactamente el truco de la 0202 con `vence`: mientras el
-- ciclo no cambie se avisa una vez, y cuando cambia (el papel se renovó, el
-- chofer pasó de 2 a 3 viajes) vuelve a avisar. Sin esto el barrido horario
-- mandaría el mismo WhatsApp 24 veces al día, que es la forma más rápida de
-- entrenar al jefe a ignorar el canal.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. La regla, como estructura ───────────────────────────────────────────
create table if not exists public.regla_vigilancia (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenant(id) on delete cascade,
  -- El catálogo CERRADO. Espeja `PLANTILLAS_ID` de catalogo.ts: un valor de
  -- más aquí sería una regla que el vigilante no sabe correr y que la
  -- pantalla listaría como viva.
  plantilla       text not null,
  -- Los parámetros YA validados contra el esquema de su plantilla (zod, en
  -- `validarParams`). Objeto siempre — un arreglo o un escalar aquí sería
  -- una regla que el lector no sabe leer.
  params          jsonb not null default '{}'::jsonb,
  -- Lo que la persona escribió, tal cual, para poder citárselo. NUNCA se
  -- vuelve a interpretar: la regla viva es (plantilla, params).
  texto_original  text not null,
  -- La interpretación en español que la persona leyó y confirmó. La arma el
  -- catálogo (`fraseDe`), no el modelo.
  frase           text not null,
  estado          text not null default 'pendiente',
  -- Quién la declaró y quién la confirmó. Se conservan aunque la cuenta se
  -- borre (patrón 0207/0213/0226): quién autorizó una vigilancia es parte
  -- del expediente, no un dato de sesión.
  creada_por      uuid references public.app_user(id) on delete set null,
  creada_en       timestamptz not null default now(),
  confirmada_por  uuid references public.app_user(id) on delete set null,
  confirmada_en   timestamptz,
  -- Bitácora de operación: la última vez que el vigilante la evaluó y la
  -- última vez que de verdad disparó. NULL = todavía no pasa — NO cero: una
  -- regla recién confirmada y una que lleva un mes sin encontrar nada se
  -- distinguen aquí, y la pantalla las pinta distinto.
  --
  -- NO hay contador de disparos, y es deliberado: mantenerlo exacto exigiría
  -- un read-modify-write en cada corrida (o una RPC con lock) para un número
  -- que `regla_disparo` ya sabe contar sin poder desincronizarse. Un contador
  -- que se equivoca en una carrera es peor que no tenerlo: se lee como
  -- medición.
  ultima_corrida_en timestamptz,
  ultimo_disparo_en timestamptz,
  -- Qué modelo tradujo y cuánto costó. NULL = nadie: la persona eligió la
  -- vigilancia a mano de la lista (el camino sin proveedor).
  modelo          text,
  costo_usd       numeric(12,6),

  constraint regla_vigilancia_plantilla_dominio check (plantilla in (
    'unidad_sin_papel_vigente_al_despachar',
    'gasto_de_concepto_mayor_a',
    'gasto_sin_cfdi_mayor_a',
    'chofer_con_viajes_sin_liquidar',
    'documento_por_vencer',
    'factura_sin_cobrar_mas_de',
    'estadia_mayor_a',
    'incidencia_abierta_mas_de',
    'viaje_abierto_sin_comprobantes_mas_de',
    'costo_ia_dia_mayor_a'
  )),
  constraint regla_vigilancia_estado_dominio
    check (estado in ('pendiente', 'activa', 'pausada')),
  constraint regla_vigilancia_params_objeto
    check (jsonb_typeof(params) = 'object'),
  -- EL CANDADO DEL DISEÑO: sin confirmación humana no sale de 'pendiente'.
  constraint regla_vigilancia_activa_confirmada
    check (estado = 'pendiente'
           or (confirmada_por is not null and confirmada_en is not null)),
  constraint regla_vigilancia_textos_no_vacios
    check (btrim(texto_original) <> '' and btrim(frase) <> ''),
  constraint regla_vigilancia_texto_acotado
    check (char_length(texto_original) <= 400 and char_length(frase) <= 400),
  constraint regla_vigilancia_costo_sano
    check (costo_usd is null or (costo_usd >= 0 and costo_usd < 100)),
  -- La llave que hace posibles las FK compuestas de la casa (0028/0145).
  constraint regla_vigilancia_id_tenant_key unique (id, tenant_id)
);

comment on table public.regla_vigilancia is
  'Las vigilancias que la flota declaró en lenguaje natural (A19, 0229). Lo guardado es la ESTRUCTURA (plantilla del catálogo cerrado + params validados), no el texto: el modelo traduce UNA vez al crearla y nunca vuelve a correr. `texto_original` se conserva sólo para citarle a la persona lo que escribió.';
comment on column public.regla_vigilancia.plantilla is
  'Catálogo CERRADO de vigilancias ejecutables — espeja PLANTILLAS_ID en src/lib/likida/reglas/catalogo.ts. Cada una tiene lector determinista en lectores.ts; una plantilla sin lector no compila.';
comment on column public.regla_vigilancia.texto_original is
  'La frase tal cual la escribió la persona. Es CITA, no fuente: nadie la vuelve a interpretar. Si la interpretación quedó mal, la regla se borra y se declara otra.';
comment on column public.regla_vigilancia.estado is
  'pendiente = interpretada, esperando que un humano confirme la frase; activa = confirmada y vigilando; pausada = confirmada en su momento y apagada por su dueño. El CHECK regla_vigilancia_activa_confirmada impide que algo salga de pendiente sin firma.';
comment on constraint regla_vigilancia_activa_confirmada on public.regla_vigilancia is
  'La confirmación humana, en la base y no en un if: una regla sólo vigila si alguien leyó su interpretación y la firmó. Un POST directo a la server action no puede rodear esto.';

-- Una flota no declara dos veces la MISMA vigilancia. Parcial: una pausada no
-- estorba para volver a declararla, y borrarla tampoco deja el hueco ocupado.
create unique index if not exists regla_vigilancia_unica
  on public.regla_vigilancia (tenant_id, plantilla, params)
  where estado in ('pendiente', 'activa');

comment on index public.regla_vigilancia_unica is
  'La misma vigilancia con los mismos parámetros no se declara dos veces mientras esté viva: dos reglas idénticas serían dos WhatsApps por el mismo hecho. `params` es jsonb y su igualdad normaliza el orden de las llaves, así que {monto,concepto} y {concepto,monto} chocan — que es lo correcto.';

-- El barrido lee por (estado, tenant). Índice parcial: las pausadas y las
-- pendientes no se recorren nunca en la corrida horaria.
create index if not exists regla_vigilancia_activas_idx
  on public.regla_vigilancia (tenant_id, plantilla)
  where estado = 'activa';

-- Mismo doble candado que 0196/0198/0207/0215: RLS deny-all + solo service_role.
alter table public.regla_vigilancia enable row level security;
revoke all on table public.regla_vigilancia from public, anon, authenticated;
grant select, insert, update, delete on table public.regla_vigilancia to service_role;

-- ── 2. El sello anti-spam (patrón 0202) ────────────────────────────────────
create table if not exists public.regla_disparo (
  tenant_id    uuid not null references public.tenant(id) on delete cascade,
  regla_id     uuid not null,
  objeto       text not null,
  -- uuid SUELTO a propósito, igual que en la 0202: el sello tiene que
  -- SOBREVIVIR al borrado del objeto. Si el viaje se borra y otro nace, es
  -- otro ciclo; una FK con cascade borraría la memoria de qué ya se avisó y
  -- el mismo hecho volvería a sonar.
  objeto_id    uuid not null,
  -- El CICLO. '' = el objeto mismo es el ciclo (un gasto entra una vez). La
  -- fecha de vencimiento, el conteo de viajes o la hora de llegada aquí son
  -- lo que hace que un ciclo NUEVO vuelva a avisar.
  clave        text not null default '',
  disparado_en timestamptz not null default now(),
  -- La cita de la fila que disparó, ya armada. Se guarda para que el panel
  -- pueda enseñar QUÉ provocó el aviso sin recalcularlo contra datos que ya
  -- cambiaron.
  evidencia    text not null,

  primary key (tenant_id, regla_id, objeto, objeto_id, clave),
  -- La FK COMPUESTA de la casa (0028/0145): el sello de la flota A no puede
  -- colgarse de una regla de la flota B.
  constraint regla_disparo_regla_tenant_fkey
    foreign key (regla_id, tenant_id) references public.regla_vigilancia (id, tenant_id)
    on delete cascade,
  constraint regla_disparo_objeto_dominio check (objeto in (
    'viaje', 'gasto', 'operador', 'unidad', 'factura', 'incidencia', 'tenant'
  )),
  constraint regla_disparo_evidencia_no_vacia
    check (btrim(evidencia) <> '' and char_length(evidencia) <= 1000)
);

comment on table public.regla_disparo is
  'Idempotencia de las reglas de A19 (0229, patrón 0202): cada (regla, objeto, ciclo) avisa UNA sola vez. `clave` es el ciclo — la fecha de vencimiento, el conteo, la hora de llegada — y al cambiar vuelve a avisar. Escrita solo por el barrido del cron (service_role), DESPUÉS de que el WhatsApp salió.';
comment on column public.regla_disparo.clave is
  'El discriminador del ciclo. Cadena vacía = el objeto mismo es el ciclo (un gasto solo entra una vez). Un papel renovado trae otra fecha, un chofer con 3 viajes trae otro conteo: ciclos nuevos, avisos nuevos.';

-- El panel enseña "últimos disparos de esta regla".
create index if not exists regla_disparo_por_regla_idx
  on public.regla_disparo (tenant_id, regla_id, disparado_en desc);

alter table public.regla_disparo enable row level security;
revoke all on table public.regla_disparo from public, anon, authenticated;
grant select, insert, update, delete on table public.regla_disparo to service_role;
