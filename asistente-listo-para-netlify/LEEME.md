# Mi asistente de tareas y hábitos (PWA)

Archivos: `index.html`, `styles.css`, `app.js`, `sw.js`, `manifest.webmanifest`, `icons/`.
Todo funciona sin servidor propio ni cuentas: los datos viven en IndexedDB de tu teléfono.

## Condición para instalar
Una PWA solo se instala (y el service worker solo funciona) desde **HTTPS** o desde **localhost**. Abrir `index.html` como archivo (`file://`) permite usar la app, pero no instalarla ni usarla sin conexión. Un único HTML no alcanza: hacen falta el manifest, el service worker y los iconos.

## Instalar en Android (elige una opción)
1. **Hosting estático gratuito (lo más simple):** sube la carpeta a GitHub Pages, Netlify o Cloudflare Pages. Solo se publican los archivos de la app; tus datos nunca salen del teléfono. Abre la dirección HTTPS en Chrome → menú ⋮ → **Instalar aplicación**.
2. **Desde el propio celular con Termux:** `pkg install python`, entra a la carpeta y ejecuta `python -m http.server 8080`. Abre `http://localhost:8080` en Chrome → menú ⋮ → **Instalar aplicación**.
3. Después de abrirla una vez con conexión, funciona sin Internet.

Los datos pertenecen al origen (dirección) desde donde se abre: si cambias de dirección, empiezas con una base vacía (restaura una copia).

## Copia de seguridad
Ajustes → **Exportar copia de seguridad (JSON)**. Se descarga `asistente-copia-AAAA-MM-DD.json`. Hazla de forma periódica y guárdala fuera del teléfono.

## Restaurar
Ajustes → **Importar copia de seguridad** → elige el JSON. La app valida el archivo y pide confirmación antes de **reemplazar** los datos actuales.

## Cómo analiza (todo local, con reglas y estadísticas)
- Solo cuenta tareas **completadas**, con su fecha real de finalización. Crear una tarea no cuenta.
- **Hábito:** actividad con 3 o más realizaciones distribuidas en al menos 14 días. El resto es ocasional y no se marca como olvidada.
- **Olvidada:** hábito cuyo tiempo sin hacerse supera 1,5 veces su intervalo promedio (el promedio se calcula con registros reales y se muestra junto con las fechas que lo justifican). También: tareas agregadas 3 o más veces y nunca completadas, pendientes con más de 7 días, y hábitos que bajaron a la mitad o menos frente a los 30 días previos (requiere 60 días de uso).
- Con menos de 14 días de uso, la app dice que no hay historial suficiente.
- Cada observación se puede posponer 7 días o descartar.
- Sugerencias de “Armar mi día”: actividades completadas al menos 2 veces en el mismo día de la semana durante las últimas 8 semanas.

## Estado de verificación
Ver la lista al final de la respuesta en el chat: lo implementado y lo que no fue probado en un dispositivo real.
