#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════
# EL BUS DE MANDO, LADO MAC (0127) — el puente entre las rutinas launchd y
# /admin/tu-turno. Cuatro verbos:
#
#   bus.sh corrida-inicio <rutina>                 → imprime el id de la corrida
#   bus.sh corrida-fin <id> <exit> [pr] [veredicto…]
#   bus.sh pieza <rutina> <carpeta-absoluta>       → espeja una pieza de la cola
#   bus.sh sembrar-catalogo                        → encargos/*.md + plists → bus_rutina
#   bus.sh ordenes                                 → ejecuta lo pendiente de bus_orden
#
# Filosofía: este script JAMÁS rompe a la rutina que lo llama — todo error
# aquí es un aviso a stderr y exit 0 (menos en `ordenes`, que corre solo).
# La aprobación sigue donde estaba: las órdenes las creó Javier en /admin;
# aquí solo se ejecutan y se firma el resultado.
# ═══════════════════════════════════════════════════════════════════════════
set -uo pipefail
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
REPO="$HOME/javiercamarapp/likida"
COLA="$HOME/javiercamarapp/likida-marketing-cola"
TALLER="$HOME/javiercamarapp/likida-mejoras"

leer() { grep "^$1=" "$REPO/.env.local" 2>/dev/null | head -1 | cut -d= -f2- | sed 's/[[:space:]]*#.*//' | tr -d '"' | tr -d "'" | xargs; }
export BUS_URL="$(leer NEXT_PUBLIC_SUPABASE_URL)"
export BUS_KEY="$(leer SUPABASE_SERVICE_ROLE_KEY)"
[ -z "$BUS_URL" ] || [ -z "$BUS_KEY" ] && { echo "[bus] sin credenciales en .env.local — no reporto." >&2; exit 0; }

CMD="${1:-}"; shift || true

api() { # api <metodo> <ruta+query> [json] [prefer]
  local m="$1" r="$2" d="${3:-}" p="${4:-}"
  curl -sS -m 20 -X "$m" "$BUS_URL/rest/v1/$r" \
    -H "apikey: $BUS_KEY" -H "Authorization: Bearer $BUS_KEY" \
    -H "Content-Type: application/json" ${p:+-H "Prefer: $p"} ${d:+-d "$d"}
}

case "$CMD" in

corrida-inicio)
  RUTINA="${1:?rutina}"
  api POST "bus_corrida" "{\"rutina\":\"$RUTINA\"}" "return=representation" \
    | python3 -c "import json,sys
try: print(json.load(sys.stdin)[0]['id'])
except Exception: pass" 2>/dev/null
  exit 0 ;;

corrida-fin)
  ID="${1:?id}"; CODIGO="${2:-0}"; PR="${3:-}"; shift 3 2>/dev/null || shift $# 2>/dev/null || true
  VERE="${*:-}"
  python3 - "$ID" "$CODIGO" "$PR" "$VERE" <<'PY' 2>/dev/null || true
import json, os, sys, urllib.request, datetime
id_, codigo, pr, vere = sys.argv[1:5]
cuerpo = {"fin": datetime.datetime.now(datetime.timezone.utc).isoformat(),
          "exit_code": int(codigo) if codigo.lstrip('-').isdigit() else None,
          "veredicto": (vere or None) and vere[:300]}
if pr: cuerpo["pr_url"] = pr
req = urllib.request.Request(
    f"{os.environ['BUS_URL']}/rest/v1/bus_corrida?id=eq.{id_}",
    data=json.dumps(cuerpo).encode(), method="PATCH",
    headers={"apikey": os.environ['BUS_KEY'], "Authorization": f"Bearer {os.environ['BUS_KEY']}",
             "Content-Type": "application/json", "Prefer": "return=minimal"})
urllib.request.urlopen(req, timeout=20).read()
PY
  exit 0 ;;

pieza)
  RUTINA="${1:?rutina}"; CARPETA="${2:?carpeta}"
  python3 - "$RUTINA" "$CARPETA" <<'PY' 2>/dev/null || true
import json, os, sys, urllib.request, urllib.parse, mimetypes, pathlib
rutina, carpeta = sys.argv[1], pathlib.Path(sys.argv[2])
COLA = pathlib.Path.home() / "javiercamarapp" / "likida-marketing-cola"
URL, KEY = os.environ["BUS_URL"], os.environ["BUS_KEY"]
if not carpeta.is_dir(): sys.exit(0)
try: rel = str(carpeta.relative_to(COLA))
except ValueError: rel = carpeta.name

def pedir(metodo, ruta, data=None, headers=None):
    h = {"apikey": KEY, "Authorization": f"Bearer {KEY}"}
    h.update(headers or {})
    req = urllib.request.Request(f"{URL}{ruta}", data=data, method=metodo, headers=h)
    return urllib.request.urlopen(req, timeout=30).read()

# El tipo por lo que la carpeta contiene — el video manda sobre la imagen.
archivos = [f for f in carpeta.rglob("*") if f.is_file()]
exts = {f.suffix.lower() for f in archivos}
nombre = carpeta.name.lower()
if ".mp4" in exts or ".webm" in exts: tipo = "video"
elif "sequence" in nombre: tipo = "sequence"
elif "articulo" in nombre or "articulo" in str(carpeta.parent).lower(): tipo = "articulo"
elif {".png", ".jpg", ".jpeg"} & exts: tipo = "imagen"
elif ".md" in exts: tipo = "copy"
else: tipo = "otro"

copy_md = None
for candidato in ("post.md", "guion.md", "copy.md", "META.md"):
    f = carpeta / candidato
    if f.is_file():
        copy_md = f.read_text(errors="replace")[:4000]; break

# El preview: la primera imagen (o nada — la tarjeta vive sin foto).
media_path = None
for f in sorted(archivos):
    if f.suffix.lower() in (".png", ".jpg", ".jpeg"):
        objeto = f"piezas/{rel}/{f.name}"
        mime = mimetypes.guess_type(f.name)[0] or "application/octet-stream"
        try:
            pedir("POST", f"/storage/v1/object/bus/{urllib.parse.quote(objeto)}", data=f.read_bytes(),
                  headers={"Content-Type": mime, "x-upsert": "true"})
            media_path = objeto
        except Exception: pass
        break

fila = {"rutina": rutina, "carpeta": rel, "titulo": carpeta.name, "tipo": tipo,
        "copy_md": copy_md, "media_path": media_path}
# Upsert por carpeta SIN tocar `estado`: re-espejar una pieza ya aprobada no
# la regresa a pendiente.
pedir("POST", "/rest/v1/bus_pieza?on_conflict=carpeta",
      data=json.dumps(fila).encode(),
      headers={"Content-Type": "application/json",
               "Prefer": "resolution=merge-duplicates,return=minimal"})
print(f"[bus] pieza espejada: {rel} ({tipo})")
PY
  exit 0 ;;

sembrar-catalogo)
  python3 - <<'PY'
import json, os, plistlib, pathlib, urllib.request, datetime
BASE = pathlib.Path.home() / "javiercamarapp" / "likida" / "scripts" / "mejora-diaria"
URL, KEY = os.environ["BUS_URL"], os.environ["BUS_KEY"]
DIAS = {0: "dom", 1: "lun", 2: "mar", 3: "mié", 4: "jue", 5: "vie", 6: "sáb", 7: "dom"}

def horario_de(nombre):
    p = BASE / f"com.likida.{nombre}.plist"
    if not p.is_file(): return ""
    try: d = plistlib.loads(p.read_bytes())
    except Exception: return ""
    if "StartInterval" in d: return f"cada {d['StartInterval'] // 60} min"
    cal = d.get("StartCalendarInterval")
    if not cal: return ""
    if isinstance(cal, dict): cal = [cal]
    partes = []
    for c in cal:
        hhmm = f"{c.get('Hour', 0):02d}:{c.get('Minute', 0):02d}"
        pre = ""
        if "Weekday" in c: pre = DIAS.get(c["Weekday"], "") + " "
        if "Day" in c: pre = f"día {c['Day']} "
        partes.append(pre + hhmm)
    return " y ".join(partes)

filas = []
for enc in sorted((BASE / "encargos").glob("*.md")):
    nombre = enc.stem
    texto = enc.read_text(errors="replace")
    desc = next((l.lstrip("# ").strip() for l in texto.splitlines() if l.strip()), "")[:200]
    filas.append({"nombre": nombre, "horario": horario_de(nombre), "descripcion": desc,
                  "encargo_md": texto[:20000],
                  "actualizado_en": datetime.datetime.now(datetime.timezone.utc).isoformat()})
req = urllib.request.Request(
    f"{URL}/rest/v1/bus_rutina?on_conflict=nombre",
    data=json.dumps(filas).encode(), method="POST",
    headers={"apikey": KEY, "Authorization": f"Bearer {KEY}", "Content-Type": "application/json",
             "Prefer": "resolution=merge-duplicates,return=minimal"})
urllib.request.urlopen(req, timeout=30).read()
print(f"[bus] catálogo sembrado: {len(filas)} rutinas")
PY
  exit $? ;;

ordenes)
  python3 - <<'PY'
import json, os, subprocess, pathlib, urllib.request, datetime
URL, KEY = os.environ["BUS_URL"], os.environ["BUS_KEY"]
REPO = pathlib.Path.home() / "javiercamarapp" / "likida"
APAGADO = REPO / ".mejora-diaria" / "APAGADO"
NOTAS = REPO / ".mejora-diaria" / "notas-javier.md"

def pedir(metodo, ruta, cuerpo=None, prefer=None):
    h = {"apikey": KEY, "Authorization": f"Bearer {KEY}", "Content-Type": "application/json"}
    if prefer: h["Prefer"] = prefer
    req = urllib.request.Request(f"{URL}/rest/v1/{ruta}",
                                 data=json.dumps(cuerpo).encode() if cuerpo is not None else None,
                                 method=metodo, headers=h)
    crudo = urllib.request.urlopen(req, timeout=30).read()
    return json.loads(crudo) if crudo else None

def ahora(): return datetime.datetime.now(datetime.timezone.utc).isoformat()

pendientes = pedir("GET", "bus_orden?estado=eq.pendiente&order=creado_en&limit=10") or []
for o in pendientes:
    # Claim anclado a pendiente (mismo patrón que wa_pendientes): si otra
    # instancia la tomó entre el GET y este PATCH, la respuesta viene vacía.
    tomada = pedir("PATCH", f"bus_orden?id=eq.{o['id']}&estado=eq.pendiente",
                   {"estado": "tomada", "tomada_en": ahora()}, "return=representation")
    if not tomada: continue
    tipo, rutina = o["tipo"], o.get("rutina")
    payload = o.get("payload") or {}
    ok, resultado = False, ""
    try:
        if tipo == "correr_ahora":
            plist = pathlib.Path(f"{REPO}/scripts/mejora-diaria/com.likida.{rutina}.plist")
            if not plist.is_file():
                resultado = f"no existe com.likida.{rutina}"
            else:
                uid = os.getuid()
                r = subprocess.run(["launchctl", "kickstart", "-k", f"gui/{uid}/com.likida.{rutina}"],
                                   capture_output=True, text=True, timeout=30)
                ok = r.returncode == 0
                resultado = "corrida disparada" if ok else (r.stderr.strip()[:200] or f"launchctl exit {r.returncode}")
        elif tipo == "kill_switch_on":
            APAGADO.parent.mkdir(parents=True, exist_ok=True); APAGADO.touch()
            ok, resultado = True, "APAGADO puesto — todas las rutinas del repo se detienen"
        elif tipo == "kill_switch_off":
            APAGADO.unlink(missing_ok=True)
            ok, resultado = True, "APAGADO retirado — las rutinas vuelven a su horario"
        elif tipo == "nota":
            NOTAS.parent.mkdir(parents=True, exist_ok=True)
            with open(NOTAS, "a") as f:
                f.write(f"\n## {ahora()}\n{payload.get('texto', '')}\n")
            ok, resultado = True, "anotada en notas-javier.md"
        elif tipo == "editar_encargo":
            # Fase D dice PR chico, no escritura directa — llega con el editor
            # visual de rutinas. Hasta entonces la orden se rechaza con causa.
            resultado = "editar_encargo aún no está cableado en la Mac (llega con el editor de rutinas)"
        else:
            resultado = f"tipo desconocido: {tipo}"
    except Exception as e:
        resultado = str(e)[:200]
    pedir("PATCH", f"bus_orden?id=eq.{o['id']}",
          {"estado": "hecha" if ok else "fallida", "resuelta_en": ahora(),
           "resultado": resultado or ("hecha" if ok else "falló sin decir por qué")})
    print(f"[bus] orden {tipo}{' · ' + rutina if rutina else ''}: {'✓' if ok else '✗'} {resultado}")
print(f"[bus] órdenes atendidas: {len(pendientes)}")
PY
  exit $? ;;

*)
  echo "uso: bus.sh corrida-inicio|corrida-fin|pieza|sembrar-catalogo|ordenes" >&2
  exit 2 ;;
esac
