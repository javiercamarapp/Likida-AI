#!/usr/bin/env bash
# Prueba PostgreSQL real de la carrera que Vitest no puede simular: varias sesiones llaman a cp_envio_reclamar
# AL MISMO TIEMPO (cada una conserva su transacción abierta un segundo) y ninguna fila se entrega dos veces.
# Datos sintéticos; limpia lo que crea.
set -euo pipefail

host="${1:?uso: $0 HOST PORT DB}"
port="${2:?uso: $0 HOST PORT DB}"
database="${3:?uso: $0 HOST PORT DB}"
tenant='79000000-0000-4000-8000-0000000000f1'
psql_cmd=(psql -h "$host" -p "$port" -d "$database" -X -v ON_ERROR_STOP=1 -q -At)
tmp="$(mktemp -d)"

limpiar() {
  "${psql_cmd[@]}" -c "delete from public.tenant where id = '$tenant';" >/dev/null || true
  rm -rf "$tmp"
}
trap limpiar EXIT

limpiar_previo() { "${psql_cmd[@]}" -c "delete from public.tenant where id = '$tenant';" >/dev/null; }
limpiar_previo

"${psql_cmd[@]}" -c "
  insert into public.tenant (id, nombre) values ('$tenant', 'Flota concurrencia 0790');
  insert into public.cp_documento (tenant_id, canal, formato, nombre_archivo, bytes, sha256)
    select '$tenant', 'manual', 'excel', 'c' || g || '.xlsx', 1000, md5('0790a' || g) || md5('0790b' || g)
      from generate_series(1, 20) g;
  insert into public.cp_envio_tms (tenant_id, documento_id, version_doc, idempotency_key)
    select '$tenant', d.id, 1, 'concurrente-' || row_number() over ()
      from public.cp_documento d where d.tenant_id = '$tenant';
"

# Cinco sesiones a la vez: cada una reclama hasta 20 y retiene su transacción un segundo.
for i in 1 2 3 4 5; do
  "${psql_cmd[@]}" -c "begin; select e.id from public.cp_envio_reclamar(20) e where e.tenant_id = '$tenant'; select pg_sleep(1); commit;" > "$tmp/s$i.txt" &
done
wait

cat "$tmp"/s*.txt | grep -E '^[0-9a-f-]{36}$' | sort > "$tmp/todos.txt" || true
total=$(wc -l < "$tmp/todos.txt" | tr -d ' ')
unicos=$(sort -u "$tmp/todos.txt" | wc -l | tr -d ' ')
echo "reclamados=$total unicos=$unicos"
# Ninguna fila repetida entre sesiones, y como mucho las 20 existentes.
test "$total" = "$unicos"
test "$total" -le 20
# Lo que no reclamó una sesión lo reclamó otra o sigue libre: nada quedó a medias (todo reclamado lleva 1 intento).
"${psql_cmd[@]}" -c "do \$\$ begin if exists (select 1 from public.cp_envio_tms where tenant_id='$tenant' and intentos > 1) then raise exception 'una fila se reclamó dos veces'; end if; end \$\$;"
echo "OK 0790 concurrencia"
