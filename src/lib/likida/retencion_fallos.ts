// A37-S09-01: las purgas de retención de datos personales que fallan no
// cambiaban el latido del cron: solo se escribía un log y el estado seguía en
// 'ok' (archivos de terceros / fotos de titulares ARCO seguían en Storage con
// /api/health en verde). Esta función recoge, en una sola lista legible, qué
// purgas complementarias no corrieron limpias. `null` = la purga lanzó o su
// RPC devolvió error (se dice, no se disfraza de cero).

export interface ResultadosPurgas {
  storage: { fallidos: number } | null;
  mcpOauth: unknown | null;
  llmPresupuesto: unknown | null;
  cartaPorteDocs: { fallidos: number } | null;
  agentesDatos: Array<{ nombre: string; ok: boolean; error?: string }> | null;
  buzonRecepcionesPurgadas: number | null;
  vinculacionPortal: number | null;
  ledgers: Array<{ nombre: string; ok: boolean; error?: string }> | null;
}

export function fallosDePurgas(r: ResultadosPurgas): string[] {
  const out: string[] = [];
  if (r.storage === null) out.push('storage: la corrida lanzó');
  else if (r.storage.fallidos > 0) out.push(`storage: ${r.storage.fallidos} archivo(s) sin borrar`);
  if (r.mcpOauth === null) out.push('mcp_oauth: no se pudo');
  if (r.llmPresupuesto === null) out.push('llm_presupuesto: no se pudo');
  if (r.cartaPorteDocs === null) out.push('carta_porte_docs: la corrida lanzó');
  else if (r.cartaPorteDocs.fallidos > 0) out.push(`carta_porte_docs: ${r.cartaPorteDocs.fallidos} documento(s) sin purgar`);
  if (r.agentesDatos === null) out.push('agentes_datos: la corrida lanzó');
  else for (const p of r.agentesDatos) if (!p.ok) out.push(`agentes_datos/${p.nombre}: ${p.error ?? 'falló'}`);
  if (r.buzonRecepcionesPurgadas === null) out.push('buzon_recepcion: no se pudo');
  if (r.vinculacionPortal === null) out.push('vinculacion_portal: no se pudo');
  if (r.ledgers === null) out.push('ledgers: la corrida lanzó');
  else for (const p of r.ledgers) if (!p.ok) out.push(`ledgers/${p.nombre}: ${p.error ?? 'falló'}`);
  return out;
}
