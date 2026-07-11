// AURA Voice Brain - Complete Working File

let isListening = false;
let recognition;
let synth = window.speechSynthesis;
let speechQueue = [];
let currentMode = 'NORMAL';
let addingContact = false;
let pendingName = '';
let editingContactIndex = -1;
let pendingCriticalAction = null; // null | 'waiting_name'
let notes = JSON.parse(localStorage.getItem('auraNotes') || '[]');
let reminders = JSON.parse(localStorage.getItem('auraReminders') || '[]');
let lastTopic = null;
let contacts = JSON.parse(localStorage.getItem('auraContacts') || '[]')
    .map(c => ({ name: c.name, number: c.number, critical: !!c.critical }));
let settings = JSON.parse(localStorage.getItem('auraSettings') || 'null') || { name: '', city: '' };
let modeRules = {
    FOCUS: ['instagram', 'youtube', 'facebook', 'twitter', 'snapchat', 'reddit', 'netflix', 'spotify'],
    WORK: ['instagram', 'youtube', 'facebook', 'twitter', 'snapchat', 'reddit', 'netflix'],
    SLEEP: ['instagram', 'youtube', 'facebook', 'twitter', 'snapchat', 'reddit', 'netflix', 'spotify', 'google'],
    NORMAL: []
};

// ===== VOICE SETUP =====
function setupVoice() {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
        addMessage('aura', 'Voice not supported. Use Chrome.');
        return;
    }
    recognition = new (window.SpeechRecognition || window.webkitSpeechRecognition)();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = 'en-IN';

    recognition.onstart = function () {
        document.getElementById('transcript').textContent = 'Listening... speak now';
        document.getElementById('micButton').textContent = '🔴 LISTENING...';
        document.getElementById('micButton').style.background = 'linear-gradient(135deg, #ff416c, #ff4b2b)';
    };

    recognition.onresult = function (event) {
        let transcript = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
            transcript += event.results[i][0].transcript;
        }
        document.getElementById('transcript').textContent = 'You said: ' + transcript;
        if (event.results[event.resultIndex].isFinal) {
            handleCommand(transcript.toLowerCase().trim());
        }
    };

    recognition.onend = function () {
        isListening = false;
        document.getElementById('micButton').textContent = '🎤 SPEAK NOW';
        document.getElementById('micButton').style.background = 'linear-gradient(135deg, #667eea, #764ba2)';
        document.getElementById('transcript').textContent = 'Listening...';
    };

    recognition.onerror = function (event) {
        document.getElementById('transcript').textContent = 'Error: ' + event.error + ' — try again';
        isListening = false;
        document.getElementById('micButton').textContent = '🎤 SPEAK NOW';
        document.getElementById('micButton').style.background = 'linear-gradient(135deg, #667eea, #764ba2)';
    };
}

function stopSpeaking() {
    synth.cancel();
    speechQueue = [];
    isSpeakingNow = false;
}

function toggleMic() {
    if (!recognition) setupVoice();
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
        document.getElementById('transcript').textContent = 'Error starting microphone. Tap again.';
        document.getElementById('micButton').textContent = '🎤 SPEAK NOW';
        document.getElementById('micButton').style.background = 'linear-gradient(135deg, #667eea, #764ba2)';
    }
}

function normalizeCommand(command) {
    return (command || '')
        .toLowerCase()
        .replace(/[^\w\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

// ===== COMMAND BRAIN =====
function handleCommand(command) {
    command = normalizeCommand(command);
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
        let text = command.replace(/^note\s*/, '').replace(/^add note\s*/, '').trim();
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
        let name = command.replace('my name is ', '').replace('call me ', '').trim();
        if (name) {
            settings.name = name.charAt(0).toUpperCase() + name.slice(1);
            saveSettings();
            speak("Got it, I will call you " + settings.name + " from now on.");
            addMessage('aura', "👤 Nice to meet you, " + settings.name + "!");
        }
        return;
    }

    const isGreeting = command === 'a' || command === 'aura' || command === 'hello a' || command === 'hello aura' || command === 'hi a' || command === 'hi aura' || command === 'hey a' || command === 'hey aura' || command.includes('hello') || command.includes('hi aura') || command.includes('hey aura');
    if (isGreeting) {
        let namePart = settings.name ? ", " + settings.name : "";
        speak("Hello" + namePart + "! I am AURA, your personal AI assistant. How can I help you today?");
        addMessage('aura', "Hello" + namePart + "! I am AURA. How can I help you today?");
        return;
    }

    if (command.includes('good morning')) {
        morningBriefing();
        return;
    }

    if (command.includes('good night')) {
        speak("Good night! Sleep well.");
        addMessage('aura', "Good night! Sleep well.");
        return;
    }

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

    if (command.includes('normal mode') || command.includes('free mode') || command.includes('focus off')) {
        setMode('NORMAL');
        speak("Normal mode. All clear.");
        addMessage('aura', "✅ Normal mode. All clear.");
        return;
    }

    if (command.includes('what are you') || command.includes('who are you') || command.includes('what is aura')) {
        speak("I am AURA. Your personal AI that protects your focus, filters your calls, and acts before you ask.");
        addMessage('aura', "I am AURA — protecting your focus, filtering calls, always on your side.");
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

    if (command.includes('youtube') || command.includes('open youtube')) {
        openApp('YouTube', 'https://youtube.com');
        return;
    }

    if (command.includes('instagram') || command.includes('open instagram')) {
        openApp('Instagram', 'https://instagram.com');
        return;
    }

    if (command.includes('whatsapp') || command.includes('open whatsapp')) {
        openApp('WhatsApp', 'https://web.whatsapp.com');
        return;
    }

    if (command.includes('facebook') || command.includes('open facebook')) {
        openApp('Facebook', 'https://facebook.com');
        return;
    }

    if (command.includes('twitter') || command.includes('open twitter')) {
        openApp('Twitter', 'https://twitter.com');
        return;
    }

    if (command.includes('snapchat') || command.includes('open snapchat')) {
        openApp('Snapchat', 'https://snapchat.com');
        return;
    }

    if (command.includes('reddit') || command.includes('open reddit')) {
        openApp('Reddit', 'https://reddit.com');
        return;
    }

    if (command.includes('google') || command.includes('open google')) {
        openApp('Google', 'https://google.com');
        return;
    }

    if (command.includes('gmail') || command.includes('open gmail')) {
        openApp('Gmail', 'https://mail.google.com');
        return;
    }

    if (command.includes('maps') || command.includes('navigation') || command.includes('directions')) {
        openApp('Google Maps', 'https://maps.google.com');
        return;
    }

    if (command.includes('notion') || command.includes('open notion')) {
        openApp('Notion', 'https://notion.so');
        return;
    }

    if (command.includes('spotify') || command.includes('play music')) {
        openApp('Spotify', 'https://open.spotify.com');
        return;
    }

    if (command.includes('netflix') || command.includes('open netflix')) {
        openApp('Netflix', 'https://netflix.com');
        return;
    }

    if (command.includes('amazon') || command.includes('open amazon')) {
        openApp('Amazon', 'https://amazon.in');
        return;
    }

    if (command.includes('linkedin') || command.includes('open linkedin')) {
        openApp('LinkedIn', 'https://linkedin.com');
        return;
    }

    if (command.includes('github') || command.includes('open github')) {
        openApp('GitHub', 'https://github.com');
        return;
    }

    if (command.includes('search for') || command.includes('google search') || command.includes('search')) {
        let query = command.replace('search for', '').replace('google search', '').replace('search', '').trim();
        if (query) {
            speak("Searching for " + query);
            addMessage('aura', "🔍 Searching: " + query);
            setTimeout(() => window.open('https://google.com/search?q=' + encodeURIComponent(query), '_blank'), 1000);
        }
        return;
    }

    if (command.includes('take me to') || command.includes('navigate to') || command.includes('directions to')) {
        let place = command.replace('take me to', '').replace('navigate to', '').replace('directions to', '').trim();
        if (place) {
            speak("Opening navigation to " + place);
            addMessage('aura', "🗺️ Navigating to " + place + "...");
            setTimeout(() => window.open('https://maps.google.com/?q=' + encodeURIComponent(place), '_blank'), 1000);
        }
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
            "AURA believes in you. Now you believe in yourself."
        ];
        let quote = quotes[Math.floor(Math.random() * quotes.length)];
        speak(quote);
        addMessage('aura', "💪 " + quote);
        return;
    }

    if (command.includes('add contact') || command.includes('save contact') || command.includes('new contact')) {
        addingContact = 'waiting_name';
        speak("Sure. What is the name of the contact?");
        addMessage('aura', "📒 What is the name of the contact?");
        return;
    }

    if (command.includes('show contacts') || command.includes('my contacts') || command.includes('contact list') || command.includes('open contacts')) {
        toggleContacts();
        return;
    }

   if ((command.includes('mark') && command.includes('critical')) || (command.includes('make') && command.includes('critical'))) {
        let name = command.replace(/mark|make|as|critical|contact/g, '').trim();
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
        let name = command.replace('edit contact', '').replace('edit', '').trim();
        if (name) {
            editContact(name);
        } else {
            speak("Which contact should I edit?");
            addMessage('aura', "✏️ Which contact should I edit?");
        }
        return;
    }

    if (command.includes('delete contact') || command.includes('remove contact') ||
        ((command.startsWith('delete ') || command.startsWith('remove ')) &&
         contacts.some(c => command.includes(c.name)))) {
        let name = command.replace('delete contact', '').replace('remove contact', '')
                           .replace('delete', '').replace('remove', '').trim();
        if (name) {
            deleteContact(name);
        } else {
            speak("Which contact should I delete?");
            addMessage('aura', "🗑️ Which contact should I delete?");
        }
        return;
    }

    if (command.startsWith('call ')) {
        let name = command.replace('call ', '').trim();
        callContact(name);
        return;
    }

    if (command.includes('thank you') || command.includes('thanks')) {
        speak("Always here for you.");
        addMessage('aura', "😊 Always here for you.");
        return;
    }

    if (command.includes('bye') || command.includes('goodbye')) {
        speak("Goodbye. AURA stays active, always protecting you.");
        addMessage('aura', "👋 Goodbye. AURA stays active.");
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

    askAI(command);
}

async function testApiKey() {
    const key = document.getElementById('settingApiKey').value.trim();
    const statusEl = document.getElementById('apiKeyStatus');
    if (!key) {
        statusEl.textContent = "⚠️ Paste a key first.";
        statusEl.style.color = "#fbbf24";
        return;
    }
    statusEl.textContent = "Testing...";
    statusEl.style.color = "#888";
    try {
        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${key}`,
            {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ contents: [{ parts: [{ text: "Say OK" }] }] })
            }
        );
        if (response.ok) {
            statusEl.textContent = "✅ Key works!";
            statusEl.style.color = "#00ff88";
        } else {
            statusEl.textContent = "❌ Key rejected (check it's correct).";
            statusEl.style.color = "#ff4444";
        }
    } catch (err) {
        statusEl.textContent = "❌ Network error while testing.";
        statusEl.style.color = "#ff4444";
    }
}

function emergency() {
    speak("Emergency mode activated. Please call your local emergency services immediately or contact someone nearby.");
    addMessage('aura', "🚨 Emergency mode activated. Please call local emergency services immediately.");
}

// ===== AI FALLBACK =====
function saveApiKey() {
    const key = document.getElementById('apiKeyInput').value.trim();
    if (key) {
        localStorage.setItem('auraApiKey', key);
        document.getElementById('apiKeyInput').value = '';
        addMessage('aura', "✅ API key saved for this session.");
    }
}

async function askAI(userText) {
    const apiKey = localStorage.getItem('auraApiKey');
    if (!apiKey) {
        speak("Please add your API key first.");
        addMessage('aura', "🔑 No API key set. Paste one in the box above.");
        return;
    }
    addMessage('aura', "🤔 Thinking...");
    try {
        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${apiKey}`,
            {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: userText }] }]
                })
            }
        );
        const data = await response.json();
        const reply = data.candidates[0].content.parts[0].text;
        speak(reply);
        addMessage('aura', "🤖 " + reply);
    } catch (err) {
        speak("Sorry, I could not reach the AI right now.");
        addMessage('aura', "❌ AI request failed.");
    }
}

// ===== CONTACTS SYSTEM =====
function saveContacts() {
    localStorage.setItem('auraContacts', JSON.stringify(contacts));
    contacts = JSON.parse(localStorage.getItem('auraContacts') || '[]')
        .map(c => ({ name: c.name, number: c.number, critical: !!c.critical }));
    renderContactsPanel();
}

function renderContactsPanel() {
    let panel = document.getElementById('contactsPanel');
    if (!panel) return;

    contacts = JSON.parse(localStorage.getItem('auraContacts') || '[]')
        .map(c => ({ name: c.name, number: c.number, critical: !!c.critical }));
    let stored = contacts;
    let currentName = editingContactIndex !== -1 && contacts[editingContactIndex] ? contacts[editingContactIndex].name : '';
    let currentNumber = editingContactIndex !== -1 && contacts[editingContactIndex] ? contacts[editingContactIndex].number : '';

    let listHtml = '';
    if (stored.length === 0) {
        listHtml = `<div style="color:#888;font-size:12px">No contacts yet. Add one below.</div>`;
    } else {
        stored.forEach(c => {
            listHtml += `
                <div style="display:flex;justify-content:space-between;align-items:center;background:#0d0d1a;border-radius:8px;padding:8px 10px;margin-bottom:6px">
                    <div>
                        <div style="color:#fff;font-size:13px;text-transform:capitalize">${c.critical ? '⭐ ' : ''}${c.name}</div>
                        <div style="color:#667eea;font-size:11px">${c.number}</div>
                    </div>
                    <div style="display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end">
                        <button onclick="directCall('${c.number}','${c.name}')"
                            style="background:#00ff88;border:none;border-radius:6px;padding:6px 12px;color:#000;font-size:12px;cursor:pointer;font-weight:bold">
                            📞 Call
                        </button>
                        <button onclick="startManualEdit('${c.name}')"
                            style="background:#667eea;border:none;border-radius:6px;padding:6px 12px;color:#fff;font-size:12px;cursor:pointer;font-weight:bold">
                            ✏️ Edit
                        </button>
                    </div>
                </div>
            `;
        });
    }

    panel.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
            <div style="color:#667eea;font-weight:bold">📒 Contacts (${stored.length})</div>
            <button onclick="resetContactForm();document.getElementById('contactsPanel').remove()"
                style="background:#ff4444;border:none;border-radius:8px;padding:6px 10px;color:white;cursor:pointer;font-size:12px">
                ✕ Close
            </button>
        </div>

        <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:10px">
            <input id="contactName" placeholder="Name e.g. Mom" value="${currentName}" style="padding:8px;border-radius:8px;border:1px solid #333;background:#0d0d1a;color:white;font-size:13px" />
            <input id="contactNum" placeholder="Number" type="tel" value="${currentNumber}" style="padding:8px;border-radius:8px;border:1px solid #333;background:#0d0d1a;color:white;font-size:13px" />
            <button class="add-contact-btn" onclick="addContact()"
                style="padding:8px;border:none;border-radius:8px;background:${editingContactIndex !== -1 ? '#fbbf24' : '#667eea'};color:${editingContactIndex !== -1 ? '#000' : '#fff'};font-size:13px;cursor:pointer;font-weight:bold">
                ${editingContactIndex !== -1 ? '💾 Save Edit' : '+ Add Contact'}
            </button>
        </div>

        <div style="color:#888;font-size:12px;margin-bottom:8px">Tip: use voice like “edit contact mom” or edit manually below.</div>
        <div style="max-height:180px;overflow-y:auto">${listHtml}</div>
    `;

    setTimeout(() => {
        let nameInput = document.getElementById('contactName');
        if (nameInput) nameInput.focus();
    }, 50);
}

function handleContactFlow(command) {
    if (addingContact === 'waiting_name') {
        pendingName = command.trim();
        addingContact = 'waiting_number';
        speak("Got it. What is the number for " + pendingName + "?");
        addMessage('aura', "📞 What is " + pendingName + "'s number?");
        return true;
    }
    if (addingContact === 'waiting_number') {
        let number = command.replace(/\s/g, '');
        if (editingContactIndex !== -1) {
            contacts[editingContactIndex] = { name: pendingName.toLowerCase(), number: number };
            saveContacts();
            speak("Contact " + pendingName + " updated with number " + number);
            addMessage('aura', "✅ Updated: " + pendingName + " — " + number);
        } else {
            contacts.push({ name: pendingName.toLowerCase(), number: number });
            saveContacts();
            speak("Contact " + pendingName + " saved with number " + number);
            addMessage('aura', "✅ Saved: " + pendingName + " — " + number);
        }
        lastTopic = 'contacts';
        addingContact = false;
        pendingName = '';
        editingContactIndex = -1;
        return true;
    }
    return false;
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
    let name = document.getElementById('contactName').value.trim();
    let number = document.getElementById('contactNum').value.trim();
    if (!name || !number) {
        addMessage('aura', '⚠️ Please enter both name and number.');
        return;
    }

    if (editingContactIndex !== -1) {
        contacts[editingContactIndex] = { name: name.toLowerCase(), number: number };
        saveContacts();
        addMessage('aura', '✅ Updated contact: ' + name);
    } else {
        contacts.push({ name: name.toLowerCase(), number: number });
        saveContacts();
        addMessage('aura', '✅ Added contact: ' + name);
    }

    resetContactForm();
}

function callContact(name) {
    let found = contacts.find(c => c.name === name.toLowerCase().trim());

    if ((currentMode === 'FOCUS' || currentMode === 'STUDY') && !(found && found.critical)) {
        speak("Focus mode is on. Calls are blocked. Say normal mode first, or mark this contact as critical.");
        addMessage('aura', "🔒 Calls blocked in Focus mode. Mark as Critical to allow through.");
        return;
    }
    if (found) {
        if (found.critical && (currentMode === 'FOCUS' || currentMode === 'STUDY')) {
            addMessage('aura', "⭐ Critical contact — bypassing Focus mode.");
        }
        speak("Calling " + found.name + " now.");
        addMessage('aura', "📞 Calling " + found.name + " — " + found.number);
        setTimeout(() => { window.location.href = 'tel:' + found.number; }, 1500);
    } else {
        speak("I could not find " + name + ". Say show contacts to check.");
        addMessage('aura', "❌ " + name + " not found. Say 'show contacts' to check.");
    }
}

function deleteContact(name) {
    let index = contacts.findIndex(c => c.name === name.toLowerCase());
    if (index !== -1) {
        contacts.splice(index, 1);
        saveContacts();
        speak("Contact " + name + " deleted.");
        addMessage('aura', "🗑️ Deleted: " + name);
    } else {
        speak("Contact " + name + " not found.");
        addMessage('aura', "❌ Contact not found: " + name);
    }
}
function findContactByName(text) {
    let clean = (text || '').toLowerCase().trim();
    let exact = contacts.find(c => c.name === clean);
    if (exact) return exact;
    let words = clean.split(' ');
    return contacts.find(c => words.includes(c.name) || clean.includes(c.name));
}
function toggleCritical(name) {
    let index = contacts.findIndex(c => c.name === name.toLowerCase());
    if (index === -1) return;
    contacts[index].critical = !contacts[index].critical;
    saveContacts();
    let status = contacts[index].critical ? "marked as Critical — will bypass Focus mode" : "removed from Critical";
    speak(name + " " + status);
    addMessage('aura', "⭐ " + name + " " + status + ".");
}

function startManualEdit(contactName) {
    let index = contacts.findIndex(c => c.name === contactName.toLowerCase());
    if (index === -1) {
        addMessage('aura', '❌ Contact not found: ' + contactName);
        return;
    }

    editingContactIndex = index;
    renderContactsPanel();
    addMessage('aura', '✏️ Editing ' + contactName + '. Update the fields and click save.');
}

function resetContactForm() {
    editingContactIndex = -1;
    renderContactsPanel();
}

function editContact(oldName) {
    let index = contacts.findIndex(c => c.name === oldName.toLowerCase());
    if (index === -1) {
        speak("Contact " + oldName + " not found.");
        addMessage('aura', "❌ Contact not found: " + oldName);
        return;
    }
    editingContactIndex = index;
    addingContact = 'waiting_name';
    if (!document.getElementById('contactsPanel')) {
        toggleContacts();
    } else {
        renderContactsPanel();
    }
    speak("Okay. What should the new name be for " + oldName + "?");
    addMessage('aura', "✏️ Editing " + oldName + ". What is the new name?");
}

function toggleContacts() {
    let existing = document.getElementById('contactsPanel');
    if (existing) {
        existing.remove();
    }
    let panel = document.createElement('div');
    panel.id = 'contactsPanel';
    panel.style.cssText = `
        position: fixed;
        bottom: 130px;
        left: 50%;
        transform: translateX(-50%);
        width: 320px;
        background: #1a1a2e;
        border: 1px solid #667eea;
        border-radius: 14px;
        padding: 14px;
        z-index: 9999;
        max-height: 320px;
        overflow-y: auto;
        box-shadow: 0 10px 40px rgba(0,0,0,0.5);
    `;
    document.body.appendChild(panel);
    renderContactsPanel();
    speak("Opening your contacts.");
    addMessage('aura', "📒 Contacts opened.");
}

function directCall(number, name) {
    speak("Calling " + name + " now.");
    addMessage('aura', "📞 Calling " + name + " — " + number);
    let panel = document.getElementById('contactsPanel');
    if (panel) panel.remove();
    setTimeout(() => { window.location.href = 'tel:' + number; }, 1000);
}
// ===== NOTES SYSTEM =====
function saveNotes() {
    localStorage.setItem('auraNotes', JSON.stringify(notes));
}

function addNote(text) {
    let note = {
        text: text,
        time: new Date().toLocaleString('en-IN', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })
    };
    notes.push(note);
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
    speak("You have " + notes.length + " notes. " + spoken);
    let listHtml = notes.map((n, i) => (i + 1) + ". " + n.text + " (" + n.time + ")").join("\n");
    addMessage('aura', "📝 Your notes:\n" + listHtml);
}

function clearNotes() {
    notes = [];
    saveNotes();
    speak("All notes cleared.");
    addMessage('aura', "🗑️ All notes cleared.");
}

// ===== REMINDERS SYSTEM =====
function saveReminders() {
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
}

function recoverReminders() {
    let now = Date.now();
    reminders.forEach(r => {
        if (r.fired) return;
        let remaining = r.fireAt - now;
        if (remaining <= 0) {
            fireReminder(r.id); // missed while tab was closed — fire now
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
    let subtitle = document.getElementById('headerSubtitle');
    if (subtitle) {
        let greeting = settings.name ? "Hi, " + settings.name : "Voice AI Assistant";
        if (settings.city) {
            greeting += " • " + settings.city;
        }
        subtitle.textContent = greeting;
    }
}

function toggleSettings() {
    let existing = document.getElementById('settingsPanel');
    if (existing) {
        existing.remove();
        return;
    }

    let panel = document.createElement('div');
    panel.id = 'settingsPanel';
    panel.style.cssText = `
        position: fixed;
        bottom: 130px;
        left: 50%;
        transform: translateX(-50%);
        width: 320px;
        background: #1a1a2e;
        border: 1px solid #667eea;
        border-radius: 14px;
        padding: 14px;
        z-index: 9999;
        box-shadow: 0 10px 40px rgba(0,0,0,0.5);
    `;
    document.body.appendChild(panel);
    renderSettingsPanel();
}

function renderSettingsPanel() {
    let panel = document.getElementById('settingsPanel');
    if (!panel) return;

    panel.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
            <h3 style="color:#667eea;font-size:13px;margin:0">⚙️ Settings</h3>
            <button onclick="document.getElementById('settingsPanel').remove()"
                style="background:#ff4444;border:none;border-radius:8px;padding:6px 10px;color:white;cursor:pointer;font-size:12px">✕</button>
        </div>

        <label style="font-size:11px;color:#888;display:block;margin-bottom:4px">Your name</label>
        <input id="settingName" placeholder="e.g. Arjun" value="${settings.name}"
            style="width:100%;padding:8px;border-radius:8px;border:1px solid #333;background:#0d0d1a;color:white;font-size:13px;margin-bottom:8px;box-sizing:border-box" />

        <label style="font-size:11px;color:#888;display:block;margin-bottom:4px">Your city (used for weather)</label>
        <input id="settingCity" placeholder="e.g. Bengaluru" value="${settings.city}"
            style="width:100%;padding:8px;border-radius:8px;border:1px solid #333;background:#0d0d1a;color:white;font-size:13px;margin-bottom:8px;box-sizing:border-box" />

        <label style="font-size:11px;color:#888;display:block;margin-bottom:4px">Gemini API Key (for AI fallback)</label>
        <input type="password" id="settingApiKey" placeholder="Paste key here" value="${localStorage.getItem('auraApiKey') || ''}"
            style="width:100%;padding:8px;border-radius:8px;border:1px solid #333;background:#0d0d1a;color:white;font-size:13px;margin-bottom:6px;box-sizing:border-box" />
        <button onclick="testApiKey()"
            style="width:100%;padding:7px;border:none;border-radius:8px;background:#00ff88;color:#000;font-size:12px;cursor:pointer;font-weight:bold;margin-bottom:8px">
            🧪 Test Key
        </button>
        <div id="apiKeyStatus" style="font-size:11px;color:#888;margin-bottom:8px"></div>

        <button onclick="submitSettings()"
            style="width:100%;padding:9px;border:none;border-radius:8px;background:#667eea;color:#fff;font-size:13px;cursor:pointer;font-weight:bold">
            💾 Save Settings
        </button>
    `;
}

function submitSettings() {
    let name = document.getElementById('settingName').value.trim();
    let city = document.getElementById('settingCity').value.trim();
    let apiKey = document.getElementById('settingApiKey').value.trim();
    settings.name = name;
    settings.city = city;
     if (apiKey) localStorage.setItem('auraApiKey', apiKey);
    saveSettings();
    let message = "✅ Settings saved" + (name ? " — hi " + name + "!" : ".");
    addMessage('aura', message);
    if (name) {
        let cityPhrase = city ? " and I will remember your city as " + city : "";
        speak("Hello " + name + cityPhrase + ". I will greet you by your name from now on.");
    }
    document.getElementById('settingsPanel').remove();
}

// ===== HELPERS =====
function addMessage(sender, text) {
    let chatArea = document.getElementById('chatArea');
    let div = document.createElement('div');
    div.className = sender === 'aura' ? 'aura-message' : 'user-message';
    div.textContent = text;
    chatArea.appendChild(div);
    chatArea.scrollTop = chatArea.scrollHeight;
}

let isSpeakingNow = false;

function speak(text) {
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
    utterance.rate = 0.95;
    utterance.pitch = 1.1;
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
    return new Promise((resolve) => {
        if (!navigator.geolocation) {
            resolve({ lat: 12.97, lon: 77.59, city: 'Bengaluru' });
            return;
        }

        let timeout = setTimeout(() => {
            resolve({ lat: 12.97, lon: 77.59, city: 'Bengaluru' });
        }, 1500);

        navigator.geolocation.getCurrentPosition(
            (position) => {
                clearTimeout(timeout);
                resolve({
                    lat: position.coords.latitude,
                    lon: position.coords.longitude,
                    city: 'your location'
                });
            },
            () => {
                clearTimeout(timeout);
                resolve({ lat: 12.97, lon: 77.59, city: 'Bengaluru' });
            },
            { timeout: 1500, maximumAge: 60000 }
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
        const timeoutId = setTimeout(() => controller.abort(), 4000);
        let response = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true&hourly=relativehumidity_2m&timezone=auto`, { signal: controller.signal });
        clearTimeout(timeoutId);
        let data = await response.json();
        let temp = data.current_weather.temperature;
        let windspeed = data.current_weather.windspeed;
        let code = data.current_weather.weathercode;

        let condition = getWeatherCondition(code);
        let msg = "Current weather in " + city + " is " + temp + " degrees celsius with " + condition + ". Wind speed is " + windspeed + " kilometres per hour.";
        lastTopic = 'weather';
        speak(msg);
        addMessage('aura', "🌡️ " + temp + "°C — " + condition + " | 💨 Wind: " + windspeed + " km/h");
    } catch (error) {
        speak("I could not fetch weather right now. Please check your internet.");
        addMessage('aura', "❌ Weather unavailable. Check internet connection.");
    }
}

function getWeatherCondition(code) {
    if (code === 0) return "clear sky";
    if (code <= 3) return "partly cloudy";
    if (code <= 9) return "foggy";
    if (code <= 19) return "drizzling";
    if (code <= 29) return "thunderstorm nearby";
    if (code <= 39) return "dusty winds";
    if (code <= 49) return "foggy";
    if (code <= 59) return "light drizzle";
    if (code <= 69) return "raining";
    if (code <= 79) return "heavy snow";
    if (code <= 84) return "rain showers";
    if (code <= 94) return "thunderstorm";
    return "heavy thunderstorm";
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
    } catch (error) {
        // Weather fetch already handles its own fallback messaging
    }

    let tips = [
        "Stay hydrated and take breaks every hour.",
        "Your focus is your superpower today. Protect it.",
        "One step at a time. You have got this.",
        "Make today count. AURA is with you."
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

    if (blockedApps.length > 0) {
        let isBlocked = blockedApps.some(app => appKey.includes(app));
        if (isBlocked) {
            lastTopic = 'app access';
            speak(appName + " is blocked in " + activeMode.toLowerCase() + " mode. Say normal mode to unlock.");
            addMessage('aura', "🔒 " + appName + " blocked in " + activeMode + " mode. Say 'normal mode' to unlock.");
            return;
        }
    }

    speak("Opening " + appName + " for you.");
    addMessage('aura', "📱 Opening " + appName + "...");
    setTimeout(() => window.open(url, '_blank'), 1000);
}

function setMode(mode) {
    currentMode = mode;
    lastTopic = mode.toLowerCase() + ' mode';
    document.getElementById('modeDisplay').textContent = 'MODE: ' + mode + ' ✓';
    let screen = document.querySelector('.screen');
    if (mode === 'FOCUS' || mode === 'STUDY') {
        screen.style.borderTop = '3px solid #ff4444';
        document.getElementById('modeDisplay').style.color = '#ff4444';
    } else if (mode === 'WORK') {
        screen.style.borderTop = '3px solid #fbbf24';
        document.getElementById('modeDisplay').style.color = '#fbbf24';
    } else if (mode === 'SLEEP') {
        screen.style.borderTop = '3px solid #60a5fa';
        document.getElementById('modeDisplay').style.color = '#60a5fa';
    } else if (mode === 'OFFICE') {
        screen.style.borderTop = '3px solid #f59e0b';
        document.getElementById('modeDisplay').style.color = '#f59e0b';
    } else if (mode === 'FAMILY') {
        screen.style.borderTop = '3px solid #ec4899';
        document.getElementById('modeDisplay').style.color = '#ec4899';
    } else if (mode === 'GYM') {
        screen.style.borderTop = '3px solid #10b981';
        document.getElementById('modeDisplay').style.color = '#10b981';
    } else if (mode === 'DRIVE') {
        screen.style.borderTop = '3px solid #f97316';
        document.getElementById('modeDisplay').style.color = '#f97316';
    } else {
        screen.style.borderTop = '3px solid #00ff88';
        document.getElementById('modeDisplay').style.color = '#00ff88';
    }
}
function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js').catch(err => {
            console.warn('Service worker registration failed:', err);
        });
    }
}

// ===== START =====
window.onload = function () {
    setupVoice();
    recoverReminders();
    applySettings();
    registerServiceWorker();
    setTimeout(() => {
        let namePart = settings.name ? ", " + settings.name : "";
        let cityPart = settings.city ? " from " + settings.city : "";
        speak("Hello" + namePart + cityPart + ". I am AURA. Tap speak now and talk to me.");
    }, 1000);
};
