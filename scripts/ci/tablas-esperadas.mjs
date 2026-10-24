// A37-S02-02: las tablas `public` que las migraciones dejan en pie, derivadas de los propios archivos
// (create menos drop/rename, en orden). Sustituye al «exactamente 154» que fallaba siempre tras el reset.
import { readdirSync, readFileSync } from 'node:fs';

const CREATE = /create\s+(?:unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?public\.("?)([a-z0-9_]+)\1/gi;
const DROP = /drop\s+table\s+(?:if\s+exists\s+)?([^;]+);/gi;
const RENAME = /alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?public\.("?)([a-z0-9_]+)\1\s+rename\s+to\s+("?)([a-z0-9_]+)\3/gi;

export function tablasEsperadas(dir = 'supabase/migrations', leer = readFileSync, listar = readdirSync) {
  const tablas = new Set();
  for (const f of listar(dir).filter((n) => /^\d{4}_.+\.sql$/.test(n)).sort()) {
    const texto = leer(`${dir}/${f}`, 'utf8').replace(/--[^\n]*/g, '');
    const eventos = [];
    for (const m of texto.matchAll(CREATE)) eventos.push([m.index, 'c', m[2].toLowerCase()]);
    for (const m of texto.matchAll(DROP)) {
      for (const t of m[1].matchAll(/public\.("?)([a-z0-9_]+)\1/gi)) eventos.push([m.index, 'd', t[2].toLowerCase()]);
    }
    for (const m of texto.matchAll(RENAME)) eventos.push([m.index, 'r', m[2].toLowerCase(), m[4].toLowerCase()]);
    for (const [, tipo, a, b] of eventos.sort((x, y) => x[0] - y[0])) {
      if (tipo === 'c') tablas.add(a);
      else if (tipo === 'd') tablas.delete(a);
      else if (tablas.delete(a)) tablas.add(b);
    }
  }
  return [...tablas].sort();
}
