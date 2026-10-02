#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// Genera los VEREDICTOS de ubicación (viaje_hito_validacion) de los hitos de llegada de los viajes EN CURSO,
// corriendo el motor REAL del Conductor (conductor/validar_hito.ts → validarHitoContraSitio →
// evaluarUbicacion) sobre lo sembrado: el sitio que espera el viaje (geocerca), la posición del pin del
// chofer (si el hito fue por ubicación) o las posiciones GPS de `posicion` alrededor de la hora del mensaje.
//
// POR QUÉ ASÍ: el seed solo siembra los DATOS (hitos, posiciones, geocercas). El veredicto no se escribe a
// mano: lo calcula el mismo código que corre el producto. Si algún día cambia la doctrina de validación,
// el demo cambia con ella (y si el seed deja de producir la excepción «ya llegué» sin GPS, la prueba
// verificar-veredictos.mjs lo delata).
//
//   DEMO_DATABASE_URL='postgresql:///likida_demo' node scripts/demo/innovativos/generar-veredictos.mjs
// Lo corre sembrar.sh después de sembrar.sql. Idempotente: borra los veredictos del tenant demo y los regenera.
// ═══════════════════════════════════════════════════════════════════════════
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const T = 'eeeeeeee-0620-4000-8000-000000000250';
const URL_DB = process.env.DEMO_DATABASE_URL;
if (!URL_DB) { console.error('Define DEMO_DATABASE_URL.'); process.exit(2); }
const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const { createJiti } = createRequire(import.meta.url)('jiti');
const jiti = createJiti(import.meta.url, { alias: { '@': join(raiz, 'src') }, moduleCache: false });
const { validarHitoContraSitio } = await jiti.import(join(raiz, 'src/lib/likida/conductor/validar_hito.ts'));

const psql = (args, input) => execFileSync('psql', [URL_DB, '-Atq', '-v', 'ON_ERROR_STOP=1', ...args], { encoding: 'utf8', input, maxBuffer: 256 * 1024 * 1024 });

const [cfg] = JSON.parse(psql(['-c', `select coalesce(json_agg(c), '[]') from (select validar_ubicacion as "validarUbicacion", tolerancia_ubicacion_m as "toleranciaUbicacionM", ventana_ubicacion_min as "ventanaUbicacionMin", pedir_ubicacion as "pedirUbicacion" from agente_conductor_config where tenant_id = '${T}') c`]));
if (!cfg) { console.error('El tenant demo no tiene agente_conductor_config: siembra primero.'); process.exit(2); }

const filas = JSON.parse(psql(['-c', `select coalesce(json_agg(x), '[]') from (
  select h.id as hito_id, h.viaje_id, h.tipo, h.estado, h.ciclo, h.fuente, h.lat, h.lng,
         extract(epoch from coalesce(h.mensaje_en, h.recibido_en)) * 1000 as mensaje_ms,
         extract(epoch from h.recibido_en) * 1000 as recibido_ms,
         v.unidad_id,
         g.id as sitio_id, g.nombre as sitio_nombre, g.lat as sitio_lat, g.lng as sitio_lng, g.radio_m as sitio_radio,
         (select coalesce(json_agg(json_build_object('lat', p.lat, 'lng', p.lng, 't', extract(epoch from p.medida_en) * 1000) order by p.medida_en), '[]'::json)
            from posicion p where p.tenant_id = h.tenant_id and p.unidad_id = v.unidad_id
              and p.medida_en between coalesce(h.mensaje_en, h.recibido_en) - make_interval(mins => ${Number(cfg.ventanaUbicacionMin)})
                                  and coalesce(h.mensaje_en, h.recibido_en) + make_interval(mins => ${Number(cfg.ventanaUbicacionMin)})) as gps
  from viaje_hito h
  join viaje v on v.id = h.viaje_id and v.tenant_id = h.tenant_id
  left join geocerca g on g.tenant_id = v.tenant_id
       and g.id = case when h.tipo = 'llegada_carga' then v.origen_geocerca_id else v.destino_geocerca_id end
  where h.tenant_id = '${T}' and v.estatus = 'abierto' and h.tipo in ('llegada_carga', 'llegada_descarga')
    and h.estado in ('recibido', 'validado')
  order by v.folio, h.tipo) x`]));

if (filas.length === 0) { console.error('FALLA: no hay hitos de llegada de viajes en curso: nada que validar.'); process.exit(1); }

let actual = null;
const veredictos = [];
const deps = {
  sitio: async () => (actual.sitio_id ? { id: actual.sitio_id, nombre: actual.sitio_nombre, lat: actual.sitio_lat, lng: actual.sitio_lng, radioM: actual.sitio_radio } : null),
  posiciones: async (_t, _u, desde, hasta) => actual.gps
    .filter((p) => p.t >= desde.getTime() && p.t <= hasta.getTime())
    .map((p) => ({ lat: p.lat, lng: p.lng, medidaEn: new Date(p.t), fuente: 'gps' })),
  aplicar: async (_t, hito, v) => { veredictos.push({ hito, v }); return 'ok'; },
};

// El logger del producto escribe en stdout cada veredicto: aquí solo estorba.
const consolaLog = console.log; console.log = () => {};
for (const f of filas) {
  actual = f;
  const hito = { id: f.hito_id, tenantId: T, viajeId: f.viaje_id, tipo: f.tipo, estado: f.estado, ciclo: f.ciclo, fuente: f.fuente };
  const pin = f.fuente === 'ubicacion' && f.lat != null && f.lng != null ? { lat: f.lat, lng: f.lng, medidaEn: new Date(f.recibido_ms) } : null;
  const r = await validarHitoContraSitio(deps, {
    viaje: { id: f.viaje_id, tenantId: T, unidadId: f.unidad_id }, hito, config: cfg,
    mensajeEn: new Date(f.mensaje_ms), pin, ahora: new Date(f.recibido_ms),
  });
  if (!r) { console.error(`FALLA: el motor no devolvió veredicto para el hito ${f.hito_id}`); process.exit(1); }
}

console.log = consolaLog;

const num = (x) => (x == null ? 'null' : String(Math.round(x)));
const str = (x) => (x == null ? 'null' : `'${String(x).replace(/'/g, "''")}'`);
const values = veredictos.map(({ hito, v }) => `('${T}','${hito.viajeId}','${hito.id}',${hito.ciclo},${str(v.resultado)},${str(v.motivo)},${str(v.fuente)},${num(v.distanciaM)},${num(v.toleranciaM)},${num(v.radioM)},${v.sitioId ? `'${v.sitioId}'` : 'null'},${v.medidaEn ? `'${v.medidaEn.toISOString()}'` : 'null'})`);
psql([], `begin;
delete from viaje_hito_validacion where tenant_id = '${T}';
insert into viaje_hito_validacion (tenant_id, viaje_id, viaje_hito_id, ciclo, resultado, motivo, fuente, distancia_m, tolerancia_m, radio_m, sitio_id, medida_en)
values ${values.join(',\n')};
commit;
`);

// La excepción que el guion enseña tiene que EXISTIR: los viajes sembrados como «llegue_sin_gps» (el chofer escribió
// «ya llegué» y el GPS dice que no) son exactamente los que el motor marcó sin_coincidencia. Si no, el seed y el
// motor se desalinearon y el demo no puede prometer esa excepción.
const esperados = psql(['-c', "select folio from innovativos_sim.plan_viaje where escenario = 'llegue_sin_gps' order by folio"]).trim().split('\n').filter(Boolean);
const obtenidos = psql(['-c', `select v.folio from viaje_hito_validacion vv join viaje v on v.id = vv.viaje_id and v.tenant_id = vv.tenant_id where vv.tenant_id = '${T}' and vv.resultado = 'sin_coincidencia' order by v.folio`]).trim().split('\n').filter(Boolean);
if (esperados.length === 0 || JSON.stringify(esperados) !== JSON.stringify(obtenidos)) {
  console.error(`FALLA: los «ya llegué» sin GPS sembrados (${esperados.join(', ') || 'ninguno'}) no coinciden con los sin_coincidencia del motor (${obtenidos.join(', ') || 'ninguno'}).`);
  process.exit(1);
}

const cuenta = {};
for (const { v } of veredictos) { const k = `${v.resultado}${v.motivo ? ` (${v.motivo})` : ''}`; cuenta[k] = (cuenta[k] ?? 0) + 1; }
console.log(`veredictos generados con el motor real: ${veredictos.length}`);
for (const [k, n] of Object.entries(cuenta).sort()) console.log(`  ${String(n).padStart(4)}  ${k}`);
