// Tipo de cada pantalla del arnés. Solo las de tipo 'panel' (KPI + gráfica + tabla) se juzgan en el primer pliegue (c5);
// asistente/formulario/componentes/vacío no tienen por qué traer gráfica. Lo que no está aquí es 'componentes'.
export const PANTALLAS_TIPO = {
  '01-resumen': 'panel', '03-tabla-viajes': 'panel', '11-tabla-grande': 'panel',
  'c01-resumen-vacio': 'panel', 'c02-resumen-en-curso': 'panel', 'c03-resumen-sin-dato': 'panel',
  'a1-liquidacion': 'panel', 'a2-peajes': 'panel', 'a3-carta-porte': 'panel',
  'c04-asistente-vacio': 'asistente', 'c05-asistente-tms': 'asistente', 'c06-asistente-atencion': 'asistente',
  'c07-asistente-en-curso': 'asistente', 'c08-asistente-sin-dato': 'asistente',
  'c09-conexiones': 'formulario', 'c4-conexiones': 'formulario', '04-formulario': 'formulario',
  'carga-v2': 'carga',
};
