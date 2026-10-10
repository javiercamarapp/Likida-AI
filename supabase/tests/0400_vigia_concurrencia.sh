#!/usr/bin/env bash
# Sesiones reales compiten por la ingesta del Vigía (0400). Lo que solo la base
# puede demostrar con carreras de verdad:
#   A. el MISMO wamid entregado por 8 sesiones a la vez (Meta reentrega) es UN
#      mensaje y todas las demás ven duplicado = true;
#   B. 6 sesiones mandando mensajes DISTINTOS del mismo cliente: ninguno se pierde
#      y el contador de insistencia es exacto (el lock por contacto serializa);
#   C. la PRIMERA aparición de un cliente (todavía sin conversación) desde 8
#      sesiones a la vez abre UNA sola conversación activa;
#   D. 6 sesiones redactando respuesta del agente al MISMO entrante: gana UNA.
# Exclusivo PostgreSQL desechable; UUIDs y objetos sintéticos propios.
set -euo pipefail
host="${1:?uso: $0 HOST PORT DB}"
port="${2:?uso: $0 HOST PORT DB}"
database="${3:?uso: $0 HOST PORT DB}"
tenant='40000000-0000-4000-8000-0000000c0001'
cliente='40000000-0000-4000-8000-0000000c0002'
contacto_a='40000000-0000-4000-8000-0000000c0011'
contacto_b='40000000-0000-4000-8000-0000000c0012'
psql_cmd=(psql -h "$host" -p "$port" -d "$database" -X -v ON_ERROR_STOP=1 -qAt)
work="$(mktemp -d)"
limpiar() {
  "${psql_cmd[@]}" -c "delete from public.tenant where id='$tenant';" >/dev/null 2>&1 || true
  rm -rf "$work"
}
[[ "$("${psql_cmd[@]}" -c "select count(*) from public.tenant where id='$tenant';")" = 0 ]] || { echo 'Fixture0400 ya existe; no tocar datos ajenos.'; exit 1; }
trap limpiar EXIT
"${psql_cmd[@]}" <<SQL
insert into public.tenant(id,nombre) values('$tenant','Vigía 0400 concurrencia');
insert into public.cliente(id,tenant_id,nombre) values('$cliente','$tenant','Cliente concurrente');
insert into public.vigia_contacto(id,tenant_id,cliente_id,telefono,telefono_hash,consentimiento_en,consentimiento_origen) values
  ('$contacto_a','$tenant','$cliente','525500400001',repeat('a',64),now(),'alta_flota'),
  ('$contacto_b','$tenant','$cliente','525500400002',repeat('b',64),now(),'alta_flota');
SQL

recibir() { # contacto wamid
  "${psql_cmd[@]}" -c "select duplicado from public.vigia_recibir_mensaje('$tenant','$1','$2','texto','hola',now());"
}

# ── A. el mismo wamid desde 8 sesiones a la vez ──────────────────────────────
for n in $(seq 1 8); do ( for _ in $(seq 1 10); do recibir "$contacto_a" 'wamid.DUP'; done > "$work/a$n" ) & done; wait
dups="$(cat "$work"/a* | grep -c '^t$' || true)"
nuevos="$(cat "$work"/a* | grep -c '^f$' || true)"
[[ "$nuevos" = 1 ]] || { echo "0400 A: el mismo wamid entró $nuevos veces (debía ser 1)"; exit 1; }
[[ "$dups" = 79 ]] || { echo "0400 A: $dups duplicados reportados (debían ser 79)"; exit 1; }
[[ "$("${psql_cmd[@]}" -c "select count(*) from public.vigia_mensaje where tenant_id='$tenant' and wamid='wamid.DUP';")" = 1 ]] || { echo '0400 A: quedó más de un mensaje con el mismo wamid'; exit 1; }

# ── B. mensajes distintos del mismo cliente, 6 sesiones × 10 ─────────────────
for n in $(seq 1 6); do ( for i in $(seq 1 10); do recibir "$contacto_a" "wamid.B-$n-$i" >/dev/null; done ) & done; wait
total="$("${psql_cmd[@]}" -c "select count(*) from public.vigia_mensaje where tenant_id='$tenant' and conversacion_id in (select id from public.vigia_conversacion where contacto_id='$contacto_a') and direccion='entrante';")"
[[ "$total" = 61 ]] || { echo "0400 B: hay $total entrantes (debían ser 61: 1 + 60)"; exit 1; }
[[ "$("${psql_cmd[@]}" -c "select entradas_sin_respuesta from public.vigia_conversacion where contacto_id='$contacto_a' and estado='activa';")" = 61 ]] || { echo '0400 B: el contador de insistencia no es exacto'; exit 1; }
[[ "$("${psql_cmd[@]}" -c "select count(*) from public.vigia_conversacion where contacto_id='$contacto_a' and estado='activa';")" = 1 ]] || { echo '0400 B: hay más de una conversación activa'; exit 1; }

# ── C. la primera aparición de un cliente, 8 sesiones a la vez ───────────────
for n in $(seq 1 8); do ( recibir "$contacto_b" "wamid.C-$n" >/dev/null ) & done; wait
[[ "$("${psql_cmd[@]}" -c "select count(*) from public.vigia_conversacion where contacto_id='$contacto_b';")" = 1 ]] || { echo '0400 C: la carrera abrió más de una conversación'; exit 1; }
[[ "$("${psql_cmd[@]}" -c "select entradas_sin_respuesta from public.vigia_conversacion where contacto_id='$contacto_b';")" = 8 ]] || { echo '0400 C: se perdió un entrante en la carrera'; exit 1; }

# ── D. una sola respuesta del agente por entrante, 6 sesiones ────────────────
read -r conv entrante < <("${psql_cmd[@]}" -F ' ' -c "select conversacion_id, id from public.vigia_mensaje where tenant_id='$tenant' and wamid='wamid.DUP';")
for n in $(seq 1 6); do
  ( "${psql_cmd[@]}" -c "insert into public.vigia_mensaje(tenant_id,conversacion_id,direccion,autor,texto,estado,respuesta_a) values('$tenant','$conv','saliente','agente','borrador $n','pendiente_aprobacion','$entrante');" >/dev/null 2>&1 && echo ok > "$work/d$n" || echo no > "$work/d$n" ) &
done; wait
ganadoras="$(cat "$work"/d* | grep -c '^ok$' || true)"
[[ "$ganadoras" = 1 ]] || { echo "0400 D: $ganadoras sesiones redactaron respuesta al mismo entrante (debía ser 1)"; exit 1; }
echo "0400_vigia_concurrencia PASS: dedupe por wamid (1 de 80), insistencia exacta (61), una conversación por carrera (8 entrantes), una respuesta por entrante."
