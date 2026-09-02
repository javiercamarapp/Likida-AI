// La herramienta de vigencias del parque vehicular. Reusa el MISMO motor que
// /v1/unidades y el panel: `getUnidades` (elige el papel más próximo a vencer)
// y `clasificarVigencia`/`contarVigencias`. `sin_dato` NO es `vigente` — la
// línea que la cabecera de /v1/unidades fija se respeta aquí letra por letra.

import { z } from 'zod';
import { getUnidades } from '@/lib/likida/operacion';
import { clasificarVigencia, contarVigencias, avisoVigencias, DIAS_AVISO } from '@/lib/likida/vigencias';
import { numero } from '@/lib/formato';
import type { Herramienta, ResultadoHerramienta } from '../tipos';

const esquema = z.object({});

async function ejecutar(tenantId: string): Promise<ResultadoHerramienta> {
  const unidades = await getUnidades(tenantId);
  if (unidades.length === 0) {
    return {
      texto: 'No hay unidades registradas en tu flota. El parque se da de alta en el panel.',
      estructurado: { unidades: [], resumen: null },
    };
  }
  const conteo = contarVigencias(unidades);
  const clasificadas = unidades.map((u) => ({
    numeroEconomico: u.numeroEconomico,
    estado: u.estado,
    vigencia: clasificarVigencia(u.diasAlVencimiento, u.queVence),
    diasAlVencimiento: u.diasAlVencimiento,
    queVence: u.queVence,
  }));
  const pideAccion = clasificadas
    .filter((u) => u.vigencia.estado === 'vencido' || u.vigencia.estado === 'por_vencer')
    .sort((a, b) => (a.diasAlVencimiento ?? 0) - (b.diasAlVencimiento ?? 0))
    .slice(0, 15);
  const sinDato = clasificadas.filter((u) => u.vigencia.estado === 'sin_dato');
  const lineas = pideAccion.map((u) => `• ${u.numeroEconomico}: ${u.vigencia.rotulo}`);
  const texto = [
    `${numero(unidades.length)} unidad${unidades.length === 1 ? '' : 'es'} en el parque. ${avisoVigencias(conteo) ?? 'Papeles al día en todas las unidades con papeles capturados.'}`,
    ...(lineas.length > 0 ? ['', 'Las que piden atención (el aviso empieza ' + DIAS_AVISO + ' días antes del vencimiento):', ...lineas] : []),
    ...(sinDato.length > 0
      ? ['', `Ojo: ${numero(sinDato.length)} unidad${sinDato.length === 1 ? '' : 'es'} sin ningún papel capturado (${sinDato.slice(0, 10).map((u) => u.numeroEconomico).join(', ')}${sinDato.length > 10 ? '…' : ''}). Sin dato NO es estar en regla.`]
      : []),
  ].join('\n');
  return {
    texto,
    estructurado: {
      resumen: { ...conteo, diasAviso: DIAS_AVISO },
      unidades: clasificadas.map((u) => ({
        numeroEconomico: u.numeroEconomico,
        estado: u.estado,
        vigencia: u.vigencia.estado,
        diasAlVencimiento: u.diasAlVencimiento,
        queVence: u.queVence,
      })),
    },
  };
}

export const herramientaUnidadesVigencias: Herramienta<z.infer<typeof esquema>> = {
  nombre: 'unidades_vigencias',
  titulo: 'Unidades y sus papeles',
  descripcion:
    'El parque vehicular con el estado de sus papeles de ley (póliza, permiso federal y verificación): cuáles pueden salir a carretera, cuáles tienen un papel vencido o por vencer, y cuáles no tienen papeles capturados. Solo lectura.',
  area: 'operacion',
  esquema,
  ejecutar,
};
