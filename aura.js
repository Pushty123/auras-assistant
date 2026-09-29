// =============================================================================
// AURA Voice Brain — updated for the new AURA UI (index.html + aura-ui.js)
//
// All original features are kept: voice commands, modes + app blocking,
// contacts (add / edit / delete / critical / call), notes, reminders, weather,
// morning briefing, Gemini AI fallback, settings and the service worker.
//
// What changed (summary):
//  • Contacts use the panel that already exists in index.html (glass styling)
//    instead of building an old-style panel with inline colours.
//  • Mic button toggles a CSS class instead of painting old gradients.
//  • setMode() no longer crashes if `.screen` is missing; colours match the palette.
//  • Command order fixed: "search for…", "directions to…" no longer get
//    swallowed by the "open Google/Maps" checks.
//  • Gemini key is sent in a header (not the URL), replies are short and
//    speakable, and the "Thinking…" bubble is removed when the answer arrives.
//  • Contact names are escaped (names with ' no longer break the buttons),
//    edits keep the Critical flag, duplicates update instead of repeating.
//  • Drive mode now really lets only critical calls through, as it says.
//  • Reminders also show a system notification when notifications are allowed.
//  • The start-up greeting waits for your first tap (browsers block speech
//    before that) and is skipped while onboarding is still running.
// =============================================================================

let isListening = false;
let recognition;
let synth = window.speechSynthesis;
let speechQueue = [];
let isSpeakingNow = false;
let currentMode = 'NORMAL';
let addingContact = false;
let pendingName = '';
let editingContactIndex = -1;
let pendingCriticalAction = null; // null | 'waiting_name'
let notes = JSON.parse(localStorage.getItem('auraNotes') || '[]');
let reminders = JSON.parse(localStorage.getItem('auraReminders') || '[]');
let lastTopic = null;
let contacts = loadContacts();
let settings = JSON.parse(localStorage.getItem('auraSettings') || 'null') || { name: '', city: '' };
let modeRules = {
    FOCUS: ['instagram', 'youtube', 'facebook', 'twitter', 'snapchat', 'reddit', 'netflix', 'spotify'],
    WORK: ['instagram', 'youtube', 'facebook', 'twitter', 'snapchat', 'reddit', 'netflix'],
    SLEEP: ['instagram', 'youtube', 'facebook', 'twitter', 'snapchat', 'reddit', 'netflix', 'spotify', 'google'],
    NORMAL: []
};
// Modes where only Critical contacts can be called
const CALL_LOCK_MODES = ['FOCUS', 'STUDY', 'DRIVE'];
// Mode accent colours (tuned for the dark violet UI)
const MODE_COLORS = {
    FOCUS: '#ff5c8a', STUDY: '#ff5c8a', WORK: '#ffc861', SLEEP: '#7fb2ff',
    OFFICE: '#ffb454', FAMILY: '#ff7ad9', GYM: '#c28bff', DRIVE: '#ff9a5c', NORMAL: '#d4c4ff'
};
const PROMPT_LINE = 'What shall we do with your day?';

// ===== SMALL HELPERS =====
function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function capitalize(s) { return String(s || '').replace(/\b\w/g, c => c.toUpperCase()); }
function loadContacts() {
    return JSON.parse(localStorage.getItem('auraContacts') || '[]')
        .map(c => ({ name: c.name, number: c.number, critical: !!c.critical }));
}
function setMicUI(listening) {
    const mic = document.getElementById('micButton');
    if (!mic) return;
    mic.textContent = listening ? '🔴 LISTENING...' : '🎤 SPEAK NOW';
    mic.classList.toggle('is-listening', listening);
    mic.setAttribute('aria-pressed', String(listening));
}
function setTranscript(text) {
    const t = document.getElementById('transcript');
    if (t) t.textContent = text;
}

// ===== VOICE SETUP =====
function setupVoice() {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
        addMessage('aura', 'Voice input needs Chrome or Edge. You can still type in the bar above.');
        return;
    }
    recognition = new (window.SpeechRecognition || window.webkitSpeechRecognition)();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = 'en-IN';

    recognition.onstart = function () {
        setTranscript('Listening... speak now');
        setMicUI(true);
    };

    recognition.onresult = function (event) {
        let transcript = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
            transcript += event.results[i][0].transcript;
        }
        setTranscript('You said: ' + transcript);
        if (event.results[event.results.length - 1].isFinal) {
            handleCommand(transcript.toLowerCase().trim());
        }
    };

    recognition.onend = function () {
        isListening = false;
        setMicUI(false);
        setTranscript('Listening...');
    };

    recognition.onerror = function (event) {
        const friendly = {
            'not-allowed': 'Microphone is blocked. Allow it in your browser settings.',
            'no-speech': "I didn't hear anything. Tap the mic and try again.",
            'network': 'Voice needs an internet connection.'
        };
        setTranscript(friendly[event.error] || ('Error: ' + event.error + ' — try again'));
        isListening = false;
        setMicUI(false);
    };
}

function stopSpeaking() {
    if (synth) synth.cancel();
    speechQueue = [];
    isSpeakingNow = false;
}

function toggleMic() {
    if (!recognition) setupVoice();
    if (!recognition) return;
    stopSpeaking();
    if (isListening) {
        recognition.stop();
        isListening = false;
        return;
    }
    try {
        recognition.start();
        isListening = true;
    } catch (err) {
        isListening = false;
        setTranscript('Error starting microphone. Tap again.');
        setMicUI(false);
    }
}

function normalizeCommand(command) {
    return (command || '')
        .toLowerCase()
        .replace(/[^\w\s+]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

// ===== COMMAND BRAIN =====
function handleCommand(command) {
    command = normalizeCommand(command);
    if (!command) return;
    addMessage('user', command);

    if (handleContactFlow(command)) return;
    if (handlePendingCritical(command)) return;

    if (command.startsWith('remind me')) {
        let parsed = parseReminder(command);
        if (parsed) {
            addReminder(unitToMs(parsed.unit, parsed.amount), parsed.task);
        } else {
            speak("Please say it like: remind me in 10 minutes to drink water.");
            addMessage('aura', "⏰ Try: \"remind me in 10 minutes to drink water\"");
        }
        return;
    }

    if (command.startsWith('note ') || command.startsWith('add note')) {
        let text = command.replace(/^add note\s*/, '').replace(/^note\s*/, '').trim();
        if (text) {
            addNote(text);
        } else {
            speak("What should I note down?");
            addMessage('aura', "📝 What should I note down?");
        }
        return;
    }

    if (command.includes('read my notes') || command.includes('read notes') || command.includes('show my notes') || command.includes('show notes')) {
        readNotes();
        return;
    }

    if (command.includes('clear notes') || command.includes('delete all notes')) {
        clearNotes();
        return;
    }

    if (command.includes('what were we talking about') || command.includes('last topic') || command.includes('what was i doing')) {
        recallLastTopic();
        return;
    }

    if (command.includes('emergency') || command.includes('help me') || command.includes('call police') || command.includes('call ambulance')) {
        emergency();
        return;
    }

    if (command.startsWith('my name is ') || command.startsWith('call me ')) {
        let name = command.replace(/^my name is /, '').replace(/^call me /, '').trim();
        if (name) {
            settings.name = capitalize(name);
            saveSettings();
            speak("Got it, I will call you " + settings.name + " from now on.");
            addMessage('aura', "👤 Nice to meet you, " + settings.name + "!");
        }
        return;
    }

    const isGreeting = ['a', 'aura', 'hello a', 'hello aura', 'hi a', 'hi aura', 'hey a', 'hey aura', 'hello', 'hi', 'hey'].includes(command) ||
        command.startsWith('hello') || command.includes('hi aura') || command.includes('hey aura');
    if (isGreeting) {
        let namePart = settings.name ? ", " + settings.name : "";
        speak("Hello" + namePart + "! I am Aura, your personal assistant. How can I help you today?");
        addMessage('aura', "Hello" + namePart + "! I'm Aura. How can I help you today?");
        return;
    }

    if (command.includes('good morning')) {
        morningBriefing();
        return;
    }

    if (command.includes('good night')) {
        speak("Good night! Sleep well.");
        addMessage('aura', "🌙 Good night! Sleep well.");
        return;
    }

    // ----- Modes -----
    if (command.includes('focus mode') || command.includes('study mode')) {
        setMode('FOCUS');
        speak("Focus mode activated. You are locked in.");
        addMessage('aura', "🔒 Focus mode activated. You are locked in.");
        return;
    }
    if (command.includes('work mode')) {
        setMode('WORK');
        speak("Work mode on.");
        addMessage('aura', "💼 Work mode on.");
        return;
    }
    if (command.includes('sleep mode')) {
        setMode('SLEEP');
        speak("Sleep mode activated. Goodnight.");
        addMessage('aura', "🌙 Sleep mode activated. Goodnight.");
        return;
    }
    if (command.includes('office mode')) {
        setMode('OFFICE');
        speak("Office mode on. Professional settings activated. Focus on your work.");
        addMessage('aura', "🏢 Office mode. Professional settings activated.");
        return;
    }
    if (command.includes('family mode')) {
        setMode('FAMILY');
        speak("Family mode on. All family contacts have priority. Enjoy your time.");
        addMessage('aura', "👨‍👩‍👧 Family mode. Family contacts prioritised.");
        return;
    }
    if (command.includes('gym mode') || command.includes('workout mode')) {
        setMode('GYM');
        speak("Gym mode activated. Let us crush this workout. All notifications silenced.");
        addMessage('aura', "💪 Gym mode. Notifications silenced. Let's go.");
        return;
    }
    if (command.includes('drive mode') || command.includes('driving mode')) {
        setMode('DRIVE');
        speak("Drive mode on. Stay safe. Only critical calls will come through.");
        addMessage('aura', "🚗 Drive mode. Critical calls only. Stay safe.");
        return;
    }
    if (command.includes('normal mode') || command.includes('free mode') || command.includes('focus off')) {
        setMode('NORMAL');
        speak("Normal mode. All clear.");
        addMessage('aura', "✅ Normal mode. All clear.");
        return;
    }

    if (command.includes('what are you') || command.includes('who are you') || command.includes('what is aura')) {
        speak("I am Aura. Your personal assistant that protects your focus, filters your calls, and acts before you ask.");
        addMessage('aura', "I'm Aura — protecting your focus, filtering calls, always on your side.");
        return;
    }

    if (command.includes('what time') || command.includes('time please') || command.includes('current time')) {
        let time = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
        speak("The time is " + time);
        addMessage('aura', "🕐 It is " + time);
        return;
    }

    if (command.includes('what date') || command.includes('todays date') || command.includes('what day')) {
        let date = new Date().toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
        speak("Today is " + date);
        addMessage('aura', "📅 Today is " + date);
        return;
    }

    // ----- Search & navigation (checked BEFORE the app openers) -----
    if (command.includes('take me to') || command.includes('navigate to') || command.includes('directions to')) {
        let place = command.replace('take me to', '').replace('navigate to', '').replace('directions to', '').trim();
        if (place) {
            speak("Opening navigation to " + place);
            addMessage('aura', "🗺️ Navigating to " + place + "...");
            setTimeout(() => window.open('https://maps.google.com/?q=' + encodeURIComponent(place), '_blank'), 1000);
            return;
        }
    }

    if (command.startsWith('search') || command.includes('search for') || command.includes('google search') || command.startsWith('google ')) {
        let query = command.replace('search for', '').replace('google search', '').replace(/^search/, '').replace(/^google/, '').trim();
        if (query) {
            speak("Searching for " + query);
            addMessage('aura', "🔍 Searching: " + query);
            setTimeout(() => window.open('https://google.com/search?q=' + encodeURIComponent(query), '_blank'), 1000);
            return;
        }
    }

    // ----- Contacts (checked before app openers so "call mom" etc. win) -----
    if (command.includes('add contact') || command.includes('save contact') || command.includes('new contact')) {
        addingContact = 'waiting_name';
        speak("Sure. What is the name of the contact?");
        addMessage('aura', "📒 What is the name of the contact?");
        return;
    }

    if (command.includes('show contacts') || command.includes('my contacts') || command.includes('contact list') || command.includes('open contacts')) {
        openContacts();
        return;
    }

    if ((command.includes('mark') || command.includes('make')) && command.includes('critical')) {
        let name = command.replace(/\b(mark|make|as|critical|contact|a)\b/g, '').replace(/\s+/g, ' ').trim();
        let match = name ? findContactByName(name) : null;
        if (match) {
            toggleCritical(match.name);
        } else {
            pendingCriticalAction = 'waiting_name';
            speak("Which contact should be marked critical?");
            addMessage('aura', "⭐ Which contact should be marked critical?");
        }
        return;
    }

    if (command.includes('edit contact') || (command.startsWith('edit ') && contacts.some(c => command.includes(c.name)))) {
        let name = command.replace('edit contact', '').replace(/^edit/, '').trim();
        if (name) {
            editContact(name);
        } else {
            speak("Which contact should I edit?");
            addMessage('aura', "✏️ Which contact should I edit?");
        }
        return;
    }

    if (command.includes('delete contact') || command.includes('remove contact') ||
        ((command.startsWith('delete ') || command.startsWith('remove ')) && contacts.some(c => command.includes(c.name)))) {
        let name = command.replace('delete contact', '').replace('remove contact', '')
            .replace(/^delete/, '').replace(/^remove/, '').trim();
        if (name) {
            deleteContact(name);
        } else {
            speak("Which contact should I delete?");
            addMessage('aura', "🗑️ Which contact should I delete?");
        }
        return;
    }

    if (command.startsWith('call ')) {
        callContact(command.replace(/^call /, '').trim());
        return;
    }

    // ----- App openers -----
    const APPS = [
        ['youtube', 'YouTube', 'https://youtube.com'],
        ['instagram', 'Instagram', 'https://instagram.com'],
        ['whatsapp', 'WhatsApp', 'https://web.whatsapp.com'],
        ['facebook', 'Facebook', 'https://facebook.com'],
        ['twitter', 'Twitter', 'https://twitter.com'],
        ['snapchat', 'Snapchat', 'https://snapchat.com'],
        ['reddit', 'Reddit', 'https://reddit.com'],
        ['gmail', 'Gmail', 'https://mail.google.com'],
        ['maps', 'Google Maps', 'https://maps.google.com'],
        ['navigation', 'Google Maps', 'https://maps.google.com'],
        ['directions', 'Google Maps', 'https://maps.google.com'],
        ['google', 'Google', 'https://google.com'],
        ['notion', 'Notion', 'https://notion.so'],
        ['spotify', 'Spotify', 'https://open.spotify.com'],
        ['play music', 'Spotify', 'https://open.spotify.com'],
        ['netflix', 'Netflix', 'https://netflix.com'],
        ['amazon', 'Amazon', 'https://amazon.in'],
        ['linkedin', 'LinkedIn', 'https://linkedin.com'],
        ['github', 'GitHub', 'https://github.com']
    ];
    const app = APPS.find(([word]) => command.includes(word));
    if (app) {
        openApp(app[1], app[2]);
        return;
    }

    if (command.includes('joke')) {
        let jokes = [
            "Why do programmers prefer dark mode? Because light attracts bugs!",
            "Why did the developer go broke? He used up all his cache!",
            "Why do Java developers wear glasses? Because they do not C sharp!"
        ];
        let joke = jokes[Math.floor(Math.random() * jokes.length)];
        speak(joke);
        addMessage('aura', "😄 " + joke);
        return;
    }

    if (command.includes('motivate') || command.includes('inspire')) {
        let quotes = [
            "You are building something nobody has built before. Keep going.",
            "Every expert was once a beginner. Every pro was once an amateur.",
            "Aura believes in you. Now you believe in yourself."
        ];
        let quote = quotes[Math.floor(Math.random() * quotes.length)];
        speak(quote);
        addMessage('aura', "💪 " + quote);
        return;
    }

    if (command.includes('thank you') || command.includes('thanks')) {
        speak("Always here for you.");
        addMessage('aura', "😊 Always here for you.");
        return;
    }

    if (/\b(bye|goodbye)\b/.test(command)) {
        speak("Goodbye. Aura stays active, always protecting you.");
        addMessage('aura', "👋 Goodbye. Aura stays active.");
        return;
    }

    if (command.includes('weather') || command.includes('temperature') || command.includes('how hot') || command.includes('how cold')) {
        getWeather();
        return;
    }

    if (command.includes('morning briefing') || command.includes('daily briefing') || command.includes('brief me')) {
        morningBriefing();
        return;
    }

    askAI(command);
}

function emergency() {
    speak("Emergency mode activated. Please call your local emergency number now. In India, dial 1 1 2.");
    addMessage('aura', "🚨 Emergency: call your local emergency number now (112 in India) or ask someone nearby for help.");
}

// ===== AI FALLBACK (Gemini) =====
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent';

function geminiRequest(key, text, withPersona) {
    const body = { contents: [{ parts: [{ text: text }] }] };
    if (withPersona) {
        body.systemInstruction = { parts: [{ text:
            "You are Aura, a warm personal voice assistant" + (settings.name ? " talking to " + settings.name : "") +
            ". Reply in 1 to 3 short sentences of plain text, no markdown, no lists, easy to read aloud." }] };
    }
    return fetch(GEMINI_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify(body)
    });
}

async function testApiKey() {
    const input = document.getElementById('settingApiKey');
    const statusEl = document.getElementById('apiKeyStatus');
    if (!input || !statusEl) return;
    const key = input.value.trim();
    const show = (text, color) => { statusEl.textContent = text; statusEl.style.color = color; };
    if (!key) return show("⚠️ Paste a key first.", '#ffc861');
    show("Testing...", '#aaa3cc');
    try {
        const response = await geminiRequest(key, 'Say OK', false);
        if (response.ok) show("✅ Key works!", '#b692ff');
        else show("❌ Key rejected (check it's correct).", '#ff7a95');
    } catch (err) {
        show("❌ Network error while testing.", '#ff7a95');
    }
}

function saveApiKey() {
    const input = document.getElementById('apiKeyInput') || document.getElementById('settingApiKey');
    const key = input ? input.value.trim() : '';
    if (key) {
        localStorage.setItem('auraApiKey', key);
        addMessage('aura', "✅ API key saved on this device.");
    }
}

async function askAI(userText) {
    const apiKey = localStorage.getItem('auraApiKey');
    if (!apiKey) {
        speak("I don't know that one yet. Add a Gemini API key in Settings and I can answer anything.");
        addMessage('aura', "🔑 I don't know that one yet. Add a Gemini API key in Settings ⚙️ to unlock AI answers.");
        return;
    }
    const thinking = addMessage('aura', "🤔 Thinking...");
    try {
        const response = await geminiRequest(apiKey, userText, true);
        const data = await response.json();
        if (!response.ok) throw new Error((data.error && data.error.message) || 'Request failed');
        let reply = data.candidates && data.candidates[0] && data.candidates[0].content &&
            data.candidates[0].content.parts.map(p => p.text || '').join(' ').trim();
        if (!reply) throw new Error('Empty reply');
        reply = reply.replace(/[*_#`>]/g, '').replace(/\n{3,}/g, '\n\n').trim(); // plain text for speech
        if (thinking) thinking.remove();
        lastTopic = userText.slice(0, 40);
        speak(reply);
        addMessage('aura', "🤖 " + reply);
    } catch (err) {
        if (thinking) thinking.remove();
        speak("Sorry, I could not reach the AI right now.");
        addMessage('aura', "❌ AI request failed. Check your key in Settings or your internet connection.");
    }
}

// ===== CONTACTS SYSTEM =====
function saveContacts() {
    localStorage.setItem('auraContacts', JSON.stringify(contacts));
    contacts = loadContacts();
    renderContactsPanel();
}

/* Uses the panel that exists in index.html; creates one only if it's missing. */
function getContactsPanel() {
    let panel = document.getElementById('contactsPanel');
    if (panel) return panel;
    panel = document.createElement('div');
    panel.id = 'contactsPanel';
    panel.className = 'contacts-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'My contacts');
    panel.innerHTML = `
        <h3>📒 My Contacts</h3>
        <div style="display:flex; gap:8px; margin-bottom:6px;">
            <input class="contact-input" id="contactName" placeholder="Name e.g. Mom" aria-label="Contact name" />
            <input class="contact-input" id="contactNum" placeholder="Number" type="tel" aria-label="Contact number" />
        </div>
        <button class="add-contact-btn" onclick="addContact()">+ Add Contact</button>
        <div class="contact-list" id="contactList"></div>
        <button class="close-contacts-btn" onclick="toggleContacts()">✕ Close</button>`;
    (document.getElementById('app') || document.body).appendChild(panel);
    return panel;
}

function isContactsOpen() {
    const p = document.getElementById('contactsPanel');
    return !!p && p.style.display === 'block';
}

function renderContactsPanel() {
    const panel = document.getElementById('contactsPanel');
    if (!panel) return;
    contacts = loadContacts();

    const title = panel.querySelector('h3');
    if (title) title.textContent = '📒 My Contacts' + (contacts.length ? ' (' + contacts.length + ')' : '');

    const editing = editingContactIndex !== -1 && contacts[editingContactIndex];
    const nameInput = document.getElementById('contactName');
    const numInput = document.getElementById('contactNum');
    const addBtn = panel.querySelector('.add-contact-btn');
    if (editing) {
        if (nameInput) nameInput.value = capitalize(editing.name);
        if (numInput) numInput.value = editing.number;
    }
    if (addBtn) addBtn.textContent = editing ? '💾 Save Changes' : '+ Add Contact';

    const list = document.getElementById('contactList');
    if (!list) return;
    if (contacts.length === 0) {
        list.innerHTML = '<div class="contact-num" style="padding:6px 4px">No contacts yet. Add one above, or say "add contact".</div>';
        return;
    }
    const ghost = 'background:transparent;border:1px solid var(--line-hi, #555);color:inherit';
    list.innerHTML = contacts.map((c, i) => `
        <div class="contact-item">
            <div style="min-width:0">
                <div class="contact-name">${c.critical ? '⭐ ' : ''}${escapeHtml(capitalize(c.name))}</div>
                <div class="contact-num">${escapeHtml(c.number)}</div>
            </div>
            <div style="display:flex;gap:6px;flex-shrink:0">
                <button class="call-btn" style="${ghost};padding:0 12px" data-contact-crit="${i}"
                    aria-label="${c.critical ? 'Remove' : 'Mark'} ${escapeHtml(c.name)} as critical" title="Critical contacts can call through Focus and Drive mode">${c.critical ? '★' : '☆'}</button>
                <button class="call-btn" style="${ghost}" data-contact-edit="${i}" aria-label="Edit ${escapeHtml(c.name)}">Edit</button>
                <button class="call-btn" data-contact-call="${i}" aria-label="Call ${escapeHtml(c.name)}">Call</button>
            </div>
        </div>`).join('');
}

// One delegated listener for the list buttons (no names inside onclick strings)
document.addEventListener('click', function (e) {
    const call = e.target.closest('[data-contact-call]');
    const edit = e.target.closest('[data-contact-edit]');
    const crit = e.target.closest('[data-contact-crit]');
    if (call) { const c = contacts[+call.dataset.contactCall]; if (c) directCall(c.number, c.name); }
    if (edit) { const c = contacts[+edit.dataset.contactEdit]; if (c) startManualEdit(c.name); }
    if (crit) { const c = contacts[+crit.dataset.contactCrit]; if (c) toggleCritical(c.name); }
});

function handleContactFlow(command) {
    if (addingContact === 'waiting_name') {
        pendingName = command.trim();
        addingContact = 'waiting_number';
        speak("Got it. What is the number for " + pendingName + "?");
        addMessage('aura', "📞 What is " + capitalize(pendingName) + "'s number?");
        return true;
    }
    if (addingContact === 'waiting_number') {
        let number = command.replace(/[^\d+]/g, '');
        if (number.length < 3) {
            speak("That didn't sound like a number. Please say the number again.");
            addMessage('aura', "🔢 Please say the number again, digit by digit.");
            return true;
        }
        upsertContact(pendingName, number);
        speak("Contact " + pendingName + " saved with number " + number.split('').join(' '));
        addMessage('aura', "✅ Saved: " + capitalize(pendingName) + " — " + number);
        lastTopic = 'contacts';
        addingContact = false;
        pendingName = '';
        return true;
    }
    return false;
}

/* Adds a contact, or updates it when editing / when the name already exists.
   Keeps the Critical flag. */
function upsertContact(name, number) {
    name = name.toLowerCase().trim();
    let index = editingContactIndex !== -1 ? editingContactIndex : contacts.findIndex(c => c.name === name);
    if (index !== -1 && contacts[index]) {
        contacts[index] = { name: name, number: number, critical: !!contacts[index].critical };
    } else {
        contacts.push({ name: name, number: number, critical: false });
    }
    editingContactIndex = -1;
    saveContacts();
}

function handlePendingCritical(command) {
    if (pendingCriticalAction === 'waiting_name') {
        pendingCriticalAction = null;
        let match = findContactByName(command);
        if (match) {
            toggleCritical(match.name);
        } else {
            speak("I still could not find that contact. Say show contacts to check the list.");
            addMessage('aura', "❌ Still not found. Say 'show contacts' to check spelling.");
        }
        return true;
    }
    return false;
}

function addContact() {
    const nameEl = document.getElementById('contactName');
    const numEl = document.getElementById('contactNum');
    let name = nameEl ? nameEl.value.trim() : '';
    let number = numEl ? numEl.value.trim() : '';
    if (!name || !number) {
        addMessage('aura', '⚠️ Please enter both name and number.');
        return;
    }
    if (!/^[+\d][\d\s-]{2,}$/.test(number)) {
        addMessage('aura', '⚠️ That number looks wrong. Use digits, spaces or a leading +.');
        return;
    }
    const wasEditing = editingContactIndex !== -1;
    upsertContact(name, number.replace(/[\s-]/g, ''));
    addMessage('aura', (wasEditing ? '✅ Updated contact: ' : '✅ Added contact: ') + capitalize(name));
    resetContactForm();
}

function callContact(name) {
    let found = findContactByName(name);

    if (CALL_LOCK_MODES.includes(currentMode) && !(found && found.critical)) {
        const m = currentMode.toLowerCase();
        speak(capitalize(m) + " mode is on. Calls are blocked. Say normal mode first, or mark this contact as critical.");
        addMessage('aura', "🔒 Calls blocked in " + capitalize(m) + " mode. Mark the contact as Critical ⭐ to allow it.");
        return;
    }
    if (found) {
        if (found.critical && CALL_LOCK_MODES.includes(currentMode)) {
            addMessage('aura', "⭐ Critical contact — allowed through " + currentMode.toLowerCase() + " mode.");
        }
        speak("Calling " + found.name + " now.");
        addMessage('aura', "📞 Calling " + capitalize(found.name) + " — " + found.number);
        setTimeout(() => { window.location.href = 'tel:' + found.number; }, 1500);
    } else {
        speak("I could not find " + name + ". Say show contacts to check.");
        addMessage('aura', "❌ " + capitalize(name) + " not found. Say 'show contacts' to check.");
    }
}

function deleteContact(name) {
    let match = findContactByName(name);
    let index = match ? contacts.indexOf(match) : -1;
    if (index !== -1) {
        contacts.splice(index, 1);
        saveContacts();
        speak("Contact " + match.name + " deleted.");
        addMessage('aura', "🗑️ Deleted: " + capitalize(match.name));
    } else {
        speak("Contact " + name + " not found.");
        addMessage('aura', "❌ Contact not found: " + name);
    }
}

function findContactByName(text) {
    // Compare without punctuation, so a spoken "d souza" matches "d'souza"
    const norm = s => String(s || '').toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
    let clean = norm(text);
    if (!clean) return null;
    let exact = contacts.find(c => norm(c.name) === clean);
    if (exact) return exact;
    let words = clean.split(' ');
    return contacts.find(c => words.includes(norm(c.name)) || (' ' + clean + ' ').includes(' ' + norm(c.name) + ' ')) || null;
}

function toggleCritical(name) {
    let index = contacts.findIndex(c => c.name === name.toLowerCase());
    if (index === -1) return;
    contacts[index].critical = !contacts[index].critical;
    const nowCritical = contacts[index].critical;
    saveContacts();
    let status = nowCritical ? "marked as Critical — can call through Focus and Drive mode" : "removed from Critical";
    speak(name + " " + status);
    addMessage('aura', "⭐ " + capitalize(name) + " " + status + ".");
}

function startManualEdit(contactName) {
    let index = contacts.findIndex(c => c.name === contactName.toLowerCase());
    if (index === -1) {
        addMessage('aura', '❌ Contact not found: ' + contactName);
        return;
    }
    editingContactIndex = index;
    renderContactsPanel();
    const n = document.getElementById('contactName');
    if (n) n.focus();
    addMessage('aura', '✏️ Editing ' + capitalize(contactName) + '. Update the fields and tap Save Changes.');
}

function resetContactForm() {
    editingContactIndex = -1;
    const n = document.getElementById('contactName'), num = document.getElementById('contactNum');
    if (n) n.value = '';
    if (num) num.value = '';
    renderContactsPanel();
}

function editContact(oldName) {
    let match = findContactByName(oldName);
    if (!match) {
        speak("Contact " + oldName + " not found.");
        addMessage('aura', "❌ Contact not found: " + oldName);
        return;
    }
    editingContactIndex = contacts.indexOf(match);
    addingContact = 'waiting_name';
    openContacts(true);
    speak("Okay. What should the new name be for " + match.name + "?");
    addMessage('aura', "✏️ Editing " + capitalize(match.name) + ". What is the new name?");
}

function openContacts(silent) {
    const panel = getContactsPanel();
    panel.style.display = 'block';
    renderContactsPanel();
    setTimeout(() => { const n = document.getElementById('contactName'); if (n) n.focus(); }, 60);
    if (!silent) {
        speak("Opening your contacts.");
        addMessage('aura', "📒 Contacts opened.");
    }
}

function closeContacts() {
    const panel = document.getElementById('contactsPanel');
    if (panel) panel.style.display = 'none';
    editingContactIndex = -1;
    const n = document.getElementById('contactName'), num = document.getElementById('contactNum');
    if (n) n.value = '';
    if (num) num.value = '';
}

/* Button in the UI: open if closed, close if open */
function toggleContacts() {
    if (isContactsOpen()) closeContacts();
    else openContacts();
}

function directCall(number, name) {
    speak("Calling " + name + " now.");
    addMessage('aura', "📞 Calling " + capitalize(name) + " — " + number);
    closeContacts();
    setTimeout(() => { window.location.href = 'tel:' + number; }, 1000);
}

// ===== NOTES SYSTEM =====
function saveNotes() {
    localStorage.setItem('auraNotes', JSON.stringify(notes));
}

function addNote(text) {
    notes.push({
        text: text,
        time: new Date().toLocaleString('en-IN', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })
    });
    saveNotes();
    lastTopic = 'notes';
    speak("Noted: " + text);
    addMessage('aura', "📝 Noted: \"" + text + "\"");
}

function readNotes() {
    if (notes.length === 0) {
        speak("You have no notes saved yet.");
        addMessage('aura', "📝 No notes saved yet. Say 'note' followed by what you want to remember.");
        return;
    }
    lastTopic = 'notes';
    let spoken = notes.map((n, i) => (i + 1) + ". " + n.text).join(". ");
    speak("You have " + notes.length + " note" + (notes.length > 1 ? "s" : "") + ". " + spoken);
    let list = notes.map((n, i) => (i + 1) + ". " + n.text + " (" + n.time + ")").join("\n");
    addMessage('aura', "📝 Your notes:\n" + list);
}

function clearNotes() {
    notes = [];
    saveNotes();
    speak("All notes cleared.");
    addMessage('aura', "🗑️ All notes cleared.");
}

// ===== REMINDERS SYSTEM =====
function saveReminders() {
    // keep only pending reminders and fired ones from the last day
    const dayAgo = Date.now() - 86400000;
    reminders = reminders.filter(r => !r.fired || r.fireAt > dayAgo);
    localStorage.setItem('auraReminders', JSON.stringify(reminders));
}

function parseReminder(command) {
    // "remind me in 10 minutes to drink water"
    let m1 = command.match(/remind me (?:to )?in\s+(\d+)\s*(second|seconds|sec|secs|minute|minutes|min|mins|hour|hours|hr|hrs)\s+(?:to\s+)?(.+)/);
    if (m1) return { amount: parseInt(m1[1]), unit: m1[2], task: m1[3].trim() };

    // "remind me to drink water in 10 minutes"
    let m2 = command.match(/remind me to (.+?) in\s+(\d+)\s*(second|seconds|sec|secs|minute|minutes|min|mins|hour|hours|hr|hrs)/);
    if (m2) return { amount: parseInt(m2[2]), unit: m2[3], task: m2[1].trim() };

    return null;
}

function unitToMs(unit, amount) {
    if (unit.startsWith('sec')) return amount * 1000;
    if (unit.startsWith('min')) return amount * 60 * 1000;
    if (unit.startsWith('hour') || unit.startsWith('hr')) return amount * 60 * 60 * 1000;
    return amount * 60 * 1000;
}

function addReminder(msDelay, task) {
    let reminder = { id: Date.now(), task: task, fireAt: Date.now() + msDelay, fired: false };
    reminders.push(reminder);
    saveReminders();
    lastTopic = 'reminders';
    scheduleReminder(reminder, msDelay);

    let mins = Math.round(msDelay / 60000);
    let timeLabel = mins >= 1 ? (mins + " minute" + (mins > 1 ? "s" : "")) : Math.round(msDelay / 1000) + " seconds";
    speak("Okay, I will remind you to " + task + " in " + timeLabel + ".");
    addMessage('aura', "⏰ Reminder set: \"" + task + "\" in " + timeLabel + ".");
}

function scheduleReminder(reminder, msDelay) {
    setTimeout(() => fireReminder(reminder.id), msDelay);
}

function fireReminder(id) {
    let reminder = reminders.find(r => r.id === id);
    if (!reminder || reminder.fired) return;
    reminder.fired = true;
    saveReminders();
    speak("Reminder: " + reminder.task);
    addMessage('aura', "⏰🔔 Reminder: " + reminder.task);
    // System notification if the user allowed notifications in Settings
    try {
        if ('Notification' in window && Notification.permission === 'granted') {
            new Notification('AURA reminder', { body: reminder.task, icon: 'icon/icon-192.png', tag: 'aura-' + id });
        }
    } catch (e) { /* some mobile browsers only allow notifications via the service worker */ }
}

function recoverReminders() {
    let now = Date.now();
    reminders.forEach(r => {
        if (r.fired) return;
        let remaining = r.fireAt - now;
        if (remaining <= 0) {
            fireReminder(r.id); // missed while the app was closed — fire now
        } else {
            scheduleReminder(r, remaining);
        }
    });
}

// ===== CONTEXT MEMORY =====
function recallLastTopic() {
    if (!lastTopic) {
        speak("We have not talked about anything specific yet.");
        addMessage('aura', "🧠 Nothing tracked yet — start a conversation and I will remember it.");
        return;
    }
    speak("We were just talking about " + lastTopic + ".");
    addMessage('aura', "🧠 Last topic: " + lastTopic);
}

// ===== SETTINGS SYSTEM =====
function saveSettings() {
    localStorage.setItem('auraSettings', JSON.stringify(settings));
    applySettings();
}

function applySettings() {
    // Name is the big "Hello <name>" heading; the subtitle shows the prompt + city
    const homeName = document.getElementById('homeName');
    if (homeName && settings.name) homeName.textContent = settings.name;
    const subtitle = document.getElementById('headerSubtitle');
    if (subtitle) subtitle.textContent = PROMPT_LINE + (settings.city ? ' · ' + settings.city : '');
}

/* The new UI (aura-ui.js) replaces toggleSettings() with its Settings sheet,
   which edits `settings` and the API key directly. This simple panel is only a
   fallback if aura-ui.js isn't loaded. */
function toggleSettings() {
    let existing = document.getElementById('settingsPanel');
    if (existing) { existing.remove(); return; }
    let panel = document.createElement('div');
    panel.id = 'settingsPanel';
    panel.className = 'contacts-panel';
    panel.style.display = 'block';
    (document.getElementById('app') || document.body).appendChild(panel);
    renderSettingsPanel();
}

function renderSettingsPanel() {
    let panel = document.getElementById('settingsPanel');
    if (!panel) return;
    panel.innerHTML = `
        <h3>⚙️ Settings</h3>
        <label class="contact-num" for="settingName">Your name</label>
        <input class="contact-input" id="settingName" placeholder="e.g. Arjun" value="${escapeHtml(settings.name)}" style="width:100%;margin:4px 0 10px" />
        <label class="contact-num" for="settingCity">Your city (used for weather)</label>
        <input class="contact-input" id="settingCity" placeholder="e.g. Bengaluru" value="${escapeHtml(settings.city)}" style="width:100%;margin:4px 0 10px" />
        <label class="contact-num" for="settingApiKey">Gemini API key (for AI answers)</label>
        <input class="contact-input" type="password" id="settingApiKey" placeholder="Paste key here" value="${escapeHtml(localStorage.getItem('auraApiKey') || '')}" style="width:100%;margin:4px 0 8px" />
        <button class="close-contacts-btn" onclick="testApiKey()" style="margin-top:0">🧪 Test Key</button>
        <div id="apiKeyStatus" class="contact-num" style="margin:8px 0"></div>
        <button class="add-contact-btn" onclick="submitSettings()">💾 Save Settings</button>
        <button class="close-contacts-btn" onclick="document.getElementById('settingsPanel').remove()">✕ Close</button>`;
}

function submitSettings() {
    let name = document.getElementById('settingName').value.trim();
    let city = document.getElementById('settingCity').value.trim();
    let apiKey = document.getElementById('settingApiKey').value.trim();
    settings.name = name;
    settings.city = city;
    if (apiKey) localStorage.setItem('auraApiKey', apiKey);
    saveSettings();
    addMessage('aura', "✅ Settings saved" + (name ? " — hi " + name + "!" : "."));
    if (name) {
        let cityPhrase = city ? " and I will remember your city as " + city : "";
        speak("Hello " + name + cityPhrase + ". I will greet you by your name from now on.");
    }
    document.getElementById('settingsPanel').remove();
}

// ===== HELPERS =====
function addMessage(sender, text) {
    let chatArea = document.getElementById('chatArea');
    if (!chatArea) return null;
    let div = document.createElement('div');
    div.className = sender === 'aura' ? 'aura-message' : 'user-message';
    div.textContent = text;
    chatArea.appendChild(div);
    chatArea.scrollTop = chatArea.scrollHeight;
    return div;
}

function speak(text) {
    if (!synth || typeof SpeechSynthesisUtterance === 'undefined') return;
    speechQueue.push(text);
    if (!isSpeakingNow) {
        playNextSpeech();
    }
}

function playNextSpeech() {
    if (speechQueue.length === 0) {
        isSpeakingNow = false;
        return;
    }
    isSpeakingNow = true;
    let nextText = speechQueue.shift();
    let utterance = new SpeechSynthesisUtterance(nextText);
    utterance.rate = 0.95;   // aura-ui.js multiplies this by the Settings speed
    utterance.pitch = 1.1;   // and by the personality's pitch
    utterance.volume = 1;
    utterance.lang = 'en-IN';
    utterance.onend = () => playNextSpeech();
    utterance.onerror = () => playNextSpeech();
    synth.speak(utterance);
}

// ===== WEATHER + BRIEFING =====
async function geocodeCity(cityName) {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 4000);
        let res = await fetch('https://geocoding-api.open-meteo.com/v1/search?name=' + encodeURIComponent(cityName) + '&count=1', { signal: controller.signal });
        clearTimeout(timeoutId);
        let data = await res.json();
        if (data.results && data.results.length > 0) {
            let r = data.results[0];
            return { lat: r.latitude, lon: r.longitude, city: r.name };
        }
        return null;
    } catch (e) {
        return null;
    }
}

async function resolveWeatherLocation() {
    if (settings.city) {
        let geo = await geocodeCity(settings.city);
        if (geo) return geo;
    }
    return getCurrentLocation();
}

function getCurrentLocation() {
    const fallback = { lat: 12.97, lon: 77.59, city: 'Bengaluru' };
    return new Promise((resolve) => {
        if (!navigator.geolocation) { resolve(fallback); return; }
        let timeout = setTimeout(() => resolve(fallback), 3000);
        navigator.geolocation.getCurrentPosition(
            (position) => {
                clearTimeout(timeout);
                resolve({ lat: position.coords.latitude, lon: position.coords.longitude, city: 'your location' });
            },
            () => { clearTimeout(timeout); resolve(fallback); },
            { timeout: 3000, maximumAge: 600000 }
        );
    });
}

async function getWeather(lat = null, lon = null, city = null) {
    try {
        addMessage('aura', "🌤️ Fetching live weather...");
        if (lat === null || lon === null) {
            let location = await resolveWeatherLocation();
            lat = location.lat;
            lon = location.lon;
            city = location.city;
        }
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        let response = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true&timezone=auto`, { signal: controller.signal });
        clearTimeout(timeoutId);
        if (!response.ok) throw new Error('Weather HTTP ' + response.status);
        let data = await response.json();
        let temp = Math.round(data.current_weather.temperature);
        let windspeed = Math.round(data.current_weather.windspeed);
        let condition = getWeatherCondition(data.current_weather.weathercode);
        lastTopic = 'weather';
        speak("Current weather in " + city + " is " + temp + " degrees celsius with " + condition + ". Wind speed is " + windspeed + " kilometres per hour.");
        addMessage('aura', "🌡️ " + city + ": " + temp + "°C, " + condition + " · 💨 " + windspeed + " km/h");
    } catch (error) {
        speak("I could not fetch the weather right now. Please check your internet.");
        addMessage('aura', "❌ Weather unavailable. Check your internet connection.");
    }
}

/* WMO weather codes used by Open-Meteo */
function getWeatherCondition(code) {
    if (code === 0) return "clear sky";
    if (code <= 2) return "partly cloudy";
    if (code === 3) return "overcast skies";
    if (code === 45 || code === 48) return "fog";
    if (code >= 51 && code <= 57) return "light drizzle";
    if (code >= 61 && code <= 67) return "rain";
    if (code >= 71 && code <= 77) return "snow";
    if (code >= 80 && code <= 82) return "rain showers";
    if (code === 85 || code === 86) return "snow showers";
    if (code >= 95) return "thunderstorms";
    return "mixed weather";
}

async function morningBriefing() {
    lastTopic = 'daily briefing';
    let time = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
    let date = new Date().toLocaleDateString('en-IN', { weekday: 'long', month: 'long', day: 'numeric' });
    let namePart = settings.name ? ", " + settings.name : "";
    addMessage('aura', "🌅 Good morning" + namePart + "! Starting your daily briefing...");
    let location = await resolveWeatherLocation();
    speak("Good morning" + namePart + "! Today is " + date + ". The time is " + time + ". I am checking the weather for " + location.city + " now.");

    try {
        await getWeather(location.lat, location.lon, location.city);
    } catch (error) { /* getWeather handles its own messages */ }

    const pending = reminders.filter(r => !r.fired).length;
    if (pending) {
        speak("You have " + pending + " reminder" + (pending > 1 ? "s" : "") + " coming up.");
        addMessage('aura', "⏰ " + pending + " reminder" + (pending > 1 ? "s" : "") + " coming up.");
    }

    let tips = [
        "Stay hydrated and take breaks every hour.",
        "Your focus is your superpower today. Protect it.",
        "One step at a time. You have got this.",
        "Make today count. Aura is with you."
    ];
    let tip = tips[Math.floor(Math.random() * tips.length)];
    speak("And here is your daily tip. " + tip);
    addMessage('aura', "💡 Daily tip: " + tip);
}

// ===== APP OPENER =====
function openApp(appName, url) {
    let appKey = appName.toLowerCase();
    let activeMode = currentMode === 'STUDY' ? 'FOCUS' : currentMode;
    let blockedApps = modeRules[activeMode] || [];

    if (blockedApps.some(app => appKey.includes(app))) {
        lastTopic = 'app access';
        speak(appName + " is blocked in " + activeMode.toLowerCase() + " mode. Say normal mode to unlock.");
        addMessage('aura', "🔒 " + appName + " is blocked in " + activeMode + " mode. Say 'normal mode' to unlock.");
        return;
    }

    speak("Opening " + appName + " for you.");
    addMessage('aura', "📱 Opening " + appName + "...");
    setTimeout(() => window.open(url, '_blank'), 1000);
}

function setMode(mode) {
    currentMode = mode;
    lastTopic = mode.toLowerCase() + ' mode';
    const color = MODE_COLORS[mode] || MODE_COLORS.NORMAL;
    const display = document.getElementById('modeDisplay');
    if (display) {
        display.textContent = 'MODE: ' + mode + ' ✓';
        display.style.color = color;
        display.style.borderColor = mode === 'NORMAL' ? '' : color;
    }
    document.body.dataset.mode = mode.toLowerCase(); // lets CSS react to modes if you want
    const screen = document.querySelector('.screen');
    if (screen) screen.style.borderTop = mode === 'NORMAL' ? '' : '3px solid ' + color;
}

function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js').catch(err => {
            console.warn('Service worker registration failed:', err);
        });
    }
}

// ===== START =====
/* Only greet once onboarding in the new UI is finished (or if it isn't used) */
function onboardingDone() {
    try {
        const p = JSON.parse(localStorage.getItem('aura.profile.v1') || 'null');
        return !p || !!p.setupDone;
    } catch (e) { return true; }
}

window.addEventListener('load', function () {
    setupVoice();
    recoverReminders();
    applySettings();
    registerServiceWorker();

    // Browsers block speech until the user taps once, so greet on the first tap.
    // Skip it if that first tap is the mic (the user wants to talk, not listen).
    if (!onboardingDone()) return;
    const greet = function (e) {
        document.removeEventListener('pointerdown', greet, true);
        if (e && e.target && e.target.closest && e.target.closest('#micButton, .av-mic, input, textarea')) return;
        let namePart = settings.name ? ", " + settings.name : "";
        let cityPart = settings.city ? " from " + settings.city : "";
        speak("Hello" + namePart + cityPart + ". I am Aura. Tap the mic and talk to me.");
    };
    document.addEventListener('pointerdown', greet, true);
});
