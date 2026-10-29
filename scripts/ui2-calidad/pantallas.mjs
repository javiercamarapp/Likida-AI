// Tipo y ruta de cada pantalla del arnés. El TIPO decide qué se exige en el primer pliegue 1440×900 (c5, ESTILO §6):
//   resumen    KPI(4) + gráfica (plot ≥140) + «Requiere tu atención» ≥3 filas, sin tabla
//   hub        KPI + gráfica + tabla ≥10 filas          lista   KPI + tabla ≥10 filas
//   formulario ≥8 filas o campos                        asistente ≥8 filas o campos
//   carga      solo c8 (por fotograma)                  componentes   muestrario: no se juzga el pliegue
export const TIPOS_CON_PLIEGUE = ['resumen', 'hub', 'lista', 'formulario', 'asistente'];
export const PANTALLAS_TIPO = {
  '01-resumen': 'resumen', 'c01-resumen-vacio': 'resumen', 'c02-resumen-en-curso': 'resumen', 'c03-resumen-sin-dato': 'resumen',
  'a1-liquidacion': 'hub', 'a2-peajes': 'hub', 'a3-carta-porte': 'hub',
  '03-tabla-viajes': 'lista', '11-tabla-grande': 'lista',
  'c04-asistente-vacio': 'asistente', 'c05-asistente-tms': 'asistente', 'c06-asistente-atencion': 'asistente',
  'c07-asistente-en-curso': 'asistente', 'c08-asistente-sin-dato': 'asistente',
  'c09-conexiones': 'formulario', 'c4-conexiones': 'formulario', '04-formulario': 'formulario',
  'carga-v2': 'carga',
};
// Ruta de producto que representa cada pantalla (la salida JSON se escribe también por ruta).
export const PANTALLAS_RUTA = {
  '01-resumen': '/dashboard', 'c01-resumen-vacio': '/dashboard', 'c02-resumen-en-curso': '/dashboard', 'c03-resumen-sin-dato': '/dashboard',
  'a1-liquidacion': '/dashboard/agentes/liquidacion', 'a2-peajes': '/dashboard/agentes/peajes', 'a3-carta-porte': '/dashboard/agentes/carta-porte',
  '03-tabla-viajes': '/dashboard/viajes', '11-tabla-grande': '/dashboard/viajes',
  'c04-asistente-vacio': '/dashboard/puesta-en-marcha', 'c05-asistente-tms': '/dashboard/puesta-en-marcha', 'c06-asistente-atencion': '/dashboard/puesta-en-marcha',
  'c07-asistente-en-curso': '/dashboard/puesta-en-marcha', 'c08-asistente-sin-dato': '/dashboard/puesta-en-marcha',
  'c09-conexiones': '/dashboard/conexiones', 'c4-conexiones': '/dashboard/conexiones', '04-formulario': '/dashboard/configuracion',
  'carga-v2': '(carga)',
};
