// Avisos de /admin: PURO. Junta las fuentes que ya existían (bandeja de escalaciones, alertas extra de F14/F19/crons/IA y las señales del
// resumen del negocio) en UNA lista de `Aviso`. Los textos salen de `calcularAlertas` y de `alertasExtra` (no se duplican): se llama a
// `calcularAlertas` con los conteos de UNA fuente a la vez (las demás en 0) para obtener exactamente su alerta.
import { calcularAlertas } from '@/app/admin/calcular-alertas';
import type { ConteosEscalaciones, FuenteEscalacion, ItemEscalacion } from '@/lib/admin/escalaciones';
import type { AlertaExtra, IdAlertaExtra } from '@/lib/admin/fuentes-alerta-extra';
import type { ResumenNegocio } from '@/lib/admin/negocio';
import type { Aviso, Categoria, Severidad } from '@/lib/avisos/modelo';

export interface EntradaAvisosAdmin {
  /** `null` = la bandeja entera no se pudo leer (se dice con un aviso crítico; nunca «sin pendientes»). */
  bandeja: { conteos: ConteosEscalaciones; cola: readonly ItemEscalacion[] } | null;
  /** `null` = no se pudieron leer las alertas de sistema. `[]` = se leyó y no hay nada. */
  extras: ReadonlyArray<AlertaExtra> | null;
  /** `null` = el resumen del negocio no se pudo leer. */
  resumen: ResumenNegocio | null;
}

const CEROS: ConteosEscalaciones = { arco: 0, corridasFallo: 0, talachas: 0, facturasProveedor: 0, ticketsAbiertos: 0, ticketsVencidos: 0, liquidacionesRevisar: 0 };
const HREF_ESCALACIONES = '/admin/escalaciones';

interface DefFuente {
  fuente: FuenteEscalacion;
  categoria: Categoria;
  /** Los campos de conteo que alimentan la alerta de esta fuente. */
  campos: (c: ConteosEscalaciones) => Partial<ConteosEscalaciones>;
  huella: (c: ConteosEscalaciones) => string;
  severidad: (c: ConteosEscalaciones) => Severidad;
  silenciable: (c: ConteosEscalaciones) => boolean;
  /** `null` = la fuente no se pudo leer. */
  cuenta: (c: ConteosEscalaciones) => number | null;
}

const DEFS: readonly DefFuente[] = [
  // Plazo legal (20 días hábiles): crítico y no se puede marcar como leído.
  { fuente: 'arco', categoria: 'escalaciones', campos: (c) => ({ arco: c.arco }), huella: (c) => String(c.arco), severidad: () => 'critica', silenciable: () => false, cuenta: (c) => c.arco },
  { fuente: 'corridas', categoria: 'escalaciones', campos: (c) => ({ corridasFallo: c.corridasFallo }), huella: (c) => String(c.corridasFallo), severidad: () => 'atencion', silenciable: () => true, cuenta: (c) => c.corridasFallo },
  { fuente: 'talachas', categoria: 'escalaciones', campos: (c) => ({ talachas: c.talachas }), huella: (c) => String(c.talachas), severidad: () => 'atencion', silenciable: () => true, cuenta: (c) => c.talachas },
  { fuente: 'facturas_proveedor', categoria: 'escalaciones', campos: (c) => ({ facturasProveedor: c.facturasProveedor }), huella: (c) => String(c.facturasProveedor), severidad: () => 'atencion', silenciable: () => true, cuenta: (c) => c.facturasProveedor },
  // SLA vencido = crítico y no silenciable; sin vencidos es trabajo normal de soporte.
  {
    fuente: 'tickets', categoria: 'soporte',
    campos: (c) => ({ ticketsAbiertos: c.ticketsAbiertos, ticketsVencidos: c.ticketsVencidos }),
    huella: (c) => `${c.ticketsAbiertos}/${c.ticketsVencidos ?? 0}`,
    severidad: (c) => ((c.ticketsVencidos ?? 0) > 0 ? 'critica' : 'atencion'),
    silenciable: (c) => (c.ticketsVencidos ?? 0) === 0,
    cuenta: (c) => c.ticketsAbiertos,
  },
  { fuente: 'liquidaciones', categoria: 'escalaciones', campos: (c) => ({ liquidacionesRevisar: c.liquidacionesRevisar }), huella: (c) => String(c.liquidacionesRevisar), severidad: () => 'atencion', silenciable: () => true, cuenta: (c) => c.liquidacionesRevisar },
];

/** ISO válida más antigua entre las del grupo, o `null`. */
function masAntigua(items: readonly ItemEscalacion[]): string | null {
  let mejor: number | null = null;
  for (const i of items) {
    const t = Date.parse(i.desde);
    if (Number.isFinite(t) && (mejor === null || t < mejor)) mejor = t;
  }
  return mejor === null ? null : new Date(mejor).toISOString();
}

// Las alertas extra que NO se pueden marcar como leídas: dicen que el sistema está caído o ciego.
const EXTRA_NO_SILENCIABLE: ReadonlySet<IdAlertaExtra> = new Set<IdAlertaExtra>(['crons_ilegibles', 'cron_sin_latido', 'ia_credito_agotado', 'ia_sin_registro', 'webhook_en_silencio']);

export function avisosDeAdmin(e: EntradaAvisosAdmin): Aviso[] {
  const out: Aviso[] = [];

  // ── Bandeja de escalaciones ───────────────────────────────────────────────
  if (e.bandeja === null) {
    out.push({
      clave: 'bandeja_ilegible|1', fuente: 'bandeja_ilegible', categoria: 'escalaciones', severidad: 'critica',
      titulo: 'No se pudo leer la bandeja de escalaciones: puede haber pendientes que no se están viendo.',
      detalle: null, href: HREF_ESCALACIONES, desde: null, silenciable: false,
    });
  } else {
    const { conteos, cola } = e.bandeja;
    for (const d of DEFS) {
      const n = d.cuenta(conteos);
      if (n === null || n <= 0) continue;
      const [alerta] = calcularAlertas(null, [], { ...CEROS, ...d.campos(conteos) }, null);
      if (!alerta) continue;
      const items = cola.filter((i) => i.fuente === d.fuente);
      out.push({
        clave: `${d.fuente}|${d.huella(conteos)}`, fuente: d.fuente, categoria: d.categoria, severidad: d.severidad(conteos),
        titulo: alerta.texto,
        detalle: items.length > 0 ? items.slice(0, 3).map((i) => `${i.tenantNombre}: ${i.titulo}`).join(' · ') : null,
        href: alerta.href ?? HREF_ESCALACIONES, desde: masAntigua(items), silenciable: d.silenciable(conteos),
      });
    }
    // Fuentes ilegibles: UN aviso que las nombra (una fuente ciega no es «nada pendiente»).
    const ciegos: ConteosEscalaciones = { ...CEROS };
    const nombres: string[] = [];
    for (const d of DEFS) {
      if (d.cuenta(conteos) === null) {
        nombres.push(d.fuente);
        if (d.fuente === 'arco') ciegos.arco = null;
        else if (d.fuente === 'corridas') ciegos.corridasFallo = null;
        else if (d.fuente === 'talachas') ciegos.talachas = null;
        else if (d.fuente === 'facturas_proveedor') ciegos.facturasProveedor = null;
        else if (d.fuente === 'tickets') ciegos.ticketsAbiertos = null;
        else ciegos.liquidacionesRevisar = null;
      }
    }
    if (nombres.length > 0) {
      const [alerta] = calcularAlertas(null, [], ciegos, null);
      out.push({
        clave: `fuentes_ilegibles|${[...nombres].sort().join(',')}`, fuente: 'fuentes_ilegibles', categoria: 'escalaciones', severidad: 'critica',
        titulo: alerta?.texto ?? 'No se pudo leer una fuente de la bandeja de escalaciones.', detalle: null,
        href: alerta?.href ?? HREF_ESCALACIONES, desde: null, silenciable: false,
      });
    }
  }

  // ── Sistema: crons, IA, F14 (diagnóstico), F19 (silencio del webhook) ─────
  if (e.extras === null) {
    out.push({
      clave: 'extras_ilegibles|1', fuente: 'extras_ilegibles', categoria: 'sistema', severidad: 'critica',
      titulo: 'No se pudieron leer las alertas de sistema (crons, IA, webhook): no se sabe si algo está caído.',
      detalle: null, href: '/admin/salud-sistema', desde: null, silenciable: false,
    });
  } else {
    for (const x of e.extras) {
      const noSilenciable = EXTRA_NO_SILENCIABLE.has(x.id);
      out.push({
        clave: `${x.id}|${[...x.items].sort().join(',')}`, fuente: x.id, categoria: 'sistema',
        severidad: noSilenciable ? 'critica' : 'atencion', titulo: x.texto, detalle: null, href: x.href, desde: null, silenciable: !noSilenciable,
      });
    }
  }

  // ── Resumen del negocio: costo de IA y «solo demo» ────────────────────────
  if (e.resumen === null) {
    out.push({
      clave: 'resumen_ilegible|1', fuente: 'resumen_ilegible', categoria: 'costos', severidad: 'critica',
      titulo: 'No se pudo leer el resumen del negocio (costo de IA y flotas): las señales que dependen de él no se están evaluando.',
      detalle: null, href: '/admin', desde: null, silenciable: false,
    });
  } else {
    for (const a of calcularAlertas(e.resumen, [], CEROS, null)) {
      if (a.href === '/admin/costos-facturacion') {
        out.push({ clave: `costo_ia|${e.resumen.tendenciaCosto}`, fuente: 'costo_ia', categoria: 'costos', severidad: 'atencion', titulo: a.texto, detalle: null, href: a.href, desde: null, silenciable: true });
      } else if (a.href === '/admin/flotas') {
        out.push({ clave: 'solo_demo|1', fuente: 'solo_demo', categoria: 'negocio', severidad: 'info', titulo: a.texto, detalle: null, href: a.href, desde: null, silenciable: true });
      }
    }
  }
  return out;
}
