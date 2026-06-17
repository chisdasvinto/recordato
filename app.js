/* ============================================================
   RECORDATO — Lógica de la aplicación
   IndexedDB + MediaRecorder + SpeechRecognition + Notifications
   ============================================================ */

// ─── Constantes ───────────────────────────────────────────────
const DB_NAME = 'recordato-db';
const DB_VERSION = 1;
const STORE_NAME = 'notas';
const URGENTE_INTERVALO_MS = 30 * 60 * 1000; // 30 minutos

// ─── IndexedDB ────────────────────────────────────────────────
let db = null;

function abrirDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('creada', 'creada', { unique: false });
        store.createIndex('urgente', 'urgente', { unique: false });
        store.createIndex('completada', 'completada', { unique: false });
      }
    };
    req.onsuccess = (e) => { db = e.target.result; resolve(db); };
    req.onerror = (e) => reject(e.target.error);
  });
}

function guardarNota(nota) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.put(nota);
    tx.oncomplete = () => resolve(nota);
    tx.onerror = (e) => reject(e.target.error);
  });
}

function obtenerNotas(completadas = false) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.index('completada').getAll(completadas ? 1 : 0);
    req.onsuccess = () => {
      // Ordenar: urgentes primero, luego por fecha descendente
      const notas = req.result;
      notas.sort((a, b) => {
        if (a.urgente && !b.urgente) return -1;
        if (!a.urgente && b.urgente) return 1;
        return b.creada - a.creada;
      });
      resolve(notas);
    };
    req.onerror = (e) => reject(e.target.error);
  });
}

function actualizarNota(id, cambios) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(id);
    req.onsuccess = () => {
      const nota = req.result;
      if (!nota) return reject(new Error('Nota no encontrada'));
      Object.assign(nota, cambios);
      store.put(nota);
      tx.oncomplete = () => resolve(nota);
    };
    req.onerror = (e) => reject(e.target.error);
  });
}

function eliminarNota(id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject(e.target.error);
  });
}

// ─── UUID simple ──────────────────────────────────────────────
function generarId() {
  return 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// ─── Elementos DOM ────────────────────────────────────────────
const btnVoz = document.getElementById('btn-voz');
const grabandoIndicador = document.getElementById('grabando-indicador');
const transcripcionVivo = document.getElementById('transcripcion-vivo');
const checkUrgente = document.getElementById('check-urgente');
const inputTexto = document.getElementById('input-texto');
const btnTexto = document.getElementById('btn-texto');
const contenedorNotas = document.getElementById('contenedor-notas');
const vacioState = document.getElementById('vacio-state');
const bannerUrgente = document.getElementById('banner-urgente');
const bannerTexto = document.getElementById('banner-texto');
const btnPapelera = document.getElementById('btn-papelera');
const tituloLista = document.getElementById('titulo-lista');

// ─── Estado ───────────────────────────────────────────────────
let grabando = false;
let mediaRecorder = null;
let recognition = null;
let audioChunks = [];
let viendoCompletadas = false;
let timerUrgentes = null;

// ─── Grabación de voz ────────────────────────────────────────
async function iniciarGrabacion() {
  if (grabando) return;

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioChunks = [];
    mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunks.push(e.data);
    };

    mediaRecorder.onstop = async () => {
      stream.getTracks().forEach(t => t.stop());
      const audioBlob = new Blob(audioChunks, { type: 'audio/webm;codecs=opus' });
      await guardarNotaConAudio(audioBlob);
    };

    mediaRecorder.start(100); // chunks cada 100ms
    grabando = true;

    // UI
    btnVoz.classList.add('grabando');
    btnVoz.querySelector('.btn-voz-texto').textContent = 'GRABANDO...';
    btnVoz.querySelector('.btn-voz-icono').textContent = '🔴';
    grabandoIndicador.classList.remove('oculto');
    transcripcionVivo.textContent = '';

    // Iniciar transcripción en paralelo
    iniciarTranscripcion();

  } catch (err) {
    console.error('Error al acceder al micrófono:', err);
    alert('No se pudo acceder al micrófono. Verifica los permisos.');
  }
}

function detenerGrabacion() {
  if (!grabando || !mediaRecorder) return;

  mediaRecorder.stop();
  grabando = false;
  detenerTranscripcion();

  // UI
  btnVoz.classList.remove('grabando');
  btnVoz.querySelector('.btn-voz-texto').textContent = 'TOCA Y HABLA';
  btnVoz.querySelector('.btn-voz-icono').textContent = '🎤';
  grabandoIndicador.classList.add('oculto');
}

// ─── Transcripción (Web Speech API) ──────────────────────────
function iniciarTranscripcion() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    transcripcionVivo.textContent = '(transcripción no disponible)';
    return;
  }

  recognition = new SpeechRecognition();
  recognition.lang = 'es-ES';
  recognition.interimResults = true;
  recognition.continuous = true;
  recognition.maxAlternatives = 1;

  recognition.onresult = (e) => {
    let texto = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      texto += e.results[i][0].transcript;
    }
    transcripcionVivo.textContent = texto || '(escuchando...)';
  };

  recognition.onerror = (e) => {
    console.warn('Error de transcripción:', e.error);
    if (e.error === 'no-speech') {
      transcripcionVivo.textContent = '(no se detecta voz...)';
    } else if (e.error === 'not-allowed') {
      transcripcionVivo.textContent = '(permiso de micrófono denegado)';
    }
  };

  recognition.start();
}

function detenerTranscripcion() {
  if (recognition) {
    try { recognition.stop(); } catch (e) { /* ya estaba parado */ }
    recognition = null;
  }
}

// ─── Guardar nota (con audio) ────────────────────────────────
async function guardarNotaConAudio(audioBlob) {
  const textoTranscrito = transcripcionVivo.textContent || '';
  const textoValido = (textoTranscrito && textoTranscrito !== '(escuchando...)'
    && textoTranscrito !== '(no se detecta voz...)'
    && textoTranscrito !== '(transcripción no disponible)')
    ? textoTranscrito : '';

  // Convertir Blob a ArrayBuffer para compatibilidad con Safari/WebKit
  // (Safari tiene bugs al guardar Blobs directamente en IndexedDB)
  const audioData = audioBlob ? await blobToArrayBuffer(audioBlob) : null;

  const nota = {
    id: generarId(),
    texto: textoValido || '(nota de voz — toca 🎧 para escuchar)',
    audioData: audioData,  // ArrayBuffer en vez de Blob
    audioType: audioBlob ? audioBlob.type : null,
    origen: 'voz',
    urgente: checkUrgente.checked,
    creada: Date.now(),
    recordatorio: checkUrgente.checked ? Date.now() : null,
    completada: 0,
    papelera: 0
  };

  await guardarNota(nota);
  checkUrgente.checked = false;
  await renderizarNotas();

  if (nota.urgente) {
    dispararNotificacionUrgente(nota);
  }
}

function blobToArrayBuffer(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsArrayBuffer(blob);
  });
}

// ─── Guardar nota de texto ───────────────────────────────────
async function guardarNotaTexto() {
  const texto = inputTexto.value.trim();
  if (!texto) return;

  const nota = {
    id: generarId(),
    texto: texto,
    audioData: null,
    origen: 'texto',
    urgente: checkUrgente.checked,
    creada: Date.now(),
    recordatorio: checkUrgente.checked ? Date.now() : null,
    completada: 0,
    papelera: 0
  };

  await guardarNota(nota);
  inputTexto.value = '';
  checkUrgente.checked = false;
  await renderizarNotas();

  if (nota.urgente) {
    dispararNotificacionUrgente(nota);
  }
}

// ─── Notificaciones ──────────────────────────────────────────
async function pedirPermisoNotificaciones() {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'default') {
    await Notification.requestPermission();
  }
}

function dispararNotificacionUrgente(nota) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;

  const opciones = {
    body: nota.texto,
    icon: 'icons/icon-192.png',
    badge: 'icons/icon-192.png',
    tag: 'recordato-urgente',
    requireInteraction: true, // persistente, no desaparece sola
    vibrate: [200, 100, 200, 100, 200],
    silent: false
  };

  new Notification('⚠️ RECORDATORIO URGENTE', opciones);
}

function programarReNotificaciones() {
  // Limpiar timer anterior
  if (timerUrgentes) clearInterval(timerUrgentes);

  timerUrgentes = setInterval(async () => {
    const notas = await obtenerNotas(false);
    const urgentes = notas.filter(n => n.urgente);
    if (urgentes.length > 0) {
      // Disparar para la más urgente (primera)
      dispararNotificacionUrgente(urgentes[0]);
    } else {
      // Si no hay urgentes, limpiar timer
      clearInterval(timerUrgentes);
      timerUrgentes = null;
    }
  }, URGENTE_INTERVALO_MS);
}

// ─── Renderizado ─────────────────────────────────────────────
async function renderizarNotas() {
  const notas = await obtenerNotas(viendoCompletadas);
  contenedorNotas.innerHTML = '';

  if (notas.length === 0) {
    vacioState.classList.remove('oculto');
    tituloLista.textContent = viendoCompletadas ? 'Completadas' : 'Tus recordatorios';
  } else {
    vacioState.classList.add('oculto');
    tituloLista.textContent = viendoCompletadas
      ? `Completadas (${notas.length})`
      : `Tus recordatorios (${notas.length})`;

    notas.forEach(nota => {
      const card = crearCard(nota);
      contenedorNotas.appendChild(card);
    });
  }

  // Actualizar banner de urgentes
  actualizarBannerUrgente(notas);
}

function crearCard(nota) {
  const card = document.createElement('div');
  card.className = `nota-card ${nota.urgente ? 'urgente' : 'normal'} ${nota.completada ? 'completada' : ''}`;
  card.dataset.id = nota.id;

  const icono = nota.origen === 'voz' ? '🎙️' : '✏️';
  const tiempo = tiempoRelativo(nota.creada);

  card.innerHTML = `
    <span class="nota-icono">${icono}</span>
    <div class="nota-cuerpo">
      <div class="nota-texto">${escapeHtml(nota.texto)}</div>
      <div class="nota-meta">
        <span>${tiempo}</span>
        ${nota.urgente ? '<span>⚠️ Urgente</span>' : ''}
        ${nota.audioData ? '<button class="nota-audio-btn" data-action="escuchar">🎧 Escuchar</button>' : ''}
      </div>
    </div>
    <div class="nota-acciones">
      ${!viendoCompletadas
        ? `<button class="btn-hecho" data-action="hecho" title="Marcar como hecho">✓</button>`
        : ''}
      <button class="btn-borrar" data-action="borrar" title="${viendoCompletadas ? 'Eliminar definitivamente' : 'Mover a papelera'}">${viendoCompletadas ? '🗑️' : '✕'}</button>
    </div>
  `;

  // Eventos delegados
  card.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const action = btn.dataset.action;
      if (action === 'hecho') marcarHecho(nota.id, card);
      if (action === 'borrar') borrarNota(nota.id, card);
      if (action === 'escuchar') reproducirAudio(nota.audioData, nota.audioType);
    });
  });

  return card;
}

function actualizarBannerUrgente(notas) {
  const urgentes = notas.filter(n => n.urgente && !n.completada);
  if (urgentes.length > 0 && !viendoCompletadas) {
    bannerUrgente.classList.remove('oculto');
    bannerTexto.textContent = `⚠️ Tienes ${urgentes.length} recordatorio${urgentes.length > 1 ? 's' : ''} urgente${urgentes.length > 1 ? 's' : ''} pendiente${urgentes.length > 1 ? 's' : ''}`;
  } else {
    bannerUrgente.classList.add('oculto');
  }
}

// ─── Acciones sobre notas ────────────────────────────────────
async function marcarHecho(id, card) {
  card.classList.add('eliminando');
  await new Promise(r => setTimeout(r, 300));
  await actualizarNota(id, { completada: 1 });
  await renderizarNotas();
}

async function borrarNota(id, card) {
  if (viendoCompletadas) {
    // Eliminación definitiva
    card.classList.add('eliminando');
    await new Promise(r => setTimeout(r, 300));
    await eliminarNota(id);
  } else {
    // Mover a papelera (soft delete)
    card.classList.add('eliminando');
    await new Promise(r => setTimeout(r, 300));
    await actualizarNota(id, { completada: 1, papelera: 1 });
  }
  await renderizarNotas();
}

function reproducirAudio(audioData, audioType) {
  if (!audioData) return;
  // Reconstruir Blob desde ArrayBuffer (compatible con Safari)
  const blob = new Blob([audioData], { type: audioType || 'audio/webm;codecs=opus' });
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  audio.play().catch(e => console.warn('Error al reproducir audio:', e));
  audio.onended = () => URL.revokeObjectURL(url);
}

// ─── Utilidades ──────────────────────────────────────────────
function tiempoRelativo(ts) {
  const ahora = Date.now();
  const diff = ahora - ts;
  const seg = Math.floor(diff / 1000);
  if (seg < 60) return 'ahora mismo';
  const min = Math.floor(seg / 60);
  if (min < 60) return `hace ${min} min`;
  const horas = Math.floor(min / 60);
  if (horas < 24) return `hace ${horas}h`;
  const dias = Math.floor(horas / 24);
  if (dias < 7) return `hace ${dias} día${dias > 1 ? 's' : ''}`;
  return new Date(ts).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
}

function escapeHtml(texto) {
  const div = document.createElement('div');
  div.textContent = texto;
  return div.innerHTML;
}

// ─── Eventos ─────────────────────────────────────────────────
// Botón de voz: toggle simple — toca para grabar, toca para parar
btnVoz.addEventListener('click', (e) => {
  e.preventDefault();
  if (grabando) {
    detenerGrabacion();
  } else {
    iniciarGrabacion();
  }
});

// Texto: Enter para guardar
inputTexto.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    guardarNotaTexto();
  }
});

btnTexto.addEventListener('click', guardarNotaTexto);

// Toggle papelera
btnPapelera.addEventListener('click', async () => {
  viendoCompletadas = !viendoCompletadas;
  btnPapelera.textContent = viendoCompletadas ? '📋 Ver activos' : '🗑️ Ver completadas';
  await renderizarNotas();
});

// ─── Service Worker ──────────────────────────────────────────
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js')
    .then(reg => {
      console.log('SW registrado:', reg.scope);

      // Detectar nueva versión y forzar actualización
      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing;
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            // Nueva versión disponible → recargar para aplicarla
            console.log('🔄 Nueva versión detectada, recargando...');
            location.reload();
          }
        });
      });
    })
    .catch(err => console.warn('SW falló:', err));
}

// ─── Instalar PWA ────────────────────────────────────────────
let deferredPrompt = null;
const btnInstalar = document.getElementById('btn-instalar');
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
              (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

window.addEventListener('beforeinstallprompt', (e) => {
  // Solo en Android/Chrome — iOS no dispara este evento
  e.preventDefault();
  deferredPrompt = e;
  btnInstalar.textContent = '📲 Instalar app';
  btnInstalar.classList.remove('oculto');
});

btnInstalar.addEventListener('click', async () => {
  if (deferredPrompt) {
    // Android/Chrome: diálogo nativo
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    console.log('Instalación:', outcome);
    deferredPrompt = null;
    btnInstalar.classList.add('oculto');
  } else if (isIOS) {
    // iOS: mostrar instrucciones
    alert('📲 Para instalar Recordato en tu iPhone:\n\n1. Toca el botón Compartir (📤)\n2. Desliza y toca "Añadir a pantalla de inicio"\n3. Toca "Añadir"\n\n¡Usa Safari, no Chrome!');
  }
});

// Si ya está instalada, ocultar botón
window.addEventListener('appinstalled', () => {
  btnInstalar.classList.add('oculto');
  deferredPrompt = null;
});

// En iOS, mostrar el botón siempre (con instrucciones)
if (isIOS && !deferredPrompt) {
  btnInstalar.textContent = '📲 Instalar (iOS)';
  btnInstalar.classList.remove('oculto');
}

// ─── Inicio ──────────────────────────────────────────────────
async function iniciar() {
  await abrirDB();
  await pedirPermisoNotificaciones();
  await renderizarNotas();
  programarReNotificaciones();
}

iniciar().catch(err => console.error('Error al iniciar Recordato:', err));
