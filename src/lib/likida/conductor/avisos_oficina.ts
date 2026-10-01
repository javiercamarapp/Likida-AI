import { logger } from '@/lib/logger';
import { appUrl } from '@/lib/env';
import { avisarOficina, parametrosAvisoOficina } from '@/lib/meta/aviso_oficina';
import { telefonosJefe } from '../contactos';
import { puertosReales } from './ejecutor';
import { resumenParaPlantilla, textoAvisoOficina } from './mensajes';
import type { Contacto, HitoFila } from './tipos';
import type { ViajeContexto } from './repo';

// ═══════════════════════════════════════════════════════════════════════════
// EL AVISO A LA OFICINA — «Juan llegó a cargar a las 14:32».
//
// El sistema actual de Innovativos no manda este aviso. Es CONFIGURABLE por flota
// (`avisar_oficina_llegada` / `avisar_oficina_salida`, apagados por defecto: un
// aviso por hito a 250 camiones es mucho ruido hasta que el tráfico lo pida) y
// lleva la hora EXACTA del mensaje del chofer.
//
// Sale por `avisarOficina` (selector de ventana 24 h + plantilla `aviso_operacion_v1`)
// y se RECLAMA en `viaje_hito_aviso` (clase `aviso_oficina`): una reentrega o un
// segundo mensaje no avisan dos veces el mismo hito del mismo ciclo. Best-effort:
// nunca lanza ni le quita nada al acuse del chofer.
// ═══════════════════════════════════════════════════════════════════════════

export interface ArgsAvisoOficina {
  viaje: ViajeContexto;
  hito: HitoFila;
  mensajeEn: Date;
  contacto: Contacto | null;
  ahora: Date;
}

export async function avisarOficinaDeHito(a: ArgsAvisoOficina): Promise<'enviado' | 'ya_avisado' | 'sin_destinatario' | 'fallo'> {
  try {
    const p = puertosReales();
    const claim = {
      tenantId: a.viaje.tenantId, viajeId: a.viaje.id, hitoId: a.hito.id, operadorId: null,
      ciclo: a.hito.ciclo, clase: 'aviso_oficina' as const, nivel: 0,
    };
    const gano = await p.reclamar(claim);
    if (gano === 'perdido') return 'ya_avisado';
    if (gano === 'fallo') return 'fallo';

    const tel = (await telefonosJefe([a.viaje.tenantId]))[a.viaje.tenantId];
    if (!tel) {
      logger.error('conductor.aviso_oficina_sin_telefono', { tenant: a.viaje.tenantId, viaje: a.viaje.id });
      await p.cerrarAviso(claim, { ok: false, canal: 'ninguno', motivo: 'sin_destinatario', ult4: null });
      return 'sin_destinatario';
    }
    const datos = {
      chofer: a.viaje.operadorNombre, folio: a.viaje.folio, tipo: a.hito.tipo, mensajeEn: a.mensajeEn, ahora: a.ahora,
      lugar: a.hito.tipo.endsWith('carga') ? a.viaje.origen : a.viaje.destino, contacto: a.contacto,
    };
    const r = await avisarOficina(tel, textoAvisoOficina(datos), {
      parametros: parametrosAvisoOficina(a.viaje.operadorNombre ?? 'Tu chofer', resumenParaPlantilla(datos), `${appUrl()}/dashboard/agentes/conductores`),
      contexto: { agente: 'conductor_hito', tenantId: a.viaje.tenantId, viaje: a.viaje.id },
    });
    if (r.ok) {
      await p.cerrarAviso(claim, { ok: true, canal: r.via, motivo: null, ult4: tel.slice(-4) });
      return 'enviado';
    }
    await p.cerrarAviso(claim, { ok: false, canal: 'ninguno', motivo: r.motivo.slice(0, 200), ult4: tel.slice(-4) });
    return 'fallo';
  } catch (e) {
    logger.error('conductor.aviso_oficina_fallo', { viaje: a.viaje.id, err: e instanceof Error ? e.message : String(e) });
    return 'fallo';
  }
}
