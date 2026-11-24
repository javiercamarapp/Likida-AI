// Familia placas y cajas: V01 placa, V02 caja a un dígito, V03 ref vs caja, V06 caja duplicada en pool/programa.
import { ausente, cajaNorm, distanciaEdicion, esPendiente, hallazgo, lista, norm, placaNorm, regexSegura, txt } from './base';
import type { CajaInventario, ConfigValidaciones, ContextoPool, ContextoValidacion, FichaValidable, FilaPool, Hallazgo, Regla } from './tipos';

// ── V01 ─────────────────────────────────────────────────────────────────────
export function validarPlacas(f: FichaValidable, c: ContextoValidacion, cfg: ConfigValidaciones): Hallazgo[] {
  const hs: Hallazgo[] = [];
  const placaCaja = f.caja?.placas;
  const estado = f.caja?.estado;
  if (esPendiente(placaCaja)) hs.push(ausente('V01', 'la placa de la caja', ['caja.placas'], 'bloqueo'));
  if (cfg.exigirEstadoCaja && esPendiente(estado)) {
    hs.push(hallazgo('V01', 'bloqueo', 'Falta el estado/país de la placa de la caja; sin él la unidad no sale.', ['caja.estado'],
      'Pedir el estado/país de la placa de la caja; no se completa por inferencia.', true));
  }
  const placaTracto = f.unidad?.placa;
  if (esPendiente(placaTracto)) hs.push(ausente('V01', 'la placa del tracto', ['unidad.placa'], 'bloqueo'));

  // Formato (configurable por estado; el genérico es la forma del catálogo).
  const fuente = cfg.formatoPlacaPorEstado[norm(estado)] ?? cfg.formatoPlacaGenerico;
  const re = regexSegura(fuente);
  for (const [campo, valor] of [['caja.placas', placaCaja], ['unidad.placa', placaTracto]] as const) {
    if (esPendiente(valor)) continue;
    if (!re) {
      hs.push(hallazgo('V01', 'aviso', 'El formato de placa configurado no es una expresión válida; no se evaluó.', [campo], 'Corregir la configuración de formato de placa.'));
      break;
    }
    if (!re.test(placaNorm(valor))) {
      hs.push(hallazgo('V01', 'aviso', 'La placa no cumple el formato configurado.', [campo], 'Confirmar la placa con quien la capturó; no se autocorrige.'));
    }
  }

  // Contra el catálogo.
  const cajaNum = cajaNorm(f.caja?.numero, cfg.prefijosCaja);
  const reg = lista(c.catalogoCajas).find((x) => cajaNorm(x.numero, cfg.prefijosCaja) === cajaNum && cajaNum !== '');
  if (reg && !esPendiente(reg.placas) && !esPendiente(placaCaja) && placaNorm(reg.placas) !== placaNorm(placaCaja)) {
    hs.push(hallazgo('V01', 'bloqueo', 'La placa de la caja no coincide con la del catálogo.', ['caja.placas'],
      'Retener el envío y avisar al encargado; la placa del catálogo no se sustituye sola.'));
  }
  const eco = norm(f.unidad?.eco);
  const un = lista(c.catalogoUnidades).find((x) => norm(x.eco) === eco && eco !== '');
  if (un && !esPendiente(un.placa) && !esPendiente(placaTracto) && placaNorm(un.placa) !== placaNorm(placaTracto)) {
    hs.push(hallazgo('V01', 'bloqueo', 'La placa del tracto no coincide con la del catálogo.', ['unidad.placa'],
      'Retener el envío y avisar al encargado; no se autocorrige.'));
  }
  // Misma placa en dos unidades/cajas.
  if (!esPendiente(placaTracto)) {
    const otros = lista(c.catalogoUnidades).filter((x) => placaNorm(x.placa) === placaNorm(placaTracto) && norm(x.eco) !== eco);
    if (otros.length > 0) hs.push(hallazgo('V01', 'bloqueo', 'La misma placa figura en más de una unidad del catálogo.', ['unidad.placa'], 'Conflicto de catálogo: corregirlo antes de enviar.'));
  }
  if (!esPendiente(placaCaja)) {
    const otras = lista(c.catalogoCajas).filter((x) => placaNorm(x.placas) === placaNorm(placaCaja) && cajaNorm(x.numero, cfg.prefijosCaja) !== cajaNum);
    if (otras.length > 0) hs.push(hallazgo('V01', 'bloqueo', 'La misma placa figura en más de una caja del catálogo.', ['caja.placas'], 'Conflicto de catálogo: corregirlo antes de enviar.'));
  }
  // Contra lo que dicen CCP/QR/prealerta.
  for (const d of lista(f.placasEnDocumentos)) {
    const origen = txt(d.origen) || 'documento';
    if (d.placaCaja !== undefined && !esPendiente(placaCaja) && placaNorm(d.placaCaja) !== placaNorm(placaCaja)) {
      hs.push(hallazgo('V01', 'bloqueo', `La placa de la caja en ${origen} no coincide con la de la ficha.`, ['caja.placas', 'placasEnDocumentos'], 'Retener; el documento o la ficha está mal.'));
    }
    if (d.placaTracto !== undefined && !esPendiente(placaTracto) && placaNorm(d.placaTracto) !== placaNorm(placaTracto)) {
      hs.push(hallazgo('V01', 'bloqueo', `La placa del tracto en ${origen} no coincide con la de la ficha.`, ['unidad.placa', 'placasEnDocumentos'], 'Retener; el documento o la ficha está mal.'));
    }
  }
  return hs;
}

// ── V02 ─────────────────────────────────────────────────────────────────────
export function validarCajaUnDigito(f: FichaValidable, c: ContextoValidacion, cfg: ConfigValidaciones): Hallazgo[] {
  const hs: Hallazgo[] = [];
  const asignada = cajaNorm(c.cajaAsignada, cfg.prefijosCaja);
  if (asignada === '') return [ausente('V02', 'la caja asignada al servicio', ['cajaAsignada'])];
  const inv = lista(c.catalogoCajas);
  const candidatas: Array<[string, string | undefined]> = [['caja.numero', f.caja?.numero], ['cajaCitada', f.cajaCitada]];
  for (const [campo, crudo] of candidatas) {
    const n = cajaNorm(crudo, cfg.prefijosCaja);
    if (n === '') continue;
    if (n !== asignada) {
      const d = distanciaEdicion(n, asignada);
      if (d <= 1) {
        hs.push(hallazgo('V02', 'bloqueo', `Posible captura errónea: la caja asignada es ${asignada} y se cita ${n} (un carácter de diferencia).`, [campo, 'cajaAsignada'],
          `Confirmar con el encargado cuál es la caja; no se elige una.`));
      } else {
        hs.push(hallazgo('V02', 'bloqueo', `La caja citada (${n}) no es la asignada al servicio (${asignada}).`, [campo, 'cajaAsignada'],
          'Confirmar con el encargado; no se elige una.'));
      }
    }
    if (inv.length > 0) {
      const reg = inv.find((x) => cajaNorm(x.numero, cfg.prefijosCaja) === n);
      if (!reg) {
        hs.push(hallazgo('V02', 'aviso', `La caja ${n} no existe en el inventario.`, [campo], 'Verificar el número con control de equipo.'));
      } else if (c.ubicacionEsperada && !esPendiente(reg.ubicacion) && norm(reg.ubicacion) !== norm(c.ubicacionEsperada)) {
        hs.push(hallazgo('V02', 'aviso', `La caja ${n} figura en una ubicación distinta a la esperada.`, [campo, 'ubicacionEsperada'], 'Confirmar la ubicación con control de equipo.'));
      }
    }
  }
  return hs;
}

// ── V03 ─────────────────────────────────────────────────────────────────────
export function validarRefVsCaja(f: FichaValidable, c: ContextoValidacion, cfg: ConfigValidaciones): Hallazgo[] {
  const hs: Hallazgo[] = [];
  const tabla = lista(c.equivalencias);
  if (tabla.length === 0) return [ausente('V03', 'la tabla de equivalencias ref↔caja (no se infiere)', ['equivalencias'])];
  const refs = [...new Set([f.ref, ...lista(f.refsCitadas)].map((r) => norm(r)).filter((r) => r !== ''))];
  const caja = cajaNorm(f.caja?.numero ?? f.cajaCitada, cfg.prefijosCaja);
  for (const r of refs) {
    const filas = tabla.filter((x) => norm(x.ref) === r);
    if (filas.length === 0) {
      hs.push(hallazgo('V03', 'bloqueo', `La referencia ${r} no está en la tabla de equivalencias.`, ['ref'], 'Pedir confirmación del servicio; incluir siempre ref y caja en la respuesta.'));
      continue;
    }
    if (caja !== '' && !filas.some((x) => cajaNorm(x.caja, cfg.prefijosCaja) === caja)) {
      hs.push(hallazgo('V03', 'bloqueo', `La referencia ${r} no corresponde a la caja ${caja} según la tabla.`, ['ref', 'caja.numero'], 'Retener; pedir confirmación de la ref o de la caja.'));
    }
  }
  if (refs.length === 0) hs.push(ausente('V03', 'la referencia del cliente', ['ref']));
  if (refs.length > 1 && caja !== '') {
    hs.push(hallazgo('V03', 'aviso', 'El mensaje mezcla varias referencias con una sola caja: posibles servicios mezclados.', ['refsCitadas', 'caja.numero'], 'Separar por servicio y confirmar cada ref con su caja.'));
  }
  return hs;
}

// ── V06 (pool/programa) ─────────────────────────────────────────────────────
export function validarPoolCajas(filas: readonly FilaPool[], c: ContextoPool, cfg: ConfigValidaciones): Hallazgo[] {
  const hs: Hallazgo[] = [];
  const rows = lista(filas as FilaPool[]);
  if (rows.length === 0) return [ausente('V06', 'las filas del pool/programa', ['filas'])];
  const porClave = new Map<string, FilaPool[]>();
  for (const r of rows) {
    const k = `${cajaNorm(r.caja, cfg.prefijosCaja)}|${txt(r.dia).slice(0, 10)}`;
    const a = porClave.get(k) ?? [];
    a.push(r);
    porClave.set(k, a);
  }
  const inv = lista(c.catalogoCajas);
  for (const [k, grupo] of porClave) {
    const caja = k.split('|')[0];
    if (caja === '') { hs.push(ausente('V06', 'el número de caja de una fila', ['filas.caja'])); continue; }
    if (grupo.length > 1) {
      const ubic = new Set(grupo.map((g) => norm(g.ubicacion)));
      hs.push(hallazgo('V06', 'bloqueo',
        ubic.size > 1 ? `La caja ${caja} aparece repetida con ubicaciones contradictorias.` : `La caja ${caja} aparece repetida.`,
        ['filas.caja'], 'No publicar el pool; avisar al encargado y a control de equipo.'));
      const servicios = new Set(grupo.map((g) => txt(g.servicio)).filter((s) => s !== ''));
      if (servicios.size > 1) hs.push(hallazgo('V06', 'bloqueo', `La caja ${caja} está asignada a más de un servicio el mismo día.`, ['filas.servicio'], 'Resolver la asignación con el encargado.'));
    }
  }
  for (const r of rows) {
    const caja = cajaNorm(r.caja, cfg.prefijosCaja);
    if (caja === '') continue;
    if (c.lineaEsperada && !esPendiente(r.linea) && norm(r.linea) !== norm(c.lineaEsperada)) {
      hs.push(hallazgo('V06', 'aviso', `La caja ${caja} es de otra línea/cliente que la del pool.`, ['filas.linea'], 'Retirarla del pool; no se mueven cajas de otra línea.'));
    }
    if (norm(r.tipo) === 'VAN') hs.push(hallazgo('V06', 'aviso', `La caja ${caja} es tipo van.`, ['filas.tipo'], 'No es válida para este pool; avisar a control de equipo.'));
    if (cfg.exigirSuspensionAire) {
      if (r.suspensionAire === undefined) hs.push(ausente('V06', `si la caja ${caja} tiene suspensión de aire`, ['filas.suspensionAire']));
      else if (r.suspensionAire === false) hs.push(hallazgo('V06', 'aviso', `La caja ${caja} no tiene suspensión de aire.`, ['filas.suspensionAire'], 'No es válida para este pool.'));
    }
    if (['TALLER', 'EN_TALLER', 'EN TALLER'].includes(norm(r.estado))) {
      hs.push(hallazgo('V06', 'aviso', `La caja ${caja} está en taller y figura en el pool.`, ['filas.estado'], 'Confirmar disponibilidad real con control de equipo.'));
    }
    if (inv.length > 0 && !inv.some((x: CajaInventario) => cajaNorm(x.numero, cfg.prefijosCaja) === caja)) {
      hs.push(hallazgo('V06', 'aviso', `La caja ${caja} no existe en el inventario.`, ['filas.caja'], 'Verificar el número con control de equipo.'));
    }
  }
  return hs;
}

export const REGLAS_PLACAS_CAJAS: Regla[] = [
  { id: 'V01', nombre: 'Formato y consistencia de placa', familia: 'placas_cajas', entradas: ['caja.placas', 'caja.estado', 'unidad.placa', 'catalogoCajas', 'catalogoUnidades'], nucleo: true, aplica: () => true, evaluar: validarPlacas },
  { id: 'V02', nombre: 'Caja con un dígito de diferencia', familia: 'placas_cajas', entradas: ['caja.numero|cajaCitada', 'cajaAsignada', 'catalogoCajas'], nucleo: true, aplica: () => true, evaluar: validarCajaUnDigito },
  { id: 'V03', nombre: 'Referencia vs número de caja', familia: 'placas_cajas', entradas: ['ref', 'caja.numero', 'equivalencias'], nucleo: false, aplica: (f, c) => lista(c.equivalencias).length > 0 || lista(f.refsCitadas).length > 0, evaluar: validarRefVsCaja },
];
