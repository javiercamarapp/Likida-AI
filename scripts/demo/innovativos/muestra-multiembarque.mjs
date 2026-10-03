// ═══════════════════════════════════════════════════════════════════════════
// La muestra «un Excel con VARIOS embarques» (P13, 0670-0672): lo que un cliente que arma todo el día en una sola hoja manda por WhatsApp.
//
// Misma forma que la hoja de carga de Armadora Ficticia Ramos Arizpe (los encabezados del perfil `arr-excel-demo`), con 3 pedidos y 6
// renglones de mercancía. El folio (Pedido) y los datos del documento vienen SOLO en el primer renglón de cada pedido, como una celda
// combinada: el resto de los renglones es mercancía del mismo pedido (lo que el partidor del producto debe entender). TODO es ficticio.
//
// La usan `exportar-archivos.mjs` (la escribe a archivos-muestra/) y sus pruebas. Determinista: mismas fechas fijas, mismos bytes.
// ═══════════════════════════════════════════════════════════════════════════
export const NOMBRE_MULTIEMBARQUE = 'orden_c10_multi_embarques.xlsx';

export const ENCABEZADOS_MULTIEMBARQUE = ['Pedido', 'Fecha', 'Destino', 'RFC destino', 'CP destino', 'Descripción', 'Cantidad', 'Peso kg'];

export const FILAS_MULTIEMBARQUE = [
  ['C10-801', '20/10/2026', 'ACERO FICTICIO DE COAHUILA SA DE CV', 'AFC100101AB2', '25000', 'Defensas de acero', '1,200', '8,400'],
  ['', '', '', '', '', 'Faros de ensamble', '600', '1,150'],
  ['C10-802', '20/10/2026', 'ELECTRODOMESTICOS FICTICIOS APODACA SA DE CV', 'EFA100101AB4', '66610', 'Compresores de refrigeración', '450', '6,300'],
  ['', '', '', '', '', 'Láminas de acero laminado', '80', '9,600'],
  ['', '', '', '', '', 'Arneses automotrices', '2,000', '3,200'],
  ['C10-803', '21/10/2026', 'LOGISTICA FICTICIA ESCOBEDO SA DE CV', 'LFE100101AB5', '66050', 'Cajas de bebidas empacadas', '900', '12,000'],
];

/** Los bytes del .xlsx (deterministas). `XLSX` es el módulo `xlsx` (quien llama lo trae: este archivo no depende de él). */
export function bytesMultiembarque(XLSX) {
  const ws = XLSX.utils.aoa_to_sheet([ENCABEZADOS_MULTIEMBARQUE, ...FILAS_MULTIEMBARQUE]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Carga');
  wb.Props = { CreatedDate: new Date('2026-10-20T15:00:00Z'), ModifiedDate: new Date('2026-10-20T15:00:00Z'), Author: 'demo' };
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}
