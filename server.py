import asyncio
import json
import random
import os
import logging
from aiohttp import web, WSMsgType

# Configuration
HTTP_PORT = 3033
ROOT_DIR = os.path.join(os.path.dirname(__file__), 'public')

# Simple in-memory rooms state
rooms = {}
WORDS = [
    "apple", "house", "sun", "tree", "car", "dog", "cat", "bird",
    "fish", "book", "computer", "phone", "shoe", "pizza", "burger",
    "moon", "star", "cloud", "rain", "fire", "ice cream"
]

logger = logging.getLogger("whiteboard")
logging.basicConfig(level=logging.INFO)


async def broadcast_chat(room_id, sender_name, text, is_system=False):
    if room_id not in rooms:
        return
    msg = json.dumps({
        "type": "chat",
        "sender": "System" if is_system else sender_name,
        "text": text,
        "is_system": is_system
    })
    for ws in list(rooms[room_id]['clients'].keys()):
        try:
            await ws.send_str(msg)
        except Exception:
            pass


async def broadcast_draw(room_id, message, exclude_ws):
    if room_id not in rooms:
        return
    for ws in list(rooms[room_id]['clients'].keys()):
        if ws != exclude_ws:
            try:
                await ws.send_str(message)
            except Exception:
                pass


async def broadcast_members(room_id):
    if room_id not in rooms:
        return
    room = rooms[room_id]
    members = []
    for ws, data in room['clients'].items():
        role = (
            "professional"
            if room['mode'] == "professional"
            else ("drawer" if ws == room['drawer'] else "guesser")
        )
        members.append({"name": data['name'], "role": role, "ws": ws})

    for ws in list(room['clients'].keys()):
        try:
            client_members = []
            for m in members:
                client_members.append({
                    "name": m['name'],
                    "role": m['role'],
                    "is_me": m['ws'] == ws
                })
            await ws.send_str(json.dumps({"type": "members_update", "members": client_members}))
        except Exception:
            pass


async def set_new_drawer(room_id, new_drawer_ws):
    if room_id not in rooms:
        return
    room = rooms[room_id]
    room['drawer'] = new_drawer_ws
    room['secret_word'] = random.choice(WORDS)

    clear_msg = json.dumps({"type": "clear"})

    for client in list(room['clients'].keys()):
        try:
            await client.send_str(clear_msg)
            if client == room['drawer']:
                await client.send_str(json.dumps({
                    "type": "role",
                    "role": "drawer",
                    "word": room['secret_word'].upper(),
                    "name": room['clients'][client]['name']
                }))
            else:
                await client.send_str(json.dumps({
                    "type": "role",
                    "role": "guesser",
                    "drawer_name": room['clients'][room['drawer']]['name'] if room['drawer'] else "Unknown",
                    "name": room['clients'][client]['name']
                }))
        except Exception:
            pass

    await broadcast_members(room_id)


counter = 1


async def ws_handler(request):
    global counter
    ws = web.WebSocketResponse()
    await ws.prepare(request)

    # Expect first message to be create_room or join_room
    try:
        msg = await asyncio.wait_for(ws.receive(), timeout=5.0)
        if msg.type != WSMsgType.TEXT:
            await ws.close()
            return ws
        data = json.loads(msg.data)
    except Exception:
        await ws.close()
        return ws

    action_type = data.get('type')
    if action_type not in ('create_room', 'join_room'):
        await ws.close()
        return ws

    player_name = data.get('name', f"Player {counter}")
    room_id = data.get('room', 'default').lower()
    mode = data.get('mode', 'professional')

    if action_type == 'create_room' and room_id in rooms:
        await ws.send_str(json.dumps({"type": "error", "message": "Room already exists. Try joining instead."}))
        await ws.close()
        return ws

    if action_type == 'join_room' and room_id not in rooms:
        await ws.send_str(json.dumps({"type": "error", "message": "Room not found. Check the ID or create new."}))
        await ws.close()
        return ws

    counter += 1

    if action_type == 'create_room':
        rooms[room_id] = {'mode': mode, 'clients': {}, 'drawer': None, 'secret_word': ""}

    room = rooms[room_id]
    room['clients'][ws] = {'name': player_name, 'score': 0}

    logger.info(f"{player_name} joined room '{room_id}' in '{room['mode']}' mode")

    try:
        await ws.send_str(json.dumps({"type": "joined"}))
    except Exception:
        await ws.close()
        return ws

    if room['mode'] == 'professional':
        try:
            await ws.send_str(json.dumps({"type": "role", "role": "professional", "name": player_name}))
        except Exception:
            pass
        await broadcast_chat(room_id, player_name, "joined the professional board.", is_system=True)
    else:
        if len(room['clients']) == 1 or room['drawer'] is None:
            await set_new_drawer(room_id, ws)
        else:
            try:
                await ws.send_str(json.dumps({
                    "type": "role",
                    "role": "guesser",
                    "drawer_name": room['clients'][room['drawer']]['name'] if room['drawer'] else "Unknown",
                    "name": player_name
                }))
            except Exception:
                pass
            await broadcast_chat(room_id, player_name, "has joined the game.", is_system=True)

    await broadcast_members(room_id)

    try:
        async for msg in ws:
            if msg.type != WSMsgType.TEXT:
                continue
            try:
                data = json.loads(msg.data)
                msg_type = data.get('type')

                if msg_type in ('draw', 'clear'):
                    if room['mode'] == 'professional' or ws == room['drawer']:
                        await broadcast_draw(room_id, msg.data, ws)
                elif msg_type == 'close_room':
                    if ws == room['drawer'] or room['mode'] == 'professional':
                        await broadcast_chat(room_id, 'System', 'Room closed. Returning to home page...', is_system=True)
                        close_msg = json.dumps({"type": "room_closed"})
                        for client in list(room['clients'].keys()):
                            try:
                                await client.send_str(close_msg)
                                await client.close()
                            except Exception:
                                pass
                        if room_id in rooms:
                            del rooms[room_id]
                        return ws
                elif msg_type == 'chat':
                    text = data.get('text', '').strip()
                    if not text:
                        continue
                    sender_name = room['clients'][ws]['name']

                    if room['mode'] == 'professional' or ws == room['drawer']:
                        await broadcast_chat(room_id, sender_name, text)
                        continue

                    if room['secret_word'] and text.lower() == room['secret_word'].lower():
                        await broadcast_chat(room_id, sender_name, f"guessed the word '{room['secret_word'].upper()}'!!!", is_system=True)
                        room['clients'][ws]['score'] += 1
                        await set_new_drawer(room_id, ws)
                    else:
                        await broadcast_chat(room_id, sender_name, text)

            except json.JSONDecodeError:
                pass

    except Exception:
        pass
    finally:
        if room_id in rooms and ws in rooms[room_id]['clients']:
            name = rooms[room_id]['clients'][ws]['name']
            logger.info(f"{name} disconnected from {room_id}")
            del rooms[room_id]['clients'][ws]

            await broadcast_chat(room_id, name, "left the room.", is_system=True)

            if len(rooms[room_id]['clients']) == 0:
                logger.info(f"Room {room_id} is empty. Deleting...")
                del rooms[room_id]
            elif rooms[room_id]['mode'] == 'game' and ws == rooms[room_id]['drawer']:
                rooms[room_id]['drawer'] = None
                new_drawer = random.choice(list(rooms[room_id]['clients'].keys()))
                await broadcast_chat(room_id, "System", "Drawer disconnected. Picking a new drawer...", is_system=True)
                await set_new_drawer(room_id, new_drawer)
            else:
                await broadcast_members(room_id)

    return ws


def create_app():
    app = web.Application()
    # serve static files from /public at the root
    app.router.add_static('/', ROOT_DIR, show_index=True)
    app.router.add_get('/ws', ws_handler)
    return app


if __name__ == '__main__':
    app = create_app()
    logger.info(f"Starting aiohttp server on http://0.0.0.0:{HTTP_PORT} (websocket endpoint: /ws)")
    web.run_app(app, host='0.0.0.0', port=HTTP_PORT)

