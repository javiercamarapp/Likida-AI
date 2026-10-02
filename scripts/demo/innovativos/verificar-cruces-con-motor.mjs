#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// Verifica que los veredictos de GPS SEMBRADOS en desglose_peaje_linea son los
// que el motor REAL de cruce (peajes/cruce_gps.ts → evaluarCruceGps) calcularía
// con las posiciones sembradas. Así el demo no afirma nada que el producto no
// reproduzca: si algún día cambia la doctrina del cruce, esto lo delata.
//
//   DEMO_DATABASE_URL='postgresql:///likida_demo' node scripts/demo/innovativos/verificar-cruces-con-motor.mjs
// Sale 0 si coinciden todas las líneas; 1 si no.
// ═══════════════════════════════════════════════════════════════════════════
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { exigirBaseLocal } from './guarda-host.mjs';

exigirBaseLocal(); // misma guarda que sembrar.sh, antes de abrir ninguna conexión
const URL_DB = process.env.DEMO_DATABASE_URL;
if (!URL_DB) { console.error('Define DEMO_DATABASE_URL.'); process.exit(2); }
const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const { createJiti } = createRequire(import.meta.url)('jiti');
const jiti = createJiti(import.meta.url, { alias: { '@': join(raiz, 'src') }, moduleCache: false });
const { evaluarCruceGps, VENTANA_GPS_MIN } = await jiti.import(join(raiz, 'src/lib/likida/peajes/cruce_gps.ts'));

const q = `select coalesce(json_agg(x), '[]'::json) from (
  select l.indice, l.gps_veredicto as sembrado, l.detalle ->> 'origen_demo' as origen, extract(epoch from l.cruce_en) * 1000 as cruce_ms,
         c.lat, c.lng, c.radio_m,
         (select coalesce(json_agg(json_build_object('lat', p.lat, 'lng', p.lng, 't', extract(epoch from p.medida_en) * 1000) order by p.medida_en), '[]'::json)
            from posicion p where p.tenant_id = l.tenant_id and p.unidad_id = l.unidad_id
              and p.medida_en between l.cruce_en - interval '${VENTANA_GPS_MIN} minutes' and l.cruce_en + interval '${VENTANA_GPS_MIN} minutes') as muestras
  from desglose_peaje_linea l join peaje_caseta c on c.id = l.caseta_id
  where l.tenant_id = 'eeeeeeee-0620-4000-8000-000000000250' order by l.indice) x`;
const filas = JSON.parse(execFileSync('psql', [URL_DB, '-Atq', '-v', 'ON_ERROR_STOP=1', '-c', q], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }));
let mal = 0; const cuenta = {};
for (const f of filas) {
  const v = evaluarCruceGps(f.cruce_ms, { id: String(f.indice), lat: f.lat, lng: f.lng, radioM: f.radio_m }, f.muestras);
  const k = `${f.origen}: motor=${v.veredicto} sembrado=${f.sembrado}`;
  cuenta[k] = (cuenta[k] ?? 0) + 1;
  if (v.veredicto !== f.sembrado) { mal++; if (mal <= 10) console.log(`  DIFIERE línea ${f.indice}: motor=${v.veredicto} (${v.motivo ?? v.via ?? ''}) sembrado=${f.sembrado}`); }
}
for (const [k, n] of Object.entries(cuenta).sort()) console.log(`  ${String(n).padStart(4)}  ${k}`);
console.log(mal === 0 ? `OK: las ${filas.length} líneas coinciden con el motor real.` : `FALLA: ${mal} de ${filas.length} líneas difieren.`);
process.exit(mal === 0 ? 0 : 1);
