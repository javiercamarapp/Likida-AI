# RFA 2026 regla 2.9 — el deber ser del 15% de diésel en efectivo

**Fuente:** DOF (SIDOF), leído y verificado en `normas/rfa-2026-2.9.yaml`. Rige el ejercicio 2026.

## La regla

El combustible exige pago electrónico (LISR 27-III 2º párrafo). La facilidad
considera **cumplida** esa obligación cuando TODAS estas condiciones se dan:

1. **Dedicación exclusiva** al autotransporte terrestre de carga federal.
2. **Régimen**: Título II Cap. VII (coordinados) o Título IV Cap. II Secc. I
   (personas físicas con actividad empresarial).
3. **El efectivo no excede el 15%** del total pagado por combustible en el
   ejercicio.
4. **El CFDI consigna el permiso CRE vigente y no suspendido** del proveedor
   (Ley de Hidrocarburos).

Consecuencia: la facilidad **solo salva la deducción de ISR**. NO habilita el
acreditamiento del IEPS (ni el IVA, por ser pago en efectivo).

## La implementación (deber ser completo)

### 1. La flota declara al registrarse
`/admin/flotas` (alta) pide las dos condiciones; se guardan en
`tenant.config.facilidadCombustibleEfectivo` (mig. 0082 valida la llave).
Sin declaración, la válvula no abre.

### 2. Elegibilidad determinística
- `true` (ambas declaradas y verdaderas) → válvula abierta
- `false` (declaró que no) → no deducible (LISR 27-III sin excepción)
- `undefined` (sin declarar) → por confirmar, nada se afirma

### 3. El contador del 15% por ejercicio
`desde_db.ts` suma el combustible del año (total y efectivo previo, excluyendo
el viaje en curso). El motor corta por PROPORCIÓN en la frontera: lo que cabe
dentro del 15% se deduce, el excedente no (mismo mecanismo que el tope de
alimentación LISR 28-V).

### 4. Permiso CRE
Lo cubre la regla B1 del complemento de hidrocarburos: CFDI sin el complemento
→ `permiso_cre_no_verificable` → a revisión.

### 5. Notas honestas
Cada rama dice exactamente lo verificado, con el contador del ejercicio a la
vista ("el ejercicio lleva $X de $Y de combustible en efectivo (Z% del total,
tope 15%)").

## Matriz por comprobante en efectivo

| Situación | ISR | IVA | IEPS | Cubeta |
|---|---|---|---|---|
| Elegible + dentro del 15% | deducible | ❌ | ❌ | deducible (`combustible_efectivo_dentro15`, informativo) |
| Elegible + excede el 15% | excedente no deducible | ❌ | ❌ | proporcional (`efectivo_sobre_15`) |
| No elegible | no deducible | ❌ | ❌ | no_deducible (`efectivo_no_elegible`) |
| Sin declarar | ⚠️ revisar | ❌ | ❌ | por_confirmar (`combustible_efectivo`) |
| Sin permiso CRE | ⚠️ revisar | ❌ | ❌ | por_confirmar (B1) |

## Evidencia en código

- `config.ts` — `facilidadCombustibleEfectivo` en CuadraConfig
- `administracion.ts` / `app/admin/flotas/page.tsx` — captura al alta
- `cuadre/engine.ts` — la matriz (ramas `facilidad15 === true/false/undefined`)
- `cuadre/desde_db.ts` — los agregados del ejercicio
- `supabase/migrations/0082_config_facilidad15.sql` — la llave en el validador
- `cuadre/engine.test.ts` — 5 pruebas de la matriz (verificadas fallando sin el motor)

## Correcciones de la auditoría 14 (misma sesión)

La ronda 14 auditó la implementación y encontró defectos reales — todos
corregidos:

- **Excedente POR COMPROBANTE, no acumulativo**: antes cada gasto posterior al
  cruce colgaba TODO el excedente (un ticket de $1,000 imprimía "excedente de
  $1,500"); ahora la suma de la columna cuadra con totalNoDeducible.
- **El ejercicio es el de los COMPROBANTES**, no el del proceso: un viaje de
  diciembre liquidado en enero ya no pierde su cuota contra un tope de $0.
- **Las superficies honran la elegibilidad**: panel del contador, causasDe,
  avisoTope15 y el chat ya no ofrecen el 15% a flotas no elegibles o sin
  declarar; el IVA del efectivo no se acredita (mismo estándar del motor).
- **Estatus**: el excedente del 15% y la flota no elegible ya no salen
  "cuadrada" (verde) — van a 'revisar'.
- **Alta tri-estado**: una casilla sin marcar = SIN DECLARAR (no "declaró que
  NO"); la declaración se puede ver y corregir desde la consola de flotas.
- **0083**: la base exige la FORMA de la llave (dos booleanos) — un "sí" rebota.
- **Una sola barrida del ejercicio**: desde_db reusa getAcumuladoCombustible
  con las claves del SAT (mismo criterio en motor, panel y chat), best-effort.
