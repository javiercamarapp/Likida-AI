// La fuente estándar Helvetica de pdf-lib usa WinAnsi, que NO codifica varios Unicode
// (→, ●, …). Todo texto que venga de datos (nombres, OCR) se sanea con ESTA función
// antes de `drawText`: un carácter fuera de WinAnsi hace que `drawText` LANCE y el
// papel no sale. Es la misma que usa el PDF de liquidación (`pdf.ts`), extraída para
// que el acuse «solo folio» (`pdf_folio.ts`) no tenga una copia que se desalinee (B1).
//
// El rango empieza en el ESPACIO (0x20), no antes: los caracteres de CONTROL caen
// fuera y se reemplazan por '?'. El rango ` -ÿ` es 0x20–0xFF e INCLUYE los controles
// C1 (0x7F–0x9F), que WinAnsi no codifica (auditoría 22, BE-1): por eso se tratan aparte.
export function sanearWinAnsi(s: string): string {
  return s
    .replace(/→/g, '-')
    .replace(/[●○]/g, '•')            // círculos → bullet (WinAnsi sí lo tiene)
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/…/g, '...')
      // ── AUDITORÍA 22, BE-1 (ALTO) ────────────────────────────────────────
      // El rango ` -ÿ` es 0x20–0xFF e INCLUYE los controles C1 (0x7F–0x9F),
      // que WinAnsi no codifica: `drawText` lanza y la liquidación se cierra
      // SIN PAPEL, para siempre —el cierre es irreversible por los triggers
      // 0036/0037— mientras al chofer se le dice que el contralor sí lo tiene.
      // Un solo byte basta, y llega gratis: un OCR sobre un ticket con ruido,
      // o un nombre pegado desde Word (0x92 es la comilla tipográfica de
      // Windows-1252).
    .replace(/[\u007F-\u009F]/g, '?')
    .replace(/[^ -ÿ–—•€]/g, '?');
}
