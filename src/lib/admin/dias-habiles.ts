// ADM-10 (auditoría 24, MEDIO) — "Vencen pronto (≤ 5 días hábiles)" de
// /admin/compliance contaba `5 * 864e5`: 5 DÍAS NATURALES, no hábiles. Un
// vencimiento en viernes se leía "no vence pronto" un lunes que en realidad
// ya cae dentro del plazo hábil (el fin de semana no cuenta). Mismo criterio
// que el plazo legal de 20 días hábiles del art. 31 LFPDPPP con el que se
// calculó `venceEn` al registrar la solicitud — sin festivos (no hay
// calendario oficial de asuetos en este repo; sábado/domingo es lo
// verificable).
//
// Módulo propio y pequeño (no dentro de compliance/page.tsx) para que sea
// una función pura, importable sin arrastrar Server Components a la prueba.

/** Suma `n` DÍAS HÁBILES (lun-vie) a un día MX en formato 'YYYY-MM-DD'. */
export function agregarDiasHabiles(diaMx: string, n: number): string {
  const d = new Date(`${diaMx}T00:00:00Z`);
  let restantes = n;
  while (restantes > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const dow = d.getUTCDay(); // 0 = domingo, 6 = sábado
    if (dow !== 0 && dow !== 6) restantes -= 1;
  }
  return d.toISOString().slice(0, 10);
}
