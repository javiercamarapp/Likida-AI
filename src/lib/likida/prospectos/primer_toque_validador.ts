// A37-S08-02: validador DETERMINISTA del primer toque que redacta el modelo.
//
// Las reglas duras (cifras canónicas, el diésel sin pesos, sin «nuestros
// clientes») vivían solo en el prompt. Una vacante/nota con instrucciones
// inyectadas, o un modelo errático, las rompía y el texto se guardaba tal cual
// para mandarse a una persona real bajo la marca. Aquí se comprueban DESPUÉS
// del modelo y, si fallan, el texto NO se guarda ni se entrega (fail-closed):
// el botón del Cerebro sigue con la plantilla determinista.

/** Montos en pesos que Likida puede citar: $35 (tabulador), $38 / $31.25 (tramos)
 *  y ~$105 (ciclo manual). Cualquier otro `$` es una cifra inventada. */
export const CIFRAS_CANONICAS: ReadonlySet<number> = new Set([35, 38, 31.25, 105]);

export interface PrimerToque { mensaje_wa: string; correo_asunto: string; correo_cuerpo: string }

const MONTO = /\$\s*(\d[\d,]*(?:\.\d+)?)|(\d[\d,]*(?:\.\d+)?)\s*(?:pesos|mxn)\b/gi;
const CLIENTES = /nuestr[oa]s\s+(?:clientes|usuarios\s+actuales)|\bya\s+(?:trabajamos|tenemos\s+clientes)/i;
const DIESEL_O_ESTIMULO = /di[eé]sel|est[ií]mulo/i;
const PESOS = /\$|\bpesos\b|\bmxn\b/i;

/** Devuelve la lista de violaciones (vacía = el texto cumple). */
export function violacionesPrimerToque(t: PrimerToque): string[] {
  const out: string[] = [];
  for (const [campo, texto] of Object.entries(t) as Array<[keyof PrimerToque, string]>) {
    if (CLIENTES.test(texto)) out.push(`${campo}: habla de «nuestros clientes» (Likida aún no tiene)`);
    for (const m of texto.matchAll(MONTO)) {
      const n = Number((m[1] ?? m[2]).replace(/,/g, ''));
      if (!CIFRAS_CANONICAS.has(n)) out.push(`${campo}: cifra no canónica ${m[0].trim()}`);
    }
    // El diésel/estímulo solo se habla en litros: ninguna frase que lo mencione
    // puede traer pesos.
    for (const frase of texto.split(/(?<=[.!?\n])/)) {
      if (DIESEL_O_ESTIMULO.test(frase) && PESOS.test(frase)) {
        out.push(`${campo}: diésel/estímulo en pesos`);
      }
    }
  }
  return out;
}
