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
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
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
    },
    {
      urls: 'turn:openrelay.metered.ca:80?transport=tcp',
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
  localStorage.setItem('savedRoomKey', key); // save permanently
}

function joinRoom() {
  const nameVal = document.getElementById('name-input').value.trim();
  const keyVal  = document.getElementById('room-key-input').value.trim().toUpperCase();
  if (!nameVal) { alert('Enter your name.'); return; }
  if (keyVal.length < 4) { alert('Room key must be at least 4 characters.'); return; }
  senderName = nameVal;
  roomKey    = keyVal;
  // Save both name and key permanently
  localStorage.setItem('savedRoomKey', roomKey);
  localStorage.setItem('savedName', senderName);
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
  // Restore active session (already in a room)
  try {
    const s = JSON.parse(localStorage.getItem('session') || 'null');
    if (s && s.roomKey && s.senderName) {
      roomKey = s.roomKey; senderName = s.senderName;
      senderID = getOrCreateSenderID(roomKey);
      startChat(); return;
    }
  } catch(e) {}

  // Pre-fill saved key and name so user just taps "Enter Room"
  const savedKey  = localStorage.getItem('savedRoomKey');
  const savedName = localStorage.getItem('savedName');
  if (savedKey)  document.getElementById('room-key-input').value = savedKey;
  if (savedName) document.getElementById('name-input').value = savedName;
});

// ─── Chat ─────────────────────────────────────────────────────────────────────
function startChat() {
  show('chat-screen'); hide('entry-screen');
  document.getElementById('room-display').textContent = senderName + '  ·  ' + roomKey;

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
    clearSession();
    window.close();
    // fallback if window.close() is blocked
    document.body.innerHTML = '';
    window.location.replace('about:blank');
  });

  // WebRTC signaling
  socket.on('call-offer',  handleIncomingCall);
  socket.on('call-answer', handleCallAnswer);
  socket.on('ice', async (data) => {
    if (pc && pc.remoteDescription) {
      await pc.addIceCandidate(new RTCIceCandidate(data.candidate)).catch(() => {});
    } else {
      // Buffer until remote description is ready
      if (!window._iceCandidateBuffer) window._iceCandidateBuffer = [];
      window._iceCandidateBuffer.push(data.candidate);
    }
  });
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
  if (!confirm('Delete all messages and close for both sides?')) return;
  localStorage.removeItem('msgs_' + roomKey);
  clearSession();
  if (socket) socket.emit('delete');
  window.close();
  // fallback if window.close() is blocked by browser
  document.body.innerHTML = '';
  window.location.replace('about:blank');
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
  } else if (data.type === 'audio') {
    const audio = document.createElement('audio');
    audio.controls = true;
    audio.src = data.data;
    bubble.appendChild(audio);
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
function createPC() {
  const p = new RTCPeerConnection(iceServers);

  p.onicecandidate = e => {
    if (e.candidate) socket.emit('ice', { candidate: e.candidate });
  };

  // When remote stream arrives, attach to video element
  p.ontrack = e => {
    const remoteVid = document.getElementById('remote-video');
    if (remoteVid.srcObject !== e.streams[0]) {
      remoteVid.srcObject = e.streams[0];
      document.getElementById('call-status-text').textContent = 'Connected';
    }
  };

  // Monitor connection state — show status to user
  p.onconnectionstatechange = () => {
    const statusEl = document.getElementById('call-status-text');
    if (!statusEl) return;
    switch (p.connectionState) {
      case 'connecting':    statusEl.textContent = 'Connecting...'; break;
      case 'connected':     statusEl.textContent = 'Connected'; break;
      case 'disconnected':  statusEl.textContent = 'Reconnecting...'; break;
      case 'failed':
        statusEl.textContent = 'Connection failed — retrying...';
        p.restartIce(); // auto retry ICE
        break;
      case 'closed': break;
    }
  };

  p.oniceconnectionstatechange = () => {
    if (p.iceConnectionState === 'failed') p.restartIce();
  };

  return p;
}

async function startCall(type) {
  callType = type;
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: type === 'video' ? { width: 1280, height: 720, facingMode: 'user' } : false,
      audio: { echoCancellation: true, noiseSuppression: true, sampleRate: 44100 }
    });
  } catch(e) {
    try {
      localStream = await navigator.mediaDevices.getUserMedia({
        video: type === 'video', audio: true
      });
    } catch(e2) { alert('Allow camera/microphone access first.'); return; }
  }

  document.getElementById('local-video').srcObject = localStream;
  document.getElementById('call-partner-name').textContent = senderName;
  document.getElementById('call-status-text').textContent = 'Calling...';
  show('call-overlay');

  pc = createPC();
  // Add tracks BEFORE creating offer so they are included in SDP
  localStream.getTracks().forEach(t => pc.addTrack(t, localStream));

  const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: type === 'video' });
  await pc.setLocalDescription(offer);
  socket.emit('call-offer', { offer: pc.localDescription, callType, callerName: senderName });
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
      video: callType === 'video' ? { width: 1280, height: 720, facingMode: 'user' } : false,
      audio: { echoCancellation: true, noiseSuppression: true, sampleRate: 44100 }
    });
  } catch(e) {
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ video: callType === 'video', audio: true });
    } catch(e2) { alert('Allow camera/microphone access first.'); return; }
  }

  document.getElementById('local-video').srcObject = localStream;
  document.getElementById('call-partner-name').textContent = data.callerName || 'Partner';
  document.getElementById('call-status-text').textContent = 'Connecting...';
  show('call-overlay');

  pc = createPC();
  // Add tracks BEFORE setting remote description
  localStream.getTracks().forEach(t => pc.addTrack(t, localStream));

  await pc.setRemoteDescription(new RTCSessionDescription(data.offer));

  // Flush any buffered ICE candidates
  if (window._iceCandidateBuffer) {
    for (const c of window._iceCandidateBuffer) {
      await pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
    }
    window._iceCandidateBuffer = [];
  }

  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  socket.emit('call-answer', { answer: pc.localDescription });
}

async function handleCallAnswer(data) {
  if (pc) {
    await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
    // Flush buffered ICE candidates
    if (window._iceCandidateBuffer) {
      for (const c of window._iceCandidateBuffer) {
        await pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
      }
      window._iceCandidateBuffer = [];
    }
  }
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
  window._iceCandidateBuffer = [];
  window._pendingOffer = null;
  const remoteVid = document.getElementById('remote-video');
  const localVid  = document.getElementById('local-video');
  if (remoteVid) remoteVid.srcObject = null;
  if (localVid)  localVid.srcObject  = null;
  hide('call-overlay');
  hide('incoming-call');
  isMuted = false; isCamOff = false;
  const muteBtn = document.getElementById('mute-btn');
  const camBtn  = document.getElementById('cam-btn');
  if (muteBtn) muteBtn.innerHTML = `<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm-1-9c0-.55.45-1 1-1s1 .45 1 1v6c0 .55-.45 1-1 1s-1-.45-1-1V5zm6 6c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/></svg>`;
  if (camBtn)  camBtn.innerHTML  = `<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/></svg>`;
}

function toggleMute() {
  if (!localStream) return;
  isMuted = !isMuted;
  localStream.getAudioTracks().forEach(t => t.enabled = !isMuted);
  document.getElementById('mute-btn').innerHTML = isMuted
    ? `<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3L3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.54-.9L19.73 21 21 19.73 4.27 3z"/></svg>`
    : `<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm-1-9c0-.55.45-1 1-1s1 .45 1 1v6c0 .55-.45 1-1 1s-1-.45-1-1V5zm6 6c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/></svg>`;
}

function toggleCam() {
  if (!localStream) return;
  isCamOff = !isCamOff;
  localStream.getVideoTracks().forEach(t => t.enabled = !isCamOff);
  document.getElementById('cam-btn').innerHTML = isCamOff
    ? `<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M21 6.5l-4-4-14 14 4 4 14-14zm-17.5.27L5 5.27 3.5 3.77 2.27 5l1.5 1.5L5 5.27zM17 10.5V7c0-.55-.45-1-1-1h-1.17L21 12.17V11l-4-4v3.5zM3 6.17L1.27 4.44 0 5.71l3 3V17c0 .55.45 1 1 1h10.29l2 2 1.27-1.27L3 6.17z"/></svg>`
    : `<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/></svg>`;
}

// ─── Voice Recording ─────────────────────────────────────────────────────────
let mediaRecorder = null;
let audioChunks = [];
let recordingStream = null;

async function startRecording(e) {
  if (e) e.preventDefault();
  if (mediaRecorder) return;
  try {
    recordingStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(recordingStream);
    audioChunks = [];
    mediaRecorder.ondataavailable = e => { if (e.data.size > 0) audioChunks.push(e.data); };
    mediaRecorder.onstop = sendVoiceMessage;
    mediaRecorder.start();
    document.getElementById('mic-btn').classList.add('recording');
  } catch(err) {
    alert('Microphone access denied.');
  }
}

function stopRecording(e) {
  if (e) e.preventDefault();
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
    recordingStream.getTracks().forEach(t => t.stop());
    mediaRecorder = null;
    recordingStream = null;
    document.getElementById('mic-btn').classList.remove('recording');
  }
}

function sendVoiceMessage() {
  if (audioChunks.length === 0) return;
  const blob = new Blob(audioChunks, { type: 'audio/webm' });
  if (blob.size > 3 * 1024 * 1024) { alert('Voice message too long (max ~3MB).'); return; }
  const reader = new FileReader();
  reader.onload = e => {
    const msg = {
      type: 'audio',
      data: e.target.result,
      sender: senderID,
      name: senderName,
      time: Date.now()
    };
    renderMessage(msg);
    saveMessageLocal(msg);
    socket.emit('message', msg);
  };
  reader.readAsDataURL(blob);
  audioChunks = [];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function show(id) { document.getElementById(id).classList.remove('hidden'); }
function hide(id) { document.getElementById(id).classList.add('hidden'); }
