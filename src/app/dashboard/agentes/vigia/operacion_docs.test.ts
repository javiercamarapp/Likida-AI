/* eslint-disable security/detect-non-literal-fs-filename, security/detect-unsafe-regex -- prueba que lee/escribe rutas del propio repo o de un directorio temporal; ninguna ruta ni patrón viene de entrada de usuario. */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// T-A4-43: la documentación de operación del aviso proactivo y su runbook de reversión dicen lo mismo que el código y las migraciones.
// Sin base ni red: lee archivos. Si una migración 0795-0799 cambia su bloque ROLLBACK, sus valores por omisión o sus estados, esta
// prueba falla hasta que los documentos se corrijan (igual que las pruebas doc↔código de plantillas y de plazos).
const RAIZ = process.cwd();
const leer = (ruta: string) => readFileSync(join(RAIZ, ruta), 'utf8');
const MIGRACIONES = ['0795_programa_despacho', '0796_vigia_datos_viaje', '0797_vigia_aviso', '0798_vigia_servicio_prioridad', '0799_vigia_estatus_importacion'] as const;
const ORDEN_INVERSO = ['0799', '0798', '0797', '0796', '0795'] as const;

const PROACTIVO = 'docs/operacion/vigia-aviso-proactivo.md';
const ROLLBACK = 'docs/operacion/vigia-aviso-rollback.md';
const CLIENTE = 'docs/operacion/vigia-cliente.md';
const INDICE = 'docs/operacion/indice-agentes.md';

/** Sentencias SQL del bloque `-- ROLLBACK` de la cabecera de una migración, sin comentarios finales y con espacios normalizados. */
function sentenciasRollback(migracion: string): string[] {
  const lineas = leer(`supabase/migrations/${migracion}.sql`).split('\n');
  const desde = lineas.findIndex((l) => /^-- ROLLBACK/.test(l));
  expect(desde, `bloque ROLLBACK en ${migracion}`).toBeGreaterThan(-1);
  let sql = '';
  for (const l of lineas.slice(desde + 1)) {
    if (!/^--( |$)/.test(l) || /^-- ═/.test(l)) break;
    const texto = l.replace(/^--\s?/, '').replace(/\s--\s.*$/, '').trim();
    const pendiente = sql !== '' && !/;\s*$/.test(sql);
    // solo cuenta lo que empieza una sentencia SQL o continúa una sin cerrar; la prosa de la cabecera se salta
    if (pendiente || /^(drop|alter|update)\b/i.test(texto)) sql += ` ${texto}`;
  }
  return sql.split(';').map(normalizar).filter(Boolean);
}
const normalizar = (s: string) => s.replace(/\s+/g, ' ').replace(/\s*([(),])\s*/g, '$1').trim().toLowerCase();

/** Bloque ```sql que sigue al encabezado «### Revertir NNNN». */
function bloqueDeReversion(doc: string, numero: string): string {
  const m = new RegExp(`### Revertir ${numero}[\\s\\S]*?\`\`\`sql\\n([\\s\\S]*?)\`\`\``).exec(doc);
  expect(m, `bloque «Revertir ${numero}» en ${ROLLBACK}`).not.toBeNull();
  return m![1]!;
}

describe('runbook de rollback = bloque ROLLBACK de cada migración', () => {
  const doc = leer(ROLLBACK);

  for (const mig of MIGRACIONES) {
    const numero = mig.slice(0, 4);
    it(`${numero}: cada sentencia del ROLLBACK de la migración está en el runbook, en una transacción`, () => {
      const esperadas = sentenciasRollback(mig);
      expect(esperadas.length, `sentencias del ROLLBACK de ${mig}`).toBeGreaterThan(0);
      const bloque = bloqueDeReversion(doc, numero);
      expect(bloque.trim().startsWith('begin;'), 'abre transacción').toBe(true);
      expect(bloque.trim().endsWith('commit;'), 'cierra transacción').toBe(true);
      const presentes = bloque.split(';').map(normalizar);
      for (const s of esperadas) expect(presentes, `«${s}» falta en el runbook de ${numero}`).toContain(s);
      // y el runbook no agrega nada destructivo que la migración no tenga
      const permitidas = new Set([...esperadas, 'begin', 'commit', '']);
      for (const s of presentes) expect(permitidas.has(s), `«${s}» sobra en el runbook de ${numero}`).toBe(true);
    });
  }

  it('los bloques van en orden inverso: 0799, 0798, 0797, 0796, 0795', () => {
    const posiciones = ORDEN_INVERSO.map((n) => doc.indexOf(`### Revertir ${n}`));
    for (const p of posiciones) expect(p).toBeGreaterThan(-1);
    expect([...posiciones].sort((a, b) => a - b)).toEqual(posiciones);
  });

  it('dice que no hay des-envío, que la copia de seguridad es previa y que se revierte una por una', () => {
    expect(doc).toMatch(/no se puede «des-enviar»/i);
    expect(doc).toMatch(/Copia de seguridad previa/);
    expect(doc).toMatch(/Una por una, en orden inverso/);
    expect(doc).toMatch(/vigia_aviso_config\s+set habilitado = false/);
  });

  it('avisa que revertir la 0798 quita «solo avisar» y devuelve el copiloto', () => {
    expect(doc).toMatch(/`solo_avisar`/);
    expect(doc).toMatch(/copiloto/);
  });

  it('el UPDATE de limpieza usa solo estados desde los que la base permite descartar', () => {
    const trigger = leer('supabase/migrations/0797_vigia_aviso.sql');
    const m = /where tenant_id = '<id de la flota>'\s+and estado in \(([^)]*)\);/.exec(doc);
    expect(m, 'UPDATE de limpieza').not.toBeNull();
    const estados = [...m![1]!.matchAll(/'([a-z_]+)'/g)].map((x) => x[1]!);
    expect(estados.length).toBeGreaterThan(0);
    for (const e of estados) {
      const linea = trigger.split('\n').find((l) => l.includes(`old.estado = '${e}'`));
      expect(linea, `transición desde ${e}`).toBeDefined();
      expect(linea, `${e} → descartado`).toMatch(/'descartado'/);
    }
  });
});

describe('guía de operación = migraciones y código', () => {
  const doc = leer(PROACTIVO);
  const m797 = leer('supabase/migrations/0797_vigia_aviso.sql');

  it('el estado de un aviso: todos los del CHECK están explicados', () => {
    const check = /vigia_aviso_estado check \(estado in \(([^)]*)\)\)/s.exec(m797);
    expect(check, 'CHECK de estados').not.toBeNull();
    const estados = [...check![1]!.matchAll(/'([a-z_]+)'/g)].map((x) => x[1]!);
    expect(estados.sort()).toEqual(['aprobado', 'borrador', 'descartado', 'enviado', 'fallido', 'pendiente_confirmacion', 'reemplazado', 'sin_destinatario']);
    for (const e of estados) expect(doc, `estado ${e}`).toContain(e);
  });

  it('los valores por omisión de la tabla de configuración son los que la guía afirma', () => {
    expect(m797).toMatch(/habilitado\s+boolean not null default false/);
    expect(m797).toMatch(/modo\s+text not null default 'confirmar'/);
    expect(m797).toMatch(/canal_default\s+text not null default 'ejecutivo_copia'/);
    expect(m797).toMatch(/max_reenvios\s+integer not null default 3/);
    expect(m797).toMatch(/debounce_min\s+integer not null default 10/);
    expect(m797).toMatch(/autonomo_min_confirmaciones integer not null default 5/);
    expect(m797).toMatch(/zona\s+text not null default 'America\/Mexico_City'/);
    expect(m797).toMatch(/horas_antes_cita is null or horas_antes_cita between 0 and 72/);
    expect(m797).toMatch(/max_reenvios between 0 and 20/);
    expect(m797).toMatch(/debounce_min between 0 and 1440/);
    expect(m797).toMatch(/autonomo_min_confirmaciones between 0 and 1000/);
    expect(doc).toMatch(/\| Horas antes de la cita \(`horas_antes_cita`\) \| 0–72/);
    expect(doc).toMatch(/`max_reenvios` 0–20, `debounce_min` 0–1440 \| 3 y 10/);
    expect(doc).toMatch(/`autonomo_min_confirmaciones` 0–1000 \| 5/);
    expect(doc).toMatch(/`America\/Mexico_City`/);
  });

  it('la configuración nace apagada y el modo nace en confirmar (se dice sin ambigüedad)', () => {
    expect(doc).toMatch(/\*\*apagado\*\* \(sin fila de configuración = apagado\)/);
    expect(doc).toMatch(/Por omisión no manda nada solo/);
    expect(doc).toMatch(/\| Modo \| `confirmar` \/ `autonomo` \| `confirmar`/);
  });

  it('los números que la guía da del código son los del código', () => {
    const listo = leer('src/lib/likida/vigia/aviso/listo.ts');
    expect(listo).toMatch(/ccpListos: \['listo', 'despachado'\]/);
    expect(listo).toContain('proxy: regla provisional hasta tener el archivo con colores');
    expect(doc.replace(/\s+/g, ' ')).toContain('proxy: regla provisional hasta tener el archivo con colores');
    const cola = leer('src/lib/likida/vigia/aviso/cola.ts');
    expect(cola).toMatch(/HORAS_PENDIENTE_VIEJO = 2;/);
    expect(cola).toMatch(/UMBRAL_FALLIDOS_ALERTA = 3;/);
    expect(doc).toMatch(/más de 2 horas/);
    expect(doc).toMatch(/Con 3 o más en la misma pasada/);
    const generar = leer('src/lib/likida/vigia/aviso/generar.ts');
    expect(generar).toMatch(/TOPE_FILAS_POR_PASADA = 200;/);
    expect(generar).toMatch(/VENTANA_HORAS = 48;/);
    expect(doc).toMatch(/200 filas por pasada/);
    expect(doc).toMatch(/48 h/);
    expect(leer('src/lib/likida/vigia/aviso/cambios.ts')).toMatch(/DIAS_REVISION = 7;/);
  });

  it('las plantillas que nombra existen en el catálogo versionado', () => {
    const catalogo = leer('src/lib/meta/plantillas_catalogo.ts');
    for (const nombre of ['vigia_aviso_viaje_v1', 'vigia_aviso_cambio_v1']) {
      expect(doc, nombre).toContain(nombre);
      expect(catalogo, `catálogo: ${nombre}`).toContain(nombre);
    }
  });

  it('la pasada de avisos corre con el mantenimiento y la guía lo dice', () => {
    const servicio = leer('src/lib/likida/vigia/servicio.ts');
    const retorno = servicio.indexOf('if (opciones.mantenimiento === false) return r;');
    const pasada = servicio.indexOf('await pasadaAvisos(deps, ahora, r, opciones.vencePorReloj, saltar);');
    expect(retorno).toBeGreaterThan(-1);
    expect(pasada).toBeGreaterThan(retorno);
    expect(doc).toMatch(/cada 5 minutos/);
  });

  it('no promete lo que no hace: grupos en vivo solo negados, sin contestar solo, sin des-envío', () => {
    for (const l of doc.split('\n').filter((x) => /en vivo/i.test(x))) expect(l, l).toMatch(/\b(no|nunca|ni|sin)\b/i);
    expect(doc).toMatch(/\*\*No contesta solo\.\*\*/);
    expect(doc).toMatch(/\*\*No «des-envía»\.\*\*/);
    expect(doc).toMatch(/Estado al 15-oct-2026/);
    expect(doc).toMatch(/no están aplicadas en una base\s+(>\s+)?real/);
  });
});

describe('índice y guía del Vigía al día', () => {
  it('vigia-cliente.md cita las cinco migraciones, solo_avisar, servicio al cliente, N y turnos', () => {
    const doc = leer(CLIENTE);
    for (const n of ['0795', '0796', '0797', '0798', '0799']) expect(doc, n).toContain(`\`${n}\``);
    expect(doc).toMatch(/`solo_avisar`/);
    expect(doc).toMatch(/vigia_servicio_cliente/);
    expect(doc).toMatch(/N, el plazo de aviso/);
    expect(doc).toMatch(/\*\*Turnos\*\*/);
    expect(doc).toContain('vigia-aviso-proactivo.md');
    expect(doc).toContain('vigia-aviso-rollback.md');
  });

  it('indice-agentes.md lista el Vigía con sus tres documentos y las migraciones 0795-0799', () => {
    const fila = leer(INDICE).split('\n').find((l) => l.startsWith('| 4 Vigía'));
    expect(fila).toBeDefined();
    for (const d of ['vigia-cliente.md', 'vigia-aviso-proactivo.md', 'vigia-aviso-rollback.md', '0795-0799']) expect(fila).toContain(d);
  });

  it('las migraciones que citan existen en el repositorio', () => {
    for (const mig of MIGRACIONES) expect(existsSync(join(RAIZ, `supabase/migrations/${mig}.sql`)), mig).toBe(true);
  });

  it('todo enlace relativo a otro documento de operación apunta a un archivo que existe', () => {
    for (const ruta of [PROACTIVO, ROLLBACK]) {
      for (const m of leer(ruta).matchAll(/\]\(([a-z0-9_-]+\.md)\)/g)) {
        expect(existsSync(join(RAIZ, 'docs/operacion', m[1]!)), `${ruta} → ${m[1]}`).toBe(true);
      }
    }
  });

  it('los documentos no traen cifras de dinero ni cadenas de conexión', () => {
    for (const ruta of [PROACTIVO, ROLLBACK]) {
      const t = leer(ruta);
      expect(t, ruta).not.toMatch(/\$\s?\d/);
      expect(t, ruta).not.toMatch(/postgres(ql)?:\/\//i);
      expect(t, ruta).not.toMatch(/eyJ[A-Za-z0-9_-]{20,}/);
    }
  });
});
