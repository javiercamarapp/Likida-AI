import { generateStructured } from '@/lib/llm/openrouter';
import { encolarPieza } from '@/lib/likida/agentes/cola';
import { registrarCorrida } from '@/lib/likida/agentes/corridas';
import { gastoMesDiagnosticoUsd } from '@/lib/likida/agentes/runner';
import { detalleLatidos } from './salud';
import { ultimasEntradasBitacora } from './bitacora';
import {
  AGENTE_DIAGNOSTICO, EsquemaDiagnostico, ORIGEN_CORRIDA, TIPO_PIEZA_DIAGNOSTICO, type EvidenciaDiagnostico, type Puertos,
} from './diagnostico';

// Los puertos REALES del diagnóstico. Lecturas: latidos, bitácora y el contexto de la alerta (sin tenant ni nombres). Escrituras:
// SOLO la pieza propuesta en la bandeja de aprobación y la fila de gasto de la corrida. Nada más.
export function puertosReales(): Puertos {
  return {
    gastoMesUsd: () => gastoMesDiagnosticoUsd(),
    async leerEvidencia(item) {
      const ev: EvidenciaDiagnostico[] = [{ fuente: 'alerta', texto: `${item.titulo}. ${item.regla}` }];
      try {
        const latidos = await detalleLatidos();
        for (const [cron, l] of Object.entries(latidos)) {
          if (l.estado !== 'ok' || l.ultimoEstado !== 'ok') {
            const motivo = typeof l.detalle.motivo === 'string' ? l.detalle.motivo : typeof l.detalle.error === 'string' ? l.detalle.error : '';
            ev.push({ fuente: `latido:${cron}`, texto: `estado=${l.estado}, ultimo=${l.ultimoEstado ?? 'sin'}, hace=${l.haceMin ?? '?'} min ${motivo.slice(0, 200)}` });
          }
        }
      } catch { ev.push({ fuente: 'latidos', texto: 'no se pudieron leer' }); }
      try {
        const b = await ultimasEntradasBitacora({ limite: 10 });
        for (const e of b) ev.push({ fuente: 'bitacora', texto: `${e.ocurrioEn} ${e.accion}${e.entidad ? ` (${e.entidad})` : ''}` });
      } catch { ev.push({ fuente: 'bitacora', texto: 'no se pudo leer' }); }
      return ev.slice(0, 40);
    },
    async llamarModelo({ system, usuario }) {
      const r = await generateStructured({
        role: 'back_office', system, schema: EsquemaDiagnostico, schemaName: 'diagnostico_alerta',
        messages: [{ role: 'user', content: usuario }], maxTokens: 900, temperature: 0,
      });
      return { data: r.data, costoUsd: r.noMedido ? Number.NaN : r.cost, modelo: r.model };
    },
    async proponer(p) {
      await encolarPieza({
        tipo: TIPO_PIEZA_DIAGNOSTICO, prioridad: p.prioridad, agente: AGENTE_DIAGNOSTICO, tenantId: null,
        titulo: p.titulo, cuerpo: p.cuerpo, fuentes: { origen: ORIGEN_CORRIDA, huella: p.huella, solo_lectura: true },
      });
    },
    async registrarGasto({ costoUsd, ok, huella }) {
      const ahora = new Date();
      await registrarCorrida(null, AGENTE_DIAGNOSTICO, {
        inicio: ahora, fin: ahora, estado: ok ? 'ok' : 'fallo', disparo: 'cron', costoUsd,
        resumen: { origen: ORIGEN_CORRIDA, huella }, ...(ok ? {} : { error: 'El diagnóstico no se completó (se anota la cota de costo).' }),
      });
    },
  };
}
