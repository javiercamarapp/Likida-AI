// AUDITORÍA 18, ALTO (A14) — "Vencen pronto (≤ 5 días)" se calculaba con
// `venceEn <= hoy`, que es "ya venció o vence hoy". Una solicitud que vence
// pasado mañana salía en 0 y una vencida la semana pasada contaba como
// "pronto". Aquí vive la aritmética, pura, para que se pueda fijar con pruebas.

export const DIAS_VENCE_PRONTO = 5;

/** `iso` (timestamp o fecha) recortado al día, `YYYY-MM-DD`. */
export const diaDe = (iso: string) => iso.slice(0, 10);

const sumarDias = (dia: string, n: number) => {
  const d = new Date(`${dia}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Ya pasó el plazo: vencía ANTES de hoy. Hoy todavía se puede contestar. */
export function yaVencio(venceEn: string, hoy: string): boolean {
  return diaDe(venceEn) < hoy;
}

/** Vence entre hoy y dentro de `dias` (inclusive). Una vencida NO está aquí:
 *  ya no es "pronto", es incumplimiento, y se cuenta aparte. */
export function venceDentroDe(venceEn: string, hoy: string, dias: number = DIAS_VENCE_PRONTO): boolean {
  const v = diaDe(venceEn);
  return v >= hoy && v <= sumarDias(hoy, dias);
}
