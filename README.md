# Cristina

Diario personal de Barre, gimnasio y piscina. HTML, CSS y JavaScript modular, sin build.

## Estado

Version 0.5.0. Primera apertura sin datos de ejemplo: actividades, rutinas y premios ganados vacios; solo las 14 recompensas estan preparadas. Pantalla de carga, peticion de acceso al abrir sin cuenta y guia para anadir Cri al inicio. Una sesion guardada se recupera sin volver a pedir acceso. Los diarios existentes no se vacian.

Cliente oficial Supabase 2.116.0 incorporado como activo local. SQL creado y prueba de aislamiento ejecutada correctamente en el proyecto acordado. Implementados acceso por correo/contrasena, guardado por cuenta, cambios pendientes, conflictos y recuperacion. Suite: 21 pruebas Edge y 6 comprobaciones WebKit, incluyendo primera apertura y cuenta simulada. Falta verificar guardado/recuperacion con la cuenta real de Cristina antes de declarar lista la nube o activar Pages.

Nombre al anadir a inicio: Cri, mediante metadatos de Apple y manifiesto con rutas relativas. No incluye service worker ni garantiza arranque offline; falta comprobar la instalacion fisica en iPhone. Mis recompensas revela las dos entradas pendientes en orden fijo, conservando las demas ocultas. Ajustes muestra el correo conectado; Mi cuenta distingue diario nuevo, copia recuperada, pendientes y falta de confirmacion remota, con acceso directo al diario. Iniciar sesion consulta automaticamente la nube; Sincronizar permite volver a consultarla.

Iconos PNG opacos de 180/192/512 px, incluyendo apple-touch-icon y variante maskable. Imagenes nativas de arranque para iPhone 16 Pro y 17 Pro Max, vertical/horizontal; otros dispositivos usan la pantalla web. La guia de instalacion aparece junto al primer acceso, distingue Safari/Android/escritorio y se oculta en standalone; tambien esta en Ajustes. La peticion automatica de acceso se muestra una vez por pestana sin cuenta y al cerrar sesion; puede cerrarse para conservar acceso al diario local. La carga espera la cuenta, acota la espera visual y ofrece reintentar si tarda mas de 30 segundos. No cambia la cuenta ni descarta formularios para mostrar instrucciones.

Primer logro: Un beso por una clase de Barre/Heat, con felicitacion y anuncio de mas regalos, sin canje pendiente. Despues: Hersheys, mazapan, Yogs, Bubble Tea, Myka, Cine, Kimchis, Hikari, Riverside, Nacion Sushi, PF Changs, restaurante a eleccion y playa. Las metas siguen siendo independientes por disciplina; el orden visible ya no cambia con el porcentaje de progreso. Se conservan las personalizaciones y premios ganados al actualizar la lista original, incluyendo Myka/Yogs renombrados. No se repueblan listas vacias o completamente personalizadas. El restaurante nuevo parte de 60 sesiones gym, editable.

El cierre del fondo exige pulsacion iniciada y terminada fuera de la hoja, evitando clics retargeteados de selectores. Los cambios de otra pestana se aplazan durante un formulario o la lista de edicion; no interrumpen la seleccion ni sobrescriben el borrador.

## Ejecutar y probar

```powershell
python -m http.server 60150 --bind 127.0.0.1
```

Abrir http://127.0.0.1:60150/.

```powershell
python -m unittest test_app -v
```

Las pruebas requieren Python, Playwright y Edge. Usan contextos aislados con datos ficticios.

Los activos ya estan generados. Para regenerarlos en Windows: `python generate_assets.py`, con Pillow y las fuentes Georgia instaladas en Windows, mas Manrope local. No se redistribuyen archivos de fuentes de Windows.

## Preparar Supabase

1. Iniciar sesion directamente en https://supabase.com/dashboard y elegir el proyecto acordado. No crear otro proyecto ni modificar configuracion global de autenticacion.
2. En SQL Editor, abrir una consulta nueva y ejecutar completo `supabase/001_cris_diary.sql` una sola vez. Crea exclusivamente `public.cris_diaries`, sus politicas RLS y `public.cris_save_diary`.
3. Ejecutar completo `supabase/002_verify_isolation.sql` en otra consulta. Debe terminar sin errores. Comprueba permisos, lectura/escritura por propietario, rechazo entre cuentas, revision obsoleta, reintentos y rechazo de datos demo. Todos los registros ficticios se revierten con ROLLBACK; no crea usuarios en Auth ni toca tablas de otra app.
4. Si cualquiera falla, detenerse y revisar el error. No desactivar RLS ni repetir con modificaciones improvisadas. El primer archivo falla si los objetos ya existen, para no sobrescribirlos.
5. El cliente ya esta configurado en `cloud-config.js` con la URL del proyecto y su clave publicable. Nunca usar claves secretas, service_role, contrasena de base de datos ni tokens personales en el frontend o GitHub.

El diario se conserva como un documento JSON por usuario para mantener juntos historiales, rutinas, series, preferencias y premios. El backend acepta hasta 5 MiB por documento y rechaza datos demo. La app continuara validando su estructura completa.

Cada fila pertenece a `auth.uid()`. Las cuentas no pueden leer ni modificar filas ajenas; anon no tiene acceso. Las escrituras de la app deben usar `cris_save_diary(payload, expected_revision, mutation_id)`, no un upsert directo: una revision obsoleta provoca conflicto en vez de sobrescribir cambios. Reintentar con el mismo identificador y contenido reconoce el ultimo guardado.

No se crean triggers ni claves foraneas en Auth. El propietario se identifica mediante el JWT y RLS; borrar una cuenta de Auth no elimina automaticamente su diario. La limpieza de esas filas requiere una operacion administrativa explicita. Restaurar un diario vacio es una actualizacion, no un DELETE publico.

En Ajustes > Mi cuenta, iniciar sesion con una cuenta de Supabase Auth; el login administrativo del dashboard no equivale al login del diario. La creacion inicial de la cuenta se hace directamente en Authentication > Users del dashboard. No hay registro publico ni recuperacion de contrasena dentro de esta version; administrar el acceso desde Supabase sin cambiar configuracion global de otras apps.

El guardado local usa `cristina.diary.account.v1.<user-id>` por cuenta. Sesion de Auth exclusiva `cristina.auth.v1`, sin reutilizar claves ni sesiones de otra app. El diario local original no se migra automaticamente: Vincular diario local exige confirmacion, cuenta vacia y datos no demo. Los cambios se guardan primero localmente y se envian despues; solo se indica Guardado en la nube tras confirmacion remota. Cerrar sesion conserva la copia y sus pendientes, y usa cierre local de esa sesion de Auth.

Ante conflicto, elegir explicitamente la copia que se conserva. Antes se guarda una copia local de recuperacion, descargable desde Mi cuenta. La nube se consulta al iniciar/abrir la cuenta o al pulsar Sincronizar; no hay colaboracion en tiempo real. Exportar un respaldo antes de borrar almacenamiento local, cambiar de telefono o resolver un conflicto importante.

## GitHub y Pages

Repositorio creado: https://github.com/miguelr1881/cris-fitness-tracker, publico. GitHub Pages gratuito pendiente de activacion tras la verificacion real. Crear commits exclusivamente desde la web de GitHub.

El codigo y la lista de regalos seran publicos. El PIN local solo oculta la edicion en la interfaz: no es autenticacion ni protege secretos. Los datos privados del diario nunca deben incluirse en el repositorio.

Archivos publicos autorizados por la web: `index.html`, `manifest.webmanifest`, `styles.css`, `app.js`, `store.js`, `training.js`, `rewards.js`, `reward-ui.js`, `cloud.js`, `sync.js`, `cloud-config.js`, `supabase.min.js`, `SUPABASE-LICENSE.txt`, `lucide.min.js`, `manrope.ttf`, `FONT-LICENSE.txt`, `README.md`, `.gitignore`, `test_app.py` y la carpeta `supabase`. No subir respaldos JSON, datos de navegador, capturas, archivos de entorno ni carpetas temporales. La subida web no aplica `.gitignore`: seleccionar los archivos expresamente.

Activos de arranque adicionales: `launch.js`, `generate_assets.py`, `icon-192.png`, `icon-512.png`, `apple-touch-icon.png`, `launch-1206x2622.png`, `launch-2622x1206.png`, `launch-1320x2868.png` y `launch-2868x1320.png`. Conservar sus rutas relativas para Pages.

Una vez conectada y verificada la app, configurar Settings > Pages > Deploy from a branch > main > / (root). No cambiar el sitio de otra app. El enlace final sera `https://USUARIO.github.io/cris-fitness-tracker/`.

GitHub Pages y el origen local tienen almacenamientos separados. Antes de pasar a la URL publicada, conservar el respaldo; no asumir que los datos locales apareceran alli hasta importar o verificar la recuperacion desde Supabase.