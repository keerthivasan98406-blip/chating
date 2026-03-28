// ─── State ───────────────────────────────────────────────────────────────────
let roomKey = null, senderID = null, senderName = null;
let socket = null;

// WebRTC
let pc = null, localStream = null, callType = null;
let isMuted = false, isCamOff = false;

const iceServers = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    {
      urls: 'turn:openrelay.metered.ca:80',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    },
    {
      urls: 'turn:openrelay.metered.ca:443',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    },
    {
      urls: 'turn:openrelay.metered.ca:443?transport=tcp',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    }
  ]
};

// ─── Entry ────────────────────────────────────────────────────────────────────
function generateKey() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let key = '';
  for (let i = 0; i < 8; i++) key += chars[Math.floor(Math.random() * chars.length)];
  document.getElementById('room-key-input').value = key;
}

function joinRoom() {
  const nameVal = document.getElementById('name-input').value.trim();
  const keyVal  = document.getElementById('room-key-input').value.trim().toUpperCase();
  if (!nameVal) { alert('Enter your name.'); return; }
  if (keyVal.length < 4) { alert('Room key must be at least 4 characters.'); return; }
  senderName = nameVal;
  roomKey    = keyVal;
  senderID   = getOrCreateSenderID(roomKey);
  saveSession();
  startChat();
}

function getOrCreateSenderID(key) {
  const k = 'senderID_' + key;
  let id = sessionStorage.getItem(k);
  if (!id) { id = 'u_' + Math.random().toString(36).slice(2, 10); sessionStorage.setItem(k, id); }
  return id;
}

function saveSession() {
  localStorage.setItem('session', JSON.stringify({ roomKey, senderName }));
}
function clearSession() { localStorage.removeItem('session'); }

window.addEventListener('load', () => {
  try {
    const s = JSON.parse(localStorage.getItem('session') || 'null');
    if (s && s.roomKey && s.senderName) {
      roomKey = s.roomKey; senderName = s.senderName;
      senderID = getOrCreateSenderID(roomKey);
      startChat();
    }
  } catch(e) {}
});

// ─── Chat ─────────────────────────────────────────────────────────────────────
function startChat() {
  show('chat-screen'); hide('entry-screen');
  document.getElementById('room-display').textContent = senderName + '  ·  🔑 ' + roomKey;

  socket = io();

  socket.emit('join', { roomKey, senderName, senderID });

  // Load history from server
  socket.on('history', (msgs) => {
    msgs.forEach(renderMessage);
  });

  // Incoming message from other device
  socket.on('message', (msg) => {
    saveMessageLocal(msg);
    renderMessage(msg);
  });

  // Delete signal from other device
  socket.on('delete', () => {
    localStorage.removeItem('msgs_' + roomKey);
    clearChatUI();
    appendSystemMsg('Chat cleared');
  });

  // WebRTC signaling
  socket.on('call-offer',  handleIncomingCall);
  socket.on('call-answer', handleCallAnswer);
  socket.on('ice',         (data) => { if (pc) pc.addIceCandidate(new RTCIceCandidate(data.candidate)).catch(() => {}); });
  socket.on('call-end',    () => endCall(true));
  socket.on('call-reject', () => { endCall(true); appendSystemMsg('Call declined'); });
}

function leaveRoom() {
  if (socket) { socket.disconnect(); socket = null; }
  roomKey = null; senderID = null; senderName = null;
  clearSession();
  document.getElementById('messages').innerHTML = '';
  hide('chat-screen'); show('entry-screen');
}

// ─── Messaging ────────────────────────────────────────────────────────────────
function sendMessage() {
  const input = document.getElementById('msg-input');
  const text = input.value.trim();
  if (!text || !socket) return;
  input.value = '';
  const msg = { type: 'text', text, sender: senderID, name: senderName, time: Date.now() };
  renderMessage(msg);
  saveMessageLocal(msg);
  socket.emit('message', msg);
}

function sendImage(event) {
  const file = event.target.files[0];
  if (!file || !socket) return;
  event.target.value = '';
  const reader = new FileReader();
  reader.onload = e => {
    const data = e.target.result;
    if (data.length > 2 * 1024 * 1024) { alert('Image too large (max ~1.5MB).'); return; }
    const msg = { type: 'image', data, sender: senderID, name: senderName, time: Date.now() };
    renderMessage(msg);
    saveMessageLocal(msg);
    socket.emit('message', msg);
  };
  reader.readAsDataURL(file);
}

function deleteAll() {
  if (!confirm('Delete all messages for both sides?')) return;
  localStorage.removeItem('msgs_' + roomKey);
  clearChatUI();
  appendSystemMsg('Chat cleared');
  if (socket) socket.emit('delete');
}

// ─── Local storage (for refresh persistence) ──────────────────────────────────
function saveMessageLocal(msg) {
  const k = 'msgs_' + roomKey;
  const list = JSON.parse(localStorage.getItem(k) || '[]');
  if (list.some(m => m.time === msg.time && m.sender === msg.sender)) return;
  list.push(msg);
  if (list.length > 200) list.splice(0, list.length - 200);
  localStorage.setItem(k, JSON.stringify(list));
}

// ─── Render ───────────────────────────────────────────────────────────────────
function renderMessage(data) {
  const box = document.getElementById('messages');
  const isMe = data.sender === senderID;

  const wrap = document.createElement('div');
  wrap.className = 'msg-wrap ' + (isMe ? 'me' : 'them');

  const bubble = document.createElement('div');
  bubble.className = 'msg';

  if (!isMe && data.name) {
    const n = document.createElement('div');
    n.className = 'msg-name'; n.textContent = data.name;
    bubble.appendChild(n);
  }

  if (data.type === 'image') {
    const img = document.createElement('img');
    img.src = data.data; img.alt = 'image';
    img.onclick = () => openLightbox(data.data);
    bubble.appendChild(img);
  } else {
    const span = document.createElement('span');
    span.textContent = data.text;
    bubble.appendChild(span);
  }

  const footer = document.createElement('div');
  footer.className = 'msg-footer';
  const t = document.createElement('span');
  t.className = 'msg-time'; t.textContent = formatTime(data.time);
  footer.appendChild(t);
  if (isMe) {
    const tick = document.createElement('span');
    tick.className = 'tick'; tick.textContent = '✓✓';
    footer.appendChild(tick);
  }
  bubble.appendChild(footer);
  wrap.appendChild(bubble);
  box.appendChild(wrap);
  box.scrollTop = box.scrollHeight;
}

function clearChatUI() { document.getElementById('messages').innerHTML = ''; }

function appendSystemMsg(text) {
  const box = document.getElementById('messages');
  const d = document.createElement('div');
  d.className = 'system-msg'; d.textContent = text;
  box.appendChild(d); box.scrollTop = box.scrollHeight;
}

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function openLightbox(src) {
  const lb = document.createElement('div');
  lb.className = 'lightbox'; lb.onclick = () => lb.remove();
  const img = document.createElement('img'); img.src = src;
  lb.appendChild(img); document.body.appendChild(lb);
}

// ─── WebRTC Calls ─────────────────────────────────────────────────────────────
async function startCall(type) {
  callType = type;
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: type === 'video' ? { width: 1280, height: 720 } : false,
      audio: { echoCancellation: true, noiseSuppression: true, sampleRate: 44100 }
    });
  } catch(e) { alert('Allow camera/microphone access first.'); return; }

  document.getElementById('local-video').srcObject = localStream;
  document.getElementById('call-partner-name').textContent = senderName;
  document.getElementById('call-status-text').textContent = 'Calling...';
  show('call-overlay');

  pc = new RTCPeerConnection(iceServers);
  localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
  pc.onicecandidate = e => { if (e.candidate) socket.emit('ice', { candidate: e.candidate }); };
  pc.ontrack = e => {
    document.getElementById('remote-video').srcObject = e.streams[0];
    document.getElementById('call-status-text').textContent = 'Connected';
  };

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  socket.emit('call-offer', { offer, callType, callerName: senderName });
}

async function handleIncomingCall(data) {
  window._pendingOffer = data;
  document.getElementById('ic-caller-name').textContent = data.callerName || 'Partner';
  document.getElementById('ic-call-type').textContent = data.callType === 'video' ? '📹 Video Call' : '📞 Voice Call';
  show('incoming-call');
}

async function acceptCall() {
  hide('incoming-call');
  const data = window._pendingOffer;
  callType = data.callType;

  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: callType === 'video' ? { width: 1280, height: 720 } : false,
      audio: { echoCancellation: true, noiseSuppression: true, sampleRate: 44100 }
    });
  } catch(e) { alert('Allow camera/microphone access first.'); return; }

  document.getElementById('local-video').srcObject = localStream;
  document.getElementById('call-partner-name').textContent = data.callerName || 'Partner';
  document.getElementById('call-status-text').textContent = 'Connected';
  show('call-overlay');

  pc = new RTCPeerConnection(iceServers);
  localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
  pc.onicecandidate = e => { if (e.candidate) socket.emit('ice', { candidate: e.candidate }); };
  pc.ontrack = e => { document.getElementById('remote-video').srcObject = e.streams[0]; };

  await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  socket.emit('call-answer', { answer });
}

async function handleCallAnswer(data) {
  if (pc) await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
}

function rejectCall() {
  hide('incoming-call');
  socket.emit('call-reject');
  window._pendingOffer = null;
}

function endCall(remote = false) {
  if (!remote && socket) socket.emit('call-end');
  if (pc) { pc.close(); pc = null; }
  if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
  document.getElementById('remote-video').srcObject = null;
  document.getElementById('local-video').srcObject = null;
  hide('call-overlay'); hide('incoming-call');
  isMuted = false; isCamOff = false;
  document.getElementById('mute-btn').textContent = '🎤';
  document.getElementById('cam-btn').textContent = '📷';
}

function toggleMute() {
  if (!localStream) return;
  isMuted = !isMuted;
  localStream.getAudioTracks().forEach(t => t.enabled = !isMuted);
  document.getElementById('mute-btn').textContent = isMuted ? '�' : '🎤';
}

function toggleCam() {
  if (!localStream) return;
  isCamOff = !isCamOff;
  localStream.getVideoTracks().forEach(t => t.enabled = !isCamOff);
  document.getElementById('cam-btn').textContent = isCamOff ? '�' : '📷';
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function show(id) { document.getElementById(id).classList.remove('hidden'); }
function hide(id) { document.getElementById(id).classList.add('hidden'); }
