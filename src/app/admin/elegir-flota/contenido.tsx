import { Building2, FlaskConical } from 'lucide-react';
import { AvisoCompacto, BarraFiltros, Boton, BotonEnlace, EstadoError, FiltroBusqueda, Icono, StatusChip, TablaBase, type ColumnaBase } from '@/app/ui-v2/componentes';
import { EsqueletoTablaMaestra } from '@/app/ui-v2/esqueletos';
import { NavegacionFilas } from './navegacion-teclado';
import { type TSistema, T_SISTEMA_ES } from '@/lib/i18n/sistema_tr';
import '../resumen.css';
import '../pulido-c.css';

// ═══════════════════════════════════════════════════════════════════════════
// EL SELECTOR DE FLOTA — la pantalla que mató al tenant implícito.
//
// Un superadmin que entra a /dashboard sin "ver como" (`?tenant=`/`?vista=`)
// y sin selección previa aterriza AQUÍ en vez de caer a la demo en silencio
// (hallazgo #1 de la auditoría externa). La demo SIGUE existiendo — como
// opción EXPLÍCITA, con su nombre y su naturaleza a la vista, jamás como
// default que nadie pidió.
//
// Server Component puro y separado del gateo (convención inicio-contenido):
// el preview headless lo monta sin sesión para VERIFICAR MIRANDO.
// ═══════════════════════════════════════════════════════════════════════════

export interface FlotaElegible {
  id: string;
  nombre: string;
}

export function ElegirFlotaContenido({
  flotas, demoId, seleccionActual, next, error, errorLista, consulta = '',
  accionElegir, accionQuitar, t = T_SISTEMA_ES,
}: {
  /** Las flotas reales (la demo NO va aquí — tiene su tarjeta propia). */
  flotas: FlotaElegible[];
  demoId: string;
  /** La selección vigente de la cookie, para marcarla — null sin selección. */
  seleccionActual: string | null;
  /** A dónde volver después de elegir (ya validado por `destinoSeguro`). */
  next: string;
  /** Error del intento anterior (`?error=`): flota inválida o firma caída. */
  error: string | null;
  /** `true` si la LISTA no se pudo leer — se dice, no se enseña vacía. */
  errorLista: boolean;
  /** El texto del buscador (`?q=`): filtra por nombre o id. */
  consulta?: string;
  accionElegir: (formData: FormData) => Promise<void>;
  accionQuitar: () => Promise<void>;
  /** Traductor del namespace `admin_sistema` (la página lo pasa; sin él habla español). */
  t?: TSistema;
}) {
  const q = consulta.trim().toLowerCase();
  const visibles = q ? flotas.filter((f) => f.nombre.toLowerCase().includes(q) || f.id.toLowerCase().includes(q)) : flotas;
  const demo: FilaFlota = { id: demoId, nombre: t('elegir_flota.flota_demo'), esDemo: true };
  const filas: FilaFlota[] = [...visibles.map((f) => ({ ...f, esDemo: false })), ...(q && !demo.nombre.toLowerCase().includes(q) ? [] : [demo])];

  const columnas: ColumnaBase<FilaFlota>[] = [
    {
      id: 'flota', titulo: t('elegir_flota.col_flota'), principal: true,
      celda: (f) => (
        <span className="adm-res-fila" data-activa={seleccionActual === f.id ? '' : undefined}>
          <Icono icono={f.esDemo ? FlaskConical : Building2} />
          <span className="adm-res-fila__texto">
            <span className="adm-res-fila__titulo">{f.nombre}</span>
            <span className="adm-flota-id">{f.esDemo ? t('elegir_flota.demo_no_es_cliente') : f.id}</span>
          </span>
          {seleccionActual === f.id ? <StatusChip tono="ok">{t('elegir_flota.activa')}</StatusChip> : null}
        </span>
      ),
    },
    {
      id: 'elegir', titulo: '', alinear: 'der',
      celda: (f) => {
        const activa = seleccionActual === f.id;
        return (
          <form action={accionElegir} className="adm-flota-form">
            <input type="hidden" name="flota" value={f.esDemo ? 'demo' : f.id} />
            <input type="hidden" name="next" value={next} />
            <Boton type="submit" tamano="sm" variante={activa ? 'ghost' : 'secondary'}>{activa ? t('elegir_flota.volver_a_elegirla') : t('elegir_flota.elegir')}</Boton>
          </form>
        );
      },
    },
  ];

  return (
    <EsqueletoTablaMaestra
      area={t('elegir_flota.area')} titulo={t('elegir_flota.titulo')}
      apoyo={t('elegir_flota.apoyo')}
      acciones={<BotonEnlace variante="ghost" href="/admin">{t('elegir_flota.volver_al_resumen')}</BotonEnlace>}
      filtros={(
        // Buscador de 32 px con la lupa DENTRO del campo (Rovaq): la barra de filtros GET conserva `next` y limpia con un enlace.
        <BarraFiltros accion="/admin/elegir-flota" enLinea buscar etiqueta={t('elegir_flota.buscar_flota')} ocultos={{ next }} nActivos={consulta ? 1 : 0}
          limpiarHref={`/admin/elegir-flota?next=${encodeURIComponent(next)}`}>
          <FiltroBusqueda nombre="q" valor={consulta} placeholder={t('elegir_flota.buscar_flota_ph')} etiqueta={t('elegir_flota.buscar_flota')} />
        </BarraFiltros>
      )}
      avisos={error ? (
        <AvisoCompacto tono="error" resumen={error === 'firma'
          ? t('elegir_flota.error_firma')
          : t('elegir_flota.error_flota')} />
      ) : null}
      pie={errorLista ? undefined : `${filas.length} de ${flotas.length + 1}`}
    >
      {errorLista ? (
        <EstadoError reintentar>{t('elegir_flota.error_lista')}</EstadoError>
      ) : null}
      <NavegacionFilas>
        <TablaBase
          etiqueta={t('elegir_flota.flotas')} columnas={columnas} filas={errorLista ? [demo] : filas} idFila={(f) => f.id} tarjetaMovil altoMaximo={false}
          vacio={{ titulo: t('elegir_flota.sin_flotas'), texto: t('elegir_flota.sin_flotas_texto') }}
        />
      </NavegacionFilas>
      {seleccionActual && (
        <form action={accionQuitar}>
          <Boton type="submit" variante="secondary">{t('elegir_flota.quitar_seleccion')}</Boton>
        </form>
      )}
    </EsqueletoTablaMaestra>
  );
}

interface FilaFlota extends FlotaElegible { esDemo: boolean }
