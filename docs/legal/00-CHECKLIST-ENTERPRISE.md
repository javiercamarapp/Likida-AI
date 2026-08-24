# Checklist de salida enterprise — Likida

Estado inicial: **BLOQUEADO**. No sustituye revisión de abogado, fiscalista ni especialista de seguridad.

## Identidad y firma

- [ ] `[COMPLETAR: razón social inscrita]` coincide con `LEGAL_ENTITY_NAME`.
- [ ] `[COMPLETAR: domicilio legal/fiscal]` coincide con `LEGAL_ENTITY_ADDRESS`.
- [ ] `[COMPLETAR: entidad federativa y tribunales]` coincide con `LEGAL_JURISDICTION`.
- [ ] Firmante del cliente y facultades verificadas.
- [ ] MSA/orden de servicio firmada.
- [ ] Precio, impuestos, renovación, límites y forma de pago firmados.

## Datos y proveedores

- [ ] DPA firmado, versión en `LEGAL_DPA_VERSION`.
- [ ] Instrucciones de tratamiento y categorías de datos aprobadas.
- [ ] Subencargados aprobados, versión en `LEGAL_SUBPROCESSORS_VERSION`.
- [ ] Cadena de modelos (incluido el proveedor de routing) documentada.
- [ ] Retención, retorno y borrado acordados.
- [ ] Procedimiento ARCO y solicitudes de titulares probado.

## Seguridad y continuidad

- [ ] Anexo de seguridad aprobado, versión en `LEGAL_SECURITY_ANNEX_VERSION`.
- [ ] SLA firmado, versión en `LEGAL_SLA_VERSION`.
- [ ] RPO/RTO medidos, no solo prometidos.
- [ ] Restore de base y Storage ejecutado con evidencia.
- [ ] Incidente y contacto 24/7 definidos.
- [ ] SSO/SCIM, audit log y exportación acordados si el plan lo requiere.

## Gate técnico

- [ ] `LEGAL_ENFORCE_PRODUCTION=true` en el entorno de producción.
- [ ] `LEGAL_ENTITY_NAME`, `LEGAL_ENTITY_ADDRESS`, `LEGAL_JURISDICTION` presentes.
- [ ] `LEGAL_CONTACT_EMAIL` pertenece a un buzón controlado y monitoreado.
- [ ] Las cuatro versiones contractuales presentes.
- [ ] Build de producción ejecutado con las variables reales sin datos ficticios.
- [ ] No se publicó el servicio enterprise mientras el gate esté bloqueado.
