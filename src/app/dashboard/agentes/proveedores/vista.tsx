import { Building2, Inbox, Download, TriangleAlert, Mail } from 'lucide-react';
import type { FacturaProveedor } from '@/lib/likida/proveedores';
import type { BuzonDeFlota } from '@/lib/correo/buzon_escritura';
import { mxn, numero, fechaCorta } from '@/lib/formato';
import { EstadoVacio } from '@/app/admin/ui/kit';
import { BarraPagina } from '../../resumen-visual';
import {
  SubirFactura, SubirFotoFactura, BotonesDecision, DireccionBuzon, GenerarBuzon, RotarBuzon,
  type AccionProveedores,
} from './controles';

/**
 * La ventana del Agente de Proveedores (F6): la bandeja donde el XML del
 * taller espera la decisión de un humano, y el export que sustituye la
 * captura manual en el ERP. El agente prepara y marca (receptor ajeno,
 * duplicados); la persona decide — nunca al revés.
 */
export function VistaAgenteProveedores({
  facturas, rfcFlota, sufijo, acciones, notificaciones, ficha,
  buzon, dominioConfigurado, puedeAdministrarBuzon,
}: {
  facturas: FacturaProveedor[];
  rfcFlota: string | null;
  sufijo: string;
  acciones: {
    subirFactura: AccionProveedores; subirFoto: AccionProveedores; decidir: AccionProveedores;
    generarBuzon: AccionProveedores; rotarBuzon: AccionProveedores;
  };
  /** La ficha de corridas ya renderizada (`FichaCorridas`). ReactNode y no
   *  datos por la misma razón que las notificaciones: esta vista no debe
   *  importar el módulo de corridas, que trae `supabaseAdmin`. */
  ficha?: React.ReactNode;
  /** El buzón de intake, o `null` si su lectura falló — la sección lo dice en
   *  vez de fingir que no hay buzón. */
  buzon: BuzonDeFlota | null;
  /** ¿Hay `RESEND_EMAIL_DOMAIN`? Sin él no existe dirección que enseñar NI
   *  que generar, y la sección lo dice en vez de armar una que no existe. */
  dominioConfigurado: boolean;
  /** Generar/rotar es CONTROL (`puedeAdministrar`), no dato: el botón solo se
   *  pinta al dueño — y la server action lo vuelve a comprobar de todos modos. */
  puedeAdministrarBuzon: boolean;
  /** La sección de Notificaciones, ya renderizada en el servidor
   *  (`SeccionNotificaciones`). Entra como ReactNode y no como datos: esta
   *  vista no debe importar el motor de avisos, que trae `supabaseAdmin`. */
  notificaciones?: React.ReactNode;
}) {
  const pendientes = facturas.filter((f) => f.estado === 'pendiente');
  const aprobadas = facturas.filter((f) => f.estado === 'aprobada');
  const rechazadas = facturas.filter((f) => f.estado === 'rechazada');
  const receptorAjeno = pendientes.filter((f) => f.receptorEsFlota === false).length;
  const sinExportar = aprobadas.filter((f) => f.exportadaEn === null).length;
  const exportadas = aprobadas.length - sinExportar;

  return (
    <main className="h-full">
      <div className="rounded-2xl min-h-full hairline flex flex-col" style={{ background: 'var(--g1)' }}>
        <BarraPagina
          icono={<Building2 width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />}
          titulo="Facturas de proveedores"
        />
        <div className="px-5 py-5 flex-1 space-y-4">

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Kpi titulo="Esperan tu decisión" valor={numero(pendientes.length)}
              tono={pendientes.length > 0 ? 'warn' : undefined} />
            <Kpi titulo="Aprobadas" valor={numero(aprobadas.length)}
              nota={aprobadas.length === 0 ? undefined
                : `${numero(sinExportar)} sin exportar · ${numero(exportadas)} ya exportadas`} />
            <Kpi titulo="Rechazadas" valor={numero(rechazadas.length)} />
            <Kpi titulo="Con receptor ajeno" valor={numero(receptorAjeno)}
              nota="el CFDI no es a tu RFC" tono={receptorAjeno > 0 ? 'bad' : undefined} />
          </div>

          <section className="card p-4">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <h2 className="font-display text-[15px] font-semibold mb-1">Subir factura de proveedor</h2>
                <p className="text-[11px] mb-3" style={{ color: 'var(--faint)' }}>
                  El XML es el dato duro del CFDI — súbelo siempre que lo tengas. Si solo hay
                  papel, la foto también entra: la IA lee las cifras y la bandeja la marca para
                  revisarse contra el papel antes de aprobar. {rfcFlota
                    ? <>Se valida contra el RFC de tu flota ({rfcFlota}).</>
                    : <>Tu flota aún no tiene RFC capturado: la validación de receptor queda pendiente y se dice.</>}
                </p>
                <div className="space-y-2">
                  <SubirFactura subirFactura={acciones.subirFactura} />
                  <SubirFotoFactura subirFoto={acciones.subirFoto} />
                </div>
              </div>
              {aprobadas.length > 0 && (
                <div className="shrink-0 space-y-1.5">
                  <BotonExport
                    href={linkExport(sufijo, 'sap_b1')}
                    rotulo="Exportar aprobadas (CSV SAP B1)" />
                  <BotonExport
                    href={linkExport(sufijo, 'contpaqi')}
                    rotulo="Exportar aprobadas (CSV CONTPAQi)" />
                  <p className="text-[10.5px] max-w-[260px]" style={{ color: 'var(--faint)' }}>
                    Layout estándar de importación — valídalo con tu contador o consultor SAP
                    antes del primer import. Lo exportado queda marcado en la bandeja.
                  </p>
                </div>
              )}
            </div>
          </section>

          <SeccionBuzon
            buzon={buzon}
            dominioConfigurado={dominioConfigurado}
            puedeAdministrarBuzon={puedeAdministrarBuzon}
            acciones={{ generarBuzon: acciones.generarBuzon, rotarBuzon: acciones.rotarBuzon }}
          />

          <section className="card p-4">
            <h2 className="font-display text-[15px] font-semibold mb-1">La bandeja</h2>
            <p className="text-[11px] mb-3" style={{ color: 'var(--faint)' }}>
              Pendientes arriba; lo decidido queda con su quién y su cuándo
            </p>
            {facturas.length === 0 ? (
              <EstadoVacio icono={<Inbox width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
                Aún no hay facturas de proveedor — sube el primer XML y aparece aquí
                esperando tu decisión.
              </EstadoVacio>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="text-left" style={{ color: 'var(--faint)' }}>
                      <th className="etiqueta-mono text-[10px] uppercase font-normal pb-2">Fecha</th>
                      <th className="etiqueta-mono text-[10px] uppercase font-normal pb-2">Proveedor (RFC)</th>
                      <th className="etiqueta-mono text-[10px] uppercase font-normal pb-2">Concepto</th>
                      <th className="etiqueta-mono text-[10px] uppercase font-normal pb-2 pr-6 text-right">Total</th>
                      <th className="etiqueta-mono text-[10px] uppercase font-normal pb-2">Estado</th>
                      <th className="etiqueta-mono text-[10px] uppercase font-normal pb-2 text-right pr-1">Decidir</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...pendientes, ...aprobadas, ...rechazadas].map((f) => (
                      <tr key={f.id} className="border-t align-top" style={{ borderColor: 'var(--line2)' }}>
                        <td className="py-2.5" style={{ color: 'var(--muted)' }}>
                          {f.fecha ? fechaCorta(f.fecha) : '—'}
                          {/* NULL = fila anterior al rastreo de origen (0108): no se adivina. */}
                          {f.origen && (
                            <span className="block text-[10.5px]" style={{ color: 'var(--faint)' }}>
                              {f.origen === 'correo' ? 'por correo' : 'subida a mano'}
                            </span>
                          )}
                        </td>
                        <td className="py-2.5">
                          <span className="cifra-mono block">{f.emisorRfc ?? 'sin RFC'}</span>
                          {f.receptorEsFlota === false && (
                            <span className="inline-flex items-center gap-1 text-[11px]" style={{ color: 'var(--bad)' }}>
                              <TriangleAlert width={11} height={11} strokeWidth={2} /> receptor ajeno
                            </span>
                          )}
                          {f.receptorEsFlota === null && (
                            <span className="block text-[11px]" style={{ color: 'var(--faint)' }}>receptor sin validar</span>
                          )}
                        </td>
                        <td className="py-2.5">
                          <span className="block truncate max-w-[26ch]" title={f.descripcion ?? undefined}>
                            {f.descripcion ?? 'sin descripción en el XML'}
                          </span>
                          {f.conceptos > 1 && (
                            <span className="block text-[11px]" style={{ color: 'var(--faint)' }}>
                              y {numero(f.conceptos - 1)} concepto{f.conceptos - 1 === 1 ? '' : 's'} más
                            </span>
                          )}
                          {/* Cifra leída por VISIÓN, no del XML: se dice siempre, con su
                              confianza, para que nadie apruebe un OCR como dato duro. */}
                          {f.ocrConfianza !== null && (
                            <span className="inline-flex items-center gap-1 text-[10.5px]" style={{ color: 'var(--warn)' }}>
                              <TriangleAlert width={10} height={10} strokeWidth={2} />
                              leída de foto (OCR {f.ocrConfianza.toFixed(2)}) — revisa contra el papel
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 pr-6 text-right cifra-mono">{mxn(f.total)}</td>
                        <td className="py-2.5">
                          <PillEstado f={f} />
                          <NotaSat estadoSat={f.estadoSat} />
                        </td>
                        <td className="py-2.5 pl-3 text-right">
                          {f.estado === 'pendiente'
                            ? <BotonesDecision facturaId={f.id} decidir={acciones.decidir} />
                            : <span className="text-[11px]" style={{ color: 'var(--faint)' }}>
                                {f.decididoPor ?? '—'}{f.decididoEn ? ` · ${fechaCorta(f.decididoEn)}` : ''}
                              </span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <p className="text-[11px]" style={{ color: 'var(--faint)' }}>
            Los CSV usan el layout estándar de importación de facturas de compra (SAP Business
            One por Excel/DTW; variante simple para CONTPAQi) — no una compatibilidad
            certificada: valídalos con tu contador o consultor SAP antes del primer import. La
            escritura directa al Service Layer de SAP B1 se activa con credenciales del cliente —
            este agente no la promete antes de tenerlas.
          </p>

          {ficha}

          {notificaciones}
        </div>
      </div>
    </main>
  );
}

/**
 * EL BUZÓN DE INTAKE (C1, auditoría 4): la dirección de correo de la flota a
 * la que los proveedores mandan —o el contador reenvía— sus facturas, y los
 * XML adjuntos entran solos a esta bandeja (`api/correo/entrante`).
 *
 * La columna `tenant.buzon_token` existía desde la 0095 y el webhook la leía,
 * pero NADIE la escribía: 0 flotas con buzón en producción. Esta sección es
 * quien la llena. Exportada para poder probar su gateo por render.
 */
export function SeccionBuzon({ buzon, dominioConfigurado, puedeAdministrarBuzon, acciones }: {
  buzon: BuzonDeFlota | null;
  dominioConfigurado: boolean;
  puedeAdministrarBuzon: boolean;
  acciones: { generarBuzon: AccionProveedores; rotarBuzon: AccionProveedores };
}) {
  return (
    <section className="card p-4">
      <h2 className="font-display text-[15px] font-semibold mb-1">Buzón de facturas por correo</h2>
      <p className="text-[11px] mb-3 max-w-xl" style={{ color: 'var(--faint)' }}>
        Dale esta dirección a tus proveedores o reenvía ahí sus facturas: los XML adjuntos
        entran solos a esta bandeja, sin subir nada a mano.
      </p>

      {buzon === null ? (
        // La lectura falló. NO se dice "sin buzón": ese estado ofrecería
        // generar uno encima del que quizá ya existe, y rotarlo sin querer.
        // Un <p> y no `EstadoError`: aquel trae `useRouter` para reintentar,
        // y esta sección se degrada dentro de una página que sí cargó.
        <p className="text-[12.5px]" style={{ color: 'var(--bad)' }}>
          No se pudo leer el buzón de la flota ahora mismo. Recarga la página; si se repite,
          avísale a Likida.
        </p>
      ) : !dominioConfigurado ? (
        // Sin RESEND_EMAIL_DOMAIN no hay dirección que enseñar ni que generar:
        // se dice qué falta en vez de armar una dirección que no existe.
        <EstadoVacio icono={<Mail width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
          El dominio de correo no está configurado en este entorno
          (falta <code className="cifra-mono">RESEND_EMAIL_DOMAIN</code>), así que el buzón por
          correo no puede operar. Es configuración del sistema, no de tu flota.
        </EstadoVacio>
      ) : buzon.direccion ? (
        <div>
          <DireccionBuzon direccion={buzon.direccion} />
          {puedeAdministrarBuzon && <RotarBuzon rotar={acciones.rotarBuzon} />}
        </div>
      ) : (
        <div>
          <p className="text-[12.5px] mb-2 max-w-xl" style={{ color: 'var(--muted)' }}>
            Tu flota aún no tiene dirección. Se genera una vez y es única de tu flota — el token
            en la dirección es lo que decide que esas facturas entren aquí y no a otra parte.
          </p>
          {puedeAdministrarBuzon
            ? <GenerarBuzon generar={acciones.generarBuzon} />
            : <p className="text-[12px]" style={{ color: 'var(--faint)' }}>
                Generarla es una acción del dueño de la flota — pídesela a tu administrador.
              </p>}
        </div>
      )}
    </section>
  );
}

/** El link del export arrastrando el `?tenant=`/`?vista=`/`?rol=` de la
 *  previsualización — perderlo mandaría el CSV de otra flota. */
function linkExport(sufijo: string, formato: 'sap_b1' | 'contpaqi'): string {
  return `/api/export/facturas-proveedor${sufijo ? `${sufijo}&` : '?'}formato=${formato}`;
}

function BotonExport({ href, rotulo }: { href: string; rotulo: string }) {
  return (
    <a href={href}
      className="hairline flex items-center gap-1.5 text-[12.5px] font-medium px-3 py-1.5 rounded-lg transition-colors hover:bg-[var(--canvas)]"
      style={{ background: 'var(--surface)' }}>
      <Download width={13} height={13} strokeWidth={1.75} />
      {rotulo}
    </a>
  );
}

/** El estatus ante el SAT, consultado AL INGERIR. null = fila anterior a la
 *  0108 (no se consultó y se dice); 'pendiente' = se intentó y el SAT no
 *  contestó. Un CFDI cancelado grita: aprobarlo mandaría al ERP una factura
 *  que el SAT ya no reconoce. */
function NotaSat({ estadoSat }: { estadoSat: FacturaProveedor['estadoSat'] }) {
  if (estadoSat === 'vigente') {
    return <span className="block text-[10.5px] mt-0.5" style={{ color: 'var(--ok)' }}>vigente ante el SAT</span>;
  }
  if (estadoSat === 'cancelado') {
    return (
      <span className="inline-flex items-center gap-1 text-[10.5px] mt-0.5 font-medium" style={{ color: 'var(--bad)' }}>
        <TriangleAlert width={10} height={10} strokeWidth={2} /> CANCELADO ante el SAT
      </span>
    );
  }
  if (estadoSat === 'no_encontrado') {
    return <span className="block text-[10.5px] mt-0.5" style={{ color: 'var(--warn)' }}>el SAT no lo encuentra</span>;
  }
  return (
    <span className="block text-[10.5px] mt-0.5" style={{ color: 'var(--faint)' }}>
      {estadoSat === 'pendiente' ? 'SAT sin contestar al ingerir' : 'SAT sin consultar'}
    </span>
  );
}

function PillEstado({ f }: { f: FacturaProveedor }) {
  // «Exportada» no borra la decisión: es una aprobada que YA salió en un CSV
  // (`exportada_en`, 0108) — el anti-doble-import visible.
  const cfg = f.estado === 'aprobada'
    ? f.exportadaEn
      ? { rotulo: 'Exportada', fg: 'var(--ok)', bg: 'var(--okbg)' }
      : { rotulo: 'Aprobada', fg: 'var(--ok)', bg: 'var(--okbg)' }
    : f.estado === 'rechazada'
      ? { rotulo: 'Rechazada', fg: 'var(--muted)', bg: 'var(--canvas)' }
      : { rotulo: 'Pendiente', fg: 'var(--warn)', bg: 'var(--warnbg)' };
  return (
    <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium"
      style={{ color: cfg.fg, background: cfg.bg }}>{cfg.rotulo}</span>
  );
}

function Kpi({ titulo, valor, nota, tono }: { titulo: string; valor: string; nota?: string; tono?: 'warn' | 'bad' }) {
  return (
    <div className="card p-3.5">
      <div className="etiqueta-mono text-[10px] uppercase" style={{ color: 'var(--faint)' }}>{titulo}</div>
      <div className="cifra-mono text-[20px] font-medium mt-1"
        style={tono ? { color: `var(--${tono})` } : undefined}>{valor}</div>
      {nota && <div className="text-[11px] mt-0.5" style={{ color: 'var(--faint)' }}>{nota}</div>}
    </div>
  );
}
