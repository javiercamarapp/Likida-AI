import type { PropsCifra } from '@/app/ui-v2/graficas';

/** Sello de clase de dato de Rovaq («● Observado»): punto negro de 6 px más la palabra. Lo llevan las cifras que son una lectura
 *  directa de la base; una cifra sin valor o en error no se sella (su estado ya dice «sin dato»). `rotulo` viene del diccionario
 *  de la página (`a1r4.observado`), nunca de un literal. */
export function observadas(cifras: readonly PropsCifra[], rotulo: string): PropsCifra[] {
  return cifras.map((c) => {
    if (c.tipo || c.estado === 'vacio' || c.estado === 'error' || c.valor === null || c.valor === undefined) return c;
    return { ...c, tipo: 'observado', sello: c.sello ?? rotulo };
  });
}
