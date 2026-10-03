#!/usr/bin/env python3
"""medir.py — corre las consultas calientes de consultas.sql contra la base sembrada
y reporta p50/p95 + plan (Index / Seq Scan sobre tablas grandes).

Solo biblioteca estándar + el binario `psql` (sin npm, sin drivers).

  PGHOST=127.0.0.1 PGPORT=55432 PGUSER=postgres \
  python3 scripts/carga/250-camiones/medir.py [--corridas 20] [--solo cron.conductor] \
      [--log /ruta/pg.log] [--salida resultados.json]

Cómo mide:
  · TIEMPO: N corridas de EXPLAIN (ANALYZE) dentro de BEGIN … ROLLBACK (las consultas
    que escriben —reclamar_*, purgar_*— quedan sin efecto). Tiempo = Planning + Execution
    del servidor (no incluye red ni el JSON de PostgREST). La primera corrida se descarta
    (caché fría de plan/buffers) y se reporta aparte.
  · PLAN: con auto_explain (log_nested_statements) para ver DENTRO de las RPC; se lee
    del log del servidor (--log). Si no se pasa --log se usa solo el plan de EXPLAIN de
    primer nivel (las RPC aparecen como «Function Scan»).
  · SEQ: marca «SEQ» si el plan trae Seq Scan sobre una tabla con más de 50,000 filas
    estimadas (pg_class.reltuples). Un Seq Scan sobre una tabla chica no se marca.
"""
import argparse, json, os, re, statistics, subprocess, sys

DIR = os.path.dirname(os.path.abspath(__file__))
T = os.environ.get('CARGA_TENANT', 'aaaaaaaa-0000-4000-8000-000000000250')
C = os.environ.get('CARGA_CHICA', None)  # se resuelve abajo si falta


def psql(sql, tuples=True, check=True):
    r = subprocess.run(['psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1'] + (['-At'] if tuples else []) + ['-c', sql],
                       capture_output=True, text=True)
    if check and r.returncode != 0:
        raise RuntimeError(r.stderr.strip())
    return r


def cargar_consultas(ruta):
    consultas, cur = [], None
    for linea in open(ruta, encoding='utf-8'):
        m = re.match(r'--\s*@(\w+):\s*(.*)$', linea.rstrip())
        if m:
            k, v = m.group(1), m.group(2).strip()
            if k == 'nombre':
                cur = {'nombre': v, 'sql': '', 'tipo': 'pantalla', 'origen': '', 'muta': False}
                consultas.append(cur)
            elif cur is not None:
                cur[k] = (v == '1') if k == 'muta' else v
            continue
        if cur is not None and not linea.lstrip().startswith('--'):
            cur['sql'] += linea
    for q in consultas:
        q['sql'] = q['sql'].strip().rstrip(';')
    return consultas


def sustituir(sql, ctx):
    for k, v in ctx.items():
        sql = sql.replace(':' + k, v)
    return sql


def p95(xs):
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(round(0.95 * (len(xs) - 1) + 0.4999)))]


def tiempo_una(sql):
    """Un EXPLAIN ANALYZE en transacción con rollback → ms (planning + execution)."""
    r = psql(f"begin; explain (analyze, format json) {sql}; rollback;", check=False)
    if r.returncode != 0:
        raise RuntimeError(r.stderr.strip().splitlines()[-1] if r.stderr.strip() else 'error')
    txt = r.stdout.strip()
    ini = txt.index('[')
    fin = txt.rindex(']') + 1
    j = json.loads(txt[ini:fin])[0]
    return j.get('Planning Time', 0) + j['Execution Time'], j


def plan_anidado(sql, ruta_log):
    """Plan completo (incluido el de las consultas dentro de las RPC) vía auto_explain."""
    antes = os.path.getsize(ruta_log)
    psql("begin; load 'auto_explain'; set auto_explain.log_min_duration=0; set auto_explain.log_analyze=on;"
         " set auto_explain.log_buffers=on; set auto_explain.log_nested_statements=on; set auto_explain.log_format=text;"
         f" {sql}; rollback;", check=False)
    with open(ruta_log, 'rb') as f:
        f.seek(antes)
        return f.read().decode('utf-8', 'replace')


def grandes():
    r = psql("select relname from pg_class where relkind='r' and relnamespace='public'::regnamespace and reltuples > 50000")
    return set(x for x in r.stdout.split() if x)


def seqs(texto, tablas_grandes):
    # texto = plan(es) en formato text; Seq Scan on tabla  / Parallel Seq Scan on tabla
    encontrados = re.findall(r'Seq Scan on (?:public\.)?(\w+)', texto)
    return sorted(set(encontrados)), sorted(set(t for t in encontrados if t in tablas_grandes))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--corridas', type=int, default=20)
    ap.add_argument('--solo', default='')
    ap.add_argument('--archivo', default=os.path.join(DIR, 'consultas.sql'))
    ap.add_argument('--log', default='')
    ap.add_argument('--salida', default='')
    ap.add_argument('--plan', action='store_true', help='imprime el plan de cada consulta')
    a = ap.parse_args()

    c = C or psql("select id from tenant where nombre='ZZZ CARGA CHICA 01'").stdout.strip()
    ctx = {'T': f"'{T}'::uuid", 'C': f"'{c}'::uuid"}
    tg = grandes()
    res = []
    for q in cargar_consultas(a.archivo):
        if a.solo and a.solo not in q['nombre']:
            continue
        sql = sustituir(q['sql'], ctx)
        fila = {'nombre': q['nombre'], 'tipo': q['tipo'], 'origen': q['origen']}
        try:
            frio, j = tiempo_una(sql)
            xs = [tiempo_una(sql)[0] for _ in range(a.corridas)]
            fila.update(frio=round(frio, 1), p50=round(statistics.median(xs), 1), p95=round(p95(xs), 1), max=round(max(xs), 1))
            texto = ''
            if a.log:
                texto = plan_anidado(sql, a.log)
            else:
                r = psql(f"begin; explain (analyze, buffers) {sql}; rollback;", tuples=False, check=False)
                texto = r.stdout
            todos, malos = seqs(texto, tg)
            fila.update(seq_todas=todos, seq_grandes=malos, plan='SEQ' if malos else 'Index/otro')
            if a.plan:
                fila['plan_texto'] = texto
        except Exception as e:  # noqa: BLE001
            fila.update(error=str(e)[:300])
        res.append(fila)
        meta = 'ERROR ' + fila['error'] if 'error' in fila else f"frio={fila['frio']:>8} p50={fila['p50']:>8} p95={fila['p95']:>8} {fila['plan']}{(' ' + ','.join(fila['seq_grandes'])) if fila['seq_grandes'] else ''}"
        print(f"{q['tipo']:<8} {q['nombre']:<48} {meta}", flush=True)
    if a.salida:
        json.dump(res, open(a.salida, 'w'), indent=1, ensure_ascii=False)


if __name__ == '__main__':
    main()
