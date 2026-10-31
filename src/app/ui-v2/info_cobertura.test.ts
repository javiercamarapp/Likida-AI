/* eslint-disable security/detect-non-literal-fs-filename -- recorre el árbol del repo con rutas propias */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { INFO, type InfoTexto } from './info-catalogo';

// ═══════════════════════════════════════════════════════════════════════════
// COBERTURA DE ⓘ (L4): cada cifra (`<Cifra>`) y cada recuadro con título de las páginas migradas lleva su ⓘ del catálogo.
//  · `<Cifra …>` sin `info=` falla.
//  · En un archivo con `MarcoPagina`, un `<h2>` / `<h3>` suelto falla: el título de un recuadro es `<TituloRecuadro info=…>` (o `Tarjeta
//    info=…`). Si de verdad no es el título de un recuadro (p. ej. el de un diálogo), se marca en la línea anterior o en la misma con
//    `sin-info: <motivo>` dentro de un comentario.
//  · Ninguna entrada nueva del catálogo queda `por_confirmar` (solo las dos del Resumen que ya estaban).
// ═══════════════════════════════════════════════════════════════════════════

const RAIZ = join(process.cwd(), 'src/app/dashboard');
function tsx(dir: string, salida: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const r = join(dir, n);
    if (statSync(r).isDirectory()) { tsx(r, salida); continue; }
    if (n.endsWith('.tsx') && !/\.test\./.test(n)) salida.push(r);
  }
  return salida;
}
const todos = tsx(RAIZ).map((f) => ({ f, ruta: relative(RAIZ, f), src: readFileSync(f, 'utf8') }));

/** Etiquetas JSX `<Nombre … >` completas (con llaves anidadas), para mirar sus atributos. */
function etiquetas(src: string, nombre: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`<${nombre}(?=[\\s/>])`, 'g');
  for (let m = re.exec(src); m; m = re.exec(src)) {
    let d = 0, q: string | null = null, j = m.index;
    for (; j < src.length; j++) {
      const c = src[j];
      if (q) { if (c === '\\') j++; else if (c === q) q = null; continue; }
      if (c === '"' || c === "'" || c === '`') q = c;
      else if (c === '{') d++;
      else if (c === '}') d--;
      else if (c === '>' && d === 0) break;
    }
    out.push(src.slice(m.index, j + 1));
  }
  return out;
}


/** Archivos hijo (sin `MarcoPagina`) con títulos de recuadro todavía sin ⓘ al cerrar L4: 52 archivos, 96 títulos. Pendiente declarado: cada vez que uno se
 *  cubre, su tope baja o se borra la línea. Un archivo nuevo o un tope superado hace fallar la prueba. */
const HIJOS_SIN_CUBRIR: Record<string, number> = {
  '[id]/revision-panel.tsx': 1,
  'agentes/carta-porte/configuracion/seccion_ccp.tsx': 1,
  'agentes/carta-porte/configuracion/seccion_primer_mes.tsx': 1,
  'agentes/cobranza/page.tsx': 1,
  'agentes/conductores/configuracion/documentos_cliente.tsx': 1,
  'agentes/conductores/configuracion/forma.tsx': 1,
  'agentes/conductores/configuracion/preflight.tsx': 2,
  'agentes/conductores/constancia-vista.tsx': 1,
  'agentes/estrategia-forma.tsx': 1,
  'agentes/facturas/control-emision.tsx': 3,
  'agentes/facturas/portales-vinculo.tsx': 1,
  'agentes/ficha-corridas.tsx': 1,
  'agentes/insights/panel-insights.tsx': 1,
  'agentes/insights/tarjeta-insight.tsx': 1,
  'agentes/liquidacion/cargas.tsx': 3,
  'agentes/liquidacion/cola.tsx': 1,
  'agentes/liquidacion/conteos-nomina.tsx': 1,
  'agentes/liquidacion/externas.tsx': 1,
  'agentes/peajes/candidatos-tabla.tsx': 2,
  'agentes/peajes/configuracion/clases-cobro.tsx': 1,
  'agentes/peajes/configuracion/cruce-viajes.tsx': 1,
  'agentes/peajes/configuracion/entradas.tsx': 1,
  'agentes/peajes/configuracion/inmovilizadas.tsx': 1,
  'agentes/peajes/configuracion/reglas-cobro.tsx': 4,
  'agentes/peajes/configuracion/tarifario.tsx': 1,
  'agentes/peajes/configuracion/umbrales-avisos.tsx': 4,
  'agentes/peajes/reclamacion/revision.tsx': 4,
  'agentes/peajes/revision-cobros.tsx': 2,
  'agentes/proveedores/seccion_buzon.tsx': 3,
  'agentes/seccion-notificaciones.tsx': 1,
  'carta-porte/borrador/[viajeId]/page.tsx': 6,
  'carta-porte/documentos/[id]/vista.tsx': 1,
  'conexiones/page.tsx': 1,
  'conexiones/seccion-credenciales.tsx': 1,
  'conexiones/seccion-gps.tsx': 4,
  'conexiones/seccion-integraciones.tsx': 2,
  'configuracion/forma.tsx': 2,
  'contador/timbrado.tsx': 1,
  'inicio-cinco-agentes.tsx': 1,
  'jornada/formas.tsx': 4,
  'onboarding/forma.tsx': 4,
  'opera-whatsapp.tsx': 1,
  'operadores/invitaciones.tsx': 1,
  'primera-liquidacion.tsx': 1,
  'puesta-en-marcha/vista.tsx': 3,
  'reglas/vista.tsx': 2,
  'resumen-visual.tsx': 1,
  'shell/navegacion-v2.tsx': 2,
  'timbrado/[viajeId]/timbrar.tsx': 4,
  'unidades/taller.tsx': 4,
  'viajes-en-vivo/pregunta.tsx': 1,
};

describe('ⓘ: cobertura de cifras y recuadros en las páginas migradas', () => {
  it('toda <Cifra> lleva info=', () => {
    const faltan = todos.flatMap(({ ruta, src }) => etiquetas(src, 'Cifra').filter((t) => !/\binfo=/.test(t)).map((t) => `${ruta}: ${t.slice(0, 70).replace(/\s+/g, ' ')}`));
    expect(faltan, `Cifras sin ⓘ (${faltan.length}):\n${faltan.join('\n')}`).toEqual([]);
  });

  it('en las páginas con MarcoPagina no hay <h2>/<h3> sueltos (usa TituloRecuadro, Tarjeta o sin-info: motivo)', () => {
    const sueltos: string[] = [];
    for (const { ruta, src } of todos) {
      if (!src.includes('MarcoPagina')) continue;
      const lineas = src.split('\n');
      lineas.forEach((l, i) => {
        if (!/<h[23][\s>]/.test(l)) return;
        if (/sin-info:/.test(l) || /sin-info:/.test(lineas[i - 1] ?? '')) return;
        sueltos.push(`${ruta}:${i + 1}: ${l.trim().slice(0, 80)}`);
      });
    }
    expect(sueltos, `Títulos de recuadro sin ⓘ (${sueltos.length}):\n${sueltos.join('\n')}`).toEqual([]);
  });

  it('en el resto de dashboard/** los <h2>/<h3> sueltos NO crecen: lista explícita de archivos hijo aún sin cubrir (solo puede bajar)', () => {
    const sueltosDe = (src: string) => src.split('\n').filter((l, i, a) => /<h[23][\s>]/.test(l) && !/sin-info:/.test(l) && !/sin-info:/.test(a[i - 1] ?? '')).length;
    const excesos: string[] = [];
    const obsoletos: string[] = [];
    for (const { ruta, src } of todos) {
      if (src.includes('MarcoPagina')) continue;
      const n = sueltosDe(src);
      const tope = HIJOS_SIN_CUBRIR[ruta] ?? 0;
      if (n > tope) excesos.push(`${ruta}: ${n} > ${tope}`);
      if (n < tope) obsoletos.push(`${ruta}: ${n} < ${tope} (baja el tope en HIJOS_SIN_CUBRIR)`);
    }
    for (const r of Object.keys(HIJOS_SIN_CUBRIR)) if (!todos.some((t) => t.ruta === r)) obsoletos.push(`${r}: el archivo ya no existe`);
    expect(excesos, `Títulos sueltos nuevos (usa TituloRecuadro con info):\n${excesos.join('\n')}`).toEqual([]);
    expect(obsoletos, `Topes obsoletos:\n${obsoletos.join('\n')}`).toEqual([]);
  });

  it('la etiqueta visible de cada <Cifra> no contradice el título de su ⓘ (igual o uno contiene al otro)', () => {
    const norm = (x: string) => x.toLowerCase().replace(/[^a-záéíóúñ ]/g, '').replace(/\s+/g, ' ').trim();
    // Alias reconocidos: la misma cifra se rotula distinto en dos pantallas (el título de la ⓘ nombra los dos).
    const ALIAS: Record<string, string[]> = {
      'despacho.pod_pendientes': ['pod pendientes', 'sin evidencia de entrega'],
      'despacho.unidades_libres': ['unidades libres'],
      'cobranza.gasto_avisos': ['avisos'],
      'operadores.licencias_por_vencer': ['vencen en'],
    };
    const malos: string[] = [];
    for (const { ruta, src } of todos) {
      for (const t of etiquetas(src, 'Cifra')) {
        const e = /etiqueta=(?:"([^"]*)"|\{`([^`$]*)[`$])/.exec(t);
        const k = /info="([^"]+)"/.exec(t);
        const rotulo = e?.[1] ?? e?.[2];
        if (!rotulo || !k) continue;
        const titulo = (INFO as Record<string, InfoTexto | undefined>)[k[1]]?.titulo;
        if (!titulo) continue;
        const a = norm(rotulo), b = norm(titulo);
        if (a === b || a.startsWith(b) || b.startsWith(a) || a.includes(b) || b.includes(a)) continue;
        if ((ALIAS[k[1]] ?? []).some((x) => a.startsWith(x))) continue;
        malos.push(`${ruta}: «${rotulo}» vs ⓘ «${titulo}» (${k[1]})`);
      }
    }
    expect(malos, `Rótulo y ⓘ se contradicen:\n${malos.join('\n')}`).toEqual([]);
  });

  it('el catálogo no gana textos por_confirmar (solo los dos del Resumen)', () => {
    const pend = (Object.entries(INFO) as Array<[string, InfoTexto]>).filter(([, t]) => t.estado === 'por_confirmar').map(([k]) => k).sort();
    expect(pend).toEqual(['resumen.a_tiempo', 'resumen.diferencias_recuperado']);
  });

  it('toda clave sigue la forma <pagina>.<recuadro>, con título legible, «Qué es» de una línea y tono de guía (sin exclamaciones ni emojis)', () => {
    for (const [k, t] of Object.entries(INFO) as Array<[string, InfoTexto]>) {
      expect(k.split('.').length, k).toBeGreaterThan(1);
      for (const parte of k.split('.')) expect(parte, k).toMatch(/^[a-z0-9_-]+$/);
      expect(t.titulo.trim().length, k).toBeGreaterThan(3);
      expect(t.queEs, k).not.toMatch(/\n/);
      expect(t.queEs.length, k).toBeLessThanOrEqual(110);
      // Tono de guía (ANEXO C): sin exclamaciones, sin emojis.
      for (const campo of [t.queEs, t.comoSeCalcula, t.fuente, t.queHacer ?? '']) expect(campo, k).not.toMatch(/[!¡]|\p{Extended_Pictographic}/u);
    }
  });
});
