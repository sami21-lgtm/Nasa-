/*
 * SpaceSkribble – NASA Sky Challenge · client app
 * ------------------------------------------------
 * Sections:
 *   1. Helpers (DOM, images, toasts, sound)
 *   2. Starfield background
 *   3. Transports – how we talk to the game engine
 *        • SocketTransport  → Node.js + Socket.IO server (real multiplayer)
 *        • LocalTransport   → engine runs in this tab; other tabs of the same
 *                             browser join through BroadcastChannel; Space Bots
 *                             fill in for friends
 *   4. App state & screens
 *   5. Home page (avatars, catalogue, gravity lab, distance ladder)
 *   6. Lobby
 *   7. Game screen (timer, word, clues, chat, NASA card)
 *   8. Drawing canvas
 *   9. Game over (leaderboard + confetti)
 */
(() => {
  'use strict';
  const { Room, makeRoomCode, AVATARS, SPACE_OBJECTS } = window.SpaceEngine;

  // ═══════════════════════ 1. HELPERS ═══════════════════════
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const rid = () => Math.random().toString(36).slice(2, 10);
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Netlify Image CDN on deployed sites; original files when running locally.
  const USE_CDN = location.protocol !== 'file:' && !/^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(location.hostname);
  const img = (src, w = 800) => (USE_CDN ? `/.netlify/images?url=${encodeURIComponent(src)}&w=${w}&fm=webp&q=78` : src);

  $$('[data-bg]').forEach((el) => el.style.setProperty('--photo', `url("${img(el.dataset.bg, 1800)}")`));

  function toast(text, kind = '') {
    const t = document.createElement('div');
    t.className = 'toast ' + kind;
    t.textContent = text;
    $('#toasts').appendChild(t);
    setTimeout(() => t.classList.add('out'), 3200);
    setTimeout(() => t.remove(), 3700);
  }

  // Tiny synth so we don't ship audio files.
  const Sound = {
    muted: localStorage.getItem('ss-muted') === '1',
    ctx: null,
    play(notes, type = 'sine', len = 0.12) {
      if (this.muted) return;
      try {
        this.ctx = this.ctx || new (window.AudioContext || window.webkitAudioContext)();
        notes.forEach((f, i) => {
          const o = this.ctx.createOscillator();
          const g = this.ctx.createGain();
          const t = this.ctx.currentTime + i * len * 0.8;
          o.type = type;
          o.frequency.value = f;
          g.gain.setValueAtTime(0.0001, t);
          g.gain.exponentialRampToValueAtTime(0.12, t + 0.02);
          g.gain.exponentialRampToValueAtTime(0.0001, t + len);
          o.connect(g).connect(this.ctx.destination);
          o.start(t);
          o.stop(t + len + 0.02);
        });
      } catch (_) {}
    },
    correct() { this.play([660, 880, 1320], 'triangle', 0.14); },
    tick() { this.play([520], 'square', 0.05); },
    reveal() { this.play([392, 494, 587, 784], 'sine', 0.2); },
    win() { this.play([523, 659, 784, 1046, 1318], 'triangle', 0.18); },
    pop() { this.play([300, 600], 'sine', 0.08); },
  };

  // ═══════════════════════ 2. STARFIELD ═══════════════════════
  (function starfield() {
    const c = $('#starfield');
    const ctx = c.getContext('2d');
    let stars = [];
    let shooting = null;
    function resize() {
      c.width = innerWidth * devicePixelRatio;
      c.height = innerHeight * devicePixelRatio;
      const n = Math.min(260, Math.floor((innerWidth * innerHeight) / 5500));
      stars = Array.from({ length: n }, () => ({
        x: Math.random() * c.width,
        y: Math.random() * c.height,
        r: (Math.random() * 1.3 + 0.2) * devicePixelRatio,
        p: Math.random() * Math.PI * 2,
        s: 0.5 + Math.random() * 1.5,
        hue: Math.random() < 0.15 ? 30 : Math.random() < 0.3 ? 210 : 0,
      }));
    }
    function frame(t) {
      ctx.clearRect(0, 0, c.width, c.height);
      for (const s of stars) {
        const a = reduceMotion ? 0.7 : 0.35 + 0.65 * Math.abs(Math.sin(s.p + (t / 1000) * s.s));
        ctx.fillStyle = s.hue ? `hsla(${s.hue},90%,85%,${a})` : `rgba(255,255,255,${a})`;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fill();
      }
      if (!reduceMotion) {
        if (!shooting && Math.random() < 0.004) shooting = { x: Math.random() * c.width, y: Math.random() * c.height * 0.4, life: 1 };
        if (shooting) {
          const { x, y, life } = shooting;
          const g = ctx.createLinearGradient(x, y, x - 160 * devicePixelRatio, y - 60 * devicePixelRatio);
          g.addColorStop(0, `rgba(255,255,255,${life})`);
          g.addColorStop(1, 'rgba(255,255,255,0)');
          ctx.strokeStyle = g;
          ctx.lineWidth = 2 * devicePixelRatio;
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x - 160 * devicePixelRatio, y - 60 * devicePixelRatio);
          ctx.stroke();
          shooting.x += 14 * devicePixelRatio;
          shooting.y += 5 * devicePixelRatio;
          shooting.life -= 0.025;
          if (shooting.life <= 0) shooting = null;
        }
        requestAnimationFrame(frame);
      }
    }
    addEventListener('resize', resize);
    resize();
    requestAnimationFrame(frame);
  })();

  // ═══════════════════════ 3. TRANSPORTS ═══════════════════════
  // Both transports expose: onEvent(fn), create(profile), join(code, profile), send(type, payload), leave()

  // Routes an action to the engine. Shared by LocalTransport (server.js has the same switch).
  function dispatch(room, id, type, payload) {
    switch (type) {
      case 'ready': return room.setReady(id, payload);
      case 'settings': return room.updateSettings(id, payload);
      case 'addBot': return room.addBot(id);
      case 'kick': return room.kick(id, payload);
      case 'start': return room.start(id);
      case 'choose': return room.choose(id, payload);
      case 'draw': return room.draw(id, payload);
      case 'guess': return room.guess(id, payload);
      case 'playAgain': return room.playAgain(id);
    }
  }


class SocketTransport {
    constructor() {
      this.kind = 'online';

      let savedUser = null;

      try {
        savedUser = JSON.parse(
          localStorage.getItem('spaceSkribbleUser') || 'null'
        );
      } catch {
        savedUser = null;
      }

      const token = savedUser?.token || '';

      this.socket = window.io(window.SS_API_BASE || undefined, {
        auth: {
          token: token
        }
      });

      this.socket.on('evt', ({ event, payload }) =>
        this.handler(event, payload)
      );

      this.socket.on('disconnect', () =>
        this.handler('disconnected', {})
      );

      // The server rejects sockets without a valid login: send the player back to log in.
      this.socket.on('connect_error', (error) => {
        if (error && error.message === 'LOGIN_REQUIRED' && window.SS) window.SS.logout();
      });
    }

    onEvent(fn) { this.handler = fn; }

create(profile) {
  this.socket.emit('evt', {
    event: 'createRoom',
    payload: { profile }
  });
}

join(code, profile) {
  this.socket.emit('evt', {
    event: 'joinRoom',
    payload: { code, profile }
  });
}

send(type, payload) {
  this.socket.emit('evt', { event: type, payload });
}

    leave() { this.socket.disconnect(); }
  }

  class LocalTransport {
    constructor() {
      this.kind = 'local';
      this.id = 'p-' + rid();
      this.channel = null;
      this.room = null;
      addEventListener('pagehide', () => this.leave());
    }
    onEvent(fn) { this.handler = fn; }
    deliver(event, payload) {
      const copy = payload === undefined ? payload : structuredClone(payload);
      queueMicrotask(() => this.handler(event, copy));
    }
    addressedToMe(to) {
      return to === 'all' || to === this.id || (to && to.except && to.except !== this.id);
    }

    // ── host side: this tab runs the engine ──
    create(profile) {
      const code = makeRoomCode();
      this.channel = new BroadcastChannel('spaceskribble-' + code);
      this.room = new Room({
        code,
        emit: (to, event, payload) => {
          if (this.addressedToMe(to)) this.deliver(event, payload);
          if (to !== this.id) this.channel.postMessage({ kind: 'evt', to, event, payload });
        },
      });
      this.channel.onmessage = ({ data: m }) => {
        if (m.kind === 'join') {
          const res = this.room.join(m.from, m.profile);
          if (res.error) this.channel.postMessage({ kind: 'evt', to: m.from, event: 'error', payload: { message: res.error } });
          else this.channel.postMessage({ kind: 'evt', to: m.from, event: 'joined', payload: { code, you: m.from } });
        } else if (m.kind === 'action') dispatch(this.room, m.from, m.type, m.payload);
        else if (m.kind === 'bye') this.room.leave(m.from);
      };
      this.timer = setInterval(() => this.room.tick(250), 250);
      this.deliver('joined', { code, you: this.id });
      this.room.join(this.id, profile);
    }

    // ── guest side: another tab of this browser hosts ──
    join(code, profile) {
      this.channel = new BroadcastChannel('spaceskribble-' + code);
      let answered = false;
      this.channel.onmessage = ({ data: m }) => {
        if (m.kind === 'hostgone') return this.handler('hostgone', {});
        if (m.kind !== 'evt' || !this.addressedToMe(m.to)) return;
        if (m.event === 'joined' || m.event === 'error') answered = true;
        this.handler(m.event, m.payload);
      };
      this.channel.postMessage({ kind: 'join', from: this.id, profile });
      setTimeout(() => {
        if (answered) return;
        this.channel.close();
        this.channel = null;
        this.handler('error', {
          message: 'Room not found. In local mode, rooms only work between tabs of the same browser. Run the Node server (see README) to play across devices.',
        });
      }, 1500);
    }

    send(type, payload) {
      if (this.room) dispatch(this.room, this.id, type, payload);
      else if (this.channel) this.channel.postMessage({ kind: 'action', from: this.id, type, payload });
    }
    leave() {
      if (!this.channel) return;
      if (this.room) {
        clearInterval(this.timer);
        this.channel.postMessage({ kind: 'hostgone' });
      } else this.channel.postMessage({ kind: 'bye', from: this.id });
      this.channel.close();
      this.channel = null;
    }
  }

  const net = window.io && !window.__noSocket ? new SocketTransport() : new LocalTransport();

  // ═══════════════════════ 4. APP STATE & SCREENS ═══════════════════════
  const S = {
    me: null,
    code: null,
    room: null, // latest public state from engine
    secret: null, // { object, image } – only for the drawer
    reveal: null,
    lastPhase: null,
    lastTime: null,
  };

  function show(screen) {
    $$('.screen').forEach((s) => s.classList.toggle('active', s.id === 'screen-' + screen));
    document.body.dataset.screen = screen;
    if (screen !== 'home') scrollTo(0, 0);
  }

  const modeText =
    net.kind === 'online'
      ? '🟢 Online multiplayer – friends on any device can join with your code'
      : '🟣 Local mode – play with Space Bots or friends in other tabs of this browser';
  $('#mode-pill').textContent = modeText;
  $('#lobby-mode').textContent = net.kind === 'online' ? '🟢 Online' : '🟣 Local mode';

  net.onEvent((event, p) => {
    switch (event) {
      case 'joined':
        S.me = p.you;
        S.code = p.code;
        history.replaceState(null, '', '?room=' + p.code);
        $('#chat').innerHTML = '';
        show('lobby');
        break;
      case 'error': toast(p.message, 'bad'); setBusy(false); break;
      case 'toast': toast(p.text); break;
      case 'state': onState(p); break;
      case 'secret': S.secret = p; renderSecret(); break;
      case 'choose': showChoices(p.choices); break;
      case 'chat': addChat(p); break;
      case 'draw': Board.apply(p); break;
      case 'sync': Board.strokes = p.strokes || []; Board.redraw(); break;
      case 'clear': Board.strokes = []; Board.redraw(); S.secret = null; S.reveal = null; renderSecret(); break;
      case 'score': onScore(p); break;
      case 'reveal': S.reveal = p; showReveal(p); Sound.reveal(); break;
      case 'over': showOver(p.leaderboard); break;
      case 'kicked': toast('You were removed from the room.', 'bad'); goHome(); break;
      case 'hostgone': toast('The host closed the room.', 'bad'); goHome(); break;
      case 'disconnected': if (S.code) toast('Connection lost. Refresh to rejoin.', 'bad'); break;
    }
  });

  function goHome() {
    net.leave();
    setTimeout(() => (location.href = location.pathname), 600);
  }
  $$('[data-action="leave"]').forEach((b) => b.addEventListener('click', () => (S.code ? goHome() : show('home'))));

  function onState(s) {
    const prev = S.room;
    S.room = s;
    const phase = s.phase;
    if (phase === 'lobby') {
      show('lobby');
      renderLobby();
    } else if (phase === 'over') {
      show('over');
      renderOverActions();
    } else {
      show('game');
      renderGame(prev);
    }
    S.lastPhase = phase;
  }

  const meP = () => S.room && S.room.players.find((p) => p.id === S.me);
  const isHost = () => S.room && S.room.hostId === S.me;
  const isDrawer = () => S.room && S.room.drawerId === S.me;

  // dialogs
  $$('[data-open]').forEach((b) => b.addEventListener('click', () => $('#' + b.dataset.open).showModal()));
  $$('dialog.modal').forEach((d) => d.addEventListener('click', (e) => e.target === d && d.close()));

  // ═══════════════════════ 5. HOME ═══════════════════════
  const profile = {
    // Logged-in players start with their account name.
    name: localStorage.getItem('ss-name') || (window.SS && window.SS.getUser() ? String(window.SS.getUser().name || '').slice(0, 16) : ''),
    avatar: localStorage.getItem('ss-avatar') || AVATARS[0],
  };
  $('#name-input').value = profile.name;
  $('#stat-objects').textContent = SPACE_OBJECTS.length;

  const picker = $('#avatar-picker');
  picker.innerHTML = AVATARS.map(
    (a) => `<button type="button" role="radio" aria-checked="${a === profile.avatar}" class="avatar ${a === profile.avatar ? 'selected' : ''}" data-a="${a}">${a}</button>`
  ).join('');
  picker.addEventListener('click', (e) => {
    const b = e.target.closest('[data-a]');
    if (!b) return;
    profile.avatar = b.dataset.a;
    $$('.avatar', picker).forEach((x) => {
      x.classList.toggle('selected', x === b);
      x.setAttribute('aria-checked', x === b);
    });
    Sound.pop();
  });

  const params = new URLSearchParams(location.search);
  if (params.get('room')) {
    $('#code-input').value = params.get('room').toUpperCase();
    history.replaceState(null, '', location.pathname);
    setTimeout(() => $('#name-input').focus(), 300);
  }

  function readProfile() {
    const name = $('#name-input').value.trim();
    if (!name) {
      toast('Enter your astronaut name first 🚀', 'bad');
      $('#name-input').focus();
      return null;
    }
    profile.name = name;
    localStorage.setItem('ss-name', name);
    localStorage.setItem('ss-avatar', profile.avatar);
    return { name, avatar: profile.avatar };
  }
  function setBusy(b) {
    $('#create-btn').disabled = b;
    $('#join-btn').disabled = b;
  }
  $('#create-btn').addEventListener('click', () => {
    const p = readProfile();
    if (!p) return;
    setBusy(true);
    net.create(p);
  });
  $('#join-btn').addEventListener('click', joinFromForm);
  $('#code-input').addEventListener('keydown', (e) => e.key === 'Enter' && (e.preventDefault(), joinFromForm()));
  $('#code-input').addEventListener('input', (e) => (e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '')));
  $('#join-form').addEventListener('submit', (e) => {
    e.preventDefault();
    $('#code-input').value ? joinFromForm() : $('#create-btn').click();
  });
  function joinFromForm() {
    const p = readProfile();
    if (!p) return;
    const code = $('#code-input').value.trim().toUpperCase();
    if (code.length !== 5) return toast('Room codes have 5 characters.', 'bad');
    setBusy(true);
    net.join(code, p);
  }

  // ── catalogue ──
  const gravityOf = (o) => (o.stats.find((s) => s.g) || {}).g;
  const categories = ['All', ...new Set(SPACE_OBJECTS.map((o) => o.category))];
  let activeCat = 'All';
  function renderCatalogue() {
    $('#filter-row').innerHTML = categories.map((c) => `<button class="chip ${c === activeCat ? 'active' : ''}" data-cat="${esc(c)}">${esc(c)}</button>`).join('');
    $('#object-grid').innerHTML = SPACE_OBJECTS.filter((o) => activeCat === 'All' || o.category === activeCat)
      .map((o, i) => {
        const g = gravityOf(o);
        return `<button class="object-card" data-id="${o.id}" style="--i:${i};--accent:${o.color}">
          <span class="object-img"><img loading="lazy" src="${img(o.images[0].src, 480)}" alt="${esc(o.name)}" /></span>
          <span class="object-body">
            <span class="object-cat">${esc(o.category)}</span>
            <strong>${esc(o.name)}</strong>
            <span class="object-meta"><span class="diff ${o.difficulty}">${o.difficulty}</span>${g ? `<span>g = ${g} m/s²</span>` : ''}${o.images.length > 1 ? `<span>📸 ${o.images.length} photos</span>` : ''}</span>
          </span>
        </button>`;
      })
      .join('');
  }
  $('#filter-row').addEventListener('click', (e) => {
    const b = e.target.closest('[data-cat]');
    if (!b) return;
    activeCat = b.dataset.cat;
    renderCatalogue();
  });
  const objectModal = document.createElement('dialog');
  objectModal.className = 'modal wide';
  document.body.appendChild(objectModal);
  objectModal.addEventListener('click', (e) => (e.target === objectModal || e.target.closest('.close')) && objectModal.close());
  $('#object-grid').addEventListener('click', (e) => {
    const b = e.target.closest('[data-id]');
    if (!b) return;
    const o = SPACE_OBJECTS.find((x) => x.id === b.dataset.id);
    objectModal.innerHTML = `<button class="close" aria-label="Close">✕</button>` + nasaCardHTML(o, pickImage(o));
    objectModal.showModal();
  });
  const pickImage = (o) => o.images[Math.floor(Math.random() * o.images.length)];
  renderCatalogue();

  // ── gravity lab: ball drop at 9.8 m/s² and friends ──
  const WORLDS = [
    { name: 'Moon', g: 1.62, color: '#d6d6d6' },
    { name: 'Mercury', g: 3.7, color: '#b7b2a8' },
    { name: 'Mars', g: 3.71, color: '#e2603c' },
    { name: 'Venus', g: 8.87, color: '#f2d29b' },
    { name: 'Earth', g: 9.81, color: '#4d96ff' },
    { name: 'Saturn', g: 10.44, color: '#e8cf94' },
    { name: 'Jupiter', g: 24.79, color: '#d9a066' },
    { name: 'Sun', g: 274, color: '#ffb703' },
  ];
  const Lab = {
    c: $('#gravity-canvas'),
    h: 20,
    mass: 40,
    balls: [],
    t0: 0,
    running: false,
    init() {
      this.ctx = this.c.getContext('2d');
      $('#height-range').addEventListener('input', (e) => {
        this.h = +e.target.value;
        $('#height-val').textContent = this.h;
        this.table();
        this.reset();
      });
      $('#mass-range').addEventListener('input', (e) => {
        this.mass = +e.target.value;
        $('#mass-val').textContent = this.mass;
        this.table();
      });
      $('#drop-btn').addEventListener('click', () => this.drop());
      this.table();
      this.reset();
    },
    table() {
      $('#lab-table tbody').innerHTML = WORLDS.map((w) => {
        const t = Math.sqrt((2 * this.h) / w.g);
        const feel = (this.mass * w.g) / 9.81;
        return `<tr class="${w.name === 'Earth' ? 'earth' : ''}"><td><span class="dot" style="background:${w.color}"></span>${w.name}</td><td>${w.g}</td><td>${t.toFixed(2)} s</td><td>${feel >= 100 ? Math.round(feel).toLocaleString() : feel.toFixed(1)} kg</td></tr>`;
      }).join('');
    },
    reset() {
      this.running = false;
      this.balls = WORLDS.map((w) => ({ ...w, y: 0, v: 0, landed: null, bounces: 0 }));
      this.render();
    },
    drop() {
      this.reset();
      this.running = true;
      this.t0 = performance.now();
      this.last = this.t0;
      Sound.pop();
      const step = (now) => {
        if (!this.running) return;
        const dt = Math.min(0.05, (now - this.last) / 1000);
        this.last = now;
        let active = false;
        for (const b of this.balls) {
          if (b.bounces > 4) continue;
          active = true;
          b.v += b.g * dt;
          b.y += b.v * dt;
          if (b.y >= this.h) {
            b.y = this.h;
            if (b.landed === null) b.landed = (now - this.t0) / 1000;
            b.v = -b.v * 0.5;
            b.bounces++;
            if (Math.abs(b.v) < 0.4) b.bounces = 5;
          }
        }
        this.render((now - this.t0) / 1000);
        if (active && now - this.t0 < 15000) requestAnimationFrame(step);
        else this.running = false;
      };
      requestAnimationFrame(step);
    },
    render(elapsed = 0) {
      const { ctx, c } = this;
      const W = c.width;
      const H = c.height;
      const top = 40;
      const ground = H - 70;
      ctx.clearRect(0, 0, W, H);
      const lane = W / this.balls.length;
      ctx.font = '600 15px Inter, sans-serif';
      ctx.textAlign = 'center';
      // height ruler
      ctx.strokeStyle = 'rgba(255,255,255,.08)';
      ctx.setLineDash([4, 6]);
      ctx.beginPath();
      ctx.moveTo(0, top);
      ctx.lineTo(W, top);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(255,255,255,.45)';
      ctx.textAlign = 'left';
      ctx.fillText(`${this.h} m`, 8, top - 10);
      ctx.textAlign = 'center';
      this.balls.forEach((b, i) => {
        const x = lane * i + lane / 2;
        ctx.fillStyle = 'rgba(255,255,255,.04)';
        ctx.fillRect(lane * i + 6, top, lane - 12, ground - top);
        ctx.fillStyle = b.color;
        ctx.globalAlpha = 0.35;
        ctx.fillRect(lane * i + 6, ground, lane - 12, 4);
        ctx.globalAlpha = 1;
        const y = top + (b.y / this.h) * (ground - top - 16);
        const grd = ctx.createRadialGradient(x - 5, y - 5, 2, x, y, 18);
        grd.addColorStop(0, '#fff');
        grd.addColorStop(0.35, b.color);
        grd.addColorStop(1, 'rgba(0,0,0,.6)');
        ctx.fillStyle = grd;
        ctx.beginPath();
        ctx.arc(x, y, 16, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.fillText(b.name, x, ground + 28);
        ctx.fillStyle = 'rgba(255,255,255,.55)';
        ctx.font = '500 13px Inter, sans-serif';
        ctx.fillText(b.landed !== null ? `landed ${b.landed.toFixed(2)} s` : `g ${b.g}`, x, ground + 50);
        ctx.font = '600 15px Inter, sans-serif';
      });
      if (elapsed) {
        ctx.fillStyle = 'rgba(255,255,255,.7)';
        ctx.textAlign = 'right';
        ctx.fillText(`t = ${elapsed.toFixed(2)} s`, W - 10, top - 10);
      }
    },
  };
  Lab.init();

  // ── cosmic distance ladder ──
  const LY = 9.461e12;
  const DISTANCES = [
    { name: 'International Space Station', note: 'above your head', km: 400, icon: '🛰️' },
    { name: 'The Moon', note: 'average distance from Earth', km: 384400, icon: '🌙' },
    { name: 'The Sun', note: '1 AU from Earth', km: 1.496e8, icon: '☀️' },
    { name: 'Mars', note: 'Earth to Mars, closest approaches ≈ 55 million km', km: 5.5e7, icon: '🔴' },
    { name: 'Jupiter', note: 'closest approach to Earth', km: 5.88e8, icon: '🟠' },
    { name: 'Saturn', note: 'closest approach to Earth', km: 1.2e9, icon: '🪐' },
    { name: 'Neptune', note: 'closest approach to Earth', km: 4.3e9, icon: '🔵' },
    { name: 'Pleiades', note: 'Seven Sisters star cluster', km: 444 * LY, icon: '✨' },
    { name: 'Orion Nebula', note: 'stellar nursery', km: 1344 * LY, icon: '🌸' },
    { name: 'Center of the Milky Way', note: 'Sagittarius A*', km: 26000 * LY, icon: '🌌' },
    { name: 'Andromeda Galaxy', note: 'nearest big spiral galaxy', km: 2.5e6 * LY, icon: '🌀' },
  ].sort((a, b) => a.km - b.km);

  function fmtBig(n) {
    if (n < 1e6) return Math.round(n).toLocaleString();
    const units = [[1e18, 'quintillion'], [1e15, 'quadrillion'], [1e12, 'trillion'], [1e9, 'billion'], [1e6, 'million']];
    for (const [v, w] of units) if (n >= v) return `${(n / v).toLocaleString(undefined, { maximumFractionDigits: n / v < 10 ? 1 : 0 })} ${w}`;
  }
  function fmtLight(km) {
    const s = km / 299792;
    if (s < 1) return `${(s * 1000).toFixed(1)} light-milliseconds`;
    if (s < 60) return `${s.toFixed(2)} light-seconds`;
    if (s < 3600) return `${(s / 60).toFixed(1)} light-minutes`;
    if (s < 86400 * 2) return `${(s / 3600).toFixed(1)} light-hours`;
    const ly = km / LY;
    return `${ly.toLocaleString(undefined, { maximumFractionDigits: 0 })} light-years`;
  }
  function fmtCar(km) {
    const h = km / 100;
    if (h < 48) return `${h.toFixed(0)} hours of driving`;
    if (h < 24 * 730) return `${Math.round(h / 24).toLocaleString()} days of driving`;
    return `${fmtBig(h / 24 / 365.25)} years of driving`;
  }
  let unit = 'km';
  function renderLadder() {
    const min = Math.log10(100);
    const max = Math.log10(DISTANCES[DISTANCES.length - 1].km);
    $('#ladder').innerHTML = DISTANCES.map((d) => {
      const pct = 6 + ((Math.log10(d.km) - min) / (max - min)) * 94;
      const val = unit === 'km' ? `${fmtBig(d.km)} km` : unit === 'light' ? fmtLight(d.km) : fmtCar(d.km);
      return `<li><span class="lad-icon">${d.icon}</span><div class="lad-main"><div class="lad-top"><strong>${d.name}</strong><span>${val}</span></div><div class="lad-bar"><i style="width:${pct}%"></i></div><small>${d.note}</small></div></li>`;
    }).join('');
  }
  $('#unit-toggle').addEventListener('click', (e) => {
    const b = e.target.closest('[data-unit]');
    if (!b) return;
    unit = b.dataset.unit;
    $$('#unit-toggle button').forEach((x) => x.classList.toggle('active', x === b));
    renderLadder();
  });
  renderLadder();

  // ═══════════════════════ 6. LOBBY ═══════════════════════
  const TIPS = [
    'Tip: an image clue — a blurred real NASA photo — unlocks halfway through each round.',
    'Did you know? Earth’s gravity is 9.8 m/s². On the Moon it is just 1.62 m/s².',
    'Tip: guessing fast earns up to +50 bonus points.',
    'Light from the Sun takes about 8 minutes 20 seconds to reach Earth.',
    'Tip: playing alone? Add a few Space Bots and start the mission.',
  ];
  $('#lobby-tip').textContent = TIPS[Math.floor(Math.random() * TIPS.length)];

  function renderLobby() {
    const s = S.room;
    const me = meP();
    $('#lobby-code').textContent = s.code;
    $('#lobby-count').textContent = `${s.players.length}/10`;
    document.body.classList.toggle('is-host', isHost());
    $('#lobby-list').innerHTML = s.players
      .map(
        (p) => `<li class="crew ${p.ready ? 'ready' : ''}">
          <span class="crew-avatar">${p.avatar}</span>
          <span class="crew-name">${esc(p.name)}${p.id === S.me ? ' <em>(you)</em>' : ''}${p.id === s.hostId ? ' <span class="tag">HOST</span>' : ''}${p.isBot ? ' <span class="tag bot">BOT</span>' : ''}</span>
          <span class="crew-status">${p.ready ? '✅ Ready' : '⏳ Not ready'}</span>
          ${isHost() && p.id !== S.me ? `<button class="icon-btn small" data-kick="${p.id}" title="Remove" aria-label="Remove ${esc(p.name)}">✕</button>` : ''}
        </li>`
      )
      .join('');
    $('#ready-btn').textContent = me && me.ready ? 'Not ready' : "I'm ready";
    $('#ready-btn').classList.toggle('on', !!(me && me.ready));
    $('#ready-btn').hidden = isHost();
    $('#set-rounds').value = s.settings.rounds;
    $('#set-time').value = s.settings.drawTime;
    $('#set-rounds').disabled = $('#set-time').disabled = !isHost();
    const allReady = s.players.every((p) => p.ready);
    $('#start-btn').disabled = s.players.length < 2 || !allReady;
    $('#start-btn').textContent = s.players.length < 2 ? 'Need 2+ players' : allReady ? 'Start Game 🚀' : 'Waiting for crew…';
  }
  $('#lobby-list').addEventListener('click', (e) => {
    const b = e.target.closest('[data-kick]');
    if (b) net.send('kick', b.dataset.kick);
  });
  $('#ready-btn').addEventListener('click', () => net.send('ready', !(meP() && meP().ready)));
  $('#addbot-btn').addEventListener('click', () => net.send('addBot'));
  $('#start-btn').addEventListener('click', () => net.send('start'));
  $('#set-rounds').addEventListener('change', (e) => net.send('settings', { rounds: +e.target.value }));
  $('#set-time').addEventListener('change', (e) => net.send('settings', { drawTime: +e.target.value }));
  $('#copy-link').addEventListener('click', async () => {
    const link = `${location.origin}${location.pathname}?room=${S.code}`;
    try {
      await navigator.clipboard.writeText(link);
      toast('Invite link copied! 🔗');
    } catch (_) {
      prompt('Copy this invite link:', link);
    }
  });

  // ═══════════════════════ 7. GAME SCREEN ═══════════════════════
  function renderGame(prev) {
    const s = S.room;
    const drawer = s.players.find((p) => p.id === s.drawerId);
    const me = meP();

    $('#round-text').textContent = `Round ${s.round} / ${s.totalRounds} · Turn ${s.turn} / ${s.totalTurns}`;
    $('#drawer-text').textContent = drawer ? (isDrawer() ? '✏️ You are drawing' : `✏️ ${drawer.name} is drawing`) : '';

    // timer ring
    const frac = s.phaseTime ? s.timeLeft / s.phaseTime : 0;
    $('#timer-bar').style.strokeDashoffset = String(119.4 * (1 - frac));
    $('#timer-text').textContent = s.timeLeft;
    $('#timer').classList.toggle('low', s.phase === 'drawing' && s.timeLeft <= 10);
    if (s.phase === 'drawing' && s.timeLeft <= 5 && s.timeLeft > 0 && S.lastTime !== s.timeLeft) Sound.tick();
    S.lastTime = s.timeLeft;

    // overlays
    $('#choose-overlay').hidden = !(s.phase === 'choosing' && isDrawer());
    const waiting = (s.phase === 'choosing' && !isDrawer()) || (s.phase === 'reveal' && !S.reveal);
    $('#wait-overlay').hidden = !waiting;
    if (waiting) $('#wait-text').textContent = s.phase === 'choosing' ? `${drawer ? drawer.name : 'The drawer'} is choosing a space object…` : 'Revealing the answer…';
    if (s.phase !== 'reveal') $('#reveal-overlay').hidden = true;
    else if (S.reveal && $('#reveal-next')) $('#reveal-next').textContent = S.reveal.isLast ? `Final results in ${s.timeLeft}s` : `Next drawer in ${s.timeLeft}s`;

    // tools
    const canDraw = s.phase === 'drawing' && isDrawer();
    document.body.classList.toggle('can-draw', canDraw);
    $('#toolbar').hidden = !isDrawer();
    $('#canvas-badge').textContent = canDraw ? 'Draw it! No letters 😉' : s.phase === 'drawing' ? 'Guess in the chat →' : '';

    // word / hint
    const box = $('#word-box');
    if (s.phase === 'drawing' && isDrawer() && S.secret) box.innerHTML = `<span class="word-label">Your object</span><strong class="secret">${esc(S.secret.object.name)}</strong>`;
    else if (s.phase === 'drawing' && s.hint) {
      const letters = s.hint.split('').map((c) => (c === ' ' ? '<i class="gap"></i>' : `<b class="${c === '_' ? 'blank' : 'shown'}">${c === '_' ? '' : esc(c)}</b>`)).join('');
      box.innerHTML = `<span class="word-label">${me && me.guessed ? '✅ You got it!' : `Guess · ${s.hint.replace(/[^_a-z0-9]/gi, '').length} letters`}</span><span class="letters">${letters}</span>`;
    } else if (s.phase === 'choosing') box.innerHTML = `<span class="word-label">Get ready</span><strong>Choosing…</strong>`;
    else if (s.phase === 'reveal' && S.reveal) box.innerHTML = `<span class="word-label">The answer was</span><strong class="secret">${esc(S.reveal.object.name)}</strong>`;

    // chat input
    const input = $('#chat-input');
    input.placeholder = isDrawer() && s.phase === 'drawing' ? 'Chat (no spoilers!)…' : me && me.guessed ? 'Chat with others who guessed…' : 'Type your guess…';

    renderPlayers();
    renderClues(s);
    renderSecret();
    if (prev && prev.phase !== s.phase && s.phase === 'drawing' && !isDrawer()) setTimeout(() => input.focus({ preventScroll: true }), 50);
  }

  function renderPlayers() {
    const s = S.room;
    const sorted = s.players.slice().sort((a, b) => b.score - a.score);
    const list = $('#game-players');
    list.innerHTML = sorted
      .map(
        (p, i) => `<li data-id="${p.id}" class="${p.id === s.drawerId ? 'drawing' : ''} ${p.guessed ? 'guessed' : ''} ${p.id === S.me ? 'me' : ''}">
          <span class="rank">#${i + 1}</span>
          <span class="pav">${p.avatar}</span>
          <span class="pname">${esc(p.name)}${p.id === S.me ? ' (you)' : ''}<small>${p.score} pts</small></span>
          <span class="pbadge">${p.id === s.drawerId ? '✏️' : p.guessed ? '✅' : p.isBot ? '🤖' : ''}</span>
        </li>`
      )
      .join('');
  }

  let clueKey = '';
  function renderClues(s) {
    const box = $('#clues');
    const clues = isDrawer() ? [] : s.clues || [];
    const key = clues.length + ':' + S.code + ':' + s.turn;
    if (key !== clueKey) {
      clueKey = key;
      box.innerHTML = clues.length
        ? `<h3>Mission clues</h3>` +
          clues
            .map((c) =>
              c.type === 'image'
                ? `<div class="clue image-clue"><span>🖼️ ${esc(c.label)}</span><div class="clue-img"><img src="${img(c.src, 420)}" alt="Blurred image clue" /></div></div>`
                : `<div class="clue"><span>${c.label === 'Category' ? '🧭' : '💡'} ${esc(c.label)}</span><p>${esc(c.text)}</p></div>`
            )
            .join('')
        : '';
    }
    const im = $('.clue-img img', box);
    if (im) {
      // sharpen the picture as the clock runs down
      const blur = Math.max(3, Math.round(4 + 18 * (s.timeLeft / (s.settings.drawTime * 0.5))));
      im.style.filter = `blur(${blur}px) saturate(1.2)`;
    }
  }

  function renderSecret() {
    const ref = $('#reference');
    const show = S.secret && S.room && S.room.phase === 'drawing' && isDrawer();
    ref.hidden = !show;
    if (show && ref.dataset.id !== S.secret.image.src) {
      ref.dataset.id = S.secret.image.src;
      const o = S.secret.object;
      ref.innerHTML = `<img src="${img(S.secret.image.src, 360)}" alt="${esc(o.name)} reference" /><div><span class="eyebrow">Reference photo · only you can see this</span><strong>${esc(o.name)}</strong><small>${esc(o.category)} · ${esc(o.clues[2])}</small></div>`;
    }
    if (!show) ref.dataset.id = '';
  }

  function showChoices(choices) {
    $('#choices').innerHTML = choices
      .map(
        (c) => `<button class="choice" data-id="${c.id}">
          <img src="${img(c.image, 300)}" alt="" />
          <strong>${esc(c.name)}</strong>
          <span>${esc(c.category)} · <span class="diff ${c.difficulty}">${c.difficulty}</span></span>
        </button>`
      )
      .join('');
    $('#choose-overlay').hidden = false;
    Sound.pop();
  }
  $('#choices').addEventListener('click', (e) => {
    const b = e.target.closest('[data-id]');
    if (!b) return;
    net.send('choose', b.dataset.id);
    $('#choose-overlay').hidden = true;
  });

  // ── chat ──
  function addChat(m) {
    const li = document.createElement('li');
    li.className = 'msg ' + m.type;
    if (m.type === 'msg' || m.type === 'secret') li.innerHTML = `<span class="who">${m.avatar || ''} ${esc(m.name)}:</span> ${esc(m.text)}`;
    else li.textContent = m.text;
    const chat = $('#chat');
    chat.appendChild(li);
    while (chat.children.length > 120) chat.firstChild.remove();
    chat.scrollTop = chat.scrollHeight;
  }
  $('#chat-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('#chat-input');
    const text = input.value.trim();
    if (!text) return;
    net.send('guess', text);
    input.value = '';
  });
  // ── Profile XP integration ──
  function awardProfileXP(amount, eventKey) {
    const points = Math.floor(Number(amount) / 10);

    if (!Number.isFinite(points) || points <= 0 || !eventKey) return;

    const ledgerKey = 'spaceskribble_game_xp_events_v1';
    const profileKey = 'spaceskribble_profile_v1';

    let ledger = [];

    try {
      const savedLedger = JSON.parse(localStorage.getItem(ledgerKey));
      ledger = Array.isArray(savedLedger) ? savedLedger : [];
    } catch (_) {
      ledger = [];
    }

    if (ledger.includes(eventKey)) return;

    let profileData = {};

    try {
      profileData = JSON.parse(localStorage.getItem(profileKey)) || {};
    } catch (_) {
      profileData = {};
    }

    profileData.name =
      profileData.name ||
      localStorage.getItem('ss-name') ||
      'Space Explorer';

    profileData.xp = Math.max(0, Number(profileData.xp) || 0) + points;

    ledger.push(eventKey);

    if (ledger.length > 500) {
      ledger = ledger.slice(-500);
    }

    try {
      localStorage.setItem(profileKey, JSON.stringify(profileData));
      localStorage.setItem(ledgerKey, JSON.stringify(ledger));

      // Refresh the profile if it is listening on this page.
      window.dispatchEvent(new Event('spaceskribble:profile-updated'));
    } catch (error) {
      console.error('Could not save profile XP:', error);
    }
  }

  // ── Score animation + Profile XP ──
  function onScore({ id, points, drawerId, drawerPoints }) {
    const scorePoints = Number(points) || 0;
    const drawPoints = Number(drawerPoints) || 0;

    const pop = (playerId, amount) => {
      if (!playerId || amount <= 0) return;

      const li = $(`#game-players li[data-id="${playerId}"]`);
      if (!li) return;

      const span = document.createElement('span');
      span.className = 'score-pop';
      span.textContent = '+' + amount;
      li.appendChild(span);

      setTimeout(() => span.remove(), 1400);
    };

    requestAnimationFrame(() => {
      pop(id, scorePoints);
      pop(drawerId, drawPoints);
    });

    // Correct guess reward for the current player.
    if (id === S.me) {
      Sound.correct();

      const burst = document.createElement('div');
      burst.className = 'burst';
      burst.innerHTML =
        `<strong>+${scorePoints}</strong><span>Correct! 🌟</span>`;

      const canvasWrap = $('#canvas-wrap');
      if (canvasWrap) {
        canvasWrap.appendChild(burst);
        setTimeout(() => burst.remove(), 1800);
      }

      if (scorePoints > 0) {
        const guessEventKey =
          `${S.code}:guess:${S.me}:${S.room?.round}:${S.room?.turn}`;

        awardProfileXP(scorePoints, guessEventKey);
      }
    } else {
      Sound.pop();
    }

    // Drawing reward for the current player.
    if (drawerId === S.me && drawPoints > 0) {
      const drawEventKey =
        `${S.code}:draw:${S.me}:${S.room?.round}:${S.room?.turn}`;

      awardProfileXP(drawPoints, drawEventKey);
    }
  }

  // ── NASA information card ──
  function nasaCardHTML(o, image, extra = '') {
    const g = gravityOf(o);
    const ball = g
      ? `<div class="ball-fact"><span>⚾</span><p>Drop a ball from 10 m: it lands in <strong>${Math.sqrt(20 / g).toFixed(2)} s</strong> here, vs <strong>1.43 s</strong> on Earth (g = 9.8 m/s²). A 40 kg kid would feel like <strong>${((40 * g) / 9.81).toFixed(1)} kg</strong>.</p></div>`
      : '';
    return `
      <div class="nasa-media">
        <img src="${img(image.src, 900)}" alt="${esc(o.name)}" />
        <small class="credit">📷 ${esc(image.credit)}</small>
      </div>
      <div class="nasa-body">
        <div class="nasa-head">
          <span class="chip" style="--accent:${o.color}">${esc(o.category)}</span>
          <span class="nasa-tag">NASA INFO CARD</span>
        </div>
        <h2>${esc(o.name)}</h2>
        <p class="nasa-desc">${esc(o.description)}</p>
        <dl class="stat-grid">${o.stats.map((s) => `<div><dt>${esc(s.label)}</dt><dd>${esc(s.value)}</dd></div>`).join('')}</dl>
        ${ball}
        <h4>✨ Interesting facts</h4>
        <ul class="facts">${o.interestingFacts.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>
        <h4>🔭 How to observe it</h4>
        <p>${esc(o.observationGuide)}</p>
        <a class="nasa-link" href="${esc(o.nasaReference.url)}" target="_blank" rel="noopener">📚 ${esc(o.nasaReference.title)} ↗</a>
        ${extra}
      </div>`;
  }

  function showReveal(r) {
    const results = r.results.length
      ? r.results.map((x) => `<li><span>${x.avatar} ${esc(x.name)}</span><b>+${x.points}</b></li>`).join('')
      : '<li class="none">Nobody guessed this one — tricky!</li>';
    const drawerLine = r.drawer ? `<li class="drawer"><span>✏️ ${r.drawer.avatar} ${esc(r.drawer.name)} (drawer)</span><b>+${r.drawer.points}</b></li>` : '';
    const extra = `<div class="round-results"><h4>🏁 Round results</h4><ul>${results}${drawerLine}</ul><div class="next" id="reveal-next">Next drawer soon…</div></div>`;
    $('#nasa-card').innerHTML = nasaCardHTML(r.object, r.image, extra);
    $('#nasa-card').scrollTop = 0;
    $('#reveal-overlay').hidden = false;
    $('#wait-overlay').hidden = true;
    $('#choose-overlay').hidden = true;
  }

  $('#mute-btn').textContent = Sound.muted ? '🔇' : '🔊';
  $('#mute-btn').addEventListener('click', () => {
    Sound.muted = !Sound.muted;
    localStorage.setItem('ss-muted', Sound.muted ? '1' : '0');
    $('#mute-btn').textContent = Sound.muted ? '🔇' : '🔊';
  });

  // ═══════════════════════ 8. DRAWING CANVAS ═══════════════════════
  const COLORS = ['#ffffff', '#ffd166', '#ffb703', '#ff8a3d', '#ef476f', '#ff99c8', '#c77dff', '#8b5cf6', '#5ce1ff', '#4d96ff', '#06d6a0', '#8d6e63', '#9aa5b1', '#11152c'];
  const SIZES = [3, 7, 14, 26];
  const Board = {
    canvas: $('#board'),
    strokes: [],
    color: '#ffffff',
    size: 7,
    tool: 'brush',
    current: null,
    buffer: [],
    init() {
      this.ctx = this.canvas.getContext('2d');
      this.W = this.canvas.width;
      this.H = this.canvas.height;
      $('#colors').innerHTML = COLORS.map((c, i) => `<button class="swatch ${i === 0 ? 'active' : ''}" style="--c:${c}" data-color="${c}" aria-label="Color ${c}"></button>`).join('');
      $('#sizes').innerHTML = SIZES.map((s) => `<button class="size ${s === this.size ? 'active' : ''}" data-size="${s}" aria-label="Brush size ${s}"><i style="width:${Math.max(4, s * 0.9)}px;height:${Math.max(4, s * 0.9)}px"></i></button>`).join('');
      $('#colors').addEventListener('click', (e) => {
        const b = e.target.closest('[data-color]');
        if (!b) return;
        this.color = b.dataset.color;
        this.setTool('brush');
        $$('#colors .swatch').forEach((x) => x.classList.toggle('active', x === b));
      });
      $('#sizes').addEventListener('click', (e) => {
        const b = e.target.closest('[data-size]');
        if (!b) return;
        this.size = +b.dataset.size;
        $$('#sizes .size').forEach((x) => x.classList.toggle('active', x === b));
      });
      $$('[data-tool]').forEach((b) => b.addEventListener('click', () => this.setTool(b.dataset.tool)));
      $('#undo-btn').addEventListener('click', () => this.undo());
      $('#clear-btn').addEventListener('click', () => this.clear());

      const c = this.canvas;
      c.addEventListener('pointerdown', (e) => this.down(e));
      c.addEventListener('pointermove', (e) => this.move(e));
      ['pointerup', 'pointercancel', 'pointerleave'].forEach((t) => c.addEventListener(t, () => this.up()));
      setInterval(() => this.flush(), 40);

      addEventListener('keydown', (e) => {
        if (!document.body.classList.contains('can-draw') || e.target.matches('input, textarea, select')) return;
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
          e.preventDefault();
          this.undo();
        } else if (e.key === 'b') this.setTool('brush');
        else if (e.key === 'e') this.setTool('eraser');
      });
    },
    setTool(t) {
      this.tool = t;
      $$('[data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === t));
      this.canvas.classList.toggle('erasing', t === 'eraser');
    },
    pos(e) {
      const r = this.canvas.getBoundingClientRect();
      return [Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), Math.max(0, Math.min(1, (e.clientY - r.top) / r.height))];
    },
    canDraw() {
      return document.body.classList.contains('can-draw');
    },
    down(e) {
      if (!this.canDraw()) return;
      e.preventDefault();
      this.canvas.setPointerCapture(e.pointerId);
      const [x, y] = this.pos(e);
      const st = { id: rid(), c: this.color, s: this.size, e: this.tool === 'eraser', pts: [[x, y]] };
      this.current = st;
      this.strokes.push(st);
      this.drawStroke(st, 0);
      net.send('draw', { k: 'b', id: st.id, c: st.c, s: st.s, e: st.e, x, y });
    },
    move(e) {
      if (!this.current) return;
      const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      for (const ev of events) {
        const p = this.pos(ev);
        const last = this.current.pts[this.current.pts.length - 1];
        if (Math.hypot(p[0] - last[0], p[1] - last[1]) < 0.0015) continue;
        this.current.pts.push(p);
        this.buffer.push(p);
        this.drawStroke(this.current, this.current.pts.length - 2);
      }
    },
    up() {
      this.flush();
      this.current = null;
    },
    flush() {
      if (!this.current || !this.buffer.length) return;
      net.send('draw', { k: 'p', id: this.current.id, pts: this.buffer.splice(0, 64) });
    },
    undo() {
      if (!this.canDraw()) return;
      this.strokes.pop();
      this.redraw();
      net.send('draw', { k: 'u' });
    },
    clear() {
      if (!this.canDraw()) return;
      this.strokes = [];
      this.redraw();
      net.send('draw', { k: 'c' });
    },
    // apply an op from the network
    apply(op) {
      if (op.k === 'b') {
        const st = { id: op.id, c: op.c, s: op.s, e: op.e, pts: [[op.x, op.y]] };
        this.strokes.push(st);
        this.drawStroke(st, 0);
      } else if (op.k === 'p') {
        const st = this.strokes[this.strokes.length - 1];
        if (!st || st.id !== op.id) return;
        const from = st.pts.length - 1;
        st.pts.push(...op.pts);
        this.drawStroke(st, from);
      } else if (op.k === 'u') {
        this.strokes.pop();
        this.redraw();
      } else if (op.k === 'c') {
        this.strokes = [];
        this.redraw();
      }
    },
    drawStroke(st, from) {
      const { ctx, W, H } = this;
      const lw = st.s * (W / 800);
      ctx.save();
      ctx.globalCompositeOperation = st.e ? 'destination-out' : 'source-over';
      ctx.strokeStyle = ctx.fillStyle = st.c;
      ctx.lineWidth = lw;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      if (st.pts.length === 1 || from < 0) {
        const [x, y] = st.pts[0];
        ctx.beginPath();
        ctx.arc(x * W, y * H, lw / 2, 0, Math.PI * 2);
        ctx.fill();
        from = 0;
      }
      if (st.pts.length > 1) {
        ctx.beginPath();
        ctx.moveTo(st.pts[from][0] * W, st.pts[from][1] * H);
        for (let i = from + 1; i < st.pts.length; i++) ctx.lineTo(st.pts[i][0] * W, st.pts[i][1] * H);
        ctx.stroke();
      }
      ctx.restore();
    },
    redraw() {
      this.ctx.clearRect(0, 0, this.W, this.H);
      for (const st of this.strokes) this.drawStroke(st, 0);
    },
  };
  Board.init();

  // ═══════════════════════ 9. GAME OVER ═══════════════════════
  function showOver(board) {
    show('over');
    const w = board[0];
    $('#winner-title').innerHTML = w ? `${w.avatar} ${esc(w.name)} wins!` : 'Mission complete!';
    const order = [board[1], board[0], board[2]];
    $('#podium').innerHTML = order
      .map((p, i) => (p ? `<div class="step step-${[2, 1, 3][i]}"><span class="pav">${p.avatar}</span><strong>${esc(p.name)}</strong><span>${p.score} pts</span><div class="block">${[2, 1, 3][i]}</div></div>` : '<div class="step empty"></div>'))
      .join('');
    $('#final-table').innerHTML = board
      .map((p, i) => `<tr class="${p.id === S.me ? 'me' : ''}"><td>${i + 1}</td><td>${p.avatar} ${esc(p.name)}${p.isBot ? ' 🤖' : ''}</td><td><strong>${p.score}</strong></td><td>${p.correct}</td><td>${p.drawings}</td></tr>`)
      .join('');
    renderOverActions();
    Sound.win();
    confetti();
  }
  function renderOverActions() {
    $('#again-btn').hidden = !isHost();
    $('#again-wait').hidden = isHost();
  }
  $('#again-btn').addEventListener('click', () => net.send('playAgain'));

  function confetti() {
    if (reduceMotion) return;
    const c = $('#confetti');
    const ctx = c.getContext('2d');
    c.width = innerWidth;
    c.height = innerHeight;
    const colors = ['#ffd166', '#ff8a3d', '#5ce1ff', '#c77dff', '#06d6a0', '#ffffff'];
    const parts = Array.from({ length: 160 }, () => ({
      x: innerWidth / 2 + (Math.random() - 0.5) * 200,
      y: innerHeight * 0.35,
      vx: (Math.random() - 0.5) * 14,
      vy: -Math.random() * 14 - 4,
      r: Math.random() * 5 + 3,
      c: colors[Math.floor(Math.random() * colors.length)],
      star: Math.random() < 0.4,
      rot: Math.random() * 6,
    }));
    const start = performance.now();
    (function frame(now) {
      ctx.clearRect(0, 0, c.width, c.height);
      for (const p of parts) {
        p.vy += 0.3; // a little gravity, of course
        p.x += p.vx;
        p.y += p.vy;
        p.rot += 0.1;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.c;
        if (p.star) {
          ctx.beginPath();
          for (let i = 0; i < 10; i++) {
            const r = i % 2 ? p.r * 0.45 : p.r * 1.3;
            const a = (i / 10) * Math.PI * 2;
            ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
          }
          ctx.fill();
        } else ctx.fillRect(-p.r / 2, -p.r / 2, p.r, p.r * 1.6);
        ctx.restore();
      }
      if (now - start < 4500) requestAnimationFrame(frame);
      else ctx.clearRect(0, 0, c.width, c.height);
    })(start);
  }
})();
