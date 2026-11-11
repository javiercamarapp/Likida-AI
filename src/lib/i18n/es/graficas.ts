// Namespace «graficas»: textos propios de los gráficos de ui-v2 (embudo, mapa de calor, columnas apiladas). Fuente de verdad en español;
// `en/graficas.ts` lo espeja y el compilador exige las mismas claves. Las etiquetas y cifras vienen de los datos, no de aquí.
export const graficas = {
  'vacio': 'Sin datos en el periodo',
  'embudo.etapa': 'Etapa',
  'embudo.valor': 'Valor',
  'embudo.anterior': 'De la anterior',
  'embudo.parteDe': '{pct} de «{etapa}»',
  'embudo.convAnterior': '{pct} de la etapa anterior',
  'embudo.sinDato': 'sin dato',
  'calor.fila': 'Fila',
  'calor.menos': 'menos',
  'calor.mas': 'más',
  'apiladas.periodo': 'Periodo',
  'apiladas.total': 'Total',
} as const;
