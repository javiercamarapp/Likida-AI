import { appUrl } from '@/lib/env';
import { conectorGpsPorId } from '../conectores/gps';
import {
  veredictoDePoll, veredictoDePush, type EstadoIntegracion,
} from '../gps_salud';
import {
  estadoPush, saludPollsGps, huerfanosGps, conteosUnidadesGps, type HuerfanoGps, type ConteosUnidadesGps,
} from './datos';

// Arma lo que pinta la sección «GPS» de Conexiones. Cada lectura falla CERRADO:
// si no se pudo leer, la pantalla lo dice (`error`), no pinta «sana».

export interface PanelGps {
  error: string | null;
  salud: Array<{ clave: string; nombre: string; tono: 'ok' | 'warn' | 'bad' | 'neutral'; estado: EstadoIntegracion; texto: string }>;
  push: { fila: { clave: string; nombre: string; tono: 'ok' | 'warn' | 'bad' | 'neutral'; estado: string; texto: string }; configurado: boolean; version: number | null; recepciones: number; rechazos: number; previoHasta: string | null };
  endpoint: string;
  huerfanos: HuerfanoGps[];
  hayMasHuerfanos: boolean;
  conteos: ConteosUnidadesGps | null;
}

const ROTULO_ESTADO: Record<EstadoIntegracion, string> = {
  sana: 'sana', en_espera: 'en espera tras una falla', con_falla: 'con falla', parcial: 'sincronización incompleta', sin_sincronizar: 'sin sincronizar',
};

export async function armarPanelGps(tenantId: string, ahoraMs: number): Promise<PanelGps> {
  const endpoint = `${appUrl()}/api/gps/push/${tenantId}`;
  try {
    const [polls, p, h, conteos] = await Promise.all([
      saludPollsGps(tenantId), estadoPush(tenantId), huerfanosGps(tenantId), conteosUnidadesGps(tenantId),
    ]);
    const vp = veredictoDePush(p, ahoraMs);
    return {
      error: null,
      salud: polls.map((f) => {
        const v = veredictoDePoll({
          proveedor: f.proveedor, ultimoPollEn: f.ultimoPollEn, ultimoCompletoEn: f.ultimoCompletoEn,
          erroresSeguidos: f.erroresSeguidos, ultimaFalla: f.ultimaFalla, proximoIntentoEn: f.proximoIntentoEn,
          ultimoError: f.ultimoError, backlogPendiente: f.backlogPendiente,
        }, ahoraMs);
        return { clave: f.proveedor, nombre: conectorGpsPorId(f.proveedor)?.nombre ?? f.proveedor, tono: v.tono, estado: v.estado, texto: v.texto };
      }),
      push: {
        fila: { clave: 'gps_push', nombre: 'GPS propio', tono: vp.tono, estado: ROTULO_ESTADO[vp.estado], texto: vp.texto },
        configurado: p.configurado, version: p.version, recepciones: p.recepcionesTotal, rechazos: p.rechazosTotal, previoHasta: p.previoVigenteHasta,
      },
      endpoint, huerfanos: h.lista, hayMasHuerfanos: h.hayMas, conteos,
    };
  } catch {
    return {
      error: 'No se pudo leer la salud del GPS: no se afirma nada de las integraciones. Vuelve a intentar.',
      salud: [], push: { fila: { clave: 'gps_push', nombre: 'GPS propio', tono: 'neutral', estado: 'sin leer', texto: 'No se pudo leer.' }, configurado: false, version: null, recepciones: 0, rechazos: 0, previoHasta: null },
      endpoint, huerfanos: [], hayMasHuerfanos: false, conteos: null,
    };
  }
}
