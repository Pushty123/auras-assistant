/* =============================================================================
   aura-ui.js — AURA onboarding, living avatar, settings and speech hooks.

   Load order matters:  <script src="aura-ui.js"></script>
                        <script src="aura.js"></script>

   Why before aura.js?  This file wraps speechSynthesis.speak() and the
   SpeechRecognition constructor *before* aura.js uses them. That lets the
   avatar lip-sync to whatever aura.js says and react when it listens, without
   changing a single line of aura.js.

   After the page has loaded, it:
     • wraps toggleSettings() so it opens the new Settings panel
     • wraps toggleMic() to show a friendly mic explainer the first time
     • adds fallbacks for toggleMic/toggleContacts/addContact ONLY if aura.js
       did not define them (so the UI still works standalone)
   Nothing in aura.js is renamed, removed or edited.
   ========================================================================== */
(function () {
    'use strict';

    /* -------------------------------------------------------------------------
       0. Small helpers
       ---------------------------------------------------------------------- */
    const $ = (s, r = document) => r.querySelector(s);
    const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
    const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
    const rand = (a, b) => a + Math.random() * (b - a);
    const reduceMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    function hash(str) { let h = 5381; for (const ch of String(str).toLowerCase().replace(/[^a-z]/g, '')) h = ((h << 5) + h + ch.charCodeAt(0)) >>> 0; return h; }
    function shade(hex, amt) { // amt -100..100
        const n = parseInt(hex.slice(1), 16);
        const f = c => clamp(Math.round(c + (amt / 100) * (amt > 0 ? 255 - c : c)), 0, 255);
        const r = f(n >> 16), g = f((n >> 8) & 255), b = f(n & 255);
        return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
    }

    /* -------------------------------------------------------------------------
       1. Saved profile (localStorage only)
       ---------------------------------------------------------------------- */
    const KEY = 'aura.profile.v1';
    const DEFAULTS = {
        termsAccepted: false, account: null, setupDone: false,
        gender: 'her', faceId: 'h1', personaId: 'mira', callName: '',
        voiceURI: '', rate: 1, autoSpeak: true, notif: false, micExplained: false
    };
    let profile = Object.assign({}, DEFAULTS);
    try { Object.assign(profile, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) { /* private mode */ }
    function save() { try { localStorage.setItem(KEY, JSON.stringify(profile)); } catch (e) { /* ignore */ } }

    /* -------------------------------------------------------------------------
       2. Faces & personalities (all original, stylised — no real people)
       ---------------------------------------------------------------------- */
    const SKIN = ['#FBDCC6', '#F0C29C', '#D9A077', '#B77A52', '#8C5A3A', '#5C3A26'];
    const FACES = [
        { id: 'h1', g: 'her', skin: 0, hair: 'long',  hc: '#3a2418', eye: '#5a3b2a' },
        { id: 'h2', g: 'her', skin: 3, hair: 'curly', hc: '#1b1212', eye: '#3a2618' },
        { id: 'h3', g: 'her', skin: 1, hair: 'bob',   hc: '#c0703a', eye: '#3f6b3a' },
        { id: 'h4', g: 'her', skin: 5, hair: 'bun',   hc: '#111018', eye: '#2b1a10' },
        { id: 'h5', g: 'her', skin: 2, hair: 'braid', hc: '#2a1a12', eye: '#4a3020' },
        { id: 'h6', g: 'her', skin: 4, hair: 'pixie', hc: '#7b3cff', eye: '#2b1a10' },
        { id: 'm1', g: 'him', skin: 1, hair: 'quiff', hc: '#2a1a12', eye: '#4a3020' },
        { id: 'm2', g: 'him', skin: 4, hair: 'curly', hc: '#111018', eye: '#2b1a10' },
        { id: 'm3', g: 'him', skin: 0, hair: 'waves', hc: '#b8894a', eye: '#3b5a7a' },
        { id: 'm4', g: 'him', skin: 5, hair: 'buzz',  hc: '#0d0c12', eye: '#2b1a10' },
        { id: 'm5', g: 'him', skin: 2, hair: 'beard', hc: '#2b1b12', eye: '#4a3020' },
        { id: 'm6', g: 'him', skin: 3, hair: 'short', hc: '#3b2a20', eye: '#3a2618', glasses: true }
    ];
    const PERSONAS = [
        { id: 'mira',  name: 'Mira',  tag: 'Your supportive best friend',      expr: 'warm',     pitch: 1.1,  rate: 1.0,
          leads: ['Aww, ', 'Of course! ', "I've got you. "],
          greet: n => `Hey ${n}! I'm Aura, and I'm really glad you're here. Tap the mic whenever you want to talk.` },
        { id: 'rook',  name: 'Rook',  tag: 'A focused coach who keeps you on track', expr: 'focused', pitch: 0.92, rate: 1.05,
          leads: ['Right. ', 'On it. ', 'Noted. '],
          greet: n => `${n}, Aura here. Let's make today count. Tap the mic and give me the first task.` },
        { id: 'quill', name: 'Quill', tag: 'A curious geek who loves the details', expr: 'curious', pitch: 1.05, rate: 1.07,
          leads: ['Ooh, interesting. ', 'Curious! ', "Let's see. "],
          greet: n => `Hi ${n}! I'm Aura. I love a good question, so ask me anything.` },
        { id: 'ziggy', name: 'Ziggy', tag: 'A playful joker who keeps it light', expr: 'playful', pitch: 1.15, rate: 1.1,
          leads: ['Ha! ', 'Say no more! ', 'Ta-da! '],
          greet: n => `Well hello, ${n}! Aura reporting for fun. Hit the mic and let's go.` },
        { id: 'sol',   name: 'Sol',   tag: 'A calm guide for slower, clearer days', expr: 'calm', pitch: 0.95, rate: 0.9,
          leads: ['Gently. ', 'Of course. ', 'Breathe. '],
          greet: n => `Hello ${n}. I'm Aura. Whenever you're ready, just tap the mic.` }
    ];
    const face = () => FACES.find(f => f.id === profile.faceId) || FACES[0];
    const persona = () => PERSONAS.find(p => p.id === profile.personaId) || PERSONAS[0];
    const facesFor = g => FACES.filter(f => f.g === g);

    /* Expressions: brow offset/rotation, resting mouth, eye openness, blush, head tilt */
    const EXPR = {
        warm:    { bl: [-3, -4], br: [-3, 4],  rest: 'smile',   eyeRy: 6.2, blush: .55, tilt: 0,  squint: true },
        focused: { bl: [2, 8],   br: [2, -8],  rest: 'neutral', eyeRy: 6.4, blush: .12, tilt: 0 },
        curious: { bl: [-7, -6], br: [0, 0],   rest: 'soft',    eyeRy: 7.4, blush: .3,  tilt: 4 },
        playful: { bl: [-5, -8], br: [-5, 8], rest: 'grin',    eyeRy: 6.6, blush: .45, tilt: -3 },
        calm:    { bl: [-1, -2], br: [-1, 2],  rest: 'soft',    eyeRy: 4.4, blush: .3,  tilt: 0 }
    };
    /* Mouth shapes (visemes). f = filled (open mouth) */
    const MOUTH = {
        closed:  { d: 'M89 159 Q100 161 111 159', f: false },
        neutral: { d: 'M88 159 Q100 162 112 159', f: false },
        soft:    { d: 'M88 157 Q100 164 112 157', f: false },
        smile:   { d: 'M85 155 Q100 168 115 155', f: false },
        grin:    { d: 'M83 154 Q100 158 117 154 Q112 172 100 172 Q88 172 83 154Z', f: true },
        O:       { d: 'M94 159 A6 8 0 1 0 106 159 A6 8 0 1 0 94 159Z', f: true },
        A:       { d: 'M88 155 Q100 152 112 155 Q109 173 100 173 Q91 173 88 155Z', f: true },
        E:       { d: 'M84 156 Q100 153 116 156 Q108 167 100 167 Q92 167 84 156Z', f: true },
        wide:    { d: 'M82 154 Q100 157 118 154 Q113 170 100 170 Q87 170 82 154Z', f: true }
    };

    /* -------------------------------------------------------------------------
       3. Face SVG builder — separate head, hair, eyes, brows and mouth parts
       ---------------------------------------------------------------------- */
    let uidN = 0;
    function hairParts(f, hf) {
        const cap = `<path fill="${hf}" d="M52 112 Q48 54 100 52 Q152 54 148 112 Q146 86 130 76 Q100 88 70 76 Q54 86 52 112Z"/>`;
        const circles = (list, r) => list.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${hf}"/>`).join('');
        switch (f.hair) {
            case 'long': return {
                back: `<path fill="${hf}" d="M47 114 Q40 50 100 48 Q160 50 153 114 L160 212 Q132 222 120 200 L80 200 Q68 222 40 212Z"/>`,
                front: `<path fill="${hf}" d="M51 120 Q44 52 100 50 Q156 52 150 120 Q148 86 124 72 Q100 96 62 90 Q54 100 51 120Z"/>` };
            case 'bob': return {
                back: `<path fill="${hf}" d="M45 112 Q40 48 100 46 Q160 48 155 112 L158 164 Q146 172 138 160 L62 160 Q54 172 42 164Z"/>`,
                front: `<path fill="${hf}" d="M50 112 Q46 52 100 50 Q154 52 150 112 L148 90 Q140 84 128 86 L72 86 Q60 84 52 90Z"/>` };
            case 'bun': return { back: `<circle cx="100" cy="42" r="19" fill="${hf}"/>`, front: cap };
            case 'curly': {
                const big = f.g === 'her';
                const ring = []; for (let a = 150; a <= 390; a += 20) { const t = a * Math.PI / 180; ring.push([100 + (big ? 58 : 50) * Math.cos(t), (big ? 104 : 96) + (big ? 56 : 44) * Math.sin(t)]); }
                const line = []; for (let x = 60; x <= 140; x += big ? 13 : 11) line.push([x, (big ? 76 : 68) + Math.pow((x - 100) / 42, 2) * 14]);
                return {
                    back: (big ? `<ellipse cx="100" cy="118" rx="64" ry="62" fill="${hf}"/>` : '') + circles(ring, big ? 16 : 11),
                    front: circles(line, big ? 12 : 10) };
            }
            case 'braid': {
                let b = ''; for (let y = 138; y <= 222; y += 14) b += `<ellipse cx="${149 - (y - 138) * .06}" cy="${y}" rx="9" ry="9" fill="${hf}" stroke="${shade(f.hc, -30)}" stroke-width="1"/>`;
                return { back: `<path fill="${hf}" d="M48 112 Q42 50 100 48 Q158 50 152 112 L152 134 L48 124Z"/>`,
                    front: `<path fill="${hf}" d="M51 118 Q44 52 100 50 Q156 52 150 118 Q146 84 122 72 Q98 92 62 88 Q54 98 51 118Z"/>` + b };
            }
            case 'pixie': return { back: '', front: `<path fill="${hf}" d="M52 108 Q48 52 104 50 Q152 54 150 104 Q140 74 112 74 Q86 76 66 94 Q56 100 52 108Z"/>` };
            case 'quiff': return { back: '', front: cap + `<path fill="${hf}" d="M64 76 Q64 34 108 36 Q142 40 138 76 Q120 64 100 70 Q80 64 64 76Z"/>` };
            case 'waves': return { back: '', front: `<path fill="${hf}" d="M52 112 Q48 52 100 50 Q152 52 148 112 Q146 88 136 80 Q126 92 114 82 Q102 94 90 82 Q78 94 66 82 Q56 90 52 112Z"/>` };
            case 'buzz': return { back: '', front: `<path fill="${hf}" opacity=".92" d="M54 104 Q52 58 100 56 Q148 58 146 104 Q138 78 100 74 Q62 78 54 104Z"/>` };
            case 'beard': return { back: '', front: cap, beard:
                `<path fill="${hf}" d="M52 124 Q54 176 100 184 Q146 176 148 124 Q146 156 128 164 Q114 156 100 157 Q86 156 72 164 Q54 156 52 124Z"/>` +
                `<path fill="${hf}" d="M86 151 Q100 144 114 151 Q100 155 86 151Z"/>` };
            default: return { back: '', front: cap };
        }
    }

    function faceSVG(f, p, opts = {}) {
        const u = 'a' + (++uidN);
        const skin = SKIN[f.skin], x = EXPR[p.expr];
        const hf = `url(#hr-${u})`;
        const hair = hairParts(f, hf);
        const lip = f.g === 'her' ? '#b8445e' : '#7a3340';
        const m = MOUTH[x.rest];
        const eye = (cx, side) => `
            <g class="eye ${side}">
                <ellipse cx="${cx}" cy="118" rx="8.6" ry="${x.eyeRy}" fill="#f6f2ff"/>
                <g class="pupils"><circle cx="${cx}" cy="118.4" r="4.7" fill="${f.eye}"/><circle cx="${cx}" cy="118.4" r="2.3" fill="#120a14"/><circle cx="${cx - 1.6}" cy="116.6" r="1.3" fill="#fff"/></g>
                ${f.g === 'her' ? `<path d="M${cx - 9.5} ${117 - x.eyeRy * .6} Q${cx} ${110 - x.eyeRy * .5} ${cx + 9.5} ${117 - x.eyeRy * .6}" fill="none" stroke="${shade(f.hc === '#7b3cff' ? '#1a1020' : f.hc, -40)}" stroke-width="2.4" stroke-linecap="round"/>` : ''}
            </g>`;
        const brow = (x1, [dy, rot], cx) => `<path d="M${x1} 102 Q${x1 + 9} 97 ${x1 + 18} 101" transform="translate(0 ${dy}) rotate(${rot} ${cx} 100)" fill="none" stroke="${shade(f.hc === '#7b3cff' ? '#3a2240' : f.hc, -15)}" stroke-width="${f.g === 'him' ? 3.8 : 3}" stroke-linecap="round"/>`;
        return `
<svg class="av${opts.static ? ' static' : ''}" viewBox="0 0 200 240" role="img" aria-label="${esc(opts.label || 'Aura avatar')}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="sk-${u}" cx=".38" cy=".32" r=".8"><stop offset="0" stop-color="${shade(skin, 22)}"/><stop offset=".7" stop-color="${skin}"/><stop offset="1" stop-color="${shade(skin, -14)}"/></radialGradient>
    <linearGradient id="hr-${u}" x1="0" y1="0" x2=".3" y2="1"><stop offset="0" stop-color="${shade(f.hc, 26)}"/><stop offset="1" stop-color="${f.hc}"/></linearGradient>
    <linearGradient id="cl-${u}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5b2de0"/><stop offset=".6" stop-color="#a633e8"/><stop offset="1" stop-color="#ff3fb4"/></linearGradient>
  </defs>
  <g class="av-body">
    <path fill="url(#cl-${u})" d="M26 240 Q30 200 78 192 Q100 206 122 192 Q170 200 174 240Z"/>
    <path fill="none" stroke="rgba(255,255,255,.28)" stroke-width="1.5" d="M78 192 Q100 212 122 192"/>
    <path fill="${shade(skin, -12)}" d="M86 158 L86 196 Q100 205 114 196 L114 158Z"/>
    <g class="av-head"><g transform="rotate(${x.tilt} 100 170)">
      ${hair.back}
      <ellipse cx="51" cy="122" rx="7" ry="11" fill="${shade(skin, -6)}"/><ellipse cx="149" cy="122" rx="7" ry="11" fill="${shade(skin, -6)}"/>
      <ellipse cx="100" cy="116" rx="49" ry="58" fill="url(#sk-${u})" stroke="rgba(190,150,255,.35)" stroke-width="1.2"/>
      ${hair.beard || ''}
      <circle cx="72" cy="140" r="9" fill="#ff6f9f" opacity="${x.blush * .5}"/><circle cx="128" cy="140" r="9" fill="#ff6f9f" opacity="${x.blush * .5}"/>
      ${eye(80, 'l')}${eye(120, 'r')}
      ${x.squint ? `<path fill="${skin}" d="M70 122 Q80 117 90 122 L90 127 L70 127Z"/><path fill="${skin}" d="M110 122 Q120 117 130 122 L130 127 L110 127Z"/>` : ''}
      ${brow(71, x.bl, 80)}${brow(111, x.br, 120)}
      <path d="M100 125 Q96 136 100 139 Q103 140 105 138" fill="none" stroke="${shade(skin, -28)}" stroke-width="2" stroke-linecap="round"/>
      <path class="mouth" d="${m.d}" fill="${m.f ? '#4a1224' : 'none'}" stroke="${lip}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
      ${hair.front}
      ${f.glasses ? `<g fill="rgba(255,255,255,.08)" stroke="#1b1330" stroke-width="2.4"><circle cx="80" cy="118" r="12"/><circle cx="120" cy="118" r="12"/><path fill="none" d="M92 116 Q100 112 108 116"/></g>` : ''}
    </g></g>
  </g>
</svg>`;
    }

    /* -------------------------------------------------------------------------
       4. Living avatar controller: blink, glances, lip-sync, fallbacks
       ---------------------------------------------------------------------- */
    const Avatar = {
        host: null, svg: null, mouth: null, pupils: [], card: null, state: 'idle',
        speaking: false, gotBoundary: false, flapT: null, closeT: null, lifeT: [], endT: null,

        mount(host, card) { this.host = host; this.card = card; this.render(); },
        render() {
            if (!this.host) return;
            this.host.innerHTML = faceSVG(face(), persona(), { label: `Aura, ${persona().name} personality` });
            this.svg = this.host.querySelector('svg');
            this.mouth = this.svg.querySelector('.mouth');
            this.pupils = $$('.pupils', this.svg);
            this.startLife();
        },
        rest() { return EXPR[persona().expr].rest; },
        setMouth(name) {
            const m = MOUTH[name] || MOUTH.closed;
            if (!this.mouth) return;
            this.mouth.setAttribute('d', m.d);
            this.mouth.setAttribute('fill', m.f ? '#4a1224' : 'none');
        },
        setState(s) {
            this.state = s;
            if (this.card) this.card.dataset.state = s;
            const label = $('#avState');
            if (label) label.textContent = s === 'listening' ? 'LISTENING…' : s === 'speaking' ? 'SPEAKING' : 'AURA';
        },
        /* Idle life: random blinks + small eye movements (breathing/sway are CSS) */
        startLife() {
            this.lifeT.forEach(clearTimeout); this.lifeT = [];
            const blink = () => {
                if (!this.svg) return;
                const wink = persona().expr === 'playful' && Math.random() < .12;
                this.svg.classList.add(wink ? 'wink' : 'blink');
                setTimeout(() => this.svg && this.svg.classList.remove('blink', 'wink'), wink ? 260 : 130);
                this.lifeT[0] = setTimeout(blink, rand(2400, 5800));
            };
            const look = () => {
                const dx = this.state === 'listening' ? 0 : rand(-2.2, 2.2), dy = this.state === 'listening' ? -.6 : rand(-1.2, 1.2);
                this.pupils.forEach(p => p.setAttribute('transform', `translate(${dx.toFixed(2)} ${dy.toFixed(2)})`));
                this.lifeT[1] = setTimeout(look, rand(1800, 4200));
            };
            this.lifeT[0] = setTimeout(blink, rand(1200, 3000));
            if (!reduceMotion) this.lifeT[1] = setTimeout(look, 1500);
        },
        /* Speech lifecycle */
        speakStart() {
            clearTimeout(this.endT);
            this.speaking = true; this.gotBoundary = false; this.setState('speaking');
            clearTimeout(this.flapGuard);
            // Many voices never fire boundary events → fall back to a timed mouth flap
            this.flapGuard = setTimeout(() => { if (this.speaking && !this.gotBoundary) this.startFlap(); }, 380);
        },
        boundary(charIndex, text) {
            this.gotBoundary = true; this.stopFlap();
            const word = (String(text).slice(charIndex || 0).match(/[A-Za-z']+/) || [''])[0].toLowerCase();
            const v = (word.match(/[aeiouy]/) || ['a'])[0];
            this.setMouth(v === 'a' ? 'A' : v === 'o' || v === 'u' ? 'O' : v === 'e' || v === 'i' || v === 'y' ? 'E' : 'A');
            clearTimeout(this.closeT);
            const len = word.length;
            this.closeT = setTimeout(() => this.setMouth(len > 5 ? 'wide' : 'closed'), clamp(70 + len * 22, 90, 240));
        },
        speakEnd() {
            this.speaking = false; this.stopFlap(); clearTimeout(this.closeT); clearTimeout(this.flapGuard);
            this.setMouth(this.rest());
            this.setState(UI.listeningNow ? 'listening' : 'idle');
        },
        startFlap() {
            this.stopFlap();
            const seq = ['A', 'closed', 'O', 'E', 'closed', 'A', 'wide', 'closed'];
            let i = 0;
            this.flapT = setInterval(() => this.setMouth(seq[(i++ + (Math.random() * 3 | 0)) % seq.length]), 115);
        },
        stopFlap() { clearInterval(this.flapT); this.flapT = null; },
        /* Fallback when no speech API: animate for roughly the reading time */
        fakeTalk(text) {
            this.speakStart(); this.startFlap();
            clearTimeout(this.endT);
            this.endT = setTimeout(() => this.speakEnd(), clamp(String(text).length * 55, 900, 7000));
        },
        /* Optional: lip-sync from real audio loudness (e.g. a cloud TTS <audio>).
           speechSynthesis output can't be routed into Web Audio, so this is for
           when you switch to an audio-file voice later: Avatar.driveFromAudio(el) */
        driveFromAudio(audioEl) {
            const AC = window.AudioContext || window.webkitAudioContext;
            if (!AC) return false;
            const ctx = new AC(), src = ctx.createMediaElementSource(audioEl), an = ctx.createAnalyser();
            an.fftSize = 512; src.connect(an); an.connect(ctx.destination);
            const buf = new Uint8Array(an.fftSize);
            const tick = () => {
                if (audioEl.paused || audioEl.ended) { this.speakEnd(); return; }
                an.getByteTimeDomainData(buf);
                let sum = 0; for (const v of buf) sum += ((v - 128) / 128) ** 2;
                const rms = Math.sqrt(sum / buf.length);
                this.gotBoundary = true;
                this.setMouth(rms > .18 ? 'A' : rms > .11 ? 'wide' : rms > .05 ? 'O' : 'closed');
                requestAnimationFrame(tick);
            };
            audioEl.addEventListener('play', () => { ctx.resume(); this.speakStart(); tick(); });
            return true;
        }
    };
    window.AuraAvatar = Avatar; // handy for future integrations

    /* -------------------------------------------------------------------------
       5. Personality tone layer — a short, deterministic opener per reply
       ---------------------------------------------------------------------- */
    function leadFor(text) {
        const p = persona(), t = String(text || '').trim();
        if (!t || p.leads.some(l => t.startsWith(l.trim()))) return '';
        const h = hash(t);
        return h % 3 === 0 ? '' : p.leads[h % p.leads.length];
    }

    /* -------------------------------------------------------------------------
       6. Speech hooks — installed immediately, before aura.js runs
       ---------------------------------------------------------------------- */
    const synth = window.speechSynthesis || null;
    let lastUtterAt = 0, voices = [];
    let onVoices = null; // set once the Settings panel exists
    function loadVoices() { try { voices = synth ? synth.getVoices() : []; } catch (e) { voices = []; } if (onVoices) onVoices(); }

    if (synth && typeof synth.speak === 'function') {
        const origSpeak = synth.speak.bind(synth);
        synth.speak = function (u) {
            try {
                const p = persona();
                if (!u.__aura) { const lead = leadFor(u.text); if (lead) u.text = lead + u.text; }
                const v = profile.voiceURI && voices.find(x => x.voiceURI === profile.voiceURI);
                if (v) { u.voice = v; u.lang = v.lang; }
                u.rate = clamp((u.rate || 1) * profile.rate * p.rate, .5, 2);
                u.pitch = clamp((u.pitch || 1) * p.pitch, 0, 2);
                u.addEventListener('start', () => Avatar.speakStart());
                u.addEventListener('boundary', e => { if (!e.name || e.name === 'word') Avatar.boundary(e.charIndex, u.text); });
                const done = () => setTimeout(() => { if (!synth.speaking) Avatar.speakEnd(); }, 80);
                u.addEventListener('end', done); u.addEventListener('error', done);
            } catch (e) { /* never block speech */ }
            lastUtterAt = Date.now();
            return origSpeak(u);
        };
        loadVoices();
        if ('onvoiceschanged' in synth) synth.addEventListener('voiceschanged', loadVoices);
    }

    /* Wrap SpeechRecognition so the avatar knows when Aura is listening */
    ['SpeechRecognition', 'webkitSpeechRecognition'].forEach(k => {
        const Orig = window[k];
        if (typeof Orig !== 'function') return;
        function Hooked() {
            const r = new Orig();
            r.addEventListener('start', () => UI.setListening(true, true));
            r.addEventListener('end', () => UI.setListening(false, true));
            r.addEventListener('error', () => UI.setListening(false, true));
            return r;
        }
        Hooked.prototype = Orig.prototype;
        window[k] = Hooked;
    });

    /* Speak something as Aura (used for our own lines and auto-read replies) */
    function speakAura(text) {
        if (!synth || typeof SpeechSynthesisUtterance === 'undefined') { Avatar.fakeTalk(text); return; }
        const u = new SpeechSynthesisUtterance(text);
        u.__aura = true;
        synth.speak(u);
    }

    /* -------------------------------------------------------------------------
       7. UI state shared across modules
       ---------------------------------------------------------------------- */
    const UI = {
        listeningNow: false, hookSeen: false,
        setListening(on, fromHook) {
            if (fromHook) this.hookSeen = true;
            this.listeningNow = on;
            const mic = document.getElementById('micButton');
            if (mic) mic.classList.toggle('is-listening', on);
            if (!Avatar.speaking) Avatar.setState(on ? 'listening' : 'idle');
        }
    };

    function toast(msg, ms = 2800) {
        const t = $('#toast'); if (!t) return;
        t.textContent = msg; t.classList.add('open');
        clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('open'), ms);
    }

    /* -------------------------------------------------------------------------
       8. Screen manager
       ---------------------------------------------------------------------- */
    let current = 'opening';
    function go(name) {
        if (name === current) return;
        const from = $(`.scr[data-screen="${current}"]`), to = $(`.scr[data-screen="${name}"]`);
        if (!to) return;
        if (from) { from.classList.remove('active'); from.classList.add('leaving'); setTimeout(() => from.classList.remove('leaving'), 700); }
        to.classList.add('active');
        $('#app').dataset.screen = name;
        current = name;
        to.setAttribute('tabindex', '-1');
        setTimeout(() => to.focus({ preventScroll: true }), 60);
        if (name === 'home') enterHome();
    }

    /* -------------------------------------------------------------------------
       9. Onboarding flow
       ---------------------------------------------------------------------- */
    function nextAfterLoading() {
        if (!profile.termsAccepted) return go('terms');
        if (!profile.account) return go('signin');
        go('welcome');
    }

    function runOpening() {
        let advanced = false;
        const advance = () => { if (advanced) return; advanced = true; go('loading'); runLoading(); };
        setTimeout(advance, reduceMotion ? 1200 : 3200);
        $('.scr.opening').addEventListener('click', advance);
        document.addEventListener('keydown', function k(e) { if (current === 'opening' && (e.key === 'Enter' || e.key === ' ')) { advance(); document.removeEventListener('keydown', k); } });
    }

    function runLoading() {
        const bar = $('#loadBar'), fill = bar.firstElementChild, dur = reduceMotion ? 500 : 2600, t0 = performance.now();
        const step = now => {
            const p = clamp((now - t0) / dur, 0, 1), eased = 1 - Math.pow(1 - p, 2.2);
            fill.style.width = (eased * 100).toFixed(1) + '%';
            bar.setAttribute('aria-valuenow', Math.round(eased * 100));
            if (p < 1) requestAnimationFrame(step); else setTimeout(nextAfterLoading, 350);
        };
        requestAnimationFrame(step);
    }

    function initTerms() {
        const cb = $('#termsCheck'), btn = $('#termsContinue');
        cb.addEventListener('change', () => { btn.disabled = !cb.checked; });
        btn.addEventListener('click', () => { if (!cb.checked) return; profile.termsAccepted = true; save(); go('signin'); });
    }

    async function sha256(str) {
        try {
            if (!(window.crypto && crypto.subtle)) return null;
            const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
            return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
        } catch (e) { return null; }
    }

    function initSignin() {
        const form = $('#signinForm'), n = $('#suName'), e = $('#suEmail'), p = $('#suPass');
        let tried = false;
        const rules = [
            [n, v => v.trim().length >= 2, 'Please enter your name.'],
            [e, v => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim()), 'Enter a valid email, like you@example.com.'],
            [p, v => v.length >= 8 && /\d/.test(v) && /[A-Za-z]/.test(v), 'Use at least 8 characters, including a letter and a number.']
        ];
        const check = () => {
            let firstBad = null;
            rules.forEach(([el, ok, msg]) => {
                const good = ok(el.value);
                el.setAttribute('aria-invalid', String(!good));
                $('#' + el.getAttribute('aria-describedby')).textContent = good ? '' : msg;
                if (!good && !firstBad) firstBad = el;
            });
            return firstBad;
        };
        [n, e, p].forEach(el => el.addEventListener('input', () => { if (tried) check(); }));
        $('#passToggle').addEventListener('click', function () {
            const show = p.type === 'password';
            p.type = show ? 'text' : 'password';
            this.setAttribute('aria-pressed', String(show));
            this.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
            this.querySelector('use').setAttribute('href', show ? '#i-eyeoff' : '#i-eye');
        });
        form.addEventListener('submit', async ev => {
            ev.preventDefault(); tried = true;
            const bad = check();
            if (bad) { bad.focus(); return; }
            profile.account = { name: n.value.trim(), email: e.value.trim().toLowerCase(), pwHash: await sha256(p.value), created: new Date().toISOString() };
            p.value = '';
            if (!profile.callName) profile.callName = profile.account.name.split(/\s+/)[0];
            save();
            showWelcome();
        });
    }

    function showWelcome() {
        $('#welcomeName').textContent = profile.account ? profile.account.name : '';
        go('welcome');
    }

    /* ---------- Setup wizard ---------- */
    const STEP_LABELS = ['SELECT AVATAR', 'SELECT FACE', 'SELECT PERSONALITY', 'YOUR NAME'];
    let step = 0, faceCar = null, personaCar = null;

    function renderHexSteps() {
        $('#hexSteps').innerHTML = STEP_LABELS.map((l, i) => {
            const st = i < step ? 'done' : i === step ? 'active' : 'pending';
            return `<button class="hx ${st}" data-go-step="${i}" ${i < step ? '' : 'tabindex="-1"'} aria-label="Step ${i + 1}: ${l.toLowerCase()}">
                <svg viewBox="0 0 40 44" aria-hidden="true"><polygon points="20,2 38,12 38,32 20,42 2,32 2,12"/></svg><span>${i < step ? '✓' : i + 1}</span></button>`;
        }).join('');
        $('#hexSteps').removeAttribute('aria-hidden');
        $('#hexLabel').textContent = STEP_LABELS[step];
    }

    function showStep(i) {
        step = i;
        $$('.step-pane').forEach(p => p.classList.toggle('on', +p.dataset.step === i));
        renderHexSteps();
        if (i === 0) renderPortraits();
        if (i === 1) buildFaceCarousel();
        if (i === 2) buildPersonaCarousel();
        if (i === 3) { const c = $('#callName'); c.value = profile.callName || ''; $('#setupFinish').disabled = !c.value.trim(); setTimeout(() => c.focus(), 200); }
    }

    function renderPortraits() {
        ['her', 'him'].forEach(g => {
            const f = profile.gender === g && face().g === g ? face() : facesFor(g)[0];
            const svg = faceSVG(f, persona(), { static: true, label: g === 'her' ? 'Her avatar' : 'Him avatar' });
            $(`[data-preview="${g}"]`).innerHTML = svg;
            $(`[data-reflect="${g}"]`).innerHTML = svg;
        });
        $$('.portrait').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.gender === profile.gender)));
    }

    /* Generic carousel: centre card large + glowing, sides smaller + faded.
       Arrow buttons, keyboard arrows and swipe/drag all move it. */
    function Carousel(el, dotsEl, items, startIndex, onChange) {
        const GAP = 128;
        let index = startIndex, dragX = null, dx = 0, dragged = false;
        // Replace the element so listeners from a previous build don't pile up
        const fresh = el.cloneNode(false); el.replaceWith(fresh); el = fresh;
        el.innerHTML = items.map((it, i) => `<div class="car-item glass" role="option" data-i="${i}" aria-label="${esc(it.label)}">${it.html}</div>`).join('');
        dotsEl.innerHTML = items.map(() => '<i></i>').join('');
        const cards = $$('.car-item', el), dots = $$('i', dotsEl);
        function layout(offsetPx = 0) {
            cards.forEach((c, i) => {
                const off = i - index, a = Math.abs(off);
                c.style.transform = `translateX(${off * GAP + offsetPx}px) scale(${off === 0 ? 1 : .74})`;
                c.style.opacity = a === 0 ? 1 : a === 1 ? .42 : a === 2 ? .12 : 0;
                c.style.zIndex = 10 - a;
                c.style.pointerEvents = a > 1 ? 'none' : 'auto';
                c.classList.toggle('is-center', off === 0);
                c.setAttribute('aria-selected', String(off === 0));
            });
            dots.forEach((d, i) => d.classList.toggle('on', i === index));
            const nav = el.parentElement;
            const prev = $(`[data-car-prev="${el.id}"]`, nav), next = $(`[data-car-next="${el.id}"]`, nav);
            if (prev) prev.disabled = index === 0;
            if (next) next.disabled = index === items.length - 1;
        }
        function set(i) { const n = clamp(i, 0, items.length - 1); if (n !== index) { index = n; onChange(index); } layout(); }
        el.addEventListener('click', e => { if (dragged) return; const c = e.target.closest('.car-item'); if (c) set(+c.dataset.i); });
        el.addEventListener('keydown', e => { if (e.key === 'ArrowLeft') { set(index - 1); e.preventDefault(); } if (e.key === 'ArrowRight') { set(index + 1); e.preventDefault(); } });
        el.addEventListener('pointerdown', e => { dragX = e.clientX; dx = 0; dragged = false; cards.forEach(c => c.style.transition = 'none'); });
        window.addEventListener('pointermove', e => { if (dragX === null || !el.isConnected) return; dx = e.clientX - dragX; if (Math.abs(dx) > 6) dragged = true; layout(dx * .7); });
        const up = () => {
            if (dragX === null || !el.isConnected) return;
            cards.forEach(c => c.style.transition = '');
            if (dx < -40) set(index + 1); else if (dx > 40) set(index - 1); else layout();
            dragX = null; setTimeout(() => { dragged = false; }, 50);
        };
        window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
        layout(); onChange(index);
        return { prev: () => set(index - 1), next: () => set(index + 1), el };
    }

    function buildFaceCarousel() {
        const list = facesFor(profile.gender);
        let start = list.findIndex(f => f.id === profile.faceId); if (start < 0) start = 0;
        faceCar = Carousel($('#faceCar'), $('#faceCarDots'),
            list.map((f, i) => ({ label: `Face ${i + 1}`, html: faceSVG(f, persona(), { static: true, label: `Face ${i + 1}` }) })),
            start, i => { profile.faceId = list[i].id; });
    }

    function buildPersonaCarousel() {
        let start = PERSONAS.findIndex(p => p.id === profile.personaId); if (start < 0) start = 0;
        personaCar = Carousel($('#personaCar'), $('#personaCarDots'),
            PERSONAS.map(p => ({ label: `${p.name}: ${p.tag}`, html: faceSVG(face(), p, { static: true, label: p.name }) })),
            start, i => { const p = PERSONAS[i]; profile.personaId = p.id; $('#personaName').textContent = p.name; $('#personaTag').textContent = p.tag; });
    }

    function initSetup() {
        $$('.portrait').forEach(b => b.addEventListener('click', () => {
            profile.gender = b.dataset.gender;
            if (face().g !== profile.gender) profile.faceId = facesFor(profile.gender)[0].id;
            renderPortraits();
        }));
        $$('.step-pane [data-next]').forEach(b => b.addEventListener('click', () => { save(); showStep(step + 1); }));
        document.addEventListener('click', e => {
            const pv = e.target.closest('[data-car-prev]'), nx = e.target.closest('[data-car-next]');
            const car = id => id === 'faceCar' ? faceCar : personaCar;
            if (pv && car(pv.dataset.carPrev)) car(pv.dataset.carPrev).prev();
            if (nx && car(nx.dataset.carNext)) car(nx.dataset.carNext).next();
            const hx = e.target.closest('[data-go-step]');
            if (hx && +hx.dataset.goStep < step) showStep(+hx.dataset.goStep);
        });
        const c = $('#callName'), fin = $('#setupFinish');
        c.addEventListener('input', () => { fin.disabled = !c.value.trim(); });
        c.addEventListener('keydown', e => { if (e.key === 'Enter' && c.value.trim()) fin.click(); });
        fin.addEventListener('click', () => {
            profile.callName = c.value.trim(); profile.setupDone = true; save();
            go('home');
            setTimeout(() => addAura(persona().greet(profile.callName), { tone: false }), reduceMotion ? 100 : 700);
        });
        $('#welcomeGo').addEventListener('click', () => { go('setup'); showStep(0); });
    }

    /* -------------------------------------------------------------------------
       10. Home
       ---------------------------------------------------------------------- */
    let homeReady = false;
    function enterHome() {
        $('#homeName').textContent = profile.callName || (profile.account && profile.account.name.split(' ')[0]) || 'there';
        if (!homeReady) { Avatar.mount($('#homeAvatar'), $('#avatarCard')); homeReady = true; }
        else Avatar.render();
        scrollChat();
    }
    const chatArea = () => document.getElementById('chatArea');
    function scrollChat() { const c = chatArea(); if (c) c.scrollTop = c.scrollHeight; }

    function addUser(text) {
        const d = document.createElement('div'); d.className = 'user-message'; d.textContent = text;
        chatArea().appendChild(d);
    }
    /* Aura message created by this file (marked so the tone layer skips it) */
    function addAura(text, { tone = true, speak = true } = {}) {
        const lead = tone ? leadFor(text) : '';
        const d = document.createElement('div');
        d.className = 'aura-message'; d.dataset.tone = '1'; d.dataset.spoken = '1';
        if (lead) { const s = document.createElement('span'); s.className = 'tone-lead'; s.textContent = lead; d.appendChild(s); }
        d.appendChild(document.createTextNode(text));
        chatArea().appendChild(d);
        if (speak) speakAura(lead + text);
    }

    /* Typed commands → aura.js if it exposes a handler, else a local fallback */
    const HANDLERS = ['processCommand', 'handleCommand', 'processVoiceCommand', 'handleVoiceCommand', 'executeCommand', 'handleInput'];
    function routeCommand(text) {
        text = String(text || '').trim(); if (!text) return;
        const name = HANDLERS.find(n => typeof window[n] === 'function');
        if (name) {
            const c = chatArea(), before = c.children.length;
            try { window[name](text); } catch (e) { console.warn('[AURA] command handler failed', e); }
            // If aura.js didn't echo the user's words, insert them where the new messages begin
            setTimeout(() => {
                const added = Array.from(c.children).slice(before);
                if (!added.some(n => n.classList.contains('user-message'))) {
                    const d = document.createElement('div'); d.className = 'user-message'; d.textContent = text;
                    c.insertBefore(d, c.children[before] || null);
                }
                scrollChat();
            }, 60);
            return;
        }
        addUser(text);
        setTimeout(() => addAura(localReply(text)), 350);
    }

    function localReply(t) {
        const s = t.toLowerCase(), n = profile.callName || 'there';
        const mode = document.getElementById('modeDisplay');
        if (/\b(hello|hi|hey)\b/.test(s)) return `Hello ${n}! How can I help?`;
        if (/focus mode/.test(s)) { if (mode) mode.textContent = 'MODE: FOCUS ✓'; return "Focus mode is on. I'll keep things quiet."; }
        if (/normal mode/.test(s)) { if (mode) mode.textContent = 'MODE: NORMAL ✓'; return 'Back to normal mode.'; }
        if (/\btime\b/.test(s)) return `It's ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.`;
        const call = s.match(/\bcall\s+(.+)/);
        if (call) {
            const who = call[1].replace(/[.?!]$/, '').trim();
            const hit = $$('#contactList .contact-name').find(el => el.textContent.trim().toLowerCase() === who);
            if (hit) { if (typeof window.toggleContacts === 'function') window.toggleContacts(); return `${hit.textContent.trim()} is ready. Tap Call on their card to confirm.`; }
            return `I couldn't find ${who} in your contacts. Add them first, then ask again.`;
        }
        return `I heard "${t}". Offline, I can handle greetings, modes, the time and calls.`;
    }

    /* Watch the chat: add personality tone to aura.js replies, auto-read, animate */
    function observeChat() {
        const c = chatArea(); if (!c) return;
        const readyAt = Date.now() + 1500;
        new MutationObserver(muts => {
            muts.forEach(m => m.addedNodes.forEach(node => {
                if (!(node instanceof HTMLElement) || !node.classList.contains('aura-message')) return;
                if (node.dataset.tone) return; // ours
                node.dataset.tone = '1';
                if (Date.now() < readyAt) return;
                const original = node.textContent;
                const lead = leadFor(original);
                if (lead) { const s = document.createElement('span'); s.className = 'tone-lead'; s.textContent = lead; node.insertBefore(s, node.firstChild); }
                const t0 = Date.now();
                setTimeout(() => {
                    const spokenByApp = Math.abs(lastUtterAt - t0) < 1500 || (synth && (synth.speaking || synth.pending));
                    if (spokenByApp) return;
                    if (!synth) Avatar.fakeTalk(original);
                    else if (profile.autoSpeak) speakAura(lead + original);
                }, 900);
            }));
            scrollChat();
        }).observe(c, { childList: true });
    }

    /* Fallback listening detection: micButton text changes (if no hook fired) */
    function observeMicButton() {
        const mic = document.getElementById('micButton'); if (!mic) return;
        new MutationObserver(() => {
            if (UI.hookSeen) return;
            UI.setListening(/listen|stop|🔴|⏹/i.test(mic.textContent));
        }).observe(mic, { childList: true, characterData: true, subtree: true });
    }

    /* -------------------------------------------------------------------------
       11. Permission explainers (asked only on first use)
       ---------------------------------------------------------------------- */
    const PERM_COPY = {
        mic: ['Let Aura hear you', "Aura listens only while the mic is active. Your browser's speech service turns your words into text, and nothing is recorded by this app."],
        notif: ['Stay in the loop', 'Aura can remind you about tasks and tell you when something needs your approval. You can turn this off anytime.']
    };
    let permCb = null;
    function explain(kind, onAllow) {
        const [title, text] = PERM_COPY[kind];
        $('#permTitle').textContent = title; $('#permText').textContent = text;
        permCb = onAllow;
        $('#permDialog').classList.add('open');
        setTimeout(() => $('#permAllow').focus(), 50);
    }
    function closePerm() { $('#permDialog').classList.remove('open'); }

    async function micPermissionState() {
        try { if (navigator.permissions) return (await navigator.permissions.query({ name: 'microphone' })).state; } catch (e) { /* unsupported */ }
        return 'prompt';
    }
    function askNotifications(done) {
        if (!('Notification' in window)) { toast("Notifications aren't supported in this browser."); done && done(false); return; }
        if (Notification.permission === 'granted') { done && done(true); return; }
        if (Notification.permission === 'denied') { toast('Notifications are blocked in your browser settings.'); done && done(false); return; }
        explain('notif', () => Notification.requestPermission().then(r => done && done(r === 'granted')));
    }

    /* -------------------------------------------------------------------------
       12. Settings panel
       ---------------------------------------------------------------------- */
    const Settings = {
        isOpen: false,
        open() {
            this.isOpen = true; this.fill();
            openSheet('#settingsPanel');
            railCurrent('settings');
        },
        close() { this.isOpen = false; closeSheets(); },
        toggle() { this.isOpen ? this.close() : this.open(); },
        fill() {
            $('#setName').value = profile.callName || '';
            $$('[data-set-gender]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.setGender === profile.gender)));
            $('#setFaces').innerHTML = facesFor(profile.gender).map((f, i) =>
                `<button data-set-face="${f.id}" aria-label="Face ${i + 1}" aria-pressed="${f.id === profile.faceId}">${faceSVG(f, persona(), { static: true, label: `Face ${i + 1}` })}</button>`).join('');
            $('#setPersonas').innerHTML = PERSONAS.map(p =>
                `<button class="chip" data-set-persona="${p.id}" aria-pressed="${p.id === profile.personaId}" title="${esc(p.tag)}">${p.name}</button>`).join('');
            this.fillVoices();
            $('#setRate').value = profile.rate; $('#rateLabel').textContent = Number(profile.rate).toFixed(2).replace(/0$/, '') + '×';
            $('#setAutoSpeak').checked = !!profile.autoSpeak;
            $('#setNotif').checked = !!profile.notif && 'Notification' in window && Notification.permission === 'granted';
            $('#notifPermLabel').textContent = !('Notification' in window) ? 'Not supported here' : Notification.permission === 'granted' ? (profile.notif ? 'On' : 'Allowed, currently off') : Notification.permission === 'denied' ? 'Blocked in browser settings' : 'Off';
            micPermissionState().then(s => {
                $('#micPermLabel').textContent = s === 'granted' ? 'Allowed' : s === 'denied' ? 'Blocked in browser settings' : 'Asked the first time you talk to Aura';
                $('#micPermBtn').hidden = s === 'granted';
            });
        },
        fillVoices() {
            const sel = $('#setVoice');
            if (!synth) { sel.innerHTML = '<option>Voice not supported in this browser</option>'; sel.disabled = true; return; }
            const sorted = voices.slice().sort((a, b) => (b.lang.startsWith('en') - a.lang.startsWith('en')) || a.name.localeCompare(b.name));
            sel.innerHTML = '<option value="">Default voice</option>' + sorted.map(v => `<option value="${esc(v.voiceURI)}">${esc(v.name)} (${esc(v.lang)})</option>`).join('');
            sel.value = profile.voiceURI || '';
        },
        init() {
            onVoices = () => { if (this.isOpen) this.fillVoices(); };
            let nameT;
            $('#setName').addEventListener('input', e => {
                clearTimeout(nameT);
                nameT = setTimeout(() => { const v = e.target.value.trim(); if (v) { profile.callName = v; save(); $('#homeName').textContent = v; } }, 300);
            });
            document.addEventListener('click', e => {
                const g = e.target.closest('[data-set-gender]'), f = e.target.closest('[data-set-face]'), p = e.target.closest('[data-set-persona]');
                if (g) { profile.gender = g.dataset.setGender; if (face().g !== profile.gender) profile.faceId = facesFor(profile.gender)[0].id; save(); Avatar.render(); this.fill(); }
                if (f) { profile.faceId = f.dataset.setFace; save(); Avatar.render(); this.fill(); }
                if (p) { profile.personaId = p.dataset.setPersona; save(); Avatar.render(); this.fill(); toast(`Aura is now in ${persona().name} mode`); }
            });
            $('#setVoice').addEventListener('change', e => { profile.voiceURI = e.target.value; save(); });
            $('#setRate').addEventListener('input', e => { profile.rate = +e.target.value; $('#rateLabel').textContent = profile.rate.toFixed(2).replace(/0$/, '') + '×'; save(); });
            $('#setAutoSpeak').addEventListener('change', e => { profile.autoSpeak = e.target.checked; save(); });
            $('#testVoice').addEventListener('click', () => speakAura(`Hi ${profile.callName || 'there'}, this is how I sound as ${persona().name}.`));
            $('#micPermBtn').addEventListener('click', async () => {
                try {
                    const s = await navigator.mediaDevices.getUserMedia({ audio: true });
                    s.getTracks().forEach(t => t.stop());
                    profile.micExplained = true; save(); toast('Microphone allowed');
                } catch (err) { toast('Microphone access was not granted.'); }
                this.fill();
            });
            $('#setNotif').addEventListener('change', e => {
                if (!e.target.checked) { profile.notif = false; save(); this.fill(); return; }
                e.target.checked = false;
                askNotifications(ok => { profile.notif = ok; save(); this.fill(); if (ok) toast('Notifications on'); });
            });
            $('#resetOnboarding').addEventListener('click', () => { $('#resetDialog').classList.add('open'); $('#resetNo').focus(); });
            $('#resetNo').addEventListener('click', () => $('#resetDialog').classList.remove('open'));
            $('#resetYes').addEventListener('click', () => { try { localStorage.removeItem(KEY); } catch (e) { /* */ } location.reload(); });
        }
    };

    function openSheet(sel) { $$('.sheet.open').forEach(s => s.classList.remove('open')); $('#scrim').classList.add('open'); $(sel).classList.add('open'); setTimeout(() => { const f = $(sel).querySelector('input, button, select'); f && f.focus(); }, 80); }
    function closeSheets() { $$('.sheet').forEach(s => s.classList.remove('open')); $('#scrim').classList.remove('open'); Settings.isOpen = false; railCurrent('home'); }
    function railCurrent(name) { $$('.rail [data-rail]').forEach(b => b.setAttribute('aria-current', b.dataset.rail === name ? 'page' : 'false')); }

    /* -------------------------------------------------------------------------
       13. Wrap / back-fill the global functions aura.js provides
       ---------------------------------------------------------------------- */
    function installGlobals() {
        /* toggleSettings(): keep whatever aura.js does, then open the real panel */
        const origSettings = typeof window.toggleSettings === 'function' ? window.toggleSettings : null;
        window.toggleSettings = function () {
            if (origSettings) { try { origSettings.apply(this, arguments); } catch (e) { /* it had nothing to open */ } }
            Settings.toggle();
        };

        /* Fallbacks — only when aura.js didn't define these */
        if (typeof window.toggleContacts !== 'function') {
            window.toggleContacts = function () {
                const p = document.getElementById('contactsPanel');
                p.style.display = p.style.display === 'block' ? 'none' : 'block';
            };
        }
        if (typeof window.addContact !== 'function') {
            const CK = 'aura.contacts';
            const load = () => { try { return JSON.parse(localStorage.getItem(CK) || '[]'); } catch (e) { return []; } };
            const render = () => {
                document.getElementById('contactList').innerHTML = load().map((c, i) =>
                    `<div class="contact-item"><div><div class="contact-name">${esc(c.name)}</div><div class="contact-num">${esc(c.num)}</div></div><button class="call-btn" data-call="${i}">Call</button></div>`).join('');
            };
            window.addContact = function () {
                const n = document.getElementById('contactName'), num = document.getElementById('contactNum');
                if (!n.value.trim() || !/^[+\d][\d\s-]{5,}$/.test(num.value.trim())) { toast('Add a name and a valid number.'); return; }
                const list = load(); list.push({ name: n.value.trim(), num: num.value.trim() });
                try { localStorage.setItem(CK, JSON.stringify(list)); } catch (e) { /* */ }
                n.value = ''; num.value = ''; render();
            };
            document.addEventListener('click', e => { const b = e.target.closest('[data-call]'); if (b) { const c = load()[+b.dataset.call]; if (c) location.href = 'tel:' + c.num.replace(/[^\d+]/g, ''); } });
            render();
        }
        if (typeof window.toggleMic !== 'function') {
            let rec = null;
            window.toggleMic = function () {
                const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
                if (!SR) { toast("Voice input isn't supported here. Type in the bar above instead."); return; }
                if (rec) { rec.stop(); return; }
                rec = new SR(); rec.lang = navigator.language || 'en-US'; rec.interimResults = true;
                rec.addEventListener('result', e => {
                    const r = e.results[e.results.length - 1], txt = r[0].transcript;
                    document.getElementById('transcript').textContent = txt;
                    if (r.isFinal) routeCommand(txt);
                });
                rec.addEventListener('end', () => { rec = null; });
                rec.start();
            };
        }

        /* toggleMic(): friendly explainer before the browser's own prompt, once */
        const origMic = window.toggleMic;
        window.toggleMic = function () {
            const args = arguments, self = this;
            const run = () => origMic.apply(self, args);
            if (profile.micExplained || UI.listeningNow) return run();
            explain('mic', () => { profile.micExplained = true; save(); run(); });
        };
        micPermissionState().then(s => { if (s === 'granted') { profile.micExplained = true; save(); } });
    }

    /* -------------------------------------------------------------------------
       14. Wire everything up
       ---------------------------------------------------------------------- */
    function spawnParticles() {
        if (reduceMotion) return;
        const host = $('#particles'); let html = '';
        for (let i = 0; i < 26; i++) {
            html += `<span class="particle" style="left:${rand(2, 98).toFixed(1)}%;top:${rand(35, 100).toFixed(1)}%;animation-duration:${rand(9, 20).toFixed(1)}s;animation-delay:-${rand(0, 20).toFixed(1)}s"></span>`;
        }
        host.innerHTML = html;
    }

    function initHomeControls() {
        $('#cmdForm').addEventListener('submit', e => { e.preventDefault(); const i = $('#cmdInput'); routeCommand(i.value); i.value = ''; });
        $('#camBtn').addEventListener('click', () => toast("Camera isn't set up yet. Aura will always ask before using it."));
        $('#bellBtn').addEventListener('click', () => askNotifications(ok => { if (ok) { profile.notif = true; save(); toast("You're all caught up."); } }));
        document.addEventListener('click', e => {
            const r = e.target.closest('[data-rail]');
            if (r) {
                if (r.dataset.rail === 'messages') { chatArea().scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' }); $('#cmdInput').focus({ preventScroll: true }); }
                if (r.dataset.rail === 'premium') toast("AURA Premium is on its way. You'll hear about it from Aura first.");
                if (r.dataset.rail === 'ideas') { openSheet('#ideasSheet'); railCurrent('ideas'); }
                if (r.dataset.rail === 'home') { $('#homeScroll').scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' }); }
            }
            const say = e.target.closest('[data-say]');
            if (say) { closeSheets(); routeCommand(say.dataset.say); }
            if (e.target.closest('[data-close-sheet]')) closeSheets();
        });
        $('#scrim').addEventListener('click', closeSheets);
        $('#permAllow').addEventListener('click', () => { closePerm(); const cb = permCb; permCb = null; cb && cb(); });
        $('#permLater').addEventListener('click', () => { closePerm(); permCb = null; });
        document.addEventListener('keydown', e => {
            if (e.key !== 'Escape') return;
            if ($('#permDialog').classList.contains('open')) return closePerm();
            if ($('#resetDialog').classList.contains('open')) return $('#resetDialog').classList.remove('open');
            if ($('.sheet.open')) return closeSheets();
            const cp = document.getElementById('contactsPanel');
            if (cp && cp.style.display === 'block' && typeof window.toggleContacts === 'function') window.toggleContacts();
        });
    }

    function boot() {
        spawnParticles();
        initTerms(); initSignin(); initSetup(); initHomeControls(); Settings.init();
        installGlobals();
        observeChat(); observeMicButton();
        if (profile.setupDone) {
            // Returning user: straight to Home, no animation
            const op = $('.scr.opening'); op.classList.remove('active');
            current = 'none'; go('home');
        } else {
            runOpening();
        }
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
})();
