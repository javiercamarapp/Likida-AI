#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# ENSAYO DE RESTAURACION DE LIKIDA AI EN UN PROYECTO SUPABASE DESECHABLE.
#
# Lo corre el DUEÑO (Javier), nunca un agente. Procedimiento y criterios:
# docs/operacion/ensayo-restauracion.md
#
# QUE HACE (todo contra el proyecto DESECHABLE; contra produccion solo SELECT):
#   1. Localiza el ultimo respaldo cifrado de scripts/respaldo.sh
#      (~/likida-respaldos/base/likida-*.sql.age: volcado SOLO DE DATOS, INSERTs,
#      producido por `supabase db dump --data-only` y cifrado con `age`).
#   2. Lo descifra en un directorio temporal (umask 077, se borra al salir).
#   3. Crea el esquema aplicando supabase/migrations/*.sql una por una con
#      `supabase db query --linked` (API de gestion: NO usa contraseña de base,
#      asi que no hay ECIRCUITBREAKER del pooler). El volcado no trae esquema.
#   4. Vacia las tablas de public del desechable y carga los datos en trozos.
#   5. Corrige privilegios (REVOKE ALL en public y reaplica los GRANT que se
#      leen de produccion en solo lectura), porque un proyecto nuevo trae
#      default privileges que dejan a anon con permisos de mas.
#   6. Verifica y mide: filas por tabla (contra el propio volcado), esquema,
#      RLS, politicas, migraciones, privilegios, Storage (integridad), edad del
#      respaldo (RPO) y tiempos por fase (RTO). Imprime PASA/FALLA/AVISO.
#
# QUE NO HACE: no toca produccion salvo SELECT de catalogo y conteos; no maneja
# contraseñas ni llaves (el CLI usa su propio login: `supabase login`); no
# restaura auth.users si el volcado no la trae; no sube archivos al Storage del
# desechable; no cubre PITR ni la restauracion fisica de Supabase.
#
# VARIABLES DE ENTORNO
#   REF_DESECHABLE          (obligatoria) ref de 20 caracteres del proyecto desechable
#   CONFIRMO_DESECHABLE=SI  (obligatoria) confirmacion explicita
#   RESPALDO_AGE_IDENTITY   (obligatoria) ruta del archivo de identidad PRIVADA de age
#   RESPALDO_DIR            carpeta de respaldos (por omision ~/likida-respaldos/base)
#   RESPALDO_ARCHIVO        ruta exacta de un .sql.age (si no, el mas reciente)
#   STORAGE_BACKUP          carpeta de respaldo-storage.sh (con MANIFIESTO.json); opcional
#   SIN_PROD=SI             no leer produccion (se omiten comparaciones contra prod)
#   RTO_OBJETIVO_MIN        objetivo de RTO medido en minutos (por omision 90)
#   TROZO_BYTES             tamaño maximo de cada trozo de datos (por omision 900000)
#   OMITIR_VERIFICACION_NOMBRE=SI  no exigir "ensayo"/"desechable" en el nombre del proyecto
#
# Aborta en el primer fallo. Reintentable: las migraciones ya aplicadas se
# saltan (registro en supabase_migrations.schema_migrations del desechable) y
# los datos se vacian y recargan completos.
# ════════════════════════════════════════════════════════════════════════════
set -u
set -o pipefail
umask 077

PROD_REF="gngoqsvrxdguxvsizpbw"
RAIZ="$(cd "$(dirname "$0")/.." && pwd -P)"
W=""

# ─── Ayudante Python (se escribe a disco bajo demanda) ──────────────────────
escribir_ayudante() {
  cat > "$1" <<'PY'
import csv, json, os, re, sys

def cargar_json_cli(ruta):
    txt = open(ruta, encoding='utf-8', errors='replace').read()
    dec = json.JSONDecoder()
    for i, ch in enumerate(txt):
        if ch in '[{':
            try:
                obj, _ = dec.raw_decode(txt[i:])
                return obj
            except ValueError:
                continue
    raise SystemExit('la salida del CLI no trae JSON')

def filas_de(obj):
    mejor = []
    def rec(o):
        nonlocal mejor
        if isinstance(o, list):
            if o and all(isinstance(x, dict) for x in o) and len(o) > len(mejor):
                mejor = o
            for x in o:
                rec(x)
        elif isinstance(o, dict):
            for v in o.values():
                rec(v)
    rec(obj)
    return mejor

def celda(v):
    if v is None:
        return ''
    if v is True:
        return 't'
    if v is False:
        return 'f'
    return str(v).replace('\t', ' ').replace('\r', ' ').replace('\n', ' ')

def cmd_tsv(entrada, salida):
    filas = filas_de(cargar_json_cli(entrada))
    lineas = sorted('\t'.join(celda(v) for v in f.values()) for f in filas)
    with open(salida, 'w', encoding='utf-8') as fh:
        for l in lineas:
            fh.write(l + '\n')
    print(len(lineas))

def leer_tsv(ruta):
    with open(ruta, encoding='utf-8') as fh:
        return [l.rstrip('\n') for l in fh if l.strip() != '']

PAT = re.compile(r"""
 (?P<esc>(?<![\w$])[Ee]'(?:[^'\\]+|\\.|'')*')
|(?P<sq>'(?:[^']+|'')*')
|(?P<dq>"(?:[^"]+|"")*")
|(?P<lc>--[^\n]*)
|(?P<bc>/\*.*?\*/)
|(?P<dol0>\$\$.*?\$\$)
|(?P<dol>\$(?P<tag>[A-Za-z_]\w*)\$.*?\$(?P=tag)\$)
|(?P<sem>;)
|(?P<op>\()
|(?P<cl>\))
|(?P<val>(?<![\w$"])VALUES(?![\w$"]))
""", re.S | re.X)

CAB = re.compile(r'^INSERT\s+INTO\s+((?:"[^"]+"|\w+)(?:\s*\.\s*(?:"[^"]+"|\w+))?)', re.I)
DESCARTAR = re.compile(r'^(SET\s|RESET\s|SELECT\s+pg_catalog\.set_config|ALTER\s+TABLE\s.*\b(DISABLE|ENABLE)\s+TRIGGER)', re.I | re.S)

def quitar_comentarios_iniciales(s):
    s = s.lstrip()
    while s.startswith('--'):
        nl = s.find('\n')
        if nl < 0:
            return ''
        s = s[nl + 1:].lstrip()
    return s

def normaliza_nombre(n):
    partes = [p.strip().strip('"') for p in re.split(r'\.', n)]
    if len(partes) == 1:
        partes = ['public'] + partes
    return '.'.join(partes)

def cmd_split(volcado, salida, maxb):
    maxb = int(maxb)
    os.makedirs(salida, exist_ok=True)
    texto = open(volcado, encoding='utf-8', errors='surrogateescape').read()
    huellas, esquemas = {}, set()
    info = {'inserts': 0, 'filas_total': 0, 'copy': 0, 'otros': 0, 'descartados': 0, 'sin_cerrar': False}
    cabecera = 'set session_replication_role = replica;\n'
    buf, tam, n_trozo = [], 0, 0

    def volcar():
        nonlocal buf, tam, n_trozo
        if not buf:
            return
        n_trozo += 1
        with open(os.path.join(salida, 'trozo-%05d.sql' % n_trozo), 'w', encoding='utf-8', errors='surrogateescape') as fh:
            fh.write(cabecera)
            fh.write(''.join(buf))
        buf, tam = [], 0

    inicio, prof, valpos, filas = 0, 0, None, 0
    for m in PAT.finditer(texto):
        k = m.lastgroup
        if k == 'val':
            if valpos is None and prof == 0:
                valpos = m.start() - inicio
        elif k == 'op':
            prof += 1
            if valpos is not None and prof == 1:
                filas += 1
        elif k == 'cl':
            prof -= 1
        elif k == 'sem' and prof == 0:
            fin = m.end()
            crudo = texto[inicio:fin]
            limpio = quitar_comentarios_iniciales(crudo)
            desfase = len(crudo) - len(limpio)
            vp = None if valpos is None else valpos - desfase
            if limpio:
                if re.match(r'^COPY\s', limpio, re.I):
                    info['copy'] += 1
                elif DESCARTAR.match(limpio):
                    info['descartados'] += 1
                else:
                    cab = CAB.match(limpio)
                    if cab and vp is not None and vp > 0:
                        nombre = normaliza_nombre(cab.group(1))
                        esquemas.add(nombre.split('.')[0])
                        huellas[nombre] = huellas.get(nombre, 0) + filas
                        info['inserts'] += 1
                        info['filas_total'] += filas
                        if 'OVERRIDING' not in limpio[:vp].upper():
                            limpio = limpio[:vp] + 'OVERRIDING SYSTEM VALUE ' + limpio[vp:]
                    else:
                        info['otros'] += 1
                    buf.append(limpio + '\n')
                    tam += len(limpio) + 1
                    if tam >= maxb:
                        volcar()
            inicio, valpos, filas = fin, None, 0
    volcar()
    resto = quitar_comentarios_iniciales(texto[inicio:])
    info['sin_cerrar'] = bool(resto.strip())
    info['esquemas'] = sorted(esquemas)
    info['trozos'] = n_trozo
    info['tablas'] = len(huellas)
    json.dump(huellas, open(os.path.join(salida, 'huellas.json'), 'w'))
    json.dump(info, open(os.path.join(salida, 'info.json'), 'w'))
    print('%d trozos, %d tablas con filas, %d filas, %d sentencias INSERT, COPY=%d' % (n_trozo, len(huellas), info['filas_total'], info['inserts'], info['copy']))

def cmd_cmp_filas(huellas, dest_tsv, prod_tsv):
    h = json.load(open(huellas))
    dest = {}
    for l in leer_tsv(dest_tsv):
        t, _, n = l.partition('\t')
        dest[t] = int(n or 0)
    malas = []
    for t in sorted(dest):
        esperado = h.get(t, 0)
        if dest[t] != esperado:
            malas.append('%s respaldo=%d destino=%d' % (t, esperado, dest[t]))
    for t in sorted(h):
        if t.startswith('public.') and t not in dest:
            malas.append('%s respaldo=%d destino=SIN_TABLA' % (t, h[t]))
    total = sum(dest.values())
    print('%d tablas comparadas, %d filas en destino, %d con diferencia' % (len(dest), total, len(malas)))
    for x in malas[:25]:
        print('  DIF ' + x)
    if prod_tsv != '-':
        prod = {}
        for l in leer_tsv(prod_tsv):
            t, _, n = l.partition('\t')
            prod[t] = int(n or 0)
        dif = [(t, prod[t], dest.get(t, 0)) for t in sorted(prod) if prod[t] != dest.get(t, 0)]
        print('  INFO vs produccion en vivo: %d tablas con filas distintas (esperable: el respaldo es anterior)' % len(dif))
        for t, p, d in dif[:10]:
            print('  INFO %s prod=%d restaurado=%d' % (t, p, d))
    sys.exit(1 if malas else 0)

def cmd_cmp_simple(a, b, maximo='12'):
    A, B = set(leer_tsv(a)), set(leer_tsv(b))
    sa, sb = sorted(A - B), sorted(B - A)
    print('%d lineas en referencia, %d en destino, %d solo en referencia, %d solo en destino' % (len(A), len(B), len(sa), len(sb)))
    for x in sa[:int(maximo)]:
        print('  FALTA_EN_DESTINO ' + x)
    for x in sb[:int(maximo)]:
        print('  SOBRA_EN_DESTINO ' + x)
    sys.exit(1 if (sa or sb) else 0)

CLAVE = re.compile(r'^(\d{4}[a-z]?)(?:_|$)')

def clave_prod(version, nombre):
    if re.fullmatch(r'\d{4}[a-z]?', version or ''):
        return version
    m = CLAVE.match(nombre or '')
    return m.group(1) if m else None

def cmd_cmp_mig(carpeta, dest_tsv, prod_tsv):
    repo = set()
    for f in os.listdir(carpeta):
        m = re.match(r'^(\d{4}[a-z]?)_.*\.sql$', f)
        if m:
            repo.add(m.group(1))
    dest = set(l.split('\t')[0] for l in leer_tsv(dest_tsv))
    prod, sin_clave = set(), 0
    if prod_tsv != '-':
        for l in leer_tsv(prod_tsv):
            v, _, n = l.partition('\t')
            k = clave_prod(v, n)
            if k:
                prod.add(k)
            else:
                sin_clave += 1
    ok = (dest == repo)
    partes = ['repo=%d destino=%d ultima_destino=%s' % (len(repo), len(dest), max(dest) if dest else '-')]
    if prod_tsv != '-':
        partes.append('prod=%d ultima_prod=%s' % (len(prod), max(prod) if prod else '-'))
        sobra = sorted(dest - prod)
        if sobra:
            ok = False
            partes.append('en destino y NO en prod: %s' % ','.join(sobra[:10]))
        extra = sorted(prod - repo)
        if extra:
            partes.append('en prod sin archivo en repo: %s' % ','.join(extra[:10]))
    if dest != repo:
        partes.append('destino sin aplicar: %s' % ','.join(sorted(repo - dest)[:10]))
    print('; '.join(partes))
    sys.exit(0 if ok else 1)

def cmd_proyecto(entrada, ref):
    obj = cargar_json_cli(entrada)
    hallado = []
    def rec(o):
        if isinstance(o, dict):
            if ref in [str(v) for v in o.values()]:
                hallado.append(str(o.get('name', o.get('Name', ''))))
            for v in o.values():
                rec(v)
        elif isinstance(o, list):
            for x in o:
                rec(x)
    rec(obj)
    if not hallado:
        sys.exit(3)
    print(hallado[0])

def cmd_sql_acl(entrada, salida):
    lineas = leer_tsv(entrada)
    with open(salida, 'w', encoding='utf-8') as fh:
        for l in lineas:
            fh.write(l + '\n')
    print(len(lineas))

def cmd_edad(ruta):
    import time
    print(int((time.time() - os.path.getmtime(ruta)) / 60))

CMDS = {'tsv': (cmd_tsv, 2), 'split': (cmd_split, 3), 'cmp-filas': (cmd_cmp_filas, 3),
        'cmp-simple': (cmd_cmp_simple, None), 'cmp-mig': (cmd_cmp_mig, 3),
        'proyecto': (cmd_proyecto, 2), 'sql-acl': (cmd_sql_acl, 2), 'edad': (cmd_edad, 1)}

if __name__ == '__main__':
    if len(sys.argv) < 2 or sys.argv[1] not in CMDS:
        raise SystemExit('uso: ayudante.py <' + '|'.join(CMDS) + '> ...')
    fn, n = CMDS[sys.argv[1]]
    fn(*sys.argv[2:])
PY
}

# Modo de prueba: solo escribe el ayudante y sale (sin red, sin variables).
if [ "${1:-}" = "--solo-ayudante" ]; then
  [ -n "${2:-}" ] || { echo "uso: $0 --solo-ayudante RUTA.py" >&2; exit 2; }
  escribir_ayudante "$2"
  exit 0
fi

# ─── Salvaguardas (antes de tocar nada) ─────────────────────────────────────
die() { echo "ERROR: $*" >&2; exit 1; }

REF="${REF_DESECHABLE:-}"
[ -n "$REF" ] || die "falta REF_DESECHABLE (ref de 20 caracteres del proyecto desechable)."
[ "$REF" != "$PROD_REF" ] || die "REF_DESECHABLE es el proyecto de PRODUCCION. Abortado; no se hizo nada."
printf '%s' "$REF" | grep -Eq '^[a-z0-9]{20}$' || die "REF_DESECHABLE no tiene forma de ref de Supabase (20 caracteres a-z0-9)."
[ "${CONFIRMO_DESECHABLE:-}" = "SI" ] || die "falta la confirmacion explicita CONFIRMO_DESECHABLE=SI (este ensayo VACIA las tablas de public del proyecto $REF)."

IDENTIDAD="${RESPALDO_AGE_IDENTITY:-}"
[ -n "$IDENTIDAD" ] || die "falta RESPALDO_AGE_IDENTITY (ruta del archivo con la identidad privada de age; la clave NO se pide por teclado ni se imprime)."
[ -f "$IDENTIDAD" ] || die "RESPALDO_AGE_IDENTITY no apunta a un archivo."

for c in supabase age python3; do
  command -v "$c" >/dev/null 2>&1 || die "falta el comando '$c'."
done
RTO_OBJ_MIN="${RTO_OBJETIVO_MIN:-90}"
TROZO="${TROZO_BYTES:-900000}"
SIN_PROD="${SIN_PROD:-}"

# ─── Respaldo mas reciente ──────────────────────────────────────────────────
RESPALDO_DIR="${RESPALDO_DIR:-$HOME/likida-respaldos/base}"
if [ -n "${RESPALDO_ARCHIVO:-}" ]; then
  ARCHIVO="$RESPALDO_ARCHIVO"
else
  ARCHIVO="$(ls -1 "$RESPALDO_DIR"/likida-*.sql.age 2>/dev/null | sort | tail -1)"
fi
[ -n "$ARCHIVO" ] && [ -f "$ARCHIVO" ] || die "no hay respaldo .sql.age en $RESPALDO_DIR (corre scripts/respaldo.sh)."
[ -s "$ARCHIVO" ] || die "el respaldo $ARCHIVO pesa 0 bytes (placeholder de iCloud o archivo vacio)."

# ─── Espacio de trabajo y registro ──────────────────────────────────────────
W="$(mktemp -d "${TMPDIR:-/tmp}/ensayo-likida.XXXXXX")" || die "no pude crear el directorio temporal."
limpiar() { [ -n "$W" ] && [ -d "$W" ] && rm -rf "$W"; }
trap limpiar EXIT
trap 'echo; echo "Interrumpido. Se borra el directorio temporal (contiene el volcado en claro)."; exit 130' INT TERM

SALIDA_DIR="$HOME/likida-respaldos/ensayo-restauracion"
mkdir -p "$SALIDA_DIR"; chmod 700 "$SALIDA_DIR"
SELLO="$(date +%Y%m%d-%H%M%S)"
ACTA="$SALIDA_DIR/acta-$SELLO.txt"
: > "$W/resultados.tsv"; : > "$W/tiempos.tsv"

escribir_ayudante "$W/ayudante.py"
PY="python3 -I $W/ayudante.py"

registrar() { # estado nombre detalle
  printf '%s\t%s\t%s\n' "$1" "$2" "${3:-}" >> "$W/resultados.tsv"
  printf '  [%s] %s%s\n' "$1" "$2" "${3:+ - $3}"
}
ahora() { date +%s; }
dur() { local s=$1; printf '%dm%02ds' $((s/60)) $((s%60)); }
fase_ini() { FASE_N="$1"; FASE_T="$(ahora)"; echo; echo "== $1 =="; }
fase_fin() { local t=$(( $(ahora) - FASE_T )); printf '%s\t%s\n' "$FASE_N" "$t" >> "$W/tiempos.tsv"; echo "   ($FASE_N: $(dur "$t"))"; }

# Muestra un fallo del CLI sin volcar datos de clientes: oculta los valores de
# "Key (col)=(valor)" y recorta.
mostrar_fallo() { # archivo
  cat "$1" "$1.err" 2>/dev/null | sed -E 's/\(([^)]*)\)=\([^)]*\)/(\1)=(<oculto>)/g' | cut -c1-240 | head -"${2:-6}" >&2
}
circuito() {
  echo "ERROR: el servicio devolvio ECIRCUITBREAKER (demasiados fallos de conexion)." >&2
  echo "       NO reintentes: espera unos 10 minutos y vuelve a correr el script (es reintentable)." >&2
  exit 4
}

# Ejecuta SQL contra un proyecto por la API de gestion. $1=directorio enlazado
# $2=archivo.sql $3=salida.json. Reintenta solo ante limite de tasa (429).
cli_sql() {
  local intento=0 rc
  while :; do
    supabase db query --linked --workdir "$1" -f "$2" -o json >"$3" 2>"$3.err" </dev/null
    rc=$?
    if [ $rc -eq 0 ]; then rm -f "$3.err"; return 0; fi
    if grep -qiE 'ECIRCUITBREAKER|circuit.?breaker' "$3" "$3.err" 2>/dev/null; then circuito; fi
    if [ $intento -lt 5 ] && grep -qiE '(^|[^0-9])429([^0-9]|$)|rate.?limit|too many requests' "$3" "$3.err" 2>/dev/null; then
      intento=$((intento+1)); sleep $((20*intento)); continue
    fi
    return $rc
  done
}

DIR_DEST="$W/enlace-destino"; DIR_PROD="$W/enlace-prod"

# Escritura: solo contra el desechable (defensa extra aunque REF ya se valido).
sql_dest() {
  [ "$REF" != "$PROD_REF" ] || die "guarda interna: destino == produccion."
  cli_sql "$DIR_DEST" "$1" "$2"
}
# Lectura de produccion: una sola sentencia SELECT/WITH sin verbos de escritura.
sql_prod() {
  grep -qiE '^[[:space:]]*(select|with)[[:space:]]' "$1" || die "guarda interna: SQL de produccion no empieza con SELECT/WITH."
  if grep -qiE '(insert[[:space:]]+into|update[[:space:]]+[a-z_."]+[[:space:]]+set|delete[[:space:]]+from|drop[[:space:]]|truncate[[:space:]]|alter[[:space:]]|create[[:space:]]|copy[[:space:]])' "$1"; then
    die "guarda interna: SQL de produccion con verbo de escritura."
  fi
  cli_sql "$DIR_PROD" "$1" "$2"
}
# consulta -> tsv ordenado. $1=dest|prod $2=nombre (usa $W/q-<nombre>.sql)
consultar() {
  local donde="$1" nom="$2" salida="$W/$1-$2"
  if [ "$donde" = "dest" ]; then sql_dest "$W/q-$nom.sql" "$salida.json"; else sql_prod "$W/q-$nom.sql" "$salida.json"; fi \
    || { echo "ERROR: fallo la consulta '$nom' en $donde:" >&2; mostrar_fallo "$salida.json"; exit 1; }
  $PY tsv "$salida.json" "$salida.tsv" >/dev/null || die "no pude interpretar la respuesta de '$nom' en $donde."
}

# ─── Consultas (todas de catalogo o conteos; sin datos de clientes) ─────────
escribir_consultas() {
  cat > "$W/q-conteos.sql" <<'SQL'
select s||'.'||t as tabla,
       (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', s, t), false, true, '')))[1]::text as filas
  from (select n.nspname::text as s, c.relname::text as t
          from pg_class c join pg_namespace n on n.oid=c.relnamespace
         where n.nspname='public' and c.relkind in ('r','p') and not c.relispartition
        union all select 'auth','users') x
 order by 1;
SQL
  cat > "$W/q-esquema.sql" <<'SQL'
select k||'|'||v from (
  select 'tablas' k, count(*)::text v from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p')
  union all select 'vistas', count(*)::text from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('v','m')
  union all select 'secuencias', count(*)::text from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='S'
  union all select 'funciones', count(*)::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
  union all select 'indices', count(*)::text from pg_indexes where schemaname='public'
  union all select 'triggers', count(*)::text from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal
  union all select 'columnas_md5', md5(string_agg(table_name||'.'||column_name||':'||data_type, ',' order by table_name, ordinal_position)) from information_schema.columns where table_schema='public'
) z order by 1;
SQL
  cat > "$W/q-rls.sql" <<'SQL'
select c.relname::text||'|rls='||c.relrowsecurity::text||'|force='||c.relforcerowsecurity::text
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relkind in ('r','p') order by 1;
SQL
  cat > "$W/q-politicas.sql" <<'SQL'
select schemaname||'.'||tablename||'|'||policyname||'|'||cmd||'|'||permissive||'|'||coalesce(roles::text,'')||'|'||md5(coalesce(qual,'')||'~'||coalesce(with_check,''))
  from pg_policies where schemaname='public' order by 1;
SQL
  cat > "$W/q-migraciones.sql" <<'SQL'
select coalesce(version,'')||E'\t'||coalesce(name,'') as v from supabase_migrations.schema_migrations order by 1;
SQL
  local cte
  cte="$(cat <<'SQL'
with g as (
  select 'tabla'::text as k, quote_ident(n.nspname)||'.'||quote_ident(c.relname) as obj, ''::text as col,
         case when c.relkind='S' then 'sequence' else 'table' end as tipo,
         case a.grantee when 0 then 'PUBLIC' else a.grantee::regrole::text end as gr, a.privilege_type as pr
    from pg_class c join pg_namespace n on n.oid=c.relnamespace,
         lateral aclexplode(coalesce(c.relacl, acldefault(case when c.relkind='S' then 's' else 'r' end, c.relowner))) a
   where n.nspname='public' and c.relkind in ('r','p','v','m','f','S')
     and (a.grantee=0 or a.grantee::regrole::text in ('anon','authenticated','service_role'))
  union all
  select 'columna', quote_ident(n.nspname)||'.'||quote_ident(c.relname), quote_ident(att.attname), 'table',
         case a.grantee when 0 then 'PUBLIC' else a.grantee::regrole::text end, a.privilege_type
    from pg_attribute att join pg_class c on c.oid=att.attrelid join pg_namespace n on n.oid=c.relnamespace,
         lateral aclexplode(att.attacl) a
   where n.nspname='public' and att.attacl is not null and att.attnum>0 and not att.attisdropped
     and (a.grantee=0 or a.grantee::regrole::text in ('anon','authenticated','service_role'))
  union all
  select 'funcion', quote_ident(n.nspname)||'.'||quote_ident(p.proname)||'('||pg_get_function_identity_arguments(p.oid)||')', '', 'routine',
         case a.grantee when 0 then 'PUBLIC' else a.grantee::regrole::text end, a.privilege_type
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace,
         lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
   where n.nspname='public'
     and (a.grantee=0 or a.grantee::regrole::text in ('anon','authenticated','service_role'))
)
SQL
)"
  { printf '%s\n' "$cte"; echo "select k||'|'||gr||'|'||obj||'|'||col||'|'||pr from g order by 1;"; } > "$W/q-privilegios.sql"
  { printf '%s\n' "$cte"; echo "select 'grant '||lower(pr)||case when col<>'' then ' ('||col||')' else '' end||' on '||tipo||' '||obj||' to '||case when gr='PUBLIC' then 'PUBLIC' else quote_ident(gr) end||';' from g order by 1;"; } > "$W/q-acl.sql"
}
escribir_consultas

# ─── Cabecera ───────────────────────────────────────────────────────────────
T_INICIO_SCRIPT="$(ahora)"
echo "Ensayo de restauracion de Likida AI"
echo "  destino desechable : $REF"
echo "  respaldo           : $(basename "$ARCHIVO") ($(du -h "$ARCHIVO" | cut -f1))"
echo "  comparar con prod  : $([ "$SIN_PROD" = "SI" ] && echo 'NO (SIN_PROD=SI)' || echo 'si, solo lectura')"
echo "  objetivo RTO medido: ${RTO_OBJ_MIN} min"

# ─── Enlaces y comprobaciones previas ───────────────────────────────────────
fase_ini "Enlace y comprobaciones previas (no cuenta para el RTO)"
enlazar() { # dir ref
  mkdir -p "$1/supabase"
  printf 'project_id = "ensayo-restauracion"\n' > "$1/supabase/config.toml"
  if ! supabase link --project-ref "$2" --workdir "$1" >"$1/link.out" 2>&1 </dev/null; then
    echo "ERROR: no pude enlazar $2 (¿hiciste 'supabase login'? ¿el ref es correcto?):" >&2
    cut -c1-200 "$1/link.out" | head -5 >&2
    exit 1
  fi
}
if [ "${OMITIR_VERIFICACION_NOMBRE:-}" != "SI" ]; then
  supabase projects list -o json >"$W/proyectos.json" 2>"$W/proyectos.err" </dev/null || { echo "ERROR: 'supabase projects list' fallo (¿login?)." >&2; exit 1; }
  NOMBRE="$($PY proyecto "$W/proyectos.json" "$REF" 2>/dev/null)" || die "el ref $REF no aparece en tu cuenta de Supabase (¿sigue creandose o es de otra organizacion?)."
  printf '%s' "$NOMBRE" | grep -qiE 'ensayo|desechable' || die "el proyecto $REF se llama '$NOMBRE': no contiene 'ensayo' ni 'desechable'. Por seguridad no se toca (OMITIR_VERIFICACION_NOMBRE=SI lo salta bajo tu responsabilidad)."
  echo "   proyecto destino: $NOMBRE"
fi
enlazar "$DIR_DEST" "$REF"
echo "SELECT 1 AS ok;" > "$W/q-ok.sql"
LISTO=0
for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30; do
  if sql_dest "$W/q-ok.sql" "$W/ok.json"; then LISTO=1; break; fi
  [ $((i % 5)) -eq 0 ] && echo "   esperando a que el proyecto desechable acepte consultas ($i/30)..."
  sleep 20
done
[ "$LISTO" = "1" ] || { echo "ERROR: el desechable no respondio en ~10 min:" >&2; mostrar_fallo "$W/ok.json"; exit 1; }
if [ "$SIN_PROD" != "SI" ]; then
  enlazar "$DIR_PROD" "$PROD_REF"
  echo "   leyendo referencias de produccion (solo SELECT)..."
  for q in conteos esquema rls politicas privilegios acl migraciones; do consultar prod "$q"; done
  [ -s "$W/prod-acl.tsv" ] || die "la lectura de privilegios de produccion salio vacia; no puedo corregir privilegios."
  cp "$W/prod-acl.tsv" "$SALIDA_DIR/acl-prod-$SELLO.sql"; chmod 600 "$SALIDA_DIR/acl-prod-$SELLO.sql"
fi
fase_fin

# ─── RTO: empieza aqui ──────────────────────────────────────────────────────
T_RESTAURO_INI="$(ahora)"

fase_ini "1. Descifrar el respaldo"
if ! age -d -i "$IDENTIDAD" -o "$W/volcado.sql" "$ARCHIVO" 2>"$W/age.err"; then
  echo "ERROR: age no pudo descifrar el respaldo (identidad equivocada o archivo dañado)." >&2
  head -2 "$W/age.err" | cut -c1-160 >&2
  exit 1
fi
BYTES="$(wc -c < "$W/volcado.sql" | tr -d ' ')"
[ "$BYTES" -ge 2000 ] || die "el volcado descifrado pesa $BYTES bytes: no es una base."
echo "   volcado en claro: $((BYTES/1024)) KiB (en el temporal; se borra al salir)"
fase_fin

fase_ini "2. Preparar los datos (trocear y contar filas del propio volcado)"
RES="$($PY split "$W/volcado.sql" "$W/trozos" "$TROZO")" || die "no pude interpretar el volcado."
echo "   $RES"
rm -f "$W/volcado.sql"
grep -q '"copy": 0' "$W/trozos/info.json" || die "el volcado trae sentencias COPY; respaldo.sh usa INSERT. Formato no soportado por este ensayo."
grep -q '"sin_cerrar": false' "$W/trozos/info.json" || die "el volcado termina con una sentencia sin cerrar (¿truncado?)."
fase_fin

fase_ini "3. Esquema: migraciones del repo (una por una, API de gestion)"
cat > "$W/q-registro.sql" <<'SQL'
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text);
SQL
sql_dest "$W/q-registro.sql" "$W/registro.json" || { mostrar_fallo "$W/registro.json"; die "no pude preparar el registro de migraciones."; }
echo "select version from supabase_migrations.schema_migrations order by 1;" > "$W/q-aplicadas.sql"
consultar dest aplicadas
APLICADAS=0; SALTADAS=0; N_MIG=0
for f in "$RAIZ"/supabase/migrations/*.sql; do
  b="$(basename "$f" .sql)"
  clave="$(printf '%s' "$b" | sed -E 's/^([0-9]{4}[a-z]?)_.*/\1/')"
  printf '%s' "$clave" | grep -Eq '^[0-9]{4}[a-z]?$' || continue
  N_MIG=$((N_MIG+1))
  if grep -qx "$clave" "$W/dest-aplicadas.tsv"; then SALTADAS=$((SALTADAS+1)); continue; fi
  nombre="${b#"${clave}_"}"
  case "$b" in
    0332_*)
      # Equivalente exacto de scripts/ci/0335 en una tabla VACIA (CONCURRENTLY no corre por la API).
      cat > "$W/pre0332.sql" <<'SQL'
create index if not exists wa_conversacion_purga_idx on public.wa_conversacion(updated_at, id);
create index if not exists codigo_pendiente_purga_idx on public.codigo_pendiente(creado_en, id);
SQL
      sql_dest "$W/pre0332.sql" "$W/pre0332.json" || { mostrar_fallo "$W/pre0332.json"; die "fallo el sustituto del preflight 0335 antes de la 0332."; }
      ;;
  esac
  { cat "$f"; printf '\n;\ninsert into supabase_migrations.schema_migrations(version, name, statements) values (%s, %s, %s) on conflict (version) do nothing;\n' \
      "'$clave'" "'$(printf '%s' "$nombre" | sed "s/'/''/g")'" "'{}'"; } > "$W/mig.sql"
  if ! sql_dest "$W/mig.sql" "$W/mig.json"; then
    echo "ERROR: fallo la migracion $b:" >&2; mostrar_fallo "$W/mig.json" 12
    echo "       El ensayo se detiene aqui (esto ya es un hallazgo: anotalo en el acta). Es reintentable." >&2
    exit 1
  fi
  APLICADAS=$((APLICADAS+1))
  [ $((APLICADAS % 25)) -eq 0 ] && echo "   $APLICADAS aplicadas (ultima $clave)..."
done
echo "   migraciones del repo: $N_MIG; aplicadas ahora: $APLICADAS; ya estaban: $SALTADAS"
fase_fin

fase_ini "4. Datos: vaciar public del desechable y cargar los trozos"
cat > "$W/vaciar.sql" <<'SQL'
do $v$
declare lista text;
begin
  select string_agg(format('%I.%I', n.nspname, c.relname), ', ') into lista
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relkind in ('r','p') and not c.relispartition;
  if lista is not null then execute 'truncate table ' || lista || ' restart identity cascade'; end if;
end
$v$;
SQL
sql_dest "$W/vaciar.sql" "$W/vaciar.json" || { mostrar_fallo "$W/vaciar.json"; die "no pude vaciar las tablas del desechable."; }
N_TROZOS="$(ls "$W/trozos"/trozo-*.sql 2>/dev/null | wc -l | tr -d ' ')"
I=0
for t in "$W/trozos"/trozo-*.sql; do
  I=$((I+1))
  if ! sql_dest "$t" "$W/carga.json"; then
    echo "ERROR: fallo la carga del trozo $I de $N_TROZOS (mensaje con valores ocultos):" >&2
    mostrar_fallo "$W/carga.json" 3
    echo "       Reintentable: el script vacia y recarga todo." >&2
    exit 1
  fi
  [ $((I % 20)) -eq 0 ] && echo "   $I/$N_TROZOS trozos..."
done
echo "   $N_TROZOS trozos cargados"
fase_fin

fase_ini "5. Privilegios: comparar, corregir y comparar de nuevo"
PRIV_ANTES="n/a"
if [ "$SIN_PROD" != "SI" ]; then
  consultar dest privilegios
  if PRIV_ANTES="$($PY cmp-simple "$W/prod-privilegios.tsv" "$W/dest-privilegios.tsv" 6)"; then
    echo "   antes de la correccion: privilegios ya iguales a prod"
  else
    echo "   antes de la correccion hay diferencias respecto de prod (se espera por default privileges del proyecto nuevo):"
    printf '%s\n' "$PRIV_ANTES" | sed 's/^/     /'
  fi
  {
    echo "revoke all on all tables in schema public from public, anon, authenticated, service_role;"
    echo "revoke all on all sequences in schema public from public, anon, authenticated, service_role;"
    echo "revoke all on all functions in schema public from public, anon, authenticated, service_role;"
  } > "$W/revocar.sql"
  sql_dest "$W/revocar.sql" "$W/revocar.json" || { mostrar_fallo "$W/revocar.json"; die "fallo el REVOKE ALL en public del desechable."; }
  split -l 1500 "$W/prod-acl.tsv" "$W/acl-parte-"
  for p in "$W"/acl-parte-*; do
    sql_dest "$p" "$W/acl.json" || { echo "ERROR: fallo un bloque de GRANT:" >&2; mostrar_fallo "$W/acl.json" 6; exit 1; }
  done
  echo "   REVOKE ALL aplicado y $(wc -l < "$W/prod-acl.tsv" | tr -d ' ') GRANT reaplicados (leidos de prod)"
else
  echo "   SIN_PROD=SI: no se corrige ni se compara (sin referencia)."
fi
fase_fin

fase_ini "6. Verificaciones"
consultar dest conteos
if [ "$SIN_PROD" != "SI" ]; then
  DET="$($PY cmp-filas "$W/trozos/huellas.json" "$W/dest-conteos.tsv" "$W/prod-conteos.tsv")"; RC=$?
else
  DET="$($PY cmp-filas "$W/trozos/huellas.json" "$W/dest-conteos.tsv" -)"; RC=$?
fi
[ $RC -eq 0 ] && registrar PASA "Filas por tabla = filas del volcado" "$(printf '%s' "$DET" | head -1)" || registrar FALLA "Filas por tabla = filas del volcado" "$(printf '%s' "$DET" | head -1)"
printf '%s\n' "$DET" | tail -n +2 | sed 's/^/        /'

if grep -q '"auth"' "$W/trozos/info.json"; then
  registrar PASA "El respaldo incluye datos de auth" "esquemas en el volcado: $(sed -E 's/.*"esquemas": \[([^]]*)\].*/\1/' "$W/trozos/info.json")"
else
  registrar AVISO "El respaldo NO incluye auth.users" "respaldo.sh vuelca solo los esquemas propios; los usuarios de acceso no se restauran con este respaldo"
fi

if [ "$SIN_PROD" != "SI" ]; then
  consultar dest esquema
  D="$($PY cmp-simple "$W/prod-esquema.tsv" "$W/dest-esquema.tsv" 12)" && registrar PASA "Esquema igual (tablas, vistas, secuencias, funciones, indices, triggers, columnas)" "$(printf '%s' "$D" | head -1)" || { registrar FALLA "Esquema igual a prod" "$(printf '%s' "$D" | head -1)"; printf '%s\n' "$D" | tail -n +2 | sed 's/^/        /'; }

  consultar dest rls
  D="$($PY cmp-simple "$W/prod-rls.tsv" "$W/dest-rls.tsv" 12)" && registrar PASA "RLS activada en las mismas tablas (y FORCE igual)" "$(printf '%s' "$D" | head -1)" || { registrar FALLA "RLS igual a prod" "$(printf '%s' "$D" | head -1)"; printf '%s\n' "$D" | tail -n +2 | sed 's/^/        /'; }

  consultar dest politicas
  D="$($PY cmp-simple "$W/prod-politicas.tsv" "$W/dest-politicas.tsv" 12)" && registrar PASA "Politicas RLS iguales (nombre, comando, roles, huella de expresion)" "$(wc -l < "$W/dest-politicas.tsv" | tr -d ' ') politicas" || { registrar FALLA "Politicas RLS iguales a prod" "$(printf '%s' "$D" | head -1)"; printf '%s\n' "$D" | tail -n +2 | sed 's/^/        /'; }

  consultar dest migraciones
  D="$($PY cmp-mig "$RAIZ/supabase/migrations" "$W/dest-migraciones.tsv" "$W/prod-migraciones.tsv")" && registrar PASA "Migraciones: destino = repo y contenidas en prod" "$D" || registrar FALLA "Migraciones: destino = repo y contenidas en prod" "$D"

  consultar dest privilegios
  D="$($PY cmp-simple "$W/prod-privilegios.tsv" "$W/dest-privilegios.tsv" 12)" && registrar PASA "Privilegios de anon/authenticated/service_role/PUBLIC iguales a prod (tablas, columnas, secuencias, funciones)" "$(wc -l < "$W/dest-privilegios.tsv" | tr -d ' ') permisos" || { registrar FALLA "Privilegios iguales a prod" "$(printf '%s' "$D" | head -1)"; printf '%s\n' "$D" | tail -n +2 | sed 's/^/        /'; }
  if printf '%s' "$PRIV_ANTES" | grep -q 'FALTA_EN_DESTINO\|SOBRA_EN_DESTINO\|solo en referencia, [1-9]\|solo en destino, [1-9]'; then
    registrar AVISO "Antes de la correccion los privilegios NO coincidian" "$(printf '%s' "$PRIV_ANTES" | head -1) (la correccion de privilegios es parte obligatoria del procedimiento)"
  else
    registrar PASA "Antes de la correccion los privilegios ya coincidian" ""
  fi
else
  registrar SALTADO "Esquema, RLS, politicas, migraciones y privilegios contra prod" "SIN_PROD=SI"
fi

# RPO: edad del respaldo
EDAD_MIN="$($PY edad "$ARCHIVO")"
if [ "$EDAD_MIN" -le 1440 ]; then registrar PASA "Edad del respaldo <= 24 h (RPO declarado)" "$((EDAD_MIN/60)) h $((EDAD_MIN%60)) min"
else registrar AVISO "Edad del respaldo > 24 h (supera el RPO declarado)" "$((EDAD_MIN/60)) h"; fi
fase_fin

fase_ini "7. Storage: integridad del respaldo y copia local (no sube al desechable)"
if [ -n "${STORAGE_BACKUP:-}" ] && [ -f "$STORAGE_BACKUP/MANIFIESTO.json" ]; then
  if command -v jq >/dev/null 2>&1; then
    if bash "$RAIZ/scripts/restore-storage-drill.sh" "$STORAGE_BACKUP" >"$W/storage1.out" 2>&1 \
       && bash "$RAIZ/scripts/restore-storage-drill.sh" "$STORAGE_BACKUP" --apply --destination "$W/storage-copia" >"$W/storage2.out" 2>&1; then
      registrar PASA "Storage: SHA-256 y bytes de cada objeto verificados; copia local hecha" "$(tail -1 "$W/storage2.out" | cut -c1-120)"
    else
      registrar FALLA "Storage: verificacion del respaldo" "$(tail -2 "$W/storage1.out" "$W/storage2.out" 2>/dev/null | cut -c1-160 | tr '\n' ' ')"
    fi
  else
    registrar SALTADO "Storage" "falta jq"
  fi
else
  registrar SALTADO "Storage" "define STORAGE_BACKUP con la carpeta de respaldo-storage.sh (con MANIFIESTO.json)"
fi
fase_fin

# ─── RTO y resumen ──────────────────────────────────────────────────────────
T_FIN="$(ahora)"
RTO_S=$((T_FIN - T_RESTAURO_INI))
RTO_MIN=$(( (RTO_S + 59) / 60 ))
if [ "$RTO_MIN" -le "$RTO_OBJ_MIN" ]; then ESTADO_RTO=PASA; else ESTADO_RTO=FALLA; fi
registrar "$ESTADO_RTO" "RTO medido (descifrar + esquema + datos + privilegios + verificar) <= ${RTO_OBJ_MIN} min" "$(dur "$RTO_S")"
EPOCH_FILE="$SALIDA_DIR/inicio-epoch"
if [ -f "$EPOCH_FILE" ]; then
  E0="$(tr -dc '0-9' < "$EPOCH_FILE")"
  if [ -n "$E0" ] && [ "$E0" -le "$T_FIN" ] && [ $((T_FIN - E0)) -lt 86400 ]; then
    registrar AVISO "RTO de extremo a extremo (desde crear el proyecto, incluye pausas humanas)" "$(dur $((T_FIN - E0)))"
  fi
fi

{
  echo "ACTA DEL ENSAYO DE RESTAURACION - $(date '+%Y-%m-%d %H:%M:%S')"
  echo "Destino desechable: $REF   Respaldo: $(basename "$ARCHIVO")   Edad: $((EDAD_MIN/60)) h $((EDAD_MIN%60)) min"
  echo "Migraciones del repo: $N_MIG   Filas del volcado: $(sed -E 's/.*"filas_total": ([0-9]+).*/\1/' "$W/trozos/info.json")   Trozos: $N_TROZOS"
  echo
  echo "Tiempos por fase:"
  awk -F'\t' '{printf "  %-80s %dm%02ds\n", $1, $2/60, $2%60}' "$W/tiempos.tsv"
  echo
  echo "Resultados:"
  awk -F'\t' '{printf "  [%s] %s%s\n", $1, $2, ($3==""?"":" - "$3)}' "$W/resultados.tsv"
} > "$ACTA"
chmod 600 "$ACTA"

echo
echo "════════════════ RESUMEN ════════════════"
cat "$ACTA"
echo
echo "Acta guardada (sin datos de clientes): $ACTA"
echo "Referencia de privilegios de prod guardada: $SALIDA_DIR/acl-prod-$SELLO.sql"
echo "Ahora BORRA el desechable:  supabase projects delete $REF --yes"
if awk -F'\t' '$1=="FALLA"{f=1} END{exit f?0:1}' "$W/resultados.tsv"; then
  echo "VEREDICTO: FALLA (hay verificaciones en FALLA; ver arriba)."
  exit 1
fi
echo "VEREDICTO: PASA (ninguna verificacion en FALLA; revisa los AVISO y los SALTADO)."
exit 0
