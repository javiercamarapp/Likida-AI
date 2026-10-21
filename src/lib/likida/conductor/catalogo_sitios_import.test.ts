import { describe, expect, it } from 'vitest';
import {
  analizarCatalogo, codigoDerivado, cupoValido, enLotes, leerCatalogo, motivosCoordenadas, normalizarNombre,
  CUPO_DEFECTO, CUPO_MAX, CUPO_MIN, TERMINAL_EXTRANJERO, TERMINAL_SIN_ASIGNAR, type FilaCatalogo,
} from './catalogo_sitios_import';

// Todo sintético: nombres «Sitio NNNNN» y coordenadas de una rejilla inventada dentro de la caja de México.

const fila = (linea: number, o: Partial<FilaCatalogo> = {}): FilaCatalogo => ({
  linea, nombre: `Sitio ${linea}`, codigo: null, lat: 20 + linea * 0.01, lng: -100 - linea * 0.01, radio_m: null, activo: true,
  terminal: 'Terminal A', pais: null, direccion: null, tipo: null, ...o,
});

describe('leerCatalogo', () => {
  it('lee CSV con sinónimos de encabezado y estatus en palabras', () => {
    const r = leerCatalogo('Nombre,Latitud,Longitud,Estatus,Plaza\nSitio A,20.5,-100.5,Inactivo,T1\nSitio B,20.6,-100.6,activo,T2\n');
    expect(r.errores).toEqual([]);
    expect(r.filas.map((f) => [f.linea, f.nombre, f.activo, f.terminal])).toEqual([[2, 'Sitio A', false, 'T1'], [3, 'Sitio B', true, 'T2']]);
  });

  it('acepta punto y coma con coma decimal', () => {
    const r = leerCatalogo('nombre;lat;lng\nSitio A;20,5;-100,5\n');
    expect(r.filas[0]).toMatchObject({ lat: 20.5, lng: -100.5 });
  });

  it('lee JSON como arreglo y como objeto con «sitios»', () => {
    const a = leerCatalogo(JSON.stringify([{ nombre: 'Sitio A', lat: 20, lng: -100, activo: false }]));
    const b = leerCatalogo(JSON.stringify({ sitios: [{ name: 'Sitio A', latitude: 20, longitude: -100 }] }));
    expect(a.filas[0]).toMatchObject({ nombre: 'Sitio A', activo: false });
    expect(b.filas[0]).toMatchObject({ nombre: 'Sitio A', lat: 20, activo: true });
  });

  it('rechaza solo la fila mala y dice cuál y por qué', () => {
    const r = leerCatalogo('nombre,lat,lng,estatus\nSitio A,20,-100,activo\n,20,-100,activo\nSitio C,abc,-100,activo\nSitio D,20,-100,quizas\n');
    expect(r.filas.map((f) => f.linea)).toEqual([2]);
    expect(r.errores.map((e) => e.linea)).toEqual([3, 4, 5]);
    expect(r.errores[0]!.mensaje).toMatch(/nombre/);
    expect(r.errores[2]!.mensaje).toMatch(/estatus/);
  });

  it('sin columna nombre, vacío y JSON roto son errores del archivo entero', () => {
    expect(leerCatalogo('lat,lng\n1,2\n').errores[0]).toMatchObject({ linea: 1 });
    expect(leerCatalogo('  ').errores[0]).toMatchObject({ linea: 0 });
    expect(leerCatalogo('[{').errores[0]).toMatchObject({ linea: 0 });
  });

  // HALLAZGO 2 (auditoría A5): el importador solo rechazaba radios no numéricos; uno absurdamente chico
  // (10 m) o grande (500,000 m) pasaba silencioso hasta que la base lo rechazara por la constraint
  // `geocerca_radio_sano` (o la aceptara, si cayó dentro del rango pero sigue siendo absurdo).
  it('un radio positivo fuera de [25, 100000] m se rechaza como error de validación, no pasa silencioso', () => {
    const r = leerCatalogo('nombre,lat,lng,radio_m\nSitio chico,20,-100,10\nSitio enorme,20,-100,500000\nSitio sano,20,-100,150\n');
    expect(r.filas.map((f) => f.linea)).toEqual([4]); // solo «Sitio sano» pasa
    expect(r.errores.map((e) => e.linea)).toEqual([2, 3]);
    expect(r.errores[0]!.mensaje).toMatch(/radio/i);
    expect(r.errores[1]!.mensaje).toMatch(/radio/i);
  });

  it('radio ausente, 0 o negativo NO es error (significa «sin declarar»: usa el default más adelante)', () => {
    const r = leerCatalogo('nombre,lat,lng,radio_m\nA,20,-100,\nB,20,-100,0\nC,20,-100,-5\n');
    expect(r.errores).toEqual([]);
    expect(r.filas.map((f) => f.radio_m)).toEqual([null, 0, -5]);
  });

  it('un radio en el límite exacto (25 o 100,000) se acepta', () => {
    const r = leerCatalogo('nombre,lat,lng,radio_m\nMin,20,-100,25\nMax,20,-100,100000\n');
    expect(r.errores).toEqual([]);
    expect(r.filas.map((f) => f.radio_m)).toEqual([25, 100000]);
  });
});

describe('motivosCoordenadas', () => {
  it('confiable dentro de México', () => expect(motivosCoordenadas({ lat: 25.6, lng: -100.3, pais: null })).toEqual([]));
  it('ausentes', () => expect(motivosCoordenadas({ lat: null, lng: -100, pais: null })).toEqual(['sin coordenadas']));
  it('fuera de rango', () => expect(motivosCoordenadas({ lat: 95, lng: -100, pais: null })).toEqual(['coordenadas fuera de rango']));
  it('(0, 0)', () => expect(motivosCoordenadas({ lat: 0, lng: 0, pais: 'Estados Unidos' })).toEqual(['coordenadas (0, 0)']));
  it('fuera de México sin país declarado va por validar', () => expect(motivosCoordenadas({ lat: 40.7, lng: -74.0, pais: null })).toHaveLength(1));
  it('país extranjero declarado: coordenadas fuera de México son válidas', () => {
    expect(motivosCoordenadas({ lat: 40.7, lng: -74.0, pais: 'EE. UU.' })).toEqual([]);
  });
  it('país «México» o «MX» cuenta como México', () => {
    expect(motivosCoordenadas({ lat: 40.7, lng: -74.0, pais: 'México' })).toHaveLength(1);
    expect(motivosCoordenadas({ lat: 40.7, lng: -74.0, pais: 'MX' })).toHaveLength(1);
  });
});

describe('duplicados candidatos', () => {
  it('mismo nombre normalizado, aunque cambien acentos, mayúsculas y signos', () => {
    const a = analizarCatalogo([fila(2, { nombre: 'Planta Querétaro #1' }), fila(3, { nombre: 'PLANTA QUERETARO 1' }), fila(4)]);
    expect(a.duplicados).toEqual([{ lineas: [2, 3], motivos: ['mismo_nombre'] }]);
    expect(a.resumen.filasEnDuplicados).toBe(2);
  });

  it('a 100 m o menos con nombres distintos; a 150 m no', () => {
    const base = fila(2, { lat: 25.0, lng: -100.0 });
    const cerca = fila(3, { lat: 25.0 + 0.0008, lng: -100.0 }); // ≈ 89 m
    const lejos = fila(4, { lat: 25.0 + 0.002, lng: -100.0 }); // ≈ 222 m de la base y 133 m de «cerca»
    const a = analizarCatalogo([base, cerca, lejos]);
    expect(a.duplicados).toEqual([{ lineas: [2, 3], motivos: ['cerca_100m'] }]);
  });

  it('a 99 m en longitud se detecta a cualquier latitud y desde cualquier posición base (celda en longitud ajustada por latitud)', () => {
    const MPORGRADO = 111195; // coherente con el radio terrestre de haversineM; país declarado para cubrir también latitudes fuera de México
    for (const lat of [0, 19.4, 25.8, 32.5, 45, 60]) {
      const dLng = 99 / (MPORGRADO * Math.cos((lat * Math.PI) / 180));
      const dLngFuera = 105 / (MPORGRADO * Math.cos((lat * Math.PI) / 180));
      for (let k = 0; k < 40; k++) {
        const lng = -117 + k * 0.00005 + 0.00001;
        const a = analizarCatalogo([fila(2, { lat, lng, pais: 'US' }), fila(3, { lat, lng: lng + dLng, pais: 'US' })]);
        expect(a.duplicados, `lat ${lat} base ${lng}`).toEqual([{ lineas: [2, 3], motivos: ['cerca_100m'] }]);
        const b = analizarCatalogo([fila(2, { lat, lng, pais: 'US' }), fila(3, { lat, lng: lng + dLngFuera, pais: 'US' })]);
        expect(b.duplicados, `lat ${lat} base ${lng} a 105 m`).toEqual([]);
      }
    }
  });

  it('a 99 m en diagonal que cruza de banda de latitud a 32,5° N también se detecta', () => {
    for (let k = 0; k < 40; k++) {
      const lat = 32.4995 + k * 0.00003;
      const lng = -117 + k * 0.00007;
      // ≈ 70 m al este y ≈ 70 m al norte → ≈ 99 m
      const dLng = 70 / (111195 * Math.cos((lat * Math.PI) / 180));
      const dLat = 70 / 111195;
      const a = analizarCatalogo([fila(2, { lat, lng }), fila(3, { lat: lat + dLat, lng: lng + dLng })]);
      expect(a.duplicados, `k ${k}`).toEqual([{ lineas: [2, 3], motivos: ['cerca_100m'] }]);
    }
  });

  it('agrupa transitivamente y lista los dos motivos', () => {
    const a = analizarCatalogo([
      fila(2, { nombre: 'Sitio X', lat: 25.0, lng: -100.0 }),
      fila(3, { nombre: 'Otro', lat: 25.0004, lng: -100.0 }),
      fila(4, { nombre: 'sitio x', lat: 22.0, lng: -101.0 }),
    ]);
    expect(a.duplicados).toEqual([{ lineas: [2, 3, 4], motivos: ['cerca_100m', 'mismo_nombre'] }]);
  });

  it('nunca fusiona: todas las filas siguen en la salida (las activas y confiables)', () => {
    const a = analizarCatalogo([fila(2, { nombre: 'Igual' }), fila(3, { nombre: 'igual' })]);
    expect(a.listas.map((s) => s.linea)).toEqual([2, 3]);
  });

  it('los inactivos también cuentan como candidatos (servicio al cliente los reactiva)', () => {
    const a = analizarCatalogo([fila(2, { nombre: 'Igual' }), fila(3, { nombre: 'Igual', activo: false })]);
    expect(a.duplicados[0]!.lineas).toEqual([2, 3]);
  });

  it('coordenadas inválidas no participan en la cercanía (dos (0,0) no son «cerca»)', () => {
    const a = analizarCatalogo([fila(2, { lat: 0, lng: 0 }), fila(3, { lat: 0, lng: 0 })]);
    expect(a.duplicados).toEqual([]);
  });
});

describe('activo / inactivo y por validar', () => {
  it('las inactivas con coordenadas buenas no se importan pero se cuentan', () => {
    const a = analizarCatalogo([fila(2), fila(3, { activo: false })]);
    expect(a.listas.map((s) => s.linea)).toEqual([2]);
    expect(a.resumen).toMatchObject({ total: 2, activas: 1, inactivas: 1, listas: 1 });
  });

  it('coordenadas dudosas pasan a «por validar» con su motivo y no entran a listas', () => {
    const a = analizarCatalogo([fila(2, { lat: 0, lng: 0 }), fila(3, { lat: null, lng: null }), fila(4, { lat: 40, lng: -74 }), fila(5)]);
    expect(a.porValidar.map((p) => [p.linea, p.motivos[0]])).toEqual([
      [2, 'coordenadas (0, 0)'], [3, 'sin coordenadas'], [4, 'fuera de México sin país extranjero declarado'],
    ]);
    expect(a.listas.map((s) => s.linea)).toEqual([5]);
  });

  it('un sitio extranjero declarado sí queda listo', () => {
    const a = analizarCatalogo([fila(2, { lat: 40.7, lng: -74.0, pais: 'Estados Unidos' })]);
    expect(a.listas).toHaveLength(1);
    expect(a.resumen.extranjeras).toBe(1);
  });

  it('el radio y el código no se inventan al azar: radio del archivo o el declarado; código determinista', () => {
    const a = analizarCatalogo([fila(2, { radio_m: 80 }), fila(3)], { radioPorDefectoM: 200 });
    expect(a.listas[0]!.radio_m).toBe(80);
    expect(a.listas[1]!.radio_m).toBe(200);
    expect(a.radioPorDefectoM).toBe(200);
    expect(codigoDerivado('Sitio 2', 20.02, -100.02)).toBe(codigoDerivado('SITIO 2', 20.02, -100.02));
    expect(a.listas[0]!.codigo).toMatch(/^CAT-/);
  });

  it('conserva el código del archivo', () => {
    expect(analizarCatalogo([fila(2, { codigo: 'ABC-1' })]).listas[0]!.codigo).toBe('ABC-1');
  });
});

describe('lista de validación por terminal', () => {
  it('cupo por día: 20 por defecto, configurable entre 20 y 30', () => {
    expect(cupoValido(undefined)).toBe(CUPO_DEFECTO);
    expect(cupoValido(5)).toBe(CUPO_MIN);
    expect(cupoValido(99)).toBe(CUPO_MAX);
    expect(cupoValido(25)).toBe(25);
  });

  it('reparte una terminal de 45 filas en días de a 20 y de a 30', () => {
    const filas = Array.from({ length: 45 }, (_, i) => fila(i + 2));
    const a20 = analizarCatalogo(filas);
    expect(a20.validacion[0]!.dias.map((d) => d.items.length)).toEqual([20, 20, 5]);
    const a30 = analizarCatalogo(filas, { cupoDiario: 30 });
    expect(a30.validacion[0]!.dias.map((d) => d.items.length)).toEqual([30, 15]);
    expect(a30.validacion[0]!.total).toBe(45);
  });

  it('nunca pasa del cupo en un día, en ninguna terminal', () => {
    const filas = Array.from({ length: 200 }, (_, i) => fila(i + 2, { terminal: `T${i % 5}` }));
    for (const cupo of [20, 25, 30]) {
      const a = analizarCatalogo(filas, { cupoDiario: cupo });
      for (const t of a.validacion) for (const d of t.dias) expect(d.items.length).toBeLessThanOrEqual(cupo);
    }
  });

  it('prioriza por validar, luego duplicados, luego rutina; las inactivas limpias no se revisan', () => {
    const a = analizarCatalogo([
      fila(2),
      fila(3, { nombre: 'Repe' }), fila(4, { nombre: 'repe' }),
      fila(5, { lat: 0, lng: 0 }),
      fila(6, { activo: false }),
    ]);
    const items = a.validacion[0]!.dias.flatMap((d) => d.items);
    expect(items.map((i) => [i.linea, i.razon])).toEqual([
      [5, 'por_validar'], [3, 'posible_duplicado'], [4, 'posible_duplicado'], [2, 'rutina'],
    ]);
  });

  it('las de EE. UU. van en su propia lista; sin terminal también aparte', () => {
    const a = analizarCatalogo([
      fila(2, { terminal: 'Monterrey' }),
      fila(3, { terminal: 'Laredo', lat: 40.7, lng: -74.0, pais: 'EE. UU.' }),
      fila(4, { terminal: null }),
    ]);
    expect(a.validacion.map((t) => t.terminal)).toEqual(['Monterrey', TERMINAL_SIN_ASIGNAR, TERMINAL_EXTRANJERO]);
  });
});

describe('13 440 filas sintéticas', () => {
  const N = 13_440;
  const filas = Array.from({ length: N }, (_, i) => fila(i + 2, {
    // rejilla con paso de 0.002° (≈ 220 m): ninguna pareja queda a ≤ 100 m por azar
    nombre: `Lugar ${i + 2}`,
    lat: 16 + (Math.floor(i / 100) * 0.002), lng: -110 + ((i % 100) * 0.002),
    terminal: `T${i % 6}`, activo: i % 4 !== 0,
  }));
  // 40 repetidos por nombre, 30 por cercanía, 25 con coordenada (0,0)
  for (let k = 0; k < 40; k++) filas[5000 + k] = { ...filas[5000 + k]!, nombre: filas[k]!.nombre };
  for (let k = 0; k < 30; k++) filas[9000 + k] = { ...filas[9000 + k]!, lat: filas[100 + k]!.lat! + 0.0003, lng: filas[100 + k]!.lng };
  for (let k = 0; k < 25; k++) filas[12000 + k] = { ...filas[12000 + k]!, lat: 0, lng: 0 };

  it('analiza dentro de un tiempo acotado y sin tope de filas', () => {
    const t0 = Date.now();
    const a = analizarCatalogo(filas);
    const ms = Date.now() - t0;
    expect(ms).toBeLessThan(3000);
    expect(a.resumen.total).toBe(N);
    expect(a.resumen.porValidar).toBe(25);
    expect(a.resumen.gruposDuplicados).toBe(70);
    expect(a.resumen.activas + a.resumen.inactivas).toBe(N);
    expect(a.listas.length).toBeLessThan(N);
    for (const t of a.validacion) for (const d of t.dias) expect(d.items.length).toBeLessThanOrEqual(20);
  });

  it('la reimportación es idempotente: misma entrada, mismo resultado', () => {
    expect(JSON.stringify(analizarCatalogo(filas))).toBe(JSON.stringify(analizarCatalogo(filas)));
  });

  it('las filas listas caben en lotes de la base sin pasar de 2000', () => {
    const a = analizarCatalogo(filas);
    const lotes = enLotes(a.listas);
    expect(lotes.every((l) => l.length <= 2000)).toBe(true);
    expect(lotes.flat()).toHaveLength(a.listas.length);
  });
});

describe('normalizarNombre', () => {
  it('quita acentos, signos y espacios de más', () => {
    expect(normalizarNombre('  Planta   Querétaro, #1 ')).toBe('planta queretaro 1');
  });
});
