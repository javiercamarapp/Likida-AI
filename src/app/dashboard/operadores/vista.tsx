import { Users, Phone, PhoneOff, IdCard } from 'lucide-react';
import { numero, fechaCorta } from '@/lib/formato';
import { clasificarVigencia, DIAS_AVISO } from '@/lib/likida/vigencias';
import { EstadoVacio } from '@/app/admin/ui/kit';
import { BarraPagina } from '../resumen-visual';

/** La fila del registro — SIN el dinero que `OperadorDetalle` trae (ver
 *  encabezado de page.tsx: la fuga del 4-ago). */
export interface FilaOperador {
  operadorId: string;
  nombre: string;
  telefono: string | null;
  numeroEmpleado: string | null;
  activo: boolean;
  viajes: number;
  licenciaTipo: string | null;
  /** ISO AAAA-MM-DD, o null = NO CAPTURADA (≠ vencida). */
  licenciaVence: string | null;
}

/** A cuántos días de hoy vence — comparación lexicográfica de ISO AAAA-MM-DD
 *  contra el día de México que manda la página. */
function diasParaVencer(vence: string, hoy: string): number {
  return Math.round((Date.parse(`${vence}T00:00:00Z`) - Date.parse(`${hoy}T00:00:00Z`)) / 86_400_000);
}

// El umbral y las FRONTERAS de estado son compartidos con `/dashboard/unidades`
// (vigencias.ts): "por vencer" tiene que querer decir lo mismo en las dos
// pantallas, o el gerente aprende dos reglas para el mismo concepto. Lo que NO
// se comparte es el TEXTO: aquí se enseña la fecha real ("vigente hasta 12 mar
// 2027"), que dice más que un conteo de días cuando hay una sola fecha que
// mirar. En Unidades son tres papeles y ahí gana el conteo.

/**
 * El Registro de Operadores (F2): quién maneja, cómo localizarlo y qué
 * vigencia lo ancla — el patrón de Handle aplicado a la licencia (0053).
 * "Sin registrar" se dice tal cual: inventar una fecha marcaría de vencido
 * (o de vigente) a quien no lo está.
 */
export function VistaOperadores({ filas, hoy }: { filas: FilaOperador[]; hoy: string }) {
  const activos = filas.filter((f) => f.activo);
  const sinTelefono = activos.filter((f) => !f.telefono).length;
  const conVencida = activos.filter((f) => f.licenciaVence !== null && diasParaVencer(f.licenciaVence, hoy) < 0).length;
  const porVencer = activos.filter((f) => {
    if (f.licenciaVence === null) return false;
    return clasificarVigencia(diasParaVencer(f.licenciaVence, hoy), 'Licencia').estado === 'por_vencer';
  }).length;

  return (
    <main className="h-full">
      <div className="rounded-2xl min-h-full hairline flex flex-col" style={{ background: 'var(--g1)' }}>
        <BarraPagina
          icono={<Users width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />}
          titulo="Operadores"
        />
        <div className="px-5 py-5 flex-1 space-y-4">

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Kpi titulo="Activos" valor={numero(activos.length)} nota={`${numero(filas.length)} en total`} />
            <Kpi titulo="Sin teléfono" valor={numero(sinTelefono)} nota="los agentes no pueden escribirles"
              tono={sinTelefono > 0 ? 'warn' : undefined} />
            <Kpi titulo="Licencias vencidas" valor={numero(conVencida)} tono={conVencida > 0 ? 'bad' : undefined} />
            <Kpi titulo={`Vencen en ${DIAS_AVISO} días`} valor={numero(porVencer)} tono={porVencer > 0 ? 'warn' : undefined} />
          </div>

          <section className="card p-4">
            <h2 className="font-display text-[15px] font-semibold mb-3">El registro</h2>
            {filas.length === 0 ? (
              <EstadoVacio icono={<Users width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
                Aún no hay operadores dados de alta — el alta rápida vive en Despacho.
              </EstadoVacio>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="text-left" style={{ color: 'var(--faint)' }}>
                      <th className="etiqueta-mono text-[10px] uppercase font-normal pb-2">Operador</th>
                      <th className="etiqueta-mono text-[10px] uppercase font-normal pb-2">Teléfono</th>
                      <th className="etiqueta-mono text-[10px] uppercase font-normal pb-2 pr-6 text-right">Viajes</th>
                      <th className="etiqueta-mono text-[10px] uppercase font-normal pb-2">Licencia</th>
                      <th className="etiqueta-mono text-[10px] uppercase font-normal pb-2">Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filas.map((f) => (
                      <tr key={f.operadorId} className="border-t" style={{ borderColor: 'var(--line2)' }}>
                        <td className="py-2">
                          <span className="font-medium block">{f.nombre}</span>
                          {f.numeroEmpleado && (
                            <span className="block text-[11px] cifra-mono" style={{ color: 'var(--faint)' }}>Nº {f.numeroEmpleado}</span>
                          )}
                        </td>
                        <td className="py-2">
                          {f.telefono ? (
                            <span className="inline-flex items-center gap-1.5 cifra-mono" style={{ color: 'var(--muted)' }}>
                              <Phone width={12} height={12} strokeWidth={1.75} /> {f.telefono}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5" style={{ color: 'var(--warn)' }}>
                              <PhoneOff width={12} height={12} strokeWidth={1.75} /> Sin teléfono
                            </span>
                          )}
                        </td>
                        <td className="py-2 pr-6 text-right cifra-mono">{numero(f.viajes)}</td>
                        <td className="py-2"><PillLicencia f={f} hoy={hoy} /></td>
                        <td className="py-2">
                          <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium"
                            style={f.activo
                              ? { color: 'var(--ok)', background: 'var(--okbg)' }
                              : { color: 'var(--muted)', background: 'var(--canvas)' }}>
                            {f.activo ? 'Activo' : 'Inactivo'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}

/** La vigencia que ancla. Cuatro estados y los cuatro son verdad: vencida /
 *  por vencer (≤30 días) / vigente / SIN REGISTRAR — el null no marca a nadie. */
function PillLicencia({ f, hoy }: { f: FilaOperador; hoy: string }) {
  if (f.licenciaVence === null) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[12px]" style={{ color: 'var(--faint)' }}>
        <IdCard width={12} height={12} strokeWidth={1.75} /> Sin registrar
      </span>
    );
  }
  const dias = diasParaVencer(f.licenciaVence, hoy);
  const estado = clasificarVigencia(dias, 'Licencia').estado;
  const tipo = f.licenciaTipo ? `${f.licenciaTipo} · ` : '';
  const pill = (texto: string, fg: string, bg: string) => (
    <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium" style={{ color: fg, background: bg }}>
      {texto}
    </span>
  );
  if (estado === 'vencido') return pill(`${tipo}vencida ${fechaCorta(f.licenciaVence)}`, 'var(--bad)', 'var(--badbg)');
  if (estado === 'por_vencer') return pill(dias === 0 ? `${tipo}vence hoy` : `${tipo}vence en ${numero(dias)} días`, 'var(--warn)', 'var(--warnbg)');
  return pill(`${tipo}vigente hasta ${fechaCorta(f.licenciaVence)}`, 'var(--ok)', 'var(--okbg)');
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
