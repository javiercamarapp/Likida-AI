#!/usr/bin/env python3
# Crea la llave de worker de la Mac (0135) — se corre UNA vez, en local:
#   python3 scripts/mejora-diaria/crear-worker-llave.py
# Genera lkw_…, guarda SOLO su sha256 en worker_llave con las 4 capacidades
# del bus, la escribe en .env.local como LIKIDA_WORKER_KEY y la imprime.
# (Usa el service role local por última vez: para eso existe esta ceremonia.)
import hashlib, json, pathlib, secrets, urllib.request

REPO = pathlib.Path.home() / "javiercamarapp" / "likida"
ENV = REPO / ".env.local"

def leer(clave):
    for linea in ENV.read_text().splitlines():
        if linea.startswith(clave + "="):
            return linea.split("=", 1)[1].split("#")[0].strip().strip('"').strip("'")
    return ""

URL, KEY = leer("NEXT_PUBLIC_SUPABASE_URL"), leer("SUPABASE_SERVICE_ROLE_KEY")
assert URL and KEY, "faltan credenciales en .env.local"

llave = "lkw_" + secrets.token_hex(24)
fila = {
    "nombre": "mac-javier",
    "hash": hashlib.sha256(llave.encode()).hexdigest(),
    "capacidades": ["bus.latido", "bus.pieza", "bus.catalogo", "bus.ordenes"],
}
req = urllib.request.Request(
    f"{URL}/rest/v1/worker_llave",
    data=json.dumps(fila).encode(), method="POST",
    headers={"apikey": KEY, "Authorization": f"Bearer {KEY}",
             "Content-Type": "application/json", "Prefer": "return=minimal"})
urllib.request.urlopen(req, timeout=30).read()

texto = ENV.read_text()
if "LIKIDA_WORKER_KEY=" in texto:
    import re
    texto = re.sub(r"^LIKIDA_WORKER_KEY=.*$", f"LIKIDA_WORKER_KEY={llave}", texto, flags=re.M)
else:
    texto = texto.rstrip("\n") + f"\n\n# Identidad del worker de la Mac (0135) — el bus ya no usa service role\nLIKIDA_WORKER_KEY={llave}\n"
ENV.write_text(texto)
print(f"llave creada y escrita en .env.local: {llave[:12]}… (capacidades: bus.*)")
print("bus.sh la va a usar solo — verifica con: bash scripts/mejora-diaria/bus.sh sembrar-catalogo")
