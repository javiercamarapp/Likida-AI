import Link from 'next/link';
import { MapPin, Truck, Camera, FileText, CircleAlert, Check, ChevronRight } from 'lucide-react';
import { mxn, fechaMx, fechaHoraMx } from '@/lib/formato';
import { etiquetaConcepto } from '@/lib/likida/cuadre/engine';
import {
  etiquetaEstatusViaje,
  leerDiferencia,
  type ViajeChofer,
  type ResumenLiquidacion,
  type ComprobanteChofer,
  type ViajeHistorial,
} from '@/lib/likida/chofer';

// ═══════════════════════════════════════════════════════════════════════════
// LO QUE EL CHOFER VE, SEPARADO DE CÓMO SE CONSIGUE.
//
// Las páginas de /chofer son Server Components que empiezan por
// `requireOperador()`: no se pueden renderizar sin sesión, y CLAUDE.md pide
// MIRAR el render, no solo medirlo. Con los bloques aquí, el preview temporal
// importa EL MISMO componente que ve el chofer en vez de una copia con los
// mismos estilos — una copia solo se verifica a sí misma.
//
// ── ESTE ARCHIVO ES PARA UN TELÉFONO, NO PARA UNA PANTALLA ENCOGIDA ──────
//
// El chofer lo abre desde el enlace que le llega por WhatsApp, en la cabina,
// con sol encima y a veces con guantes. De ahí las reglas que no se negocian:
// una sola columna, cuerpo de 16 px para arriba, fondo claro y tinta casi
// negra, montos en `tabular` (si no, las cifras bailan al comparar renglones)
// y todo lo que se toca con el pulgar por encima de 44 px — la acción
// principal, por encima de 56.
//
// NADA ANIMA. No es un olvido de `prefers-reduced-motion`: es que un panel que
// se consulta en treinta segundos, de pie junto a la bomba, no gana nada con
// una cifra que sube contando. Lo único con movimiento es el shimmer de carga,
// que ya se apaga solo con esa preferencia (globals.css).
// ═══════════════════════════════════════════════════════════════════════════

/** Alto mínimo de todo lo que se toca. La acción principal usa el grande. */
export const TOQUE = { normal: 48, principal: 56 } as const;

// ── Piezas base ──────────────────────────────────────────────────────────

export function Tarjeta({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`card p-5 ${className}`}>{children}</div>;
}

export function Titulo({ children }: { children: React.ReactNode }) {
  return (
    <h1 className="text-2xl font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
      {children}
    </h1>
  );
}

/**
 * El bloque de "aquí falta un dato, y este es cuál".
 *
 * Es el mismo criterio de `EstadoVacio` del kit: nunca se rellena con datos de
 * ejemplo ni con ceros que parezcan medición. Se escribe aparte porque el del
 * kit está calibrado para una celda de escritorio (texto de 14 px) y aquí
 * ninguna línea baja de 16.
 */
export function Pendiente({ children }: { children: React.ReactNode }) {
  return (
    <div className="card p-5 flex items-start gap-3">
      <CircleAlert width={20} height={20} strokeWidth={1.75} className="shrink-0 mt-0.5" style={{ color: 'var(--warn)' }} />
      <p className="text-base leading-relaxed">{children}</p>
    </div>
  );
}

export function Pastilla({ tono, children }: { tono: 'ok' | 'warn' | 'bad' | 'neutral'; children: React.ReactNode }) {
  const c = {
    ok: { bg: 'var(--okbg)', fg: 'var(--ok)' },
    warn: { bg: 'var(--warnbg)', fg: 'var(--warn)' },
    bad: { bg: 'var(--badbg)', fg: 'var(--bad)' },
    neutral: { bg: 'var(--canvas)', fg: 'var(--ink2)' },
  }[tono];
  return (
    <span
      className="text-base font-medium px-2.5 py-1 rounded-full inline-flex items-center gap-1.5 shrink-0"
      style={{ background: c.bg, color: c.fg }}
    >
      {children}
    </span>
  );
}

/** Una cifra grande con su rótulo. `tabular` siempre: se comparan entre sí. */
export function Cifra({
  etiqueta, valor, tamano = 'M', tono,
}: {
  etiqueta: string;
  valor: string;
  tamano?: 'M' | 'L';
  tono?: string;
}) {
  return (
    <div>
      <div className="text-base" style={{ color: 'var(--muted)' }}>{etiqueta}</div>
      <div
        className={`${tamano === 'L' ? 'text-4xl' : 'text-2xl'} font-semibold tracking-tight tabular mt-0.5`}
        style={{ color: tono ?? 'var(--ink)' }}
      >
        {valor}
      </div>
    </div>
  );
}

// ── 1. Hoy ───────────────────────────────────────────────────────────────

export function ViajeDeHoy({ viaje, unidad }: { viaje: ViajeChofer; unidad: string | null }) {
  return (
    <Tarjeta>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-base" style={{ color: 'var(--muted)' }}>Folio</div>
          <div className="text-xl font-semibold tabular truncate">{viaje.folio ?? 'Sin folio'}</div>
        </div>
        <Pastilla tono={viaje.estatus === 'abierto' ? 'ok' : 'neutral'}>
          {etiquetaEstatusViaje(viaje.estatus)}
        </Pastilla>
      </div>

      <div className="mt-5 flex items-start gap-3">
        <MapPin width={20} height={20} strokeWidth={1.75} className="shrink-0 mt-0.5" style={{ color: 'var(--marca)' }} />
        <div className="text-lg leading-snug">
          {/* Origen y destino se pintan por separado: si falta uno, se dice cuál
              falta en vez de imprimir "— → Monterrey" y dejar al chofer
              adivinando si el dato es suyo o del sistema. */}
          <span className="font-medium">{viaje.origen ?? 'Origen sin capturar'}</span>
          <span style={{ color: 'var(--faint)' }}> → </span>
          <span className="font-medium">{viaje.destino ?? 'Destino sin capturar'}</span>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-4">
        <div>
          <div className="text-base" style={{ color: 'var(--muted)' }}>Unidad</div>
          <div className="text-lg font-medium tabular flex items-center gap-2 mt-0.5">
            <Truck width={18} height={18} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />
            {unidad ?? <span style={{ color: 'var(--faint)' }}>Sin capturar</span>}
          </div>
        </div>
        <div>
          <div className="text-base" style={{ color: 'var(--muted)' }}>Anticipo</div>
          <div className="text-lg font-medium tabular mt-0.5">
            {viaje.anticipo > 0
              ? mxn(viaje.anticipo)
              : <span style={{ color: 'var(--faint)' }}>Sin registrar</span>}
          </div>
        </div>
      </div>

      <div className="mt-5 pt-4 border-t text-base" style={{ borderColor: 'var(--line)' }}>
        <span style={{ color: 'var(--muted)' }}>Inicio: </span>
        <span className="tabular">{fechaMx(viaje.fechaInicio)}</span>
      </div>
    </Tarjeta>
  );
}

export function SinViaje() {
  return (
    <Pendiente>
      Ahorita no traes ningún viaje abierto. En cuanto tu oficina te asigne uno,
      te llega por WhatsApp y aparece aquí.
    </Pendiente>
  );
}

/** Lo que se ve cuando el viaje ya está aceptado — constancia, no botón. */
export function ViajeAceptado({ cuando }: { cuando: string | null }) {
  return (
    <div className="card p-4 flex items-center gap-3" style={{ background: 'var(--okbg)', borderColor: 'var(--ok)' }}>
      <Check width={20} height={20} strokeWidth={2.25} className="shrink-0" style={{ color: 'var(--ok)' }} />
      <p className="text-base" style={{ color: 'var(--ok)' }}>
        Aceptaste este viaje{cuando ? ` el ${fechaHoraMx(cuando)}` : ''}.
      </p>
    </div>
  );
}

// ── 2. Mi liquidación en vivo ────────────────────────────────────────────

/** El botón "Ver mis viajes" — se toca desde `/chofer/liquidacion` cuando no
 *  hay viaje abierto, y desde el preview de `/admin/vista-chofer` (mismo
 *  componente, no una copia: AUDITORÍA 10, BAJO, ver el docstring de
 *  `SinViajeParaSaldo`). */
export function EnlaceViajes() {
  return (
    <Link
      href="/chofer/viajes"
      className="card px-4 flex items-center justify-between gap-3 text-base font-medium"
      style={{ minHeight: TOQUE.principal }}
    >
      Ver mis viajes
      <ChevronRight width={20} height={20} strokeWidth={2} style={{ color: 'var(--muted)' }} />
    </Link>
  );
}

/**
 * "Mi saldo" sin viaje abierto — lo que ve un chofer recién dado de alta, y
 * exactamente lo que muestra la base vacía del preview.
 *
 * AUDITORÍA 10, BAJO (frontend) — `admin/vista-chofer/page.tsx` mirroreaba
 * este bloque A MANO en vez de importarlo, y ya había divergido: al espejo le
 * faltaba `<EnlaceViajes/>`. Exportado aquí, junto a `Titulo`/`Pendiente`/
 * `SinViaje`, para que el preview importe el componente REAL — una copia
 * verifica la copia, no lo que el chofer ve.
 */
export function SinViajeParaSaldo() {
  return (
    <>
      <Titulo>Mi saldo</Titulo>
      <Pendiente>
        No traes ningún viaje abierto, así que no hay saldo en curso. Lo de tus
        viajes cerrados está en Viajes.
      </Pendiente>
      <EnlaceViajes />
    </>
  );
}

/**
 * La barra de comprobado contra anticipo.
 *
 * ── POR QUÉ BARRA Y NO ANILLO ────────────────────────────────────────────
 *
 * La primera versión era un anillo con el monto en medio, y se descartó
 * MIRÁNDOLA: con el viaje real VJ-2026-0848 ($28,477.15 comprobados) el número
 * se salía del hueco del anillo y se montaba encima del trazo. Un anillo tiene
 * un ancho útil fijo, y aquí adentro va una cifra en pesos que puede medir seis
 * dígitos o tres. La barra crece a lo ancho de la tarjeta y el monto va afuera,
 * en su renglón, donde ninguna cifra lo puede reventar.
 *
 * SIN ANTICIPO NO SE DIBUJA BARRA. Una barra vacía se lee como "llevas 0%", y
 * lo que pasa es otra cosa: que nadie capturó contra qué medir.
 */
export function Barra({ avance }: { avance: number }) {
  const pct = Math.min(Math.max(avance, 0), 1) * 100;
  const pasado = avance > 1;
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      aria-valuetext={`${Math.round(avance * 100)}% del anticipo`}
      className="w-full rounded-full overflow-hidden"
      style={{ height: 16, background: 'var(--line2)' }}
    >
      <div
        className="h-full rounded-full"
        style={{
          width: `${pct}%`,
          // Rayado cuando se pasó del anticipo: la barra llena y la barra
          // desbordada se verían idénticas, y no son lo mismo.
          background: pasado
            ? 'repeating-linear-gradient(45deg, var(--marca) 0 8px, var(--g4) 8px 16px)'
            : 'var(--marca)',
        }}
      />
    </div>
  );
}

export function SaldoEnVivo({ r }: { r: ResumenLiquidacion }) {
  const conAnticipo = r.avance !== null;

  return (
    <Tarjeta>
      <div className="text-base" style={{ color: 'var(--muted)' }}>Llevas comprobado</div>
      <div className="text-4xl font-semibold tracking-tight tabular mt-1">{mxn(r.comprobado)}</div>
      <div className="text-base mt-1" style={{ color: 'var(--muted)' }}>
        {conAnticipo
          ? <>de {mxn(r.anticipo)} de anticipo · <span className="tabular">{Math.round(r.avance! * 100)}%</span></>
          : 'sin anticipo registrado contra qué medirlo'}
      </div>

      {conAnticipo && (
        <div className="mt-4">
          <Barra avance={r.avance!} />
        </div>
      )}

      <div className="mt-6 grid grid-cols-2 gap-4">
        {r.falta !== null && r.falta > 0 && (
          <Cifra etiqueta="Te falta comprobar" valor={mxn(r.falta)} tamano="M" tono="var(--marca)" />
        )}
        {r.excedente !== null && r.excedente > 0 && (
          <Cifra etiqueta="Arriba del anticipo" valor={mxn(r.excedente)} tamano="M" />
        )}
        {r.falta === 0 && r.excedente === 0 && (
          <Cifra etiqueta="Te falta comprobar" valor={mxn(0)} tamano="M" tono="var(--ok)" />
        )}
        <Cifra
          etiqueta={r.comprobantes === 1 ? 'Comprobante' : 'Comprobantes'}
          valor={String(r.comprobantes)}
          tamano="M"
        />
      </div>

      <p className="mt-5 text-base leading-relaxed" style={{ color: 'var(--muted)' }}>
        {r.leyenda}
      </p>

      {r.enRevision > 0 && (
        <div className="mt-4 rounded-xl px-4 py-3 text-base" style={{ background: 'var(--warnbg)', color: 'var(--warn)' }}>
          {r.enRevision === 1
            ? '1 foto se leyó mal. Vuelve a mandarla por WhatsApp mientras sigues en ruta.'
            : `${r.enRevision} fotos se leyeron mal. Vuelve a mandarlas por WhatsApp mientras sigues en ruta.`}
        </div>
      )}
    </Tarjeta>
  );
}

// ── 3. Mis comprobantes ──────────────────────────────────────────────────

/** "Mis comprobantes" sin viaje abierto. Exportado por la misma razón que
 *  `SinViajeParaSaldo`: el preview de `/admin` lo importa en vez de
 *  mirrorearlo. */
export function SinViajeParaComprobantes() {
  return (
    <>
      <Titulo>Mis comprobantes</Titulo>
      <Pendiente>
        No traes ningún viaje abierto. Los comprobantes de tus viajes cerrados
        quedaron en su liquidación, en Viajes.
      </Pendiente>
    </>
  );
}

export function FilaComprobante({ c }: { c: ComprobanteChofer }) {
  const malLeido = c.estado === 'revisar';
  return (
    <li className="card p-4 flex items-center gap-4">
      {/* La foto es SUYA y se la enseña a su dueño (ver `misComprobantes`).
          Si no se guardó, un marco vacío con su ícono — nunca un placeholder
          que parezca una foto que sí existe. */}
      <div
        className="w-14 h-14 rounded-xl shrink-0 overflow-hidden flex items-center justify-center"
        style={{ background: 'var(--canvas)', border: '1px solid var(--line)' }}
      >
        {c.foto ? (
          // `<img>` y no `next/image`: la liga viene FIRMADA y con TTL, y el
          // optimizador la cachearía por su URL para volver a servirla ya
          // caducada — un marco roto donde estaba el ticket del chofer.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={c.foto} alt={`Comprobante de ${etiquetaConcepto(c.concepto)}`} className="w-full h-full object-cover" />
        ) : (
          <Camera width={20} height={20} strokeWidth={1.5} style={{ color: 'var(--faint)' }} />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="text-base font-medium truncate">{etiquetaConcepto(c.concepto)}</div>
        <div className="text-base mt-0.5 tabular" style={{ color: 'var(--muted)' }}>
          {fechaMx(c.fecha)}
        </div>
      </div>

      <div className="text-right shrink-0">
        <div className="text-lg font-semibold tabular">{mxn(c.monto)}</div>
        <div className="mt-1">
          {malLeido
            ? <Pastilla tono="warn">Reenvíala</Pastilla>
            : <Pastilla tono="ok">Registrado</Pastilla>}
        </div>
      </div>
    </li>
  );
}

export function ListaComprobantes({ comprobantes }: { comprobantes: ComprobanteChofer[] }) {
  return (
    <ul className="flex flex-col gap-3">
      {comprobantes.map((c) => <FilaComprobante key={c.id} c={c} />)}
    </ul>
  );
}

// ── 4. Mis viajes ────────────────────────────────────────────────────────

/** "Mis viajes" sin historial. Exportado por la misma razón que
 *  `SinViajeParaSaldo`: el preview de `/admin` lo importa en vez de
 *  mirrorearlo. */
export function SinViajesRegistrados() {
  return (
    <>
      <Titulo>Mis viajes</Titulo>
      <Pendiente>
        Todavía no tienes viajes registrados a tu nombre. Aparecen aquí en
        cuanto tu oficina te asigne el primero.
      </Pendiente>
    </>
  );
}

export function FilaViaje({ v }: { v: ViajeHistorial }) {
  const liq = v.liquidacion;
  const d = liq ? leerDiferencia(liq.diferencia) : null;

  return (
    <li className="card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-base font-semibold tabular truncate">{v.folio ?? 'Sin folio'}</div>
          {/* La ruta ENVUELVE, no se recorta: con `truncate`, "Mérida, YUC →
              Campeche, CAM" salía como "Mérida, YUC → Campeche,…" y el destino
              —que es la mitad del renglón— quedaba adivinándose. */}
          <div className="text-base mt-0.5 leading-snug" style={{ color: 'var(--muted)' }}>
            {v.origen && v.destino ? `${v.origen} → ${v.destino}` : 'Ruta sin capturar'}
          </div>
        </div>
        <Pastilla tono={v.estatus === 'liquidado' ? 'neutral' : 'ok'}>
          {etiquetaEstatusViaje(v.estatus)}
        </Pastilla>
      </div>

      <div className="mt-3 text-base tabular" style={{ color: 'var(--muted)' }}>
        {fechaMx(v.fechaInicio)}
      </div>

      {liq ? (
        <>
          <div className="mt-4 pt-4 border-t grid grid-cols-2 gap-3" style={{ borderColor: 'var(--line)' }}>
            <div>
              <div className="text-base" style={{ color: 'var(--muted)' }}>Comprobado</div>
              <div className="text-lg font-medium tabular">{mxn(liq.comprobado)}</div>
            </div>
            <div>
              <div className="text-base" style={{ color: 'var(--muted)' }}>Anticipo</div>
              <div className="text-lg font-medium tabular">{mxn(liq.anticipo)}</div>
            </div>
          </div>

          <div className="mt-3 flex items-center justify-between gap-3">
            {/* Se dice el SALDO, no un veredicto: que exista diferencia no
                autoriza un descuento (LFT 110-I, ver laboral/pagadero.ts). */}
            <span className="text-base">
              <span style={{ color: 'var(--muted)' }}>{d!.texto}: </span>
              <span className="font-medium tabular">{mxn(Math.abs(liq.diferencia))}</span>
            </span>
          </div>

          {liq.pdf ? (
            <a
              href={liq.pdf}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 w-full rounded-xl flex items-center justify-center gap-2 text-base font-medium"
              style={{ minHeight: TOQUE.normal, background: 'var(--canvas)', border: '1px solid var(--line)', color: 'var(--ink)' }}
            >
              <FileText width={18} height={18} strokeWidth={1.75} />
              Ver mi liquidación (PDF)
            </a>
          ) : (
            <p className="mt-4 text-base" style={{ color: 'var(--faint)' }}>
              Esta liquidación todavía no tiene PDF.
            </p>
          )}
        </>
      ) : (
        <p className="mt-4 pt-4 border-t text-base" style={{ borderColor: 'var(--line)', color: 'var(--muted)' }}>
          Todavía no se cierra la liquidación de este viaje.
        </p>
      )}
    </li>
  );
}

export function ListaViajes({ viajes }: { viajes: ViajeHistorial[] }) {
  return (
    <ul className="flex flex-col gap-3">
      {viajes.map((v) => <FilaViaje key={v.id} v={v} />)}
    </ul>
  );
}
