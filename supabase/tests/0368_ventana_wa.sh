#!/usr/bin/env bash
# 0368 — la ventana de 24 h de WhatsApp contra un Postgres REAL con la migración
# aplicada. Cubre: normalización 521→52, ventana abierta/cerrada/desconocida,
# frontera de 24 h exactas, desorden (la hora solo avanza), duplicados
# idempotentes, hora futura recortada, teléfono inválido, concurrencia, permisos
# (solo service_role) y la retención.
set -euo pipefail

pg_host=${1:?uso: 0368_ventana_wa.sh HOST PORT DB}
pg_port=${2:?uso: 0368_ventana_wa.sh HOST PORT DB}
pg_db=${3:?uso: 0368_ventana_wa.sh HOST PORT DB}
psql_cmd=(psql -h "$pg_host" -p "$pg_port" -d "$pg_db" -X -v ON_ERROR_STOP=1 -Atq)
fallos=0
q() { "${psql_cmd[@]}" -c "$1"; }
espera() { # espera "descripción" "esperado" "SQL"
  local obtenido; obtenido=$(q "$3")
  if [ "$obtenido" = "$2" ]; then echo "ok   $1"; else echo "FALLA $1: esperaba [$2], obtuve [$obtenido]"; fallos=$((fallos+1)); fi
}
cleanup() { q "delete from public.wa_ventana_contacto where telefono like '5299936%'" >/dev/null 2>&1 || true; q "delete from public.wa_envio_registro where contexto like 'prueba0368%'" >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup

espera "521+10 se normaliza a 52+10"      "529993600001" "select public.wa_normalizar_telefono('+52 1 (999) 360-0001')"
espera "52+10 se queda igual"             "529993600001" "select public.wa_normalizar_telefono('529993600001')"
espera "otra lada no se toca"             "14155550100"  "select public.wa_normalizar_telefono('+1 415 555 0100')"

espera "sin fila = desconocida"           "desconocida"  "select estado from public.ventana_estado_wa('529993600001')"
espera "ventana_abierta sin fila = false" "f"            "select public.ventana_abierta('529993600001')"

q "select public.registrar_entrante_wa('5219993600001', now() - interval '2 hours', 'wamid.A')" >/dev/null
espera "entrante hace 2 h = abierta (y el 521 coincide con el 52)" "abierta" "select estado from public.ventana_estado_wa('529993600001')"
espera "ventana_abierta = true"           "t"            "select public.ventana_abierta('5219993600001')"

# Frontera: 24 h EXACTAS = cerrada; un segundo menos = abierta.
q "select public.registrar_entrante_wa('529993600002', now() - interval '24 hours', 'wamid.B')" >/dev/null
espera "24 h exactas = cerrada"           "cerrada" "select estado from public.ventana_estado_wa('529993600002', (select ultimo_entrante_en from public.wa_ventana_contacto where telefono='529993600002') + interval '24 hours')"
espera "23 h 59 min 59 s = abierta"       "abierta" "select estado from public.ventana_estado_wa('529993600002', (select ultimo_entrante_en from public.wa_ventana_contacto where telefono='529993600002') + interval '23:59:59')"
espera "a las 25 h = cerrada"             "cerrada" "select estado from public.ventana_estado_wa('529993600002', (select ultimo_entrante_en from public.wa_ventana_contacto where telefono='529993600002') + interval '25 hours')"

# Desorden: un mensaje VIEJO llegando después de uno nuevo no retrocede la ventana.
q "select public.registrar_entrante_wa('529993600003', now() - interval '1 hour', 'wamid.NUEVO')" >/dev/null
q "select public.registrar_entrante_wa('529993600003', now() - interval '30 hours', 'wamid.VIEJO')" >/dev/null
espera "fuera de orden: gana el más reciente"  "wamid.NUEVO" "select ultimo_wamid from public.wa_ventana_contacto where telefono='529993600003'"
espera "fuera de orden: sigue abierta"         "abierta"     "select estado from public.ventana_estado_wa('529993600003')"

# Duplicado: el mismo mensaje reentregado no cambia nada.
antes=$(q "select ultimo_entrante_en from public.wa_ventana_contacto where telefono='529993600003'")
q "select public.registrar_entrante_wa('529993600003', '$antes', 'wamid.NUEVO')" >/dev/null
espera "duplicado idempotente (misma hora)"    "$antes" "select ultimo_entrante_en from public.wa_ventana_contacto where telefono='529993600003'"
espera "una sola fila por contacto"            "1" "select count(*) from public.wa_ventana_contacto where telefono='529993600003'"

# Hostil: una hora futura no alarga la ventana (se recorta al reloj de la base).
q "select public.registrar_entrante_wa('529993600004', now() + interval '10 days', 'wamid.FUTURO')" >/dev/null
espera "hora futura recortada a ahora"         "t" "select ultimo_entrante_en <= now() from public.wa_ventana_contacto where telefono='529993600004'"
espera "…y expira como máximo en 24 h"         "t" "select expira_en <= now() + interval '24 hours' from public.ventana_estado_wa('529993600004')"
q "select public.registrar_entrante_wa('529993600005', null, null)" >/dev/null
espera "p_en nulo = ahora"                     "abierta" "select estado from public.ventana_estado_wa('529993600005')"

# Teléfono inválido: falla cerrado, sin fila.
if q "select public.registrar_entrante_wa('abc', now(), null)" >/dev/null 2>&1; then echo "FALLA teléfono inválido aceptado"; fallos=$((fallos+1)); else echo "ok   teléfono inválido rechazado"; fi
if q "select public.registrar_entrante_wa('', now(), null)" >/dev/null 2>&1; then echo "FALLA teléfono vacío aceptado"; fallos=$((fallos+1)); else echo "ok   teléfono vacío rechazado"; fi
espera "teléfono basura = desconocida (no truena)" "desconocida" "select estado from public.ventana_estado_wa('no-es-telefono')"

# Concurrencia: 20 sesiones registrando el MISMO contacto con horas distintas;
# gana la más reciente y queda UNA fila.
for i in $(seq 1 20); do
  "${psql_cmd[@]}" -c "select public.registrar_entrante_wa('529993600006', now() - interval '$((i+60)) minutes', 'wamid.C$i')" >/dev/null &
done
wait
espera "concurrencia: una fila"                "1" "select count(*) from public.wa_ventana_contacto where telefono='529993600006'"
espera "concurrencia: gana la hora más reciente (i=1)" "wamid.C1" "select ultimo_wamid from public.wa_ventana_contacto where telefono='529993600006'"

# Permisos: solo service_role.
espera "anon no ejecuta registrar_entrante_wa" "f" "select has_function_privilege('anon','public.registrar_entrante_wa(text,timestamptz,text)','execute')"
espera "authenticated no ejecuta ventana_abierta" "f" "select has_function_privilege('authenticated','public.ventana_abierta(text,timestamptz)','execute')"
espera "service_role sí ejecuta ventana_estado_wa" "t" "select has_function_privilege('service_role','public.ventana_estado_wa(text,timestamptz)','execute')"
espera "authenticated no lee wa_ventana_contacto" "f" "select has_table_privilege('authenticated','public.wa_ventana_contacto','select')"
espera "RLS activada en wa_ventana_contacto" "t" "select relrowsecurity from pg_class where oid='public.wa_ventana_contacto'::regclass"
espera "RLS activada en wa_envio_registro" "t" "select relrowsecurity from pg_class where oid='public.wa_envio_registro'::regclass"

# Retención de la ventana: solo lo viejo (>= 2 días), nunca una ventana viva.
q "update public.wa_ventana_contacto set ultimo_entrante_en = now() - interval '30 days' where telefono='529993600003'"
espera "purga de ventanas borra solo las viejas" "t" "select public.purgar_wa_ventana_contacto(7, 100) >= 1"
espera "…la vieja ya no está"  "0" "select count(*) from public.wa_ventana_contacto where telefono='529993600003'"
espera "…las vivas siguen"     "1" "select count(*) from public.wa_ventana_contacto where telefono='529993600001'"
if q "select public.purgar_wa_ventana_contacto(1, 100)" >/dev/null 2>&1; then echo "FALLA purga de 1 día aceptada"; fallos=$((fallos+1)); else echo "ok   purga de ventanas con menos de 2 días rechazada"; fi

# Registro de decisiones: restricciones y retención.
q "insert into public.wa_envio_registro(contexto,contacto_ult4,ventana,canal,motivo,ok) values ('prueba0368 vieja','0001','cerrada','plantilla','ventana_cerrada',true)"
q "update public.wa_envio_registro set creado_en = now() - interval '200 days' where contexto='prueba0368 vieja'"
q "insert into public.wa_envio_registro(contexto,contacto_ult4,ventana,canal,motivo,ok) values ('prueba0368 nueva','0002','abierta','texto','ventana_abierta',true)"
if q "insert into public.wa_envio_registro(contexto,ventana,canal,motivo,ok) values ('prueba0368 mala','rara','texto','x',true)" >/dev/null 2>&1; then echo "FALLA ventana inválida aceptada"; fallos=$((fallos+1)); else echo "ok   ventana inválida rechazada"; fi
if q "insert into public.wa_envio_registro(contexto,contacto_ult4,ventana,canal,motivo,ok) values ('prueba0368 tel','529993600001','abierta','texto','x',true)" >/dev/null 2>&1; then echo "FALLA teléfono completo aceptado en el registro"; fallos=$((fallos+1)); else echo "ok   el registro no admite teléfono completo"; fi
espera "purga borra solo lo viejo" "1" "select public.purgar_wa_envio_registro(90, 100)"
espera "queda la reciente" "1" "select count(*) from public.wa_envio_registro where contexto like 'prueba0368%'"
if q "select public.purgar_wa_envio_registro(1, 100)" >/dev/null 2>&1; then echo "FALLA purga de 1 día aceptada"; fallos=$((fallos+1)); else echo "ok   purga con parámetros peligrosos rechazada"; fi

if [ "$fallos" -ne 0 ]; then echo "$fallos prueba(s) fallaron"; exit 1; fi
echo "0368: todas las pruebas pasaron"
