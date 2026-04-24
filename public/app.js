// ─── State ───────────────────────────────────────────────────────────────────
let roomKey = null, senderID = null, senderName = null, socket = null;
let pc = null, localStream = null, callType = null;
let isMuted = false, isCamOff = false;

const iceServers = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:global.stun.twilio.com:3478' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'turn:openrelay.metered.ca:80',      username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443',     username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' }
  ],
  iceCandidatePoolSize: 10
};

// ─── Entry ────────────────────────────────────────────────────────────────────
function generateKey() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let key = '';
  for (let i = 0; i < 8; i++) key += chars[Math.floor(Math.random() * chars.length)];
  document.getElementById('room-key-input').value = key;
  localStorage.setItem('savedRoomKey', key);
}

function joinRoom() {
  const nameVal = document.getElementById('name-input').value.trim();
  const keyVal  = document.getElementById('room-key-input').value.trim().toUpperCase();
  if (!nameVal) { alert('Enter your name.'); return; }
  if (keyVal.length < 4) { alert('Room key must be at least 4 characters.'); return; }
  senderName = nameVal; roomKey = keyVal;
  localStorage.setItem('savedRoomKey', roomKey);
  localStorage.setItem('savedName', senderName);
  senderID = getOrCreateSenderID(roomKey);
  saveSession(); startChat();
}

function getOrCreateSenderID(key) {
  const k = 'senderID_' + key;
  let id = sessionStorage.getItem(k);
  if (!id) { id = 'u_' + Math.random().toString(36).slice(2, 10); sessionStorage.setItem(k, id); }
  return id;
}

function saveSession()  { localStorage.setItem('session', JSON.stringify({ roomKey, senderName })); }
function clearSession() { localStorage.removeItem('session'); }

window.addEventListener('load', () => {
  try {
    const s = JSON.parse(localStorage.getItem('session') || 'null');
    if (s && s.roomKey && s.senderName) {
      roomKey = s.roomKey; senderName = s.senderName;
      senderID = getOrCreateSenderID(roomKey);
      startChat(); return;
    }
  } catch(e) {}
  const savedKey  = localStorage.getItem('savedRoomKey');
  const savedName = localStorage.getItem('savedName');
  if (savedKey)  document.getElementById('room-key-input').value = savedKey;
  if (savedName) document.getElementById('name-input').value = savedName;
  setTimeout(checkPermissions, 800);
});

// ─── Chat ─────────────────────────────────────────────────────────────────────
function startChat() {
  show('chat-screen'); hide('entry-screen');
  document.getElementById('room-display').textContent = senderName + '  ·  ' + roomKey;
  socket = io();
  socket.emit('join', { roomKey, senderName, senderID });
  socket.on('history', msgs => msgs.forEach(renderMessage));
  socket.on('message', msg  => { saveMessageLocal(msg); renderMessage(msg); });
  socket.on('delete',  ()   => {
    localStorage.removeItem('msgs_' + roomKey);
    clearSession();
    window.close();
    document.body.innerHTML = '';
    window.location.replace('about:blank');
  });
  socket.on('call-offer',  handleIncomingCall);
  socket.on('call-answer', handleCallAnswer);
  socket.on('ice', async data => {
    if (pc && pc.remoteDescription) {
      await pc.addIceCandidate(new RTCIceCandidate(data.candidate)).catch(() => {});
    } else {
      if (!window._iceBuf) window._iceBuf = [];
      window._iceBuf.push(data.candidate);
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
  renderMessage(msg); saveMessageLocal(msg); socket.emit('message', msg);
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
    renderMessage(msg); saveMessageLocal(msg); socket.emit('message', msg);
  };
  reader.readAsDataURL(file);
}

function deleteAll() {
  if (!confirm('Delete all messages and close for both sides?')) return;
  localStorage.removeItem('msgs_' + roomKey);
  clearSession();
  if (socket) socket.emit('delete');
  window.close();
  document.body.innerHTML = '';
  window.location.replace('about:blank');
}

// ─── Storage ──────────────────────────────────────────────────────────────────
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
    audio.controls = true; audio.src = data.data;
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
  if (isMe) { const tick = document.createElement('span'); tick.className = 'tick'; tick.textContent = '✓✓'; footer.appendChild(tick); }
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
function formatTime(ts) { return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
function openLightbox(src) {
  const lb = document.createElement('div');
  lb.className = 'lightbox'; lb.onclick = () => lb.remove();
  const img = document.createElement('img'); img.src = src;
  lb.appendChild(img); document.body.appendChild(lb);
}

// ─── WebRTC ───────────────────────────────────────────────────────────────────
let videoRelayInterval = null;
let relayCanvas = null;

function createPC() {
  const p = new RTCPeerConnection(iceServers);

  p.onicecandidate = e => {
    if (e.candidate) socket.emit('ice', { candidate: e.candidate.toJSON() });
  };

  p.ontrack = e => {
    console.log('ontrack:', e.track.kind);
    const rv = document.getElementById('remote-video');
    if (e.streams && e.streams[0]) {
      rv.srcObject = e.streams[0];
    } else {
      if (!rv.srcObject) rv.srcObject = new MediaStream();
      rv.srcObject.addTrack(e.track);
    }
    rv.play().catch(() => {});
    document.getElementById('call-status-text').textContent = 'Connected';
    // Stop relay if WebRTC succeeded
    stopVideoRelay();
  };

  p.onconnectionstatechange = () => {
    console.log('connectionState:', p.connectionState);
    const s = document.getElementById('call-status-text');
    if (!s) return;
    if (p.connectionState === 'connected') {
      s.textContent = 'Connected';
      stopVideoRelay();
    }
    if (p.connectionState === 'disconnected') s.textContent = 'Reconnecting...';
    if (p.connectionState === 'failed') {
      console.log('WebRTC failed — switching to relay mode');
      s.textContent = 'Connected (relay)';
      startVideoRelay();
    }
  };

  p.oniceconnectionstatechange = () => {
    console.log('iceState:', p.iceConnectionState);
    if (p.iceConnectionState === 'failed') {
      p.restartIce();
      // Also start relay as fallback
      setTimeout(() => {
        if (p.iceConnectionState !== 'connected') startVideoRelay();
      }, 3000);
    }
  };

  return p;
}

// ─── Socket.io Video Relay (fallback when WebRTC fails) ──────────────────────
function startVideoRelay() {
  if (videoRelayInterval || !localStream) return;
  console.log('Starting video relay via Socket.io');

  // Listen for remote frames
  socket.on('video-frame', (data) => {
    const rv = document.getElementById('remote-video');
    if (!rv._relayImg) {
      // Replace video element with an img for relay display
      const img = document.createElement('img');
      img.id = 'relay-img';
      img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
      rv.parentNode.insertBefore(img, rv);
      rv.style.display = 'none';
      rv._relayImg = img;
    }
    rv._relayImg.src = data.frame;
    document.getElementById('call-status-text').textContent = 'Connected';
  });

  // Send local video frames
  if (!relayCanvas) {
    relayCanvas = document.createElement('canvas');
    relayCanvas.width = 320; relayCanvas.height = 240;
  }
  const ctx = relayCanvas.getContext('2d');
  const lv = document.getElementById('local-video');

  videoRelayInterval = setInterval(() => {
    if (!localStream || !lv.videoWidth) return;
    ctx.drawImage(lv, 0, 0, 320, 240);
    const frame = relayCanvas.toDataURL('image/jpeg', 0.4);
    socket.emit('video-frame', { frame });
  }, 100); // 10fps
}

function stopVideoRelay() {
  if (videoRelayInterval) { clearInterval(videoRelayInterval); videoRelayInterval = null; }
  socket.off('video-frame');
  const rv = document.getElementById('remote-video');
  if (rv && rv._relayImg) {
    rv._relayImg.remove();
    rv._relayImg = null;
    rv.style.display = 'block';
  }
}

async function getMedia(type) {
  const tries = [
    { video: type === 'video' ? { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' } : false, audio: { echoCancellation: true, noiseSuppression: true } },
    { video: type === 'video', audio: true }
  ];
  for (const c of tries) {
    try { return await navigator.mediaDevices.getUserMedia(c); } catch(e) { console.warn('getUserMedia failed', e); }
  }
  throw new Error('Media access denied');
}

async function startCall(type) {
  if (pc) endCall(true);
  callType = type;
  try { localStream = await getMedia(type); }
  catch(e) { alert('Allow camera/microphone access first.'); return; }

  document.getElementById('local-video').srcObject = localStream;
  document.getElementById('call-partner-name').textContent = senderName;
  document.getElementById('call-status-text').textContent = 'Calling...';
  show('call-overlay');

  pc = createPC();
  localStream.getTracks().forEach(t => { console.log('addTrack caller:', t.kind); pc.addTrack(t, localStream); });

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
  if (!data) return;
  callType = data.callType;

  try { localStream = await getMedia(callType); }
  catch(e) { alert('Allow camera/microphone access first.'); return; }

  document.getElementById('local-video').srcObject = localStream;
  document.getElementById('call-partner-name').textContent = data.callerName || 'Partner';
  document.getElementById('call-status-text').textContent = 'Connecting...';
  show('call-overlay');

  pc = createPC();
  localStream.getTracks().forEach(t => { console.log('addTrack callee:', t.kind); pc.addTrack(t, localStream); });

  await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
  console.log('setRemoteDescription done (callee)');

  for (const c of (window._iceBuf || [])) {
    await pc.addIceCandidate(new RTCIceCandidate(c)).catch(e => console.warn('ICE flush err', e));
  }
  window._iceBuf = [];

  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  socket.emit('call-answer', { answer: pc.localDescription });
}

async function handleCallAnswer(data) {
  if (!pc) return;
  await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
  console.log('setRemoteDescription done (caller)');
  for (const c of (window._iceBuf || [])) {
    await pc.addIceCandidate(new RTCIceCandidate(c)).catch(e => console.warn('ICE flush err', e));
  }
  window._iceBuf = [];
}

function rejectCall() {
  hide('incoming-call');
  if (socket) socket.emit('call-reject');
  window._pendingOffer = null;
}

function endCall(remote = false) {
  if (!remote && socket) socket.emit('call-end');
  stopVideoRelay();
  if (pc) { pc.close(); pc = null; }
  if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
  window._iceBuf = []; window._pendingOffer = null;
  const rv = document.getElementById('remote-video');
  const lv = document.getElementById('local-video');
  if (rv) rv.srcObject = null;
  if (lv) lv.srcObject = null;
  hide('call-overlay'); hide('incoming-call');
  isMuted = false; isCamOff = false;
  const mb = document.getElementById('mute-btn');
  const cb = document.getElementById('cam-btn');
  if (mb) mb.innerHTML = svgMic();
  if (cb) cb.innerHTML = svgCam();
}

function toggleMute() {
  if (!localStream) return;
  isMuted = !isMuted;
  localStream.getAudioTracks().forEach(t => t.enabled = !isMuted);
  document.getElementById('mute-btn').innerHTML = isMuted ? svgMicOff() : svgMic();
}

function toggleCam() {
  if (!localStream) return;
  isCamOff = !isCamOff;
  localStream.getVideoTracks().forEach(t => t.enabled = !isCamOff);
  document.getElementById('cam-btn').innerHTML = isCamOff ? svgCamOff() : svgCam();
}

function svgMic()    { return `<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm-1-9c0-.55.45-1 1-1s1 .45 1 1v6c0 .55-.45 1-1 1s-1-.45-1-1V5zm6 6c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/></svg>`; }
function svgMicOff() { return `<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3L3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.54-.9L19.73 21 21 19.73 4.27 3z"/></svg>`; }
function svgCam()    { return `<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/></svg>`; }
function svgCamOff() { return `<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M21 6.5l-4-4-14 14 4 4 14-14zm-2.5 9.17L17 14.17V13l-4-4v1.17L6.83 4H16c.55 0 1 .45 1 1v3.5l4-4v11l-1.5-1.5zM3 6.17L1.27 4.44 0 5.71l3 3V17c0 .55.45 1 1 1h10.29l2 2 1.27-1.27L3 6.17z"/></svg>`; }

// ─── Voice Recording ──────────────────────────────────────────────────────────
let mediaRecorder = null, audioChunks = [], recordingStream = null;

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
  } catch(e) { alert('Microphone access denied.'); }
}

function stopRecording(e) {
  if (e) e.preventDefault();
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
    recordingStream.getTracks().forEach(t => t.stop());
    mediaRecorder = null; recordingStream = null;
    document.getElementById('mic-btn').classList.remove('recording');
  }
}

function sendVoiceMessage() {
  if (!audioChunks.length) return;
  const blob = new Blob(audioChunks, { type: 'audio/webm' });
  if (blob.size > 3 * 1024 * 1024) { alert('Voice message too long.'); return; }
  const reader = new FileReader();
  reader.onload = e => {
    const msg = { type: 'audio', data: e.target.result, sender: senderID, name: senderName, time: Date.now() };
    renderMessage(msg); saveMessageLocal(msg); socket.emit('message', msg);
  };
  reader.readAsDataURL(blob);
  audioChunks = [];
}

// ─── Permissions ──────────────────────────────────────────────────────────────
async function checkPermissions() {
  if (!navigator.permissions) { show('perm-banner'); return; }
  try {
    const mic = await navigator.permissions.query({ name: 'microphone' });
    const cam = await navigator.permissions.query({ name: 'camera' });
    if (mic.state !== 'granted' || cam.state !== 'granted') show('perm-banner');
  } catch(e) { show('perm-banner'); }
}

async function requestPermissions() {
  const s = document.getElementById('perm-status');
  s.className = 'perm-status'; s.textContent = 'Requesting access...';
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    stream.getTracks().forEach(t => t.stop());
    s.className = 'perm-status ok'; s.textContent = '✓ Access granted';
    setTimeout(() => hide('perm-banner'), 1200);
  } catch(e) {
    s.className = 'perm-status error';
    s.textContent = e.name === 'NotAllowedError'
      ? 'Denied. Enable permissions in browser settings and reload.'
      : 'Error: ' + e.message;
  }
}

function dismissPermBanner() { hide('perm-banner'); }

// ─── Helpers ──────────────────────────────────────────────────────────────────
function show(id) { document.getElementById(id).classList.remove('hidden'); }
function hide(id) { document.getElementById(id).classList.add('hidden'); }
