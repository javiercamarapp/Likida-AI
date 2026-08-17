#!/usr/bin/env python3
# ═══════════════════════════════════════════════════════════════════════════
# ACTIVA EL MFA DE JAVIER — se corre UNA vez, POR JAVIER (con `!` en la
# sesión o en su terminal):
#
#   python3 scripts/mejora-diaria/activar-mfa-javier.py
#
# Qué hace, paso a paso:
#  1. Genera una sesión tuya vía el ADMIN de Auth (generate_link — tu correo
#     ni se entera).
#  2. Barre factores a medias, inscribe el TOTP y lo VERIFICA con el código
#     calculado del secreto (RFC 6238) — el factor queda ACTIVO.
#  3. Guarda el QR en ~/Documents/likida-mfa-javier.svg (FUERA del repo) y
#     te manda secreto + URI a TU WhatsApp para que lo agregues a tu app
#     (Google Authenticator / 1Password → "entrada manual" o escanear el QR).
#  4. Cierra la sesión de la ceremonia.
#
# ⚠️ Desde que el factor queda verificado, las acciones 'doble' del copiloto
# exigen el código — agrega el secreto a tu app EN CUANTO llegue el WhatsApp.
# El secreto NO se imprime en pantalla ni queda en el repo.
# ═══════════════════════════════════════════════════════════════════════════
import base64, hashlib, hmac, json, pathlib, struct, subprocess, time
import urllib.request, urllib.error

REPO = pathlib.Path(__file__).resolve().parents[2]
ENV = REPO / ".env.local"

def leer(c):
    for l in ENV.read_text().splitlines():
        if l.startswith(c + "="):
            return l.split("=", 1)[1].split("#")[0].strip().strip('"').strip("'")
    return ""

URL = leer("NEXT_PUBLIC_SUPABASE_URL")
SRK = leer("SUPABASE_SERVICE_ROLE_KEY")
ANON = leer("NEXT_PUBLIC_SUPABASE_ANON_KEY")
EMAIL = "javiercamaraportepetit@gmail.com"
assert URL and SRK and ANON, "faltan credenciales en .env.local"

def pedir(ruta, cuerpo=None, token=None, metodo=None):
    h = {"apikey": ANON if token is not None else SRK, "Content-Type": "application/json"}
    h["Authorization"] = f"Bearer {token or SRK}"
    req = urllib.request.Request(f"{URL}{ruta}",
        data=json.dumps(cuerpo).encode() if cuerpo is not None else None,
        method=metodo or ("POST" if cuerpo is not None else "GET"), headers=h)
    try:
        crudo = urllib.request.urlopen(req, timeout=30).read()
        return json.loads(crudo) if crudo else {}
    except urllib.error.HTTPError as e:
        raise SystemExit(f"HTTP {e.code} en {ruta}: {e.read().decode()[:300]}")

# 1. Sesión tuya vía admin (el correo ni se entera)
gl = pedir("/auth/v1/admin/generate_link", {"type": "magiclink", "email": EMAIL})
th = gl.get("hashed_token") or gl.get("properties", {}).get("hashed_token")
assert th, f"generate_link sin hashed_token: {list(gl.keys())}"
ses = pedir("/auth/v1/verify", {"type": "magiclink", "token_hash": th, "email": EMAIL}, token="")
tok = ses.get("access_token")
assert tok, f"verify sin sesión: {list(ses.keys())}"
print("sesión creada ✓")

# 2. Sin duplicar: un verificado detiene; los a-medias se barren
factores = pedir("/auth/v1/factors", token=tok)
lista = factores if isinstance(factores, list) else factores.get("totp", []) or factores.get("factors", [])
for f in lista:
    if f.get("status") == "verified":
        raise SystemExit(f"YA tienes un factor verificado ({f.get('friendly_name')}) — nada que hacer.")
    pedir(f"/auth/v1/factors/{f['id']}", token=tok, metodo="DELETE")
    print("factor a medias barrido ✓")

# 3. Inscribir + verificar
en = pedir("/auth/v1/factors", {"factor_type": "totp", "friendly_name": "Likida"}, token=tok)
fid, secreto, uri, svg = en["id"], en["totp"]["secret"], en["totp"]["uri"], en["totp"]["qr_code"]
print("factor inscrito ✓")

def totp(sec):
    k = base64.b32decode(sec + "=" * ((8 - len(sec) % 8) % 8), casefold=True)
    c = struct.pack(">Q", int(time.time()) // 30)
    d = hmac.new(k, c, hashlib.sha1).digest()
    o = d[-1] & 0xF
    return str((struct.unpack(">I", d[o:o + 4])[0] & 0x7FFFFFFF) % 1_000_000).zfill(6)

ch = pedir(f"/auth/v1/factors/{fid}/challenge", {}, token=tok)
v = pedir(f"/auth/v1/factors/{fid}/verify", {"challenge_id": ch["id"], "code": totp(secreto)}, token=tok)
assert v.get("access_token"), "verify sin sesión nueva"
print("factor VERIFICADO ✓ — MFA activo en tu cuenta")

# 4. QR fuera del repo + entrega por WhatsApp (el secreto no pasa por pantalla)
destino = pathlib.Path.home() / "Documents" / "likida-mfa-javier.svg"
destino.write_text(svg if svg.strip().startswith("<") else base64.b64decode(svg.split(",")[-1]).decode())
print(f"QR guardado en {destino}")
subprocess.run(["bash", str(REPO / "scripts/mejora-diaria/wa-notificar.sh"),
    "🔐 TU MFA QUEDÓ ACTIVO — agrega esto a tu app AHORA (Google Authenticator / 1Password → entrada manual):\n\n"
    f"Secreto: {secreto}\n\nO escanea el QR: ~/Documents/likida-mfa-javier.svg\n\nURI completa:\n{uri}\n\n"
    "⚠️ Desde ya, las acciones sensibles del copiloto piden el código de 6 dígitos."],
    timeout=60)

try:
    pedir("/auth/v1/logout", {}, token=v["access_token"])
except SystemExit:
    pass
print("sesión de la ceremonia cerrada ✓ — revisa tu WhatsApp")
