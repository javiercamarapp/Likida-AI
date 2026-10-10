// El cableado REAL del Vigía: base, modelo barato para clasificar y —solo si se
// enciende— el pulidor de redacción. Las pruebas arman sus propios `DepsVigia`.
import { envPuesta } from '@/lib/env';
import { crearRepoVigia } from './repo';
import { crearModeloClasificador, crearModeloPulidor } from './modelo';
import type { DepsVigia } from './puertos';

/**
 * `LIKIDA_VIGIA_MODELO=no` apaga el clasificador por modelo (quedan solo las reglas).
 * `LIKIDA_VIGIA_PULIR=si` enciende el pulido de redacción (apagado por omisión: el
 * borrador determinista ya sale con datos reales; pulirlo solo cambia el tono).
 */
export function crearDepsVigia(): DepsVigia {
  const modeloApagado = envPuesta('LIKIDA_VIGIA_MODELO') && String(process.env.LIKIDA_VIGIA_MODELO).trim().toLowerCase() === 'no';
  const pulir = envPuesta('LIKIDA_VIGIA_PULIR') && String(process.env.LIKIDA_VIGIA_PULIR).trim().toLowerCase() === 'si';
  return {
    repo: crearRepoVigia(),
    modelo: modeloApagado ? null : crearModeloClasificador(),
    pulir: pulir ? crearModeloPulidor() : null,
  };
}
