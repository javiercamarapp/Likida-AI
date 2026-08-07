# Decisiones del 29-jul-2026 — una página

Salieron de facturar dos tickets reales y cosechar cinco directorios (1,740
fichas de comercio, 319 portales). El detalle está en `00-CIERRE.md`; aquí está
solo lo que se decidió y por qué.

---

## 1. NO se custodia la e.firma. Nunca en nuestro servidor.

**Decisión de Javier, y es la que ordena todo lo demás.**

Con la e.firma se firma cualquier cosa a nombre de la empresa. Un incidente ahí
no es un incidente de producto, es el fin del negocio. Y aunque un cliente la
ofrezca, la respuesta sigue siendo no.

**Lo que cierra:** descarga masiva de CFDI hecha por nosotros. El web service del
SAT la exige; no hay vuelta.

**Lo que NO cierra:** conciliar. Ver punto 2.

---

## 2. El mecanismo es un BUZÓN DE CORREO por tenant.

**El CFDI ya viaja por correo, siempre.** Hoy lo comprobamos dos veces: Megasur
mandó la factura de $839.70 a `G3M.OFICIAL@GMAIL.COM` y La Gas la de $714.75 al
mismo. El portal lo manda ahí por defecto.

Así que la integración más barata no es una API: es **ser destinatario**. Una
dirección por flota (`facturas-<tenant>@likida.ai`), una regla de reenvío en el
correo del contralor, y los XML llegan solos.

```
el operador manda el ticket  →  lo que se GASTÓ
el comercio manda el CFDI    →  lo que se FACTURÓ
la diferencia                →  lo que hay que perseguir
```

Cero credenciales, cero SAT, cero agregador. Y `cfdi_xml.ts` ya parsea el XML.

**Ventaja que se nota poco:** funciona igual con los comercios que exigen cuenta.
La Gas pide contraseña para facturar, pero la factura sale por correo — así que
capturamos el resultado sin tocar la cuenta del cliente.

**Lo que se pierde, y hay que decirlo:**

| Falta | Por qué importa | Cuándo se resuelve |
|---|---|---|
| estatus de **cancelado** | deducir una factura cancelada es un problema real | con agregador |
| el **histórico** | solo se ve desde que se conecta el buzón | con agregador |
| lo facturado que **no llegó al correo** | se persigue algo que ya existe | con agregador |

Ninguno bloquea el demo ni el primer cliente.

---

## 3. Agregador (Syncfy o Belvo) queda para DESPUÉS, no descartado.

Cuando un cliente pida histórico o nos muerda una cancelación.

Es compatible con el punto 1: **las credenciales las custodia el agregador**, el
cliente autoriza en su flujo, y nosotros nunca las vemos. Es el mismo criterio de
la sesión delegada que aplicamos con La Gas, y aquí sí existe infraestructura
para hacerlo bien.

---

## 4. `ezaudita` DESCARTADO como integración.

2,900 millones de CFDI procesados, 90,000 empresas. Sincroniza con el SAT a
diario, trae emitidos y recibidos con estatus, y concilia contra los visores.

**No se integra porque le habla al mismo comprador —el contador— y no da nada que
un agregador no dé más limpio.** Es un producto, no una plataforma.

**Y confirma que el foso está en otro lado:** calcula IVA como el visor del SAT.
No sabe del tope del 15% de combustible en efectivo (RFA 2.9), ni de que el
estímulo de IEPS es solo diésel (LIF 20-A-IV), ni de LISR 28-V. Ninguno de los
cinco competidores tiene motor fiscal.

---

## 5. PAC: PENDIENTE DE ELEGIR — SW Sapien o Facturapi.

**El criterio es Carta Porte, no la descarga.**

Todo viaje de carga federal necesita CFDI de traslado con complemento Carta Porte
3.1. Es obligatorio, con multas serias, y **ya tenemos los datos**: origen,
destino, operador, unidad, kilómetros — se recogen por WhatsApp para liquidar.

Eso mueve el producto de "herramienta administrativa" a "sin esto el camión no
sale".

Los dos candidatos dan **timbrado Y descarga masiva en el mismo contrato**, así
que se elige uno y se ahorra un proveedor. **Decisión pendiente: falta comparar
precio, catálogos de Carta Porte y calidad de la documentación.**

---

## 6. El catálogo crece por PORTAL VERIFICADO, no por scraping masivo.

**Los datos de los directorios no son verdad.** Facturamos dos tickets y **cuatro
fuentes distintas tenían mal el de G500** — el portal, el puerto y el plazo. De
319 portales cosechados, **2 están verificados**.

Y cinco de nuestros propios "hallazgos" eran artefactos de extracción, incluido
uno de 889 comercios que resultó ser un enlace de pie de página.

**La regla que queda:** un portal entra a `comercios.ts` cuando se facturó un
ticket en él. Hasta entonces vive en `docs/investigacion/` con
`plazoVerificado: false`, y hay una prueba que lo exige.

**Y la unidad es el portal, no la marca.** Cualli usa cuatro portales distintos
según la región; hay ~mil marcas de gasolinera en el país. Un catálogo por marca
es inmantenible por construcción.

---

## Lo que NO se decidió, y sigue abierto

- **Qué PAC.** Punto 5.
- **Si se emite Carta Porte**, o solo se prepara el dato. Es un producto, no una
  función.
- **Exportación a CONTPAQi/Aspel**: acordado que aporta, sin fecha.
- **Monederos de combustible** (Edenred, Efectivale, Broxel): la mejor integración
  de combustible que existe, y hace irrelevantes las 61 gasolineras cosechadas
  para el cliente que ya los tenga. Sin evaluar.
- **GPS/TMS** (Wialon, Geotab, Samsara): habilita detección de robo de combustible
  contra rendimiento real. Sin evaluar.

## Lo que sigue siendo de Javier, y bloquea el demo del 6-ago

1. **RFC real de la flota** en `tenant.rfc`. Con el genérico o el mal formado,
   toda factura sale "a revisión" y el demo se ve como si nada aprobara.
2. **URL del aviso de privacidad que resuelva.** Hoy es NXDOMAIN y es además el
   único canal ARCO.
3. **`SENTRY_DSN` en Vercel.**
