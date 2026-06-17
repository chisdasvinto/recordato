/* ============================================================
   RECORDATO — Lógica de la aplicación v2
   IndexedDB + MediaRecorder + SpeechRecognition + Notifications
   Con diagnóstico para Safari/WebKit
   ============================================================ */

// ─── Constantes ───────────────────────────────────────────────
const DB_NAME = 'recordato-db';
const DB_VERSION = 2;  // Bump para forzar recreación en Safari
const STORE_NAME = 'notas';
const URGENTE_INTERVALO_MS = 30 * 60 * 1000;

// ─── Log de diagnóstico (visible en el DOM) ───────────────────
function log(msg) {
  console.log('[Recordato]', msg);
  const el = document.getElementById('debug-log');
  if (el) {
    el.textContent += msg + '\n';
    el.scrollTop = el.scrollHeight;
  }
}

// ─── IndexedDB ────────────────────────────────────────────────
let db = null;

function abrirDB() {
  return new Promise((resolve, reject) => {
    log('Abriendo DB v' + DB_VERSION + '...');
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      log('onupgradeneeded: version=' + e.oldVersion + '→' + e.newVersion);
      // Si existe store viejo, borrarlo (limpiar datos corruptos)
      if (db.objectStoreNames.contains(STORE_NAME)) {
        log('Eliminando store viejo...');
        db.deleteObjectStore(STORE_NAME);
      }
      log('Creando store nuevo...');
      const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      store.createIndex('creada', 'creada', { unique: false });
      store.createIndex('urgente', 'urgente', { unique: false });
      store.createIndex('completada', 'completada', { unique: false });
      log('Store creado OK');
    };
    req.onsuccess = (e) => {
      db = e.target.result;
      log('DB abierta OK');
      resolve(db);
    };
    req.onerror = (e) => {
      log('ERROR abriendo DB: ' + e.target.error.message);
      reject(e.target.error);
    };
    req.onblocked = () => {
      log('DB bloqueada — cerrando otras pestañas...');
    };
  });
}

function guardarNota(nota) {
  return new Promise((resolve, reject) => {
    log('Guardando nota: ' + nota.id + ' texto=' + (nota.texto || '').slice(0, 30));
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.put(nota);
    req.onsuccess = () => log('  put OK');
    req.onerror = (e) => log('  put ERROR: ' + e.target.error.message);
    tx.oncomplete = () => { log('  transacción completa'); resolve(nota); };
    tx.onerror = (e) => { log('  transacción ERROR: ' + e.target.error.message); reject(e.target.error); };
  });
}

function obtenerNotas(completadas) {
  completadas = completadas ? 1 : 0;
  return new Promise((resolve, reject) => {
    log('Obteniendo notas (completadas=' + completadas + ')...');
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);

    // Usar getAll() sin índice primero (más seguro en Safari)
    const req = store.getAll();
    req.onsuccess = () => {
      const todas = req.result || [];
      log('  getAll: ' + todas.length + ' notas totales');
      // Filtrar manualmente
      const notas = todas.filter(n => (n.completada || 0) === completadas);
      log('  filtradas: ' + notas.length + ' notas');
      notas.sort((a, b) => {
        if (a.urgente && !b.urgente) return -1;
        if (!a.urgente && b.urgente) return 1;
        return (b.creada || 0) - (a.creada || 0);
      });
      resolve(notas);
    };
    req.onerror = (e) => {
      log('  getAll ERROR: ' + e.target.error.message);
      reject(e.target.error);
    };
  });
}

function actualizarNota(id, cambios) {
  return new Promise((resolve, reject) => {
    log('Actualizando nota: ' + id);
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(id);
    req.onsuccess = () => {
      const nota = req.result;
      if (!nota) { log('  nota no encontrada'); return reject(new Error('Nota no encontrada')); }
      Object.assign(nota, cambios);
      store.put(nota);
      tx.oncomplete = () => { log('  actualización OK'); resolve(nota); };
    };
    req.onerror = (e) => { log('  get ERROR: ' + e.target.error.message); reject(e.target.error); };
    tx.onerror = (e) => { log('  tx ERROR: ' + e.target.error.message); reject(e.target.error); };
  });
}

function eliminarNota(id) {
  return new Promise((resolve, reject) => {
    log('Eliminando nota: ' + id);
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => { log('  eliminación OK'); resolve(); };
    tx.onerror = (e) => { log('  eliminación ERROR: ' + e.target.error.message); reject(e.target.error); };
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
    // Safari no soporta 'audio/webm;codecs=opus' — usar formato compatible
    let mimeType = 'audio/webm;codecs=opus';
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      mimeType = 'audio/mp4';
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = 'audio/webm';
        if (!MediaRecorder.isTypeSupported(mimeType)) {
          mimeType = '';  // default del navegador
        }
      }
    }
    log('MediaRecorder mimeType: ' + (mimeType || '(default)'));

    mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunks.push(e.data);
    };

    mediaRecorder.onstop = async () => {
      stream.getTracks().forEach(t => t.stop());
      const audioBlob = new Blob(audioChunks, { type: mediaRecorder.mimeType || 'audio/webm' });
      log('Audio grabado: ' + (audioBlob.size / 1024).toFixed(1) + ' KB, tipo=' + audioBlob.type);
      await guardarNotaConAudio(audioBlob);
    };

    mediaRecorder.start(100);
    grabando = true;

    // UI
    btnVoz.classList.add('grabando');
    btnVoz.querySelector('.btn-voz-texto').textContent = 'GRABANDO...';
    btnVoz.querySelector('.btn-voz-icono').textContent = '🔴';
    grabandoIndicador.classList.remove('oculto');
    transcripcionVivo.textContent = '';

    iniciarTranscripcion();

  } catch (err) {
    log('ERROR micrófono: ' + err.message);
    alert('No se pudo acceder al micrófono. Verifica los permisos.');
  }
}

function detenerGrabacion() {
  if (!grabando || !mediaRecorder) return;

  mediaRecorder.stop();
  grabando = false;
  detenerTranscripcion();

  btnVoz.classList.remove('grabando');
  btnVoz.querySelector('.btn-voz-texto').textContent = 'TOCA Y HABLA';
  btnVoz.querySelector('.btn-voz-icono').textContent = '🎤';
  grabandoIndicador.classList.add('oculto');
}

// ─── Transcripción (Web Speech API) ──────────────────────────
function iniciarTranscripcion() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    transcripcionVivo.textContent = '(transcripción no disponible en este navegador)';
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
    log('Transcripción error: ' + e.error);
    if (e.error === 'no-speech') {
      transcripcionVivo.textContent = '(no se detecta voz...)';
    } else if (e.error === 'not-allowed') {
      transcripcionVivo.textContent = '(permiso de micrófono denegado)';
    } else if (e.error === 'network') {
      transcripcionVivo.textContent = '(sin conexión — el audio se guarda igual)';
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
    && textoTranscrito !== '(transcripción no disponible en este navegador)'
    && textoTranscrito !== '(sin conexión — el audio se guarda igual)')
    ? textoTranscrito : '';

  // Convertir Blob a ArrayBuffer para compatibilidad con Safari/WebKit
  const audioData = audioBlob ? await blobToArrayBuffer(audioBlob) : null;

  const nota = {
    id: generarId(),
    texto: textoValido || '(nota de voz — toca 🎧 para escuchar)',
    audioData: audioData,
    audioType: audioBlob ? audioBlob.type : null,
    origen: 'voz',
    urgente: checkUrgente.checked,
    creada: Date.now(),
    recordatorio: checkUrgente.checked ? Date.now() : null,
    completada: 0,
    papelera: 0
  };

  try {
    await guardarNota(nota);
    log('✅ Nota guardada exitosamente');
    checkUrgente.checked = false;
    await renderizarNotas();
    if (nota.urgente) dispararNotificacionUrgente(nota);
  } catch (err) {
    log('❌ ERROR al guardar nota: ' + err.message);
    alert('Error al guardar la nota. Intenta de nuevo.');
  }
}

function blobToArrayBuffer(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Error leyendo Blob'));
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
    audioType: null,
    origen: 'texto',
    urgente: checkUrgente.checked,
    creada: Date.now(),
    recordatorio: checkUrgente.checked ? Date.now() : null,
    completada: 0,
    papelera: 0
  };

  try {
    await guardarNota(nota);
    log('✅ Nota de texto guardada');
    inputTexto.value = '';
    checkUrgente.checked = false;
    await renderizarNotas();
    if (nota.urgente) dispararNotificacionUrgente(nota);
  } catch (err) {
    log('❌ ERROR al guardar texto: ' + err.message);
    alert('Error al guardar. Intenta de nuevo.');
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
    requireInteraction: true,
    vibrate: [200, 100, 200, 100, 200],
    silent: false
  };
  new Notification('⚠️ RECORDATORIO URGENTE', opciones);
}

function programarReNotificaciones() {
  if (timerUrgentes) clearInterval(timerUrgentes);
  timerUrgentes = setInterval(async () => {
    const notas = await obtenerNotas(false);
    const urgentes = notas.filter(n => n.urgente);
    if (urgentes.length > 0) {
      dispararNotificacionUrgente(urgentes[0]);
    } else {
      clearInterval(timerUrgentes);
      timerUrgentes = null;
    }
  }, URGENTE_INTERVALO_MS);
}

// ─── Renderizado ─────────────────────────────────────────────
async function renderizarNotas() {
  try {
    const notas = await obtenerNotas(viendoCompletadas);
    contenedorNotas.innerHTML = '';

    // Forzar altura en la lista (Safari no resuelve bien flex:1)
    const listaNotas = contenedorNotas.parentElement;
    const alturaDisponible = window.innerHeight - listaNotas.getBoundingClientRect().top - 80;
    listaNotas.style.height = Math.max(200, alturaDisponible) + 'px';
    listaNotas.style.overflowY = 'auto';
    listaNotas.style.display = 'block';

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

    actualizarBannerUrgente(notas);
  } catch (err) {
    log('❌ ERROR renderizando: ' + err.message);
    vacioState.classList.remove('oculto');
    tituloLista.textContent = 'Error cargando notas';
  }
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
  card.classList.add('eliminando');
  await new Promise(r => setTimeout(r, 300));
  if (viendoCompletadas) {
    await eliminarNota(id);
  } else {
    await actualizarNota(id, { completada: 1, papelera: 1 });
  }
  await renderizarNotas();
}

function reproducirAudio(audioData, audioType) {
  if (!audioData) return;
  const blob = new Blob([audioData], { type: audioType || 'audio/webm' });
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  audio.play().catch(e => log('Error reproduciendo audio: ' + e.message));
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
btnVoz.addEventListener('click', (e) => {
  e.preventDefault();
  if (grabando) detenerGrabacion();
  else iniciarGrabacion();
});

inputTexto.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    guardarNotaTexto();
  }
});

btnTexto.addEventListener('click', guardarNotaTexto);

btnPapelera.addEventListener('click', async () => {
  viendoCompletadas = !viendoCompletadas;
  btnPapelera.textContent = viendoCompletadas ? '📋 Ver activos' : '🗑️ Ver completadas';
  await renderizarNotas();
});

// ─── Service Worker ──────────────────────────────────────────
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js')
    .then(reg => {
      log('SW registrado: ' + reg.scope);
      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing;
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            log('🔄 Nueva versión, recargando...');
            location.reload();
          }
        });
      });
    })
    .catch(err => log('SW falló: ' + err.message));
}

// ─── Instalar PWA ────────────────────────────────────────────
let deferredPrompt = null;
const btnInstalar = document.getElementById('btn-instalar');
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
              (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  btnInstalar.textContent = '📲 Instalar app';
  btnInstalar.classList.remove('oculto');
});

btnInstalar.addEventListener('click', async () => {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    log('Instalación: ' + outcome);
    deferredPrompt = null;
    btnInstalar.classList.add('oculto');
  } else if (isIOS) {
    alert('📲 Para instalar Recordato en tu iPhone:\n\n1. Toca el botón Compartir (📤)\n2. Desliza y toca "Añadir a pantalla de inicio"\n3. Toca "Añadir"\n\n¡Usa Safari, no Chrome!');
  }
});

window.addEventListener('appinstalled', () => {
  btnInstalar.classList.add('oculto');
  deferredPrompt = null;
});

if (isIOS && !deferredPrompt) {
  btnInstalar.textContent = '📲 Instalar (iOS)';
  btnInstalar.classList.remove('oculto');
}

// ─── Inicio ──────────────────────────────────────────────────
async function iniciar() {
  log('🚀 Iniciando Recordato v2...');
  log('UserAgent: ' + navigator.userAgent.slice(0, 60));
  try {
    await abrirDB();
    await pedirPermisoNotificaciones();
    await renderizarNotas();
    programarReNotificaciones();
    log('✅ Inicio completo');
  } catch (err) {
    log('❌ Error fatal: ' + err.message);
    alert('Error al iniciar Recordato. Recarga la página.');
  }
}

iniciar();
