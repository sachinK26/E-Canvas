// Landing logic
const landingOverlay = document.getElementById('landingOverlay');
const gameContainer = document.getElementById('gameContainer');
const nextStepBtn = document.getElementById('nextStepBtn');
const step1Card = document.getElementById('step1Card');
const step2Card = document.getElementById('step2Card');
const createRoomBtn = document.getElementById('createRoomBtn');
const joinRoomBtn = document.getElementById('joinRoomBtn');
const backBtn = document.getElementById('backBtn');
const playerNameInput = document.getElementById('playerNameInput');
const roomNameInput = document.getElementById('roomNameInput');
const landingError = document.getElementById('landingError');

// Game UI Elements
const canvas = document.getElementById('whiteboard');
const ctx = canvas.getContext('2d');
const colorPicker = document.getElementById('colorPicker');
const sizePicker = document.getElementById('sizePicker');
const sizeValue = document.getElementById('sizeValue');
const clearBtn = document.getElementById('clearBtn');
const roleDisplay = document.getElementById('roleDisplay');
const wordDisplay = document.getElementById('wordDisplay');
const toolbar = document.getElementById('toolbar');
const chatMessages = document.getElementById('chatMessages');
const chatInput = document.getElementById('chatInput');
const sendBtn = document.getElementById('sendBtn');
const playerNameDisplay = document.getElementById('playerName');
const closeRoomBtn = document.getElementById('closeRoomBtn');
const membersBtn = document.getElementById('membersBtn');
const membersPopup = document.getElementById('membersPopup');
const membersList = document.getElementById('membersList');
const membersCountBadge = document.getElementById('membersCountBadge');

// New Toolbar tools
const penBtn = document.getElementById('penBtn');
const eraserBtn = document.getElementById('eraserBtn');
const swatches = document.querySelectorAll('.swatch');

let ws = null;
let isDrawing = false;
let myRole = '';
let isEraserMode = false;
let current = {
    x: 0, y: 0,
    color: '#f8fafc',
    size: sizePicker.value
};
nextStepBtn.addEventListener('click', () => {
    step1Card.style.display = 'none';
    step2Card.style.display = 'block';
});

backBtn.addEventListener('click', () => {
    step2Card.style.display = 'none';
    step1Card.style.display = 'block';
    landingError.textContent = '';
});

// Toggle members popup
membersBtn.addEventListener('click', () => {
    membersPopup.style.display = membersPopup.style.display === 'none' ? 'block' : 'none';
});

function handleConnect(actionType) {
    const name = playerNameInput.value.trim();
    let room = roomNameInput.value.trim().toLowerCase();
    const mode = document.querySelector('input[name="mode"]:checked').value;

    if (!name) {
        landingError.textContent = "Please enter your name.";
        return;
    }

    if (actionType === 'join_room' && !room) {
        landingError.textContent = "Please enter a room ID to join.";
        return;
    }

    // Auto generate if empty on create
    if (actionType === 'create_room' && !room) {
        room = Math.random().toString(36).substring(2, 8);
        roomNameInput.value = room;
    }

    landingError.textContent = "Connecting...";
    joinRoomBtn.disabled = true;
    createRoomBtn.disabled = true;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    // Prefer same-origin websocket endpoint on /ws (works with a single ngrok http tunnel)
    const sameOriginWs = `${protocol}//${window.location.host}/ws`;
    const wsParam = new URLSearchParams(window.location.search).get('ws');
    const basePort = 8765;

    const urlsToTry = [];
    // If a ws param is provided, try it first. It may be a full ws:// or wss:// URL or host[:port]
    if (wsParam) {
        if (wsParam.startsWith('ws://') || wsParam.startsWith('wss://')) {
            urlsToTry.push(wsParam);
        } else {
            // host or host:port
            urlsToTry.push(`${protocol}//${wsParam}`);
        }
    }

    // Try same-origin websocket endpoint which will work when you expose the HTTP server via ngrok
    urlsToTry.push(sameOriginWs);

    // Fallback: probe common localhost/ws ports
    for (let i = 0; i < 10; i++) {
        urlsToTry.push(`${protocol}//${window.location.hostname || 'localhost'}:${basePort + i}`);
    }
    for (let i = 0; i < 10; i++) {
        urlsToTry.push(`${protocol}//127.0.0.1:${basePort + i}`);
    }

    function attemptConnect(url) {
        return new Promise((resolve, reject) => {
            const s = new WebSocket(url);
            const onOpen = () => { cleanup(); resolve(s); };
            const onError = (e) => { cleanup(); reject(e); };
            const onClose = (e) => { cleanup(); reject(e); };
            const cleanup = () => {
                s.removeEventListener('open', onOpen);
                s.removeEventListener('error', onError);
                s.removeEventListener('close', onClose);
            };
            s.addEventListener('open', onOpen);
            s.addEventListener('error', onError);
            s.addEventListener('close', onClose);
        });
    }

    (async () => {
        let socket = null;
        for (const wsUrl of urlsToTry) {
            try {
                socket = await attemptConnect(wsUrl);
                console.info('Connected to websocket at', wsUrl);
                break;
            } catch (e) {
                // ignore
            }
        }

        if (!socket) {
            landingError.textContent = "Could not connect to the server.";
            joinRoomBtn.disabled = false;
            createRoomBtn.disabled = false;
            return;
        }

        ws = socket;
        let intentionalClose = false;

        ws.onerror = (error) => { };

        ws.onclose = () => {
            if (intentionalClose) return;
            if (landingOverlay.style.display !== 'none') {
                landingError.textContent = "Connection drop. Try again.";
                joinRoomBtn.disabled = false;
                createRoomBtn.disabled = false;
            } else {
                addChatMessage("System", "Disconnected from server.", true);
            }
        };

        ws.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);

                switch (message.type) {
                    case 'joined':
                        landingOverlay.style.display = 'none';
                        gameContainer.style.display = 'flex';
                        setTimeout(resizeCanvas, 0);
                        break;

                    case 'error':
                        intentionalClose = true;
                        landingError.textContent = message.message;
                        joinRoomBtn.disabled = false;
                        createRoomBtn.disabled = false;
                        ws.close();
                        break;

                    case 'members_update':
                        membersCountBadge.textContent = message.members.length;
                        membersList.innerHTML = '';
                        message.members.forEach(m => {
                            const li = document.createElement('li');
                            li.style.display = 'flex';
                            li.style.justifyContent = 'space-between';

                            const nameSpan = document.createElement('span');
                            nameSpan.textContent = m.name + (m.is_me ? " (You)" : "");
                            if (m.is_me) nameSpan.style.color = '#60a5fa';

                            const roleSpan = document.createElement('span');
                            roleSpan.textContent = m.role === 'drawer' ? '🎨' : (m.role === 'guesser' ? '🤔' : '💻');
                            roleSpan.title = m.role;

                            li.appendChild(nameSpan);
                            li.appendChild(roleSpan);
                            membersList.appendChild(li);
                        });
                        break;

                    case 'role':
                        myRole = message.role;
                        playerNameDisplay.textContent = `${message.name} - Room: ${room}`;

                        if (myRole === 'drawer') {
                            roleDisplay.textContent = '🎨 You are Drawing';
                            roleDisplay.className = 'role-badge drawer';
                            wordDisplay.style.display = 'block';
                            wordDisplay.textContent = `Word: ${message.word}`;
                            toolbar.style.display = 'flex';
                            canvas.style.cursor = isEraserMode ? 'cell' : 'crosshair';
                        } else if (myRole === 'guesser') {
                            roleDisplay.textContent = '🤔 You are Guessing';
                            roleDisplay.className = 'role-badge guesser';
                            wordDisplay.style.display = 'block';
                            wordDisplay.textContent = `Guess what ${message.drawer_name} is drawing!`;
                            toolbar.style.display = 'none';
                            canvas.style.cursor = 'default';
                        } else if (myRole === 'professional') {
                            roleDisplay.textContent = '✏️ Professional Board';
                            roleDisplay.className = 'role-badge professional';
                            wordDisplay.style.display = 'none';
                            toolbar.style.display = 'flex';
                            canvas.style.cursor = isEraserMode ? 'cell' : 'crosshair';
                        }
                        break;

                    case 'draw':
                        const { x0, y0, x1, y1, color, size, isEraser } = message.data;
                        const bounds = canvas.getBoundingClientRect();
                        const w = bounds.width;
                        const h = bounds.height;
                        drawLine(x0 * w, y0 * h, x1 * w, y1 * h, color, false, size, isEraser);
                        break;

                    case 'clear':
                        clearCanvasLocally();
                        break;

                    case 'chat':
                        addChatMessage(message.sender, message.text, message.is_system);
                        break;

                    case 'room_closed':
                        intentionalClose = true;
                        addChatMessage("System", "The room has been closed. Returning to home...", true);
                        try { if (ws && ws.readyState === WebSocket.OPEN) ws.close(); } catch (e) { }
                        gameContainer.style.display = 'none';
                        landingOverlay.style.display = 'flex';
                        step2Card.style.display = 'none';
                        step1Card.style.display = 'block';
                        joinRoomBtn.disabled = false;
                        createRoomBtn.disabled = false;
                        landingError.textContent = '';
                        break;
                }
            } catch (e) {
                console.error("Invalid message:", event.data);
            }
        };

        try {
            ws.send(JSON.stringify({ type: actionType, name: name, room: room, mode: mode }));
        } catch (e) {
            landingError.textContent = "Could not send join message to server.";
            joinRoomBtn.disabled = false;
            createRoomBtn.disabled = false;
            try { ws.close(); } catch (_) { }
            return;
        }

    })();
}

joinRoomBtn.addEventListener('click', () => handleConnect('join_room'));
createRoomBtn.addEventListener('click', () => handleConnect('create_room'));

// Close room button (only the drawer will be honored by the server)
closeRoomBtn.addEventListener('click', () => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    // Confirm with the user
    if (!confirm('Close the room for everyone and return to the home page?')) return;
    ws.send(JSON.stringify({ type: 'close_room' }));
});

// Sidebar Tools UI
penBtn.addEventListener('click', () => {
    isEraserMode = false;
    penBtn.classList.add('active');
    eraserBtn.classList.remove('active');
    if (myRole !== 'guesser') canvas.style.cursor = 'crosshair';
});

eraserBtn.addEventListener('click', () => {
    isEraserMode = true;
    eraserBtn.classList.add('active');
    penBtn.classList.remove('active');
    if (myRole !== 'guesser') canvas.style.cursor = 'cell';
});

swatches.forEach(swatch => {
    swatch.addEventListener('click', () => {
        swatches.forEach(s => s.classList.remove('active'));
        swatch.classList.add('active');
        current.color = swatch.dataset.color;
        if (isEraserMode) {
            isEraserMode = false;
            penBtn.classList.add('active');
            eraserBtn.classList.remove('active');
            if (myRole !== 'guesser') canvas.style.cursor = 'crosshair';
        }
    });
});

colorPicker.addEventListener('input', (e) => {
    swatches.forEach(s => s.classList.remove('active'));
    current.color = e.target.value;
    if (isEraserMode) {
        isEraserMode = false;
        penBtn.classList.add('active');
        eraserBtn.classList.remove('active');
        if (myRole !== 'guesser') canvas.style.cursor = 'crosshair';
    }
});

sizePicker.addEventListener('input', (e) => {
    current.size = e.target.value;
    sizeValue.textContent = current.size;
});

clearBtn.addEventListener('click', () => {
    if (myRole !== 'drawer' && myRole !== 'professional') return;
    clearCanvasLocally();
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'clear' }));
});

// Canvas logic
function resizeCanvas() {
    if (gameContainer.style.display === 'none') return;
    const container = canvas.parentElement;
    const width = container.clientWidth;
    const height = container.clientHeight;

    const scale = window.devicePixelRatio || 1;
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

    canvas.width = width * scale;
    canvas.height = height * scale;
    ctx.scale(scale, scale);

    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';

    if (imageData && imageData.width > 0) {
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = imageData.width;
        tempCanvas.height = imageData.height;
        tempCanvas.getContext('2d').putImageData(imageData, 0, 0);
        ctx.drawImage(tempCanvas, 0, 0, width, height);
    }
}
window.addEventListener('resize', resizeCanvas);


function drawLine(x0, y0, x1, y1, color, emit, size, isEraser) {
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);

    if (isEraser) {
        ctx.globalCompositeOperation = 'destination-out';
        ctx.strokeStyle = 'rgba(0,0,0,1)';
    } else {
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = color;
    }

    ctx.lineWidth = size;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.closePath();

    if (!emit) return;
    const bounds = canvas.getBoundingClientRect();
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'draw',
            data: {
                x0: x0 / bounds.width, y0: y0 / bounds.height,
                x1: x1 / bounds.width, y1: y1 / bounds.height,
                color, size, isEraser
            }
        }));
    }
}

function clearCanvasLocally() {
    const bounds = canvas.getBoundingClientRect();
    ctx.clearRect(0, 0, bounds.width, bounds.height);
}

const getCoordinates = (e) => {
    const rect = canvas.getBoundingClientRect();
    const clientX = e.clientX || (e.touches && e.touches[0] ? e.touches[0].clientX : null);
    const clientY = e.clientY || (e.touches && e.touches[0] ? e.touches[0].clientY : null);
    if (clientX === null || clientY === null) return null;
    return { x: clientX - rect.left, y: clientY - rect.top };
};

const onMouseDown = (e) => {
    if (myRole === 'guesser') return;
    const coords = getCoordinates(e);
    if (!coords) return;
    isDrawing = true;
    current.x = coords.x;
    current.y = coords.y;
};

const onMouseUp = (e) => {
    if (!isDrawing || myRole === 'guesser') return;
    isDrawing = false;
    const coords = getCoordinates(e) || current;
    drawLine(current.x, current.y, coords.x, coords.y, current.color, true, current.size, isEraserMode);
};

const onMouseMove = (e) => {
    if (!isDrawing || myRole === 'guesser') return;
    const coords = getCoordinates(e);
    if (!coords) return;
    drawLine(current.x, current.y, coords.x, coords.y, current.color, true, current.size, isEraserMode);
    current.x = coords.x;
    current.y = coords.y;
};

canvas.addEventListener('mousedown', onMouseDown);
canvas.addEventListener('mouseup', onMouseUp);
canvas.addEventListener('mouseout', onMouseUp);
canvas.addEventListener('mousemove', onMouseMove);

canvas.addEventListener('touchstart', onMouseDown, { passive: true });
canvas.addEventListener('touchend', onMouseUp);
canvas.addEventListener('touchcancel', onMouseUp);
canvas.addEventListener('touchmove', onMouseMove, { passive: true });


// Chat Functionality
function addChatMessage(sender, text, isSystem) {
    const msgDiv = document.createElement('div');
    msgDiv.className = `chat-msg ${isSystem ? 'system' : ''}`;

    if (isSystem) {
        msgDiv.textContent = `${sender} ${text}`;
    } else {
        const senderSpan = document.createElement('span');
        senderSpan.className = 'sender';
        senderSpan.textContent = `${sender}:`;
        msgDiv.appendChild(senderSpan);
        msgDiv.appendChild(document.createTextNode(` ${text}`));
    }

    chatMessages.appendChild(msgDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function sendChat() {
    const text = chatInput.value.trim();
    if (!text) return;
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'chat', text: text }));
        chatInput.value = '';
    }
}

sendBtn.addEventListener('click', sendChat);
chatInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendChat(); });
