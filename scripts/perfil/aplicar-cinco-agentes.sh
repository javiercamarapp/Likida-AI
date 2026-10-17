#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# Aplica el perfil `cinco_agentes` (mig. 0770) a UNA flota.
#
#   DATABASE_URL="postgres://..." scripts/perfil/aplicar-cinco-agentes.sh [--produccion] <UUID-del-tenant>
#   DATABASE_URL="postgres://..." scripts/perfil/aplicar-cinco-agentes.sh --verificar <UUID>   # solo lee, no escribe
#   scripts/perfil/aplicar-cinco-agentes.sh --env-file <ruta> [--produccion] <UUID>             # DATABASE_URL leído del archivo
#
# SEGURIDAD: contra un host que no sea local (127.0.0.1 / localhost / ::1) el script se NIEGA, salvo --produccion
# más una confirmación interactiva (escribir el UUID). Antes de cambiar nada escribe el estado previo de la flota en
# ~/likida-respaldos/perfil/<fecha>-<tenant>.json y al final imprime el comando EXACTO de reversa. No imprime la URL
# (solo el host).
#
# QUÉ HACE, en UNA transacción (todo o nada):
#   1. inserta (o actualiza) la fila de `tenant_perfil` con perfil = cinco_agentes;
#   2. apaga en `interruptor_tenant` los pipelines `ocr` y `cuadre` de esa flota, con motivo
#      (el código ya los trata como apagados bajo el perfil; la fila deja la palanca VISIBLE en /admin);
#   3. pone (o corrige) `liquidacion_correo_config.canal = 'correo'` y `activa = true` para esa flota —
#      DECISIÓN DE PRODUCTO: bajo este perfil, A1 (liquidación) es SIEMPRE por correo, nunca por WhatsApp (hallazgo
#      de la revisión adversarial de oct-2026: sin esta fila explícita, el código caía al default de siempre y
#      mandaba por WhatsApp). Solo se tocan las columnas `canal`/`activa`/`actualizado_en`/`actualizado_por`: si la
#      flota ya tenía remitente, destinatarios de RH u otras reglas de correo configuradas, se CONSERVAN. Esto es
#      defensa en profundidad junto con el default de `canalDeEntregaPorOmision` en
#      `src/lib/likida/liquidacion_externa/servicio.ts` (código Y configuración, no solo uno);
#   4. imprime el estado final.
#
# Requiere, además de la migración 0770, la 0785 (tabla `liquidacion_correo_config`) ya aplicada: si falta, el
# paso 3 falla y la transacción entera se revierte (no hay estado a medias: ni el perfil ni los interruptores
# quedan puestos sin la fila de correo).
#
# QUÉ NO HACE: no toca ninguna otra flota, no borra datos, no cambia usuarios ni llaves. Revertir:
# scripts/perfil/revertir-cinco-agentes.sh. Este script NO se ejecuta solo: lo corre quien opera la
# plataforma, contra la base que corresponda, DESPUÉS de aplicar las migraciones 0770 y 0785 en esa base.
# ═══════════════════════════════════════════════════════════════════════════
set -euo pipefail
# shellcheck source=scripts/perfil/_comun-cinco-agentes.sh
. "$(dirname "$0")/_comun-cinco-agentes.sh"

SOLO_VERIFICAR=0
PRODUCCION=0
ENV_FILE=""
TENANT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --verificar) SOLO_VERIFICAR=1 ;;
    --produccion) PRODUCCION=1 ;;
    --env-file) shift; ENV_FILE="${1:-}"; [ -n "$ENV_FILE" ] || perfil_uso_error "❌ --env-file pide una ruta." ;;
    -*) perfil_uso_error "❌ Opción desconocida: $1" ;;
    *) [ -z "$TENANT" ] || perfil_uso_error "❌ Sobra el argumento: $1"; TENANT="$1" ;;
  esac
  shift
done
if [ -z "$TENANT" ]; then
  echo "Uso: DATABASE_URL=... $0 [--verificar] [--produccion] [--env-file RUTA] <UUID-del-tenant>" >&2
  exit 2
fi
# El UUID entra a SQL: solo se acepta con la forma exacta de un UUID (nada de comillas ni espacios).
perfil_validar_uuid "$TENANT"
if [ -n "$ENV_FILE" ]; then perfil_cargar_env_file "$ENV_FILE"; fi
perfil_requerir_db

# Guardia ANTES de tocar la base (incluso de leerla en modo escritura): host no local => se niega sin --produccion.
if [ "$SOLO_VERIFICAR" = "0" ]; then
  perfil_guardia_host "$PRODUCCION" "$TENANT" "APLICAR el perfil cinco_agentes"
fi

MOTIVO="Perfil cinco_agentes: la lectura de comprobantes y el cierre por WhatsApp no se usan en esta flota"

if [ "$SOLO_VERIFICAR" = "1" ]; then
  psql "$DB" -v ON_ERROR_STOP=1 -v tenant="$TENANT" <<'SQL'
select 'tenant' as que, id::text as valor, nombre from public.tenant where id = :'tenant';
select 'perfil' as que, perfil as valor, cambiado_en::text from public.tenant_perfil where tenant_id = :'tenant';
select 'pipeline' as que, pipeline as valor, case when apagado then 'APAGADO' else 'encendido' end as estado
  from public.interruptor_tenant where tenant_id = :'tenant' order by pipeline;
SQL
  # Consulta aparte y SIN ON_ERROR_STOP: la 0785 (liquidacion_correo_config) es una migración distinta de la 0770, y
  # --verificar debe seguir funcionando (mostrando las otras dos tablas) aunque esa todavía no esté aplicada.
  if ! psql "$DB" -v tenant="$TENANT" <<'SQL'
select 'correo' as que, canal as valor, activa::text as estado
  from public.liquidacion_correo_config where tenant_id = :'tenant';
SQL
  then
    echo "(sin la migración 0785: liquidacion_correo_config no existe todavía — aplicarla ANTES de aplicar este perfil)"
  fi
  exit 0
fi

# La flota tiene que existir (psql no interpola variables dentro de un bloque DO, así que se comprueba aquí).
EXISTE="$(psql "$DB" -v ON_ERROR_STOP=1 -v tenant="$TENANT" -tA <<'SQL'
select count(*) from public.tenant where id = :'tenant'::uuid;
SQL
)"
if [ "$EXISTE" != "1" ]; then
  echo "❌ La flota $TENANT no existe en esta base." >&2
  exit 3
fi

# La 0785 es requisito (paso 3 de este script): un error claro aquí, no uno críptico de psql a medio transacción.
TIENE_TABLA_CORREO="$(psql "$DB" -X -v ON_ERROR_STOP=1 -tA <<'SQL'
select to_regclass('public.liquidacion_correo_config') is not null;
SQL
)"
if [ "$TIENE_TABLA_CORREO" != "t" ]; then
  echo "❌ Falta la migración 0785 (tabla liquidacion_correo_config) en esta base. Aplícala antes de aplicar este perfil: sin ella A1 no puede quedar en canal 'correo' y este script se niega a dejar el perfil puesto sin esa fila." >&2
  exit 7
fi

# Revertir solo borra las filas ocr/cuadre cuyo motivo empieza con «Perfil cinco_agentes». Si la flota ya tenía un ocr/cuadre
# propio (otro motivo), aplicar lo sobrescribiría y revertir no lo restauraría: se rehúsa antes de cambiar nada.
AJENAS="$(psql "$DB" -X -v ON_ERROR_STOP=1 -v tenant="$TENANT" -tA <<'SQL'
select count(*) from public.interruptor_tenant
 where tenant_id = :'tenant'::uuid and pipeline in ('ocr', 'cuadre') and coalesce(motivo, '') not like 'Perfil cinco_agentes%';
SQL
)"
if [ "$AJENAS" != "0" ]; then
  echo "❌ La flota $TENANT ya tiene $AJENAS interruptor(es) ocr/cuadre propios (motivo distinto de «Perfil cinco_agentes»). Aplicar los sobrescribiría y revertir no los restauraría. No se cambió nada; decide a mano (el estado actual se ve con --verificar)." >&2
  exit 6
fi

perfil_respaldar "$TENANT"
HUELLA_ANTES="$(perfil_huella "$TENANT")"

psql "$DB" -v ON_ERROR_STOP=1 -v tenant="$TENANT" -v motivo="$MOTIVO" <<'SQL'
begin;

insert into public.tenant_perfil (tenant_id, perfil, cambiado_por, cambiado_en)
values (:'tenant'::uuid, 'cinco_agentes', null, now())
on conflict (tenant_id) do update
  set perfil = excluded.perfil, cambiado_por = null, cambiado_en = now();

insert into public.interruptor_tenant (tenant_id, pipeline, apagado, motivo, cambiado_por, cambiado_en)
select :'tenant'::uuid, p, true, :'motivo', null, now()
  from unnest(array['ocr', 'cuadre']) as p
on conflict (tenant_id, pipeline) do update
  set apagado = true, motivo = excluded.motivo, cambiado_por = null, cambiado_en = now();

-- A1 (liquidación) SIEMPRE por correo bajo este perfil, nunca WhatsApp: solo se tocan canal/activa/actualizado_*,
-- así que remitente, destinatarios de RH y demás reglas de correo que la flota ya tuviera configuradas se conservan.
insert into public.liquidacion_correo_config (tenant_id, canal, activa, actualizado_en, actualizado_por)
values (:'tenant'::uuid, 'correo', true, now(), null)
on conflict (tenant_id) do update
  set canal = 'correo', activa = true, actualizado_en = now(), actualizado_por = null;

select 'perfil' as que, perfil as valor, cambiado_en::text from public.tenant_perfil where tenant_id = :'tenant'::uuid;
select 'pipeline' as que, pipeline as valor, case when apagado then 'APAGADO' else 'encendido' end as estado
  from public.interruptor_tenant where tenant_id = :'tenant'::uuid order by pipeline;
select 'correo' as que, canal as valor, activa::text as estado
  from public.liquidacion_correo_config where tenant_id = :'tenant'::uuid;

commit;
SQL
echo "huella antes=$HUELLA_ANTES despues=$(perfil_huella "$TENANT")"
echo "✔ Perfil cinco_agentes aplicado. Se nota en la app en menos de un minuto (caché de 30 s)."
if [ -n "$ENV_FILE" ]; then ARG_ENV="--env-file $ENV_FILE"; else ARG_ENV=""; fi
if [ "$PRODUCCION" = "1" ]; then ARG_PROD=" --produccion"; else ARG_PROD=""; fi
if [ -n "$ARG_ENV" ]; then PREFIJO=""; else PREFIJO='DATABASE_URL="$DATABASE_URL" '; fi
echo "Para REVERTIR (comando exacto):"
echo "  ${PREFIJO}scripts/perfil/revertir-cinco-agentes.sh${ARG_PROD}${ARG_ENV:+ $ARG_ENV} $TENANT"
echo "Para VERIFICAR:"
echo "  ${PREFIJO}scripts/perfil/verificar-cinco-agentes.sh${ARG_PROD}${ARG_ENV:+ $ARG_ENV} $TENANT"
