import { supabaseAdmin } from '@/lib/supabase/admin';
import { conteo, traerTodo } from '@/lib/likida/pg';
import { acotada } from '@/lib/likida/presupuesto';
import { hoyMx } from '@/lib/formato';

// ═══════════════════════════════════════════════════════════════════════════
// INSTRUMENTACIÓN DE PRODUCTO (0251) — los lectores de /admin/crecimiento.
//
// Dos piezas, con reglas de honestidad distintas:
//
//   · EL EMBUDO ACTIVADOS → DE PAGO no necesitaba tabla nueva (Q2 del
//     catálogo: «falta la CONSULTA, no el dato»): se cuenta en la base sobre
//     tenant/liquidacion/suscripcion, que existen desde la 0001/0052.
//
//   · LAS COHORTES DE RETENCIÓN salen de `producto_evento`, que NACIÓ con la
//     0251 — y eso obliga a la regla más importante de este módulo: un mes
//     ANTERIOR al primer evento registrado no es «0% de retención», es «no
//     medido» (null). Cero medido y ausencia de medición son respuestas
//     distintas, y pintarlas igual convertiría el estreno de la tabla en una
//     gráfica de churn total inventado.
//
// Todo lector LANZA si no puede leer — el que pinta decide qué decir, y lo
// que jamás pasa es que una base caída se vea como «cero flotas activas».
// ═══════════════════════════════════════════════════════════════════════════

export interface EmbudoActivacion {
  /** Tenants dados de alta (incluye el demo — quien pinta lo dice). */
  altas: number;
  /** Tenants con AL MENOS una liquidación: llegaron a liquidar de verdad. */
  activadas: number;
  /** Tenants con suscripción en estado 'activa' (0052). Ni 'prueba' ni
   *  'morosa' cuentan como pagando. */
  dePago: number;
}

/** Valida el jsonb de `embudo_activacion()` sin confiar en su forma: un campo
 *  ausente o no numérico LANZA — nunca se rellena con 0. Pura para probarse. */
export function parsearEmbudo(data: unknown): EmbudoActivacion {
  const d = (data ?? null) as Record<string, unknown> | null;
  const n = (campo: string): number => {
    const v = d?.[campo];
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      throw new Error(`embudo_activacion: '${campo}' no vino como número — no se inventa un 0`);
    }
    return v;
  };
  return { altas: n('altas'), activadas: n('activadas'), dePago: n('de_pago') };
}

export async function getEmbudoActivacion(): Promise<EmbudoActivacion> {
  const { data, error } = await acotada(
    supabaseAdmin().rpc('embudo_activacion'), 'instrumentacion.embudo',
  );
  if (error) throw new Error(`embudo_activacion: ${error.message}`);
  return parsearEmbudo(data);
}

// ── Cohortes de retención (Q4 del catálogo) ────────────────────────────────

/** Una fila del GROUP BY mensual de la base. `mes` viaja como 'YYYY-MM'. */
export interface UsoMensual { tenantId: string; mes: string; eventos: number }

export interface TenantAlta { id: string; nombre: string; creadoEn: string }

export interface CeldaCohorte {
  /** 'YYYY-MM' del mes medido. */
  mes: string;
  /** Flotas de la cohorte con ≥1 evento ese mes — o `null` = NO MEDIDO (el
   *  mes es anterior al primer evento que la tabla registró). */
  activas: number | null;
  /** true en el mes corriente: la celda está incompleta por definición. */
  enCurso: boolean;
}

export interface FilaCohorte {
  /** 'YYYY-MM' del mes de alta (hora local MX). */
  cohorte: string;
  flotas: number;
  celdas: CeldaCohorte[];
}

export interface Cohortes {
  filas: FilaCohorte[];
  /** 'YYYY-MM' del primer evento registrado, o `null` si la tabla sigue
   *  vacía. Es el límite entre «no medido» y «medido». */
  desdeMedicion: string | null;
}

/** El mes local MX ('YYYY-MM') de un instante ISO — vía `hoyMx()`, que es el
 *  ÚNICO sitio del repo que deletrea la zona (B2, auditoría 18). */
export function mesMx(iso: string): string {
  return hoyMx(new Date(iso)).slice(0, 7);
}

function mesSiguiente(mes: string): string {
  const [a, m] = mes.split('-').map(Number);
  const d = new Date(Date.UTC(a, m - 1 + 1, 1));
  return d.toISOString().slice(0, 7);
}

/** Tope de columnas por cohorte: 12 meses bastan para leer retención y
 *  acotan el render — la fila de una cohorte vieja no crece para siempre. */
const MAX_MESES = 12;

/**
 * PURA. Cruza el censo de tenants con el uso mensual y arma la matriz de
 * cohortes. La regla que no se negocia: un mes anterior a `desdeMedicion` es
 * `null` («no medido»), jamás 0 — y con la tabla vacía TODO es null.
 */
export function construirCohortes(
  tenants: readonly TenantAlta[],
  uso: readonly UsoMensual[],
  mesActual: string,
): Cohortes {
  const desdeMedicion = uso.length === 0
    ? null
    : uso.map((u) => u.mes).reduce((a, b) => (a < b ? a : b));

  // (tenant, mes) con actividad — solo eventos > 0 cuentan.
  const activos = new Set(uso.filter((u) => u.eventos > 0).map((u) => `${u.tenantId}|${u.mes}`));

  const porCohorte = new Map<string, TenantAlta[]>();
  for (const t of tenants) {
    const c = mesMx(t.creadoEn);
    const lista = porCohorte.get(c) ?? [];
    lista.push(t);
    porCohorte.set(c, lista);
  }

  const filas: FilaCohorte[] = [...porCohorte.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([cohorte, miembros]) => {
      const celdas: CeldaCohorte[] = [];
      for (let mes = cohorte; mes <= mesActual && celdas.length < MAX_MESES; mes = mesSiguiente(mes)) {
        const medible = desdeMedicion !== null && mes >= desdeMedicion;
        celdas.push({
          mes,
          activas: medible ? miembros.filter((t) => activos.has(`${t.id}|${mes}`)).length : null,
          enCurso: mes === mesActual,
        });
      }
      return { cohorte, flotas: miembros.length, celdas };
    });

  return { filas, desdeMedicion };
}

export async function getCohortesUso(): Promise<Cohortes> {
  const admin = supabaseAdmin();
  const [tenants, uso] = await Promise.all([
    // Una fila por flota (cientos, no cientos de miles) — el mismo criterio
    // que getResumenNegocio: `traerTodo` cubre el recorte a max_rows y LANZA
    // si no completa.
    traerTodo<{ id: string; nombre: string; created_at: string }>(
      (d, h) => acotada(
        admin.from('tenant').select('id, nombre, created_at', conteo(d)).order('id').range(d, h),
        'instrumentacion.tenants',
      ),
      'instrumentacion.tenants',
    ),
    (async () => {
      const { data, error } = await acotada(
        admin.rpc('uso_producto_mensual'), 'instrumentacion.uso_mensual',
      );
      if (error) throw new Error(`uso_producto_mensual: ${error.message}`);
      return ((data ?? []) as Array<{ tenant_id: string; mes: string; eventos: number }>)
        .map((f) => ({ tenantId: String(f.tenant_id), mes: String(f.mes).slice(0, 7), eventos: Number(f.eventos) }));
    })(),
  ]);
  return construirCohortes(
    tenants.map((t) => ({ id: t.id, nombre: t.nombre, creadoEn: t.created_at })),
    uso,
    hoyMx().slice(0, 7),
  );
}
