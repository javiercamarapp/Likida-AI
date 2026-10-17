# Fixtures sintéticos: misma forma, otros valores

El repo es público. Los datos reales de operación (nómina, peajes, cartas porte, GPS, fotos) viven solo en local. Un fixture imita la FORMA de esos datos para que los parsers se prueben contra la realidad, pero jamás lleva sus VALORES.

## Regla

**Misma FORMA, otros valores.**

| Se conserva (forma) | Se inventa (valores) |
|---|---|
| Cabeceras exactas, con sus espacios, acentos y mayúsculas | Unidades: `TC` + 4 dígitos en el rango 9xxx (`TC9031`) |
| Separador (`;`, `,`, tabulador), relleno de columnas vacías, secciones por día | Teléfonos: 10 dígitos que empiezan por `28999` |
| Hojas del libro (p. ej. una hoja principal y una hoja espejo) | Correos: `algo@demo.invalid` (dominio reservado) |
| Formato de fechas y horas (`dd/mm/aaaa h:mm`), de importes y de claves | Importes: aleatorios con semilla fija, no los reales |
| Número y orden de columnas, filas de totales, líneas en blanco | RFC: solo los genéricos del SAT (`XAXX010101000`, `XEXX010101000`) o sintéticos con homoclave `XXX` | <!-- grep-limpio:ok -->

Los cinco formatos de comprobante de carta porte, el Excel de peajes con espacios en las cabeceras y su hoja espejo, y el CSV de despacho con `;` se reproducen así: cabeceras reales, contenido inventado.

## Qué es un fixture

La prueba de higiene mira el ÍNDICE de git y toma como fixture:

- cualquier archivo dentro de una carpeta cuyo nombre empiece por `fixtures` (`fixtures/`, `fixtures-gps/`);
- cualquier archivo dentro de `__fixtures__/`;
- cualquier archivo `*.fixture.ts` (o `.json`, `.csv`, etc.).

## Qué falla

`src/lib/likida/higiene_fixtures.test.ts` falla si un fixture contiene:

1. un RFC con forma válida (fecha real) que no sea uno de los genéricos del SAT;
2. un correo cuyo dominio no sea reservado (`.invalid`, `.test`, `.example`, `example.com/org/net`);
3. un teléfono de 10 dígitos (con o sin `+52`) que no empiece por `28999`;
4. un importe con `$` de más de 4 cifras, en fixtures cuya ruta sea de nómina, sueldo o liquidación.

La prueba NO contiene nombres de personas ni de empresas: detecta formas, así que no filtra lo que vigila. Nombres, precios y estrategia los cubre `~/likida-loop/cinco-agentes/grep-limpio.sh` (local, fuera del repo).

## Generar valores: semilla fija

`src/lib/likida/fixtures_semilla.ts` expone `generadorFixture(semilla)` (PRNG mulberry32): `unidad()`, `telefono()`, `correo()`, `importe(min, max)`, `entero()`, `elegir()`. Misma semilla, misma secuencia: el fixture no cambia entre corridas ni máquinas. No uses `Math.random()` ni `Date.now()` para armar datos.

## Allowlist de lo existente

Los fixtures anteriores a esta convención no se reescriben desde aquí. Los hallazgos que son falsos positivos o deuda conocida están en `ALLOWLIST` de la prueba, uno por línea y con su justificación (RFC sintético con homoclave `XXX`, marcas de tiempo epoch, teléfonos de relleno con dígitos repetidos). Añadir una entrada exige justificarla; una entrada nueva sin motivo hace fallar la prueba.

## Revisar otro árbol

`HIGIENE_RAIZ=<ruta-de-un-worktree> npx vitest run src/lib/likida/higiene_fixtures.test.ts` audita los fixtures de otro worktree (p. ej. el de peajes) con la misma regla.
