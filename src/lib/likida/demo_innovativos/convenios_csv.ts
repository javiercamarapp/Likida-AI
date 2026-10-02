// ═══════════════════════════════════════════════════════════════════════════
// CONVENIOS E INSTRUCCIONES DE OPERACIÓN — contrato del archivo (una fila por
// instrucción; el convenio se repite). El importador real lo construye
// w3-convenios sobre la 0580 («el nombre del convenio es la llave de
// re-importación del CSV»); aquí se fija la FORMA del archivo y se valida contra
// los dominios cerrados de esa migración, para que lo que mande el cliente se
// revise ANTES de cargarlo.
//
// Columnas: clave* cliente* convenio* origen destino categoria* momento* orden texto*
//           tarifa_modo tarifa_precio requisitos_cobro (separados por |)
// ═══════════════════════════════════════════════════════════════════════════

import {
  CATEGORIAS_INSTRUCCION, MAX_TEXTO_INSTRUCCION, MOMENTOS_INSTRUCCION,
  type CategoriaInstruccion, type FilaConvenioCsv, type MomentoInstruccion,
} from './contratos';
import { leerNumero, llaveEncabezado, partirCsv } from './lector_tabla_propia';

export interface ConvenioAgrupado {
  clave: string; cliente: string; convenio: string; origen: string; destino: string;
  instrucciones: Array<{ categoria: CategoriaInstruccion; momento: MomentoInstruccion; orden: number; texto: string }>;
  tarifaModo: FilaConvenioCsv['tarifaModo']; tarifaPrecio: number | null; requisitosCobro: string[];
}
export interface ResultadoConveniosCsv { convenios: ConvenioAgrupado[]; problemas: Array<{ fila: number | null; motivo: string }> }

const MODOS = ['por_viaje', 'por_km', 'por_tonelada'] as const;

export function leerConveniosCsv(texto: string): ResultadoConveniosCsv {
  const matriz = partirCsv(texto);
  const problemas: ResultadoConveniosCsv['problemas'] = [];
  if (matriz.length === 0) return { convenios: [], problemas: [{ fila: null, motivo: 'El archivo está vacío.' }] };
  const llaves = matriz[0].map(llaveEncabezado);
  const ix = (n: string) => llaves.indexOf(n);
  const faltan = ['clave', 'cliente', 'convenio', 'categoria', 'momento', 'texto'].filter((n) => ix(n) < 0);
  if (faltan.length) return { convenios: [], problemas: [{ fila: null, motivo: `Faltan columnas: ${faltan.join(', ')}.` }] };
  const mapa = new Map<string, ConvenioAgrupado>();
  const val = (c: string[], n: string) => (ix(n) >= 0 ? (c[ix(n)] ?? '').trim() : '');
  matriz.slice(1).forEach((c, k) => {
    const fila = k + 2;
    const categoria = val(c, 'categoria') as CategoriaInstruccion; const momento = val(c, 'momento') as MomentoInstruccion; const texto = val(c, 'texto');
    if (!(CATEGORIAS_INSTRUCCION as readonly string[]).includes(categoria)) return void problemas.push({ fila, motivo: `categoría «${categoria}» fuera del dominio (${CATEGORIAS_INSTRUCCION.join(', ')})` });
    if (!(MOMENTOS_INSTRUCCION as readonly string[]).includes(momento)) return void problemas.push({ fila, motivo: `momento «${momento}» fuera del dominio (${MOMENTOS_INSTRUCCION.join(', ')})` });
    if (!texto || texto.length > MAX_TEXTO_INSTRUCCION) return void problemas.push({ fila, motivo: `texto vacío o de más de ${MAX_TEXTO_INSTRUCCION} caracteres` });
    const clave = val(c, 'clave');
    if (!clave || !val(c, 'cliente') || !val(c, 'convenio')) return void problemas.push({ fila, motivo: 'clave, cliente y convenio son obligatorios' });
    const modo = val(c, 'tarifa_modo'); const precio = val(c, 'tarifa_precio') === '' ? null : leerNumero(val(c, 'tarifa_precio'), false);
    if ((modo === '') !== (precio === null)) return void problemas.push({ fila, motivo: 'tarifa_modo y tarifa_precio van juntos (o ninguno)' });
    if (modo !== '' && !(MODOS as readonly string[]).includes(modo)) return void problemas.push({ fila, motivo: `tarifa_modo «${modo}» no válido` });
    if (precio !== null && precio <= 0) return void problemas.push({ fila, motivo: 'tarifa_precio tiene que ser positivo' });
    const g = mapa.get(clave) ?? {
      clave, cliente: val(c, 'cliente'), convenio: val(c, 'convenio'), origen: val(c, 'origen'), destino: val(c, 'destino'), instrucciones: [],
      tarifaModo: (modo || null) as ConvenioAgrupado['tarifaModo'], tarifaPrecio: precio,
      requisitosCobro: val(c, 'requisitos_cobro').split('|').map((s) => s.trim()).filter(Boolean),
    };
    mapa.set(clave, g);
    g.instrucciones.push({ categoria, momento, orden: Number(val(c, 'orden')) || g.instrucciones.length + 1, texto });
  });
  return { convenios: [...mapa.values()], problemas };
}
