import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { estadoPanel, liquidacionesDeViajes } from './estado';

// ═══════════════════════════════════════════════════════════════════════════
// "AÚN NO HAY LIQUIDACIONES" ES UNA AFIRMACIÓN, Y SE ESTABA HACIENDO A CIEGAS.
//
// Escenario del reporte (auditoría 5, frontend, CRÍTICO): Supabase no responde
// durante el demo del 6-ago. Antes del arreglo las tres consultas devolvían
// ceros —no `null`—, así que el panel afirmaba con tipografía impecable que la
// flota nunca ha liquidado un viaje. Con las consultas ya lanzando, aquí se
// fija la otra mitad: qué pantalla se elige con cada combinación.
// ═══════════════════════════════════════════════════════════════════════════

const KPIS_VACIOS = { viajesLiquidados: 0 };
const KPIS_CON_DATOS = { viajesLiquidados: 12 };

describe('estadoPanel', () => {
  it('todo caído → error, nunca "aún no hay liquidaciones"', () => {
    expect(estadoPanel({ acreditables: null, kpis: null, liquidaciones: null, anomalias: null })).toBe('error');
  });

  it('un tenant de verdad vacío → vacio', () => {
    expect(estadoPanel({ acreditables: {}, kpis: KPIS_VACIOS, liquidaciones: [], anomalias: [] })).toBe('vacio');
  });

  it('solo se cayó el listado → parcial, no vacio', () => {
    // Este es el fallo parcial que el reporte llama "peor": KPIs con 12 viajes
    // y $340,000 arriba, tabla con cero filas abajo.
    expect(estadoPanel({ acreditables: {}, kpis: KPIS_CON_DATOS, liquidaciones: null, anomalias: [] })).toBe('parcial');
  });

  it('se cayó el listado Y los KPIs vienen en cero → parcial, no vacio', () => {
    // Sin esto, la combinación más traicionera (kpis=0 legítimo + listado
    // caído) volvía a pintar "aún no hay liquidaciones".
    expect(estadoPanel({ acreditables: {}, kpis: KPIS_VACIOS, liquidaciones: null, anomalias: [] })).toBe('parcial');
  });

  it('se cayó solo la detección de duplicados → parcial', () => {
    // "0 anomalías" por fallo de lectura se lee como "revisamos y todo limpio".
    expect(estadoPanel({ acreditables: {}, kpis: KPIS_CON_DATOS, liquidaciones: [{}], anomalias: null })).toBe('parcial');
  });

  it('todo cargó y hay liquidaciones → datos', () => {
    expect(estadoPanel({ acreditables: {}, kpis: KPIS_CON_DATOS, liquidaciones: [{}], anomalias: [] })).toBe('datos');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 10, ALTO — "el estado vacío es inalcanzable". `estadoPanel` de
// arriba siempre estuvo bien: el bug vivía en QUÉ arreglo le manda el call
// site real (`dashboard/page.tsx:102`). Le pasaba `porDia`
// (`getLiquidacionesPorDia`), que SIEMPRE tiene 7 o 30 elementos —uno por
// día, muchos en cero— así que `.length` nunca podía dar 0 y la rama 'vacio'
// era código muerto: el panel pintaba "0% tasa de cuadre" siempre.
//
// `liquidacionesDeViajes` es la pieza que cierra ese hueco: filtra los
// VIAJES reales de la flota (mismo arreglo que ya se carga para
// `AvanceCierre`) a los que de verdad están `liquidado`, igual que
// `avance-cierre.tsx` cuenta `cerrados`.
// ═══════════════════════════════════════════════════════════════════════════
describe('liquidacionesDeViajes', () => {
  it('viajes null (consulta caída) → null, no []', () => {
    // Si esto devolviera `[]`, `estadoPanel` leería una sección caída como
    // "cero liquidaciones" en vez de "no se pudo leer" — el mismo error que
    // costó la nota en la auditoría 5 (fallar cerrado, no con ceros).
    expect(liquidacionesDeViajes(null)).toBeNull();
  });

  it('con actividad pero SIN ningún viaje liquidado → arreglo vacío', () => {
    // ESTE es el caso exacto que `porDia` no podía representar: actividad
    // real (viajes abiertos / en cuadre) y CERO liquidaciones. Un arreglo
    // que "siempre tiene elementos" (como `porDia`) habría dado `length` > 0
    // aquí y escondido el vacío real.
    const viajes = [{ estatus: 'abierto' }, { estatus: 'abierto' }, { estatus: 'en_cuadre' }];
    expect(liquidacionesDeViajes(viajes)).toEqual([]);
  });

  it('con viajes liquidados → solo esos, filtrados', () => {
    const viajes = [{ estatus: 'abierto' }, { estatus: 'liquidado' }, { estatus: 'liquidado' }];
    expect(liquidacionesDeViajes(viajes)).toEqual([{ estatus: 'liquidado' }, { estatus: 'liquidado' }]);
  });

  it('conectado a estadoPanel: actividad sin liquidar → "vacio", no "datos"', () => {
    // El ensamble completo que reproduce el hallazgo de la auditoría: KPIs
    // en cero (real) + viajes con actividad pero ninguno liquidado tiene que
    // seguir siendo 'vacio', nunca 'datos' disfrazado de 0%.
    const viajes = [{ estatus: 'abierto' }, { estatus: 'en_cuadre' }];
    const estado = estadoPanel({
      acreditables: {},
      kpis: KPIS_VACIOS,
      liquidaciones: liquidacionesDeViajes(viajes),
      anomalias: [],
    });
    expect(estado).toBe('vacio');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// EL CALL SITE REAL — el bug no estaba en la función, estaba en qué se le
// manda. Se prueba contra el CÓDIGO FUENTE de `page.tsx` (mismo patrón que
// `foto_no_expuesta.test.ts`: leer el archivo real, no una copia) para que
// nadie vuelva a conectar `porDia` (o cualquier arreglo de longitud fija) al
// campo `liquidaciones` de `estadoPanel`.
// ═══════════════════════════════════════════════════════════════════════════
describe('dashboard/page.tsx: el call site de estadoPanel', () => {
  const PAGINA = readFileSync(fileURLToPath(new URL('./page.tsx', import.meta.url)), 'utf8');

  it('ya no conecta "porDia" (longitud fija, 7 o 30) al campo liquidaciones', () => {
    const llamada = PAGINA.match(/estadoPanel\(\{[^}]*\}\)/)?.[0] ?? '';
    expect(llamada).not.toMatch(/liquidaciones:\s*porDia/);
  });

  it('usa liquidacionesDeViajes (la lista real, filtrada) en su lugar', () => {
    expect(PAGINA).toMatch(/liquidacionesDeViajes/);
  });
});
