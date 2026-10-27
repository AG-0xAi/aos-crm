# Pendientes y bloqueos

Estado al 27 de octubre de 2026. Todos abiertos salvo recuperación expresamente registrada en las evidencias.

| Prioridad | Pendiente / impacto | Siguiente acción |
| --- | --- | --- |
| Resuelto | Aprobación del mapa | Founder respondió «go»; siete contratos registrados y ejecución autorizada desde CRM-001 |
| P1 | WSL no instalado; Docker no disponible en PATH: no puede validarse el arranque oficial | Preparar entorno Linux y runtime con los permisos/reinicio necesarios; verificar acceso al mismo checkout |
| P1 | Código local `LOCAL` sin sandbox, puertos dev abiertos y script de setup invasivo | Perfil AOS explícito antes de cualquier arranque; no ejecutar scripts contra servicios de otros productos |
| P1 | Telemetría por defecto y overrides DB pueden incumplir privacidad | Configuración oficial, tests, primer arranque bajo captura y comprobación tras reinicio |
| P1 | 63 avisos de dependencia para 47 combinaciones del lockfile | Completar reachability y corregir componentes requeridos antes de ejecutarlos; mantener auxiliares vulnerables apagados |
| P1 | `.dockerignore` no excluye bus y evidencias | Corregir antes de cualquier build/contexto remoto |
| P1 | Gate vacío y ningún build/test funcional | Configurar solo comandos reales comprobados tras disponer de entorno; no acreditar éxito con cero comandos |
| P1 | API del control-plane AOS devolvió HTTP 401 al iniciar | Revisar credencial/ingest por la vía de AOS, sin imprimir ni sustituir secretos. Conservar bus local y no declarar panel sincronizado |
| P1 condicional | Rama de invitaciones y OAuth DCR requieren pruebas de seguridad | Mantener single-workspace/local; probar antes de invitaciones y clientes externos |
| P2 en ejecución | Fork remoto/origin aún no creado; destino aprobado AG-0xAi/aos-crm | CRM-001: crear/verificar el fork sin sobrescribir repositorios y medir procedencia |
| Resuelto | Primer grafo interrumpido por cota de diez minutos | Reintento por módulo AOS con plazo de treinta minutos terminó con exit 0; status actualizado y consulta local comprobados. Evidencia en `graph-build.json` y `graph-status.txt` |
| P2 | Patrones de secretos cubren solo árbol actual, no toda historia/entropía | Clasificar candidatos sin exponer valores y ampliar escaneo antes de publicación |
| P2 | Cumplimiento comercial, SBOM y distribución del core modificado | Revisión jurídica y avisos de terceros antes de SaaS/redistribución |
| P2 | Procedimientos de backup/restauración, upgrade y recuperación no probados | Medirlos sobre datos de prueba después del CRUD local |
| P2 | AWS: propuesta preliminar disponible, diseño definitivo sin entorno autorizado | Completar mediciones locales, presupuesto y decisiones de región antes de infraestructura; no crear recursos ni costes |
| P3 | Integraciones reales, agentes comerciales y WhatsApp | Fuera del bootstrap; abrir encargo independiente cuando el CRM esté aceptado |

El sistema de salud mostró latido reciente desde este checkout; `aos crons status` no pudo consultar la tarea SYSTEM/Admin sin elevar. Eso no acredita que falte la tarea. Si deja de crecer el registro de salud, escalar comprobación elevada al founder.

El merge guard solo tiene cobertura de este repo según `aos status`; no asumir protección en sesiones abiertas fuera. No se ejecutó ningún worker ni se aceptó artificialmente la épica para mover la barra del panel.
