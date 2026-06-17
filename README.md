# 📌 Recordato

**Para que no se te olvide nada.**

PWA minimalista para Android (y cualquier dispositivo con navegador). Anota recordatorios con **voz** o **texto**. Los urgentes te persiguen con notificaciones cada 30 minutos hasta que los marques como hechos.

---

## 🎯 Para quién es

Para personas que se olvidan de todo. La app está diseñada con **cero fricción**: abres, tocas el botón, hablas, y ya está apuntado. Si es urgente, la notificación no te deja en paz hasta que lo resuelvas.

---

## 🚀 Cómo usarla

1. Abre `https://TU_USUARIO.github.io/recordato/` en Chrome (Android) o cualquier navegador.
2. Chrome te ofrecerá **«Añadir a pantalla de inicio»** — acéptalo.
3. El icono de Recordato aparece en tu escritorio como una app más.
4. Toca el icono, toca el micrófono, habla. Fin.

---

## 🧠 Funcionalidades

| Funcionalidad | Detalle |
|---------------|---------|
| 🎤 Nota de voz | Toca el botón, habla, suelta. Se guarda con transcripción automática. |
| ✏️ Nota de texto | Escribe y pulsa Enter. |
| ⚠️ Urgente | Activa el toggle y la nota te notifica cada 30 min hasta que la marques como hecha. |
| 🔴 Banner | Si hay urgentes pendientes, un banner rojo te recibe al abrir la app. |
| 📋 Lista | Todas tus notas, urgentes primero, luego por fecha. |
| 🎧 Audio | Las notas de voz guardan el audio original por si la transcripción falla. |
| 📱 PWA | Se instala en el móvil, funciona sin conexión, pantalla completa. |

---

## 🛠️ Tecnologías

- **HTML + CSS + JavaScript vanilla** — sin frameworks, carga en <1 segundo.
- **IndexedDB** — almacenamiento local, sin servidor, sin límites.
- **Web Speech API** — transcripción voz→texto en español.
- **MediaRecorder API** — grabación de audio.
- **Service Worker** — offline-first, notificaciones persistentes.
- **Web App Manifest** — instalable como app nativa.

---

## 📁 Estructura

```
recordato/
├── index.html        # Pantalla única
├── styles.css        # Estilos (modo oscuro, alto contraste)
├── app.js            # Toda la lógica
├── sw.js             # Service Worker
├── manifest.json     # PWA manifest
├── icons/
│   ├── icon-192.png
│   └── icon-512.png
└── README.md
```

---

## 🔧 Desarrollo local

```bash
# Clonar
git clone https://github.com/chisdasvinto/recordato.git
cd recordato

# Servir (necesita HTTP para SW y APIs de voz)
python3 -m http.server 8080

# Abrir en Chrome
open http://localhost:8080
```

---

## 📲 Despliegue

La forma más fácil es **GitHub Pages**:

1. Ve a Settings → Pages en el repo.
2. Source: `main` branch, folder `/ (root)`.
3. Save. En unos segundos estará live en `https://chisdasvinto.github.io/recordato/`.

---

## ⚠️ Limitaciones

- La transcripción de voz requiere conexión a internet en la mayoría de dispositivos (usa los servidores de Google). Si no hay conexión, la nota se guarda igual con el audio y puedes escucharla luego.
- En iOS, las notificaciones persistentes tienen soporte limitado. La app funciona, pero las re-notificaciones pueden no funcionar en Safari.
- No tiene backend ni sincronización en la nube (por diseño: privacidad total).

---

Hecho con ❤️ para Vero. Que no se te olvide nada.
