import {
  CATEGORIAS, nivelDeFuente,
  type CategoriaConector, type Conector, type FormaDeConectar, type NivelDeFuente,
} from './tipos';
import { CONECTORES_ERP } from './erp';
import { CONECTORES_GPS } from './gps';
import { CONECTORES_PEAJE } from './peaje';
import { CONECTORES_PORTALES_FACTURACION } from './portales_facturacion';

// ═══════════════════════════════════════════════════════════════════════════
// EL CATÁLOGO POR CATEGORÍA. Todo lo que Likida sabe conectar, en un lugar.
//
// Mismo patrón que `facturacion/adaptadores/registro.ts` y por la misma razón:
// agregar un sistema tiene que ser agregar una entrada a la tabla de su archivo
// y nada más. Aquí NO se escribe una segunda lista a mano — se concatenan las
// tres del dominio y todo lo demás (categorías, conteos, filtros) se DERIVA.
// Una lista paralela es la que alguien olvida al meter el segundo conector, y
// entonces la pantalla de configuración enseña cinco cosas cuando hay seis.
//
// ── LA DIFERENCIA CON `conexiones.ts` E `integraciones.ts` ──────────────
//
// Son tres capas y confundirlas es cómo se le enseña al cliente una capacidad
// que su flota no tiene:
//
//   · `conexiones.ts` responde QUÉ TIENE CONECTADO ESTA FLOTA. Mide contra la
//     base (`rastreo_credencial`, datos fiscales, portales vivos). Por tenant.
//   · `integraciones.ts` responde QUÉ SISTEMAS TOCA EL PRODUCTO, en palabras
//     del dueño de la flota, incluyendo lo que no lleva credenciales (WhatsApp,
//     el buzón de correo). Es la pantalla de venta.
//   · ESTE archivo responde QUÉ SÉ CONECTAR, con el detalle técnico: qué
//     credenciales pide cada sistema, qué sabrá hacer, y de dónde salió su
//     endpoint. Es lo que se necesita para CONSTRUIR la pantalla de captura y
//     para contestarle a un director de sistemas que pregunta "¿y cómo?".
//
// Ninguna de las tres se puede derivar de las otras dos, y por eso son tres.
//
// ── QUÉ SE PUEDE AFIRMAR HOY Y QUÉ NO ───────────────────────────────────
//
// No hay credenciales de NINGUNA instancia real: cero conexiones verificadas en
// vivo. Lo que este catálogo afirma es más chico y sí es verdad: de los
// conectores marcados `api_en_vivo`, su mecanismo de autenticación está
// confirmado contra la documentación del fabricante, con URL y fecha. Los demás
// dicen por qué no. `resumenHonesto()` existe para poder pegar esa frase en una
// propuesta sin que nadie la infle.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * TODOS los conectores, en el orden de sus archivos.
 *
 * El orden dentro de cada archivo ya está decidido por evidencia del censo
 * (ver `EVIDENCIA_DE_PRIORIDAD` en `tipos.ts`); aquí no se reordena.
 */
export const CONECTORES: readonly Conector[] = [
  ...CONECTORES_ERP,
  ...CONECTORES_GPS,
  ...CONECTORES_PEAJE,
  // Derivados de `facturacion/comercios.ts`: uno por comercio con cuenta.
  ...CONECTORES_PORTALES_FACTURACION,
];

/**
 * Agrupado por categoría, en el orden de `CATEGORIAS`.
 *
 * El orden lo manda `CATEGORIAS` y NO el orden de aparición (como sí hace
 * `porCategoria` en `integraciones.ts`): aquí las categorías se reparten entre
 * tres archivos, así que "el orden en que se declararon" sería el orden de los
 * imports de arriba — un detalle de implementación gobernando lo que ve el
 * cliente. Una categoría sin conectores NO aparece; hay una prueba que exige
 * que ninguna se quede vacía, porque una categoría vacía en pantalla se lee
 * como "esto no lo hacen".
 */
export function porCategoria(): Array<[CategoriaConector, Conector[]]> {
  return CATEGORIAS
    .map((c) => [c, CONECTORES.filter((k) => k.categoria === c)] as [CategoriaConector, Conector[]])
    .filter(([, lista]) => lista.length > 0);
}

export function conectorPorId(id: string): Conector | null {
  return CONECTORES.find((c) => c.id === id) ?? null;
}

export interface ConteoConectores {
  total: number;
  /** Cuántos hay en cada categoría. Todas las categorías, incluso en cero. */
  porCategoria: Record<CategoriaConector, number>;
  /** Cuántos en cada forma de conectar. Es el conteo que no se puede inflar. */
  porForma: Record<FormaDeConectar, number>;
  /** Con documentación primaria citada contra los que no. */
  porFuente: Record<NivelDeFuente, number>;
}

/**
 * Los conteos, derivados. Nunca escritos a mano.
 *
 * `porForma` es el que importa y es el que un vendedor querría redondear: dice
 * cuántos hablan una API de verdad contra cuántos entran por archivo o esperan
 * un piloto. Publicar solo el `total` sería la cifra que engaña — "17
 * integraciones" cuando la mitad necesita que un cliente nos dé accesos.
 */
export function conteoConectores(): ConteoConectores {
  const porCategoriaConteo = Object.fromEntries(
    CATEGORIAS.map((c) => [c, 0]),
  ) as Record<CategoriaConector, number>;
  const porForma: Record<FormaDeConectar, number> = {
    api_en_vivo: 0, por_archivo: 0, requiere_piloto: 0, no_construido: 0,
  };
  const porFuente: Record<NivelDeFuente, number> = { verificado: 0, sin_verificar: 0 };

  for (const c of CONECTORES) {
    porCategoriaConteo[c.categoria] += 1;
    porForma[c.formaDeConectar] += 1;
    porFuente[nivelDeFuente(c)] += 1;
  }

  return { total: CONECTORES.length, porCategoria: porCategoriaConteo, porForma, porFuente };
}

/**
 * La frase que sí se puede decir en una propuesta, armada desde los conteos.
 *
 * Existe para que nadie tenga que redactarla dos veces y para que no se
 * despegue de la realidad: el día que un conector baje de `api_en_vivo` a
 * `requiere_piloto`, la frase cambia sola. Una frase escrita a mano en un PDF
 * de ventas envejece sin avisar, y la que envejece mal es siempre la optimista.
 */
export function resumenHonesto(): string {
  const c = conteoConectores();
  return [
    `${c.total} sistemas en el catálogo.`,
    `${c.porForma.api_en_vivo} con API en vivo y su autenticación verificada contra la documentación del fabricante;`,
    `${c.porForma.por_archivo} que hoy entran por archivo —que funciona y está terminado—;`,
    `${c.porForma.requiere_piloto} que necesitan que un cliente nos dé accesos para cerrarse;`,
    `${c.porForma.no_construido} declarados como todavía no construidos.`,
    'Ninguna conexión está verificada contra una instancia real: hoy no tenemos credenciales de ningún cliente.',
  ].join(' ');
}

/**
 * Lo que hay que pedirle a un cliente que quiere conectar estos sistemas.
 *
 * Se deriva de las credenciales declaradas, así que no se puede olvidar un
 * campo al mandar el correo. Los secretos se marcan para que quien lo lea sepa
 * que ESO no se manda por WhatsApp ni se pega en un correo.
 */
export function loQuePedirle(ids: readonly string[]): string[] {
  const lineas: string[] = [];
  for (const id of ids) {
    const c = conectorPorId(id);
    if (c === null) {
      // No se ignora en silencio: un id mal escrito produciría una lista corta
      // que se ve completa, y el cliente mandaría accesos a medias.
      lineas.push(`⚠ «${id}» no está en el catálogo de conectores.`);
      continue;
    }
    if (c.credenciales.length === 0) {
      lineas.push(`${c.nombre}: no pide credenciales — ${c.comoConectaHoy}`);
      continue;
    }
    lineas.push(`${c.nombre}:`);
    for (const campo of c.credenciales) {
      const marca = campo.forma === 'secreto' ? ' [SECRETO — mándalo por un canal seguro, no por chat]' : '';
      const opcional = campo.requerida ? '' : ' (opcional)';
      lineas.push(`  · ${campo.rotulo}${opcional}${marca}. ${campo.ayuda}`);
    }
  }
  return lineas;
}

/**
 * Los que se pueden probar de verdad hoy: tienen API y credenciales que pedir.
 *
 * Es el equivalente de `portalesVivos()` en facturación, con la misma
 * distinción: aquello responde "qué puedo hacer AHORA con esta flota cargada" y
 * esto responde "qué sé hacer". Confundirlas es cómo se acaba enseñándole al
 * cliente una capacidad que su flota no tiene habilitada.
 */
export function conectoresProbables(): readonly Conector[] {
  return CONECTORES.filter((c) => c.credenciales.length > 0 && c.formaDeConectar !== 'no_construido');
}
