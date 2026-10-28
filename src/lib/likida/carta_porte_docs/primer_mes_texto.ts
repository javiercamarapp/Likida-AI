// Texto ↔ revisores del modo primer mes (puro: lo comparten la pantalla y su acción de servidor).
import type { PrimerMesFila } from './repo';

/** El texto del área tal como se edita: un renglón por revisor. */
export const textoDeRevisores = (r: PrimerMesFila['revisores']): string => r.map((x) => `${x.departamento}: ${x.correo}`).join('\n');

/** El texto del área → revisores. Un renglón sin «:» o sin correo lanza un mensaje en llano. */
export function revisoresDeTexto(texto: string): PrimerMesFila['revisores'] {
  return texto.split('\n').map((l) => l.trim()).filter((l) => l !== '').map((l) => {
    const i = l.lastIndexOf(':');
    if (i < 1) throw new Error(`«${l.slice(0, 40)}»: escribe «Departamento: correo».`);
    return { departamento: l.slice(0, i).trim(), correo: l.slice(i + 1).trim() };
  });
}

