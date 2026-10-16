# Agente 5 «Conductor» — Runbook del piloto: operación y rollback

> Para quien opera el piloto (hasta 6 operadores voluntarios por flota). Complementa a `agente-conductor.md` (qué hace el agente) y `plantillas-meta.md` (plantillas). Aquí solo: **cómo se enciende, cómo se mira, cómo se apaga y cómo se deshace**.
>
> Todo lo que cambia una base real (migraciones, el SQL de reversa) lo ejecuta una persona con autorización, con respaldo previo y por el script de aplicación de migraciones; este documento **no** se ejecuta solo y no sustituye esa autorización.

## 0. Qué nace encendido y qué nace apagado

| Perilla (`agente_conductor_config`) | Valor al nacer | Qué implica |
|---|---|---|
| `activo` | `true` en el código; **`false` en el seed del demo** | Con `false` el agente no corre para esa flota (ni pide, ni persigue, ni detecta). |
| `detectar_hitos_gps` | **ENCENDIDO** (`true`) | En cuanto la flota está activa, el barrido de GPS registra llegadas y salidas **solo** de viajes con sitio asignado y GPS de la unidad. No hace falta encender nada más para eso. |
| `avisar_senal_vida` | **APAGADO** (`false`) | Ningún aviso de «sin señal de vida» sale hasta encenderlo (y solo se deja encender si el preflight está en verde, §1.5). |
| `perfil_seguimiento` | `completo` | Los 5 hitos del ciclo. `esenciales` = solo salida de carga, dónde está y señal de vida. |
| `piloto_max_voluntarios` | 6 (1 a 50) | Tope de operadores voluntarios por flota. |

Los defaults los fija `src/lib/likida/conductor/config.ts` y los vigila `config.test.ts`; si alguien los cambia, hay que actualizar este runbook y `agente-conductor.md`.

## 1. Encender el piloto (en este orden)

1. **Preflight.** Abrir `/dashboard/agentes/conductores/configuracion`, panel «¿Está lista la flota?». Son ocho comprobaciones de solo lectura (`preflight_piloto.ts`): voluntarios con teléfono alcanzable, unidades con GPS reciente, viajes con sitio de origen y destino (≥ 80 %), a quién avisar por patio (escalamiento), plantillas Meta aprobadas, agente encendido, zona horaria válida y continuidad del GPS (que no traiga solo eventos). Cada una dice qué falta y qué hacer. Mientras haya algo en rojo el tablero muestra un aviso y la señal de vida no se deja encender; los hitos por WhatsApp siguen funcionando.
2. **Alta de voluntarios.** En la misma pantalla, sección «Operadores del piloto»: buscar, agregar. Muestra el contador «n de 6»; el tope se aplica en el servidor. Se rechazan teléfonos inválidos o de demo y operadores de otra flota. Solo quien puede administrar la flota cambia la lista; queda bitácora sin datos personales.
3. **Importar los viajes.** Por la pantalla de viajes (`/dashboard/viajes`, importador de archivo/TMS). La compuerta de voluntarios deja **aceptados por importación** (`viaje.aceptado_origen = 'importacion'`) solo los viajes abiertos, sin aceptar, de un operador voluntario; a los demás no les escribe nada. Un viaje que el chofer ya aceptó no se reescribe. Las métricas de «aceptación del chofer» excluyen los viajes importados.
4. **Ver el tablero.** `/dashboard/agentes/conductores`: hitos por viaje, excepciones («sin sitio», «sin señal», «sin respuesta») y, si falta algo del preflight, el banner con el primer pendiente. Revisar que los viajes del piloto aparezcan y que traigan sitio.
5. **Encender `avisar_senal_vida`.** Solo cuando el preflight esté en verde: casilla «Preguntar «¿sigues bien?» si el GPS de un tractor en tránsito se calla» en la configuración. Con preflight en rojo el servidor del panel lo **rechaza** y dice por qué. La compuerta vive en el panel: `PUT /v1/conductor/config` no la aplica, así que en el piloto el encendido se hace por el panel. Existe un forzado solo para QA (casilla `forzarPreflight`) que exige superadmin y queda en la bitácora: no se usa en el piloto real.

Se enciende **una flota a la vez**, y al principio con la escalera por defecto y los umbrales por defecto (son supuestos, no mediciones; se ajustan con datos).

## 2. Apagar (de lo más chico a lo más grande)

Ninguno de estos pasos borra datos ni toca otros agentes.

| # | Qué apagar | Cómo | Qué pasa |
|---|---|---|---|
| a | **Un voluntario** | Configuración → «Operadores del piloto» → Retirar (llama a `retirar_voluntario`, 0800) | Se quita la marca de voluntario y sus viajes **abiertos** aceptados por importación vuelven a «sin aceptar» (si el aviso lo había puesto la propia importación, también se quita). Los hitos ya registrados se conservan. La pantalla dice cuántos viajes dejaron de seguirse. |
| b | **La señal de vida de la flota** | Desmarcar `avisar_senal_vida` en la configuración, o `PUT /v1/conductor/config` con `{"avisarSenalVida": false}` | No salen más avisos «¿sigues bien?» ni escalamientos por silencio. Lo demás sigue igual. |
| c | **El Conductor entero de la flota** | Desmarcar «Agente encendido para esta flota» (`activo = false`) | El cron `conductor-hitos` deja de pedir, perseguir, detectar y escalar para esa flota. El chofer que escriba por su cuenta puede seguir siendo atendido en la cara reactiva. Para detener **todas** las flotas usar la palanca `agente:conductores` (o `global`); es fail-closed: si no se puede leer, no corre. |
| d | **Detección por GPS** | `detectar_hitos_gps = false` | Deja de registrar llegadas/salidas por geocerca; el hito vuelve a depender del chofer. |

Después de cualquier apagado, comprobar en el tablero que el latido del cron `conductor-hitos` siga saliendo (`ok`; `parcial` = algún paso falló o se cortó por reloj) y que no queden avisos pendientes de enviar.

## 3. Viajes aceptados por importación: ubicarlos y limpiarlos

`aceptado_origen` vale `chofer`, `importacion` u `oficina`. Los puestos por importación no son una aceptación del chofer.

```sql
-- Ubicar (solo lectura): viajes abiertos aceptados por importación de una flota
select v.id, v.operador_id, v.aceptado_en, v.avisado_en
  from public.viaje v
 where v.tenant_id = '<id-de-la-flota>'
   and v.estatus = 'abierto'
   and v.aceptado_origen = 'importacion'
 order by v.aceptado_en;
```

- **Limpiar por operador:** retirar al voluntario (§2a) ya los revierte.
- **Limpiar a la flota entera sin quitar voluntarios** (misma regla que `retirar_voluntario`: solo viajes abiertos y solo los de origen `importacion`; el aviso se quita únicamente si lo puso la importación):

```sql
update public.viaje v
   set avisado_en      = case when v.avisado_en = v.aceptado_en then null else v.avisado_en end,
       aceptado_en     = null,
       aceptado_origen = null
 where v.tenant_id = '<id-de-la-flota>'
   and v.estatus = 'abierto'
   and v.aceptado_origen = 'importacion';
```

- Los viajes **cerrados** con `aceptado_origen = 'importacion'` se dejan como están: son historia, y las métricas ya los excluyen.

## 4. Rollback del esquema (migraciones 0800 a 0804)

**Cuándo:** solo si apagar (§2) no basta y hay que quitar las estructuras nuevas. Para detener el piloto casi nunca hace falta.

**Antes de empezar:**

1. Volver primero el **código** a la versión anterior a estas migraciones (el código de esta rama lee las columnas nuevas; si se borran con él desplegado, fallará).
2. Respaldo de la base y de las tablas que se tocan (`viaje`, `posicion`, `operador`, `agente_conductor_config`, `viaje_hito`, `viaje_sitio_derivado`, `sitio_equivalencia`).
3. Ejecutarlo una persona autorizada, **por el script de aplicación de migraciones o el cliente de SQL de la base**, en una sola transacción, **en orden inverso** (0804 → 0800).

**Qué toca y qué no:** solo columnas, índices, restricciones, funciones y la tabla creadas por 0800–0804. No modifica datos de otros agentes (cobranza, liquidación, peajes, etc.). Se pierde, por diseño, lo que se guardó en esas columnas/tablas (voluntarios, perfil y umbrales, diccionario de equivalencias, marcas de tránsito del TMS).

El repositorio no tiene carpeta `supabase/rollback/`, por eso el SQL va aquí:

```sql
begin;

-- ── 0804: tránsito y marcas del TMS ─────────────────────────────────────────
alter table public.viaje drop constraint if exists viaje_transito_estado_check;
alter table public.viaje
  drop column if exists transito_estado,
  drop column if exists transito_actualizado_en,
  drop column if exists transito_texto_origen,
  drop column if exists tms_salida_en,
  drop column if exists tms_llegada_en;

-- ── 0803: equivalencias texto → sitio ───────────────────────────────────────
-- Las filas derivadas con los dos criterios nuevos impedirían volver al CHECK de 0637.
delete from public.viaje_sitio_derivado where criterio in ('equivalencia', 'equivalencia_sin_sitio');
alter table public.viaje_sitio_derivado drop constraint if exists viaje_sitio_derivado_criterio_dominio;
alter table public.viaje_sitio_derivado add constraint viaje_sitio_derivado_criterio_dominio
  check (criterio in ('codigo', 'nombre_exacto', 'nombre_contenido'));
drop table if exists public.sitio_equivalencia;

-- ── 0802: referencia de despacho ────────────────────────────────────────────
drop index if exists public.viaje_despacho_ref_idx;
alter table public.viaje    drop column if exists despacho_ref;
alter table public.posicion drop column if exists despacho_ref;

-- ── 0801: perfil de seguimiento y umbrales ──────────────────────────────────
-- 1) Volver a la función de siembra de 0380: ejecutar el `create or replace function public.sembrar_hitos_conductor`
--    de supabase/migrations/0380_conductor_hitos.sql (junto con su revoke/grant). Es la única definición anterior.
-- 2) Opcional: los hitos que el perfil «esenciales» dejó omitidos vuelven a perseguirse en los viajes abiertos.
update public.viaje_hito h
   set estado = 'esperado', omitido_motivo = null, updated_at = now()
  from public.viaje v
 where v.id = h.viaje_id and v.tenant_id = h.tenant_id and v.estatus = 'abierto'
   and h.estado = 'omitido' and h.omitido_motivo = 'fuera_de_perfil';
alter table public.agente_conductor_config drop constraint if exists conductor_config_perfil_seguimiento;
alter table public.agente_conductor_config drop constraint if exists conductor_config_umbrales_senal;
alter table public.agente_conductor_config drop constraint if exists conductor_config_linea_base_llamadas;
alter table public.agente_conductor_config
  drop column if exists perfil_seguimiento,
  drop column if exists gps_obsoleto_min,
  drop column if exists detenido_min,
  drop column if exists segundo_aviso_min,
  drop column if exists escalar_senal_min,
  drop column if exists silencio_respuesta_min,
  drop column if exists mostrar_estados_frontera,
  drop column if exists aplicar_salida_del_tms,
  drop column if exists linea_base_llamadas_por_viaje,
  drop column if exists linea_base_registrada_en;

-- ── 0800: voluntarios y origen de la aceptación ─────────────────────────────
-- Primero revertir los viajes aceptados por importación (§3); si no, quedarían «aceptados» sin que nadie lo haya hecho.
update public.viaje v
   set avisado_en      = case when v.avisado_en = v.aceptado_en then null else v.avisado_en end,
       aceptado_en     = null,
       aceptado_origen = null
 where v.estatus = 'abierto' and v.aceptado_origen = 'importacion';
drop function if exists public.aceptar_viajes_importados(uuid, uuid[], timestamptz);
drop function if exists public.retirar_voluntario(uuid, uuid);
drop index if exists public.operador_voluntario_idx;
alter table public.agente_conductor_config drop constraint if exists agente_conductor_config_piloto_max_voluntarios_rango;
alter table public.agente_conductor_config drop column if exists piloto_max_voluntarios;
alter table public.viaje drop constraint if exists viaje_aceptado_origen_dominio;
alter table public.viaje drop column if exists aceptado_origen;
alter table public.operador
  drop column if exists agente_voluntario,
  drop column if exists agente_voluntario_desde,
  drop column if exists agente_voluntario_por;

commit;
```

**Después:** confirmar que el cron `conductor-hitos` sale `ok`, que el tablero carga y que las pruebas de migraciones del repositorio coinciden con el estado de la base. Si se reaplican las migraciones más adelante, son idempotentes (`if not exists` / `create or replace`).

## 5. Qué mirar durante el piloto

- Latido del cron `conductor-hitos` cada 5 min: `ok` o `parcial` (con la causa en el log, sin teléfonos ni coordenadas).
- Panel «¿Está lista la flota?» y su banner en el tablero: si algo vuelve a rojo (un voluntario sin teléfono, GPS que dejó de reportar), la señal de vida debe apagarse (§2b) hasta resolverlo.
- Excepciones del tablero («sin sitio», «sin señal», «sin respuesta»): son trabajo de la oficina, no del agente.
- Plantillas Meta: sin aprobación el envío fuera de la ventana de 24 h falla (132001) y el agente lo reporta; no lo simula.

## 6. KPIs del piloto y fechas

> Requisito R28 del cliente: arrancar en piloto «para ver cómo está extrayendo la información, cómo la está presentando» y qué suma o quita, y reportar el avance a los interesados. El cálculo vive en `src/lib/likida/conductor/insights.ts` (`calcularInsights` → `kpisPiloto`, puro, sin IA) y lo pinta la tarjeta de insights del tablero del agente (sección «KPIs del piloto», `TarjetaInsights` en `vista.tsx`); este documento solo define qué mide cada KPI.

**Regla de oro.** Un KPI solo se compara contra una **línea base declarada por el cliente**. Sin línea base válida la comparación dice «sin dato»: nunca se calcula un porcentaje de ahorro ni de mejora por cuenta propia. Una base no válida (negativa, no numérica, un % fuera de 0–100, minutos en cero) cuenta como no declarada. El % de mejora solo existe donde «menos es mejor» y la base es mayor que cero.

| # | KPI | Cálculo | Fuente | Línea base que debe declarar el cliente |
|---|---|---|---|---|
| 1 | Hitos sin intervención | hitos registrados por el sistema o el chofer ÷ hitos registrados × 100 (los de la oficina no cuentan) | `viaje_hito.fuente` | % de hitos que hoy se registran sin que la oficina intervenga |
| 2 | Minutos del GPS al registro | promedio de `registrado_en − detectado_en`; los negativos y sin fecha se descartan y se cuentan | `viaje_cruce_geocerca` | minutos que hoy tarda en quedar registrado un evento |
| 3 | Viajes completos | viajes con todos sus hitos no omitidos en recibido o validado ÷ viajes con algún hito que cuente × 100 | `viaje_hito.estado` por viaje | % de viajes completos hoy |
| 4 | Mensajes del supervisor evitados | hitos sin intervención × llamadas por viaje declaradas; **es una estimación** y así se rotula | `agente_conductor_config.linea_base_llamadas_por_viaje` | llamadas por viaje que hoy hace el supervisor |
| 5 | Tiempo de salida de terminal al primer cliente (referencia) | promedio de las mediciones válidas por viaje | mediciones por viaje (sin fuente automática todavía) | minutos hoy |
| 6 | Reubicaciones por cliente (referencia) | reubicaciones totales ÷ clientes con dato (lo que entrega `reubicacionesPorCliente`, T-A5-63) | bitácora de la llegada | reubicaciones por cliente hoy |

Notas de lectura:

- Los KPIs 5 y 6 son de referencia: **sin línea base no muestran valor**, ni siquiera el medido.
- «Sin dato» no es cero: un periodo sin hitos con viaje, sin cruces o sin reubicaciones registradas se muestra como «sin dato».
- El KPI 3 usa los hitos con movimiento en el periodo; un viaje que empezó antes puede aparecer incompleto por estar a medias, y si la lectura se recorta (tarjeta «recortada») la cifra es parcial.
- El KPI 2 mide el retraso del propio sistema, no cuándo ocurrió el hecho físico; el retraso de entrega del mensaje del chofer se muestra aparte y no se mezcla.
- Hoy la tarjeta recibe solo la línea base de llamadas (KPI 4), que se guarda en la configuración del agente. Las demás líneas base (KPIs 1, 2, 3, 5 y 6) y las mediciones de los KPIs 5 y 6 se aceptan en el cálculo (`piloto`), pero `page.tsx` todavía no las alimenta: no tienen columna ni pantalla donde capturarlas (es parte de lo que se acuerde con el cliente). Mientras tanto la tarjeta muestra esos KPIs como «sin dato».

**Fechas del piloto.** En blanco hasta recibirlas del cliente; las fechas autogeneradas de los resúmenes no valen.

| Concepto | Valor |
|---|---|
| Fecha de arranque del piloto | _(pendiente del cliente)_ |
| Fecha de la primera revisión de avance | _(pendiente del cliente)_ |
| Voluntarios del piloto | _(pendiente del cliente; tope por flota en `piloto_max_voluntarios`)_ |
| Patios críticos | _(pendiente del cliente)_ |
| Cohorte «sin tableta» | _(pendiente; la mapean el coordinador y monitoreo del cliente)_ |
