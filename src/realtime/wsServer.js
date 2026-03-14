import crypto from "node:crypto";
import { URL } from "node:url";
import { verifyToken } from "../auth/auth.js";
import { authorizePlayerIdentity, getRoomPlayer } from "../auth/playerIdentity.js";
import { Role, Visibility } from "../game/models.js";
import { getRoomByRef, getRoomRealtimeSync, onRoomEventAppended, resolveRoomId } from "../game/store.js";

const WS_MAGIC_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const OPCODE_TEXT = 0x1;
const OPCODE_CLOSE = 0x8;
const OPCODE_PING = 0x9;
const OPCODE_PONG = 0xa;
const MAX_FRAME_BYTES = 1024 * 1024;

function normalizeWsPath(pathname) {
  if (pathname === "/api/ws") {
    return "/ws";
  }
  return pathname;
}

function socketIsOpen(socket) {
  return !socket.destroyed && socket.writable;
}

function wsAcceptValue(secKey) {
  return crypto.createHash("sha1").update(`${secKey}${WS_MAGIC_GUID}`).digest("base64");
}

function writeHttpError(socket, statusCode, reason) {
  if (!socketIsOpen(socket)) {
    return;
  }
  const message = String(reason ?? "Bad Request");
  const response = [
    `HTTP/1.1 ${statusCode} ${message}`,
    "Connection: close",
    "Content-Type: text/plain; charset=utf-8",
    `Content-Length: ${Buffer.byteLength(message)}`,
    "",
    message,
  ].join("\r\n");
  socket.write(response);
  socket.destroy();
}

function encodeFrame(opcode, payload = Buffer.alloc(0)) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  const length = body.length;
  let header;
  if (length < 126) {
    header = Buffer.alloc(2);
    header[1] = length;
  } else if (length < 65536) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }
  header[0] = 0x80 | (opcode & 0x0f);
  return Buffer.concat([header, body]);
}

function sendFrame(socket, opcode, payload) {
  if (!socketIsOpen(socket)) {
    return false;
  }
  socket.write(encodeFrame(opcode, payload));
  return true;
}

function sendJson(socket, payload) {
  return sendFrame(socket, OPCODE_TEXT, Buffer.from(JSON.stringify(payload), "utf8"));
}

function sendClose(socket, code = 1000, reason = "") {
  const safeReason = String(reason).slice(0, 120);
  const reasonBytes = Buffer.from(safeReason, "utf8");
  const payload = Buffer.alloc(2 + reasonBytes.length);
  payload.writeUInt16BE(code, 0);
  reasonBytes.copy(payload, 2);
  sendFrame(socket, OPCODE_CLOSE, payload);
}

function decodeFrames(buffer) {
  const frames = [];
  let offset = 0;

  while (offset + 2 <= buffer.length) {
    const byte1 = buffer[offset];
    const byte2 = buffer[offset + 1];
    const fin = (byte1 & 0x80) !== 0;
    const opcode = byte1 & 0x0f;
    const masked = (byte2 & 0x80) !== 0;
    let payloadLength = byte2 & 0x7f;
    let headerLength = 2;

    if (payloadLength === 126) {
      if (offset + 4 > buffer.length) {
        break;
      }
      payloadLength = buffer.readUInt16BE(offset + 2);
      headerLength = 4;
    } else if (payloadLength === 127) {
      if (offset + 10 > buffer.length) {
        break;
      }
      const bigLength = buffer.readBigUInt64BE(offset + 2);
      if (bigLength > BigInt(MAX_FRAME_BYTES)) {
        throw new Error(`WebSocket frame too large: ${bigLength.toString()}`);
      }
      payloadLength = Number(bigLength);
      headerLength = 10;
    }

    if (payloadLength > MAX_FRAME_BYTES) {
      throw new Error(`WebSocket frame too large: ${payloadLength}`);
    }

    const maskLength = masked ? 4 : 0;
    const frameLength = headerLength + maskLength + payloadLength;
    if (offset + frameLength > buffer.length) {
      break;
    }

    const maskOffset = offset + headerLength;
    const payloadOffset = maskOffset + maskLength;
    const payloadSlice = buffer.subarray(payloadOffset, payloadOffset + payloadLength);

    let payload;
    if (masked) {
      const mask = buffer.subarray(maskOffset, maskOffset + 4);
      payload = Buffer.allocUnsafe(payloadLength);
      for (let i = 0; i < payloadLength; i += 1) {
        payload[i] = payloadSlice[i] ^ mask[i % 4];
      }
    } else {
      payload = Buffer.from(payloadSlice);
    }

    frames.push({
      fin,
      opcode,
      masked,
      payload,
    });

    offset += frameLength;
  }

  return {
    frames,
    remainder: buffer.subarray(offset),
  };
}

function toCursorNumber(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

function eventVisibleToRole(event, viewerRole) {
  if (viewerRole === Role.OBSERVER) {
    return true;
  }
  if (event.visibility === Visibility.PUBLIC) {
    return true;
  }
  if (event.visibility === Visibility.HIDER) {
    return viewerRole === Role.HIDER;
  }
  if (event.visibility === Visibility.SEEKERS) {
    return viewerRole === Role.SEEKER;
  }
  return false;
}

export function attachRealtimeWsServer(httpServer, options = {}) {
  const wsPath = String(options.path ?? "/ws");
  const clients = new Set();

  function sendEventAppend(client, event, cursor, roomCode = null) {
    if (!eventVisibleToRole(event, client.viewerRole ?? null)) {
      return;
    }
    const cursorNumber = toCursorNumber(cursor);
    if (
      cursorNumber !== null &&
      client.cursorNumber !== null &&
      cursorNumber <= client.cursorNumber
    ) {
      return;
    }
    const sent = sendJson(client.socket, {
      type: "EVENT_APPEND",
      roomCode: roomCode ?? client.roomCode ?? null,
      event,
      cursor: String(cursor),
    });
    if (sent && cursorNumber !== null) {
      client.cursorNumber = cursorNumber;
    }
  }

  const unsubscribe = onRoomEventAppended((payload) => {
    for (const client of clients) {
      if (client.roomId !== payload.roomId) {
        continue;
      }
      sendEventAppend(client, payload.event, payload.cursor, payload.roomCode);
    }
  });

  function closeClient(client) {
    if (!clients.has(client)) {
      return;
    }
    clients.delete(client);
    if (socketIsOpen(client.socket)) {
      try {
        client.socket.destroy();
      } catch {
        // no-op
      }
    }
  }

  function sendWsError(client, message, status = 400) {
    sendJson(client.socket, {
      type: "ERROR",
      status,
      message,
    });
  }

  function handleSubscribe(client, payload) {
    const roomCode = String(payload?.roomCode ?? "").trim();
    if (!roomCode) {
      sendWsError(client, "roomCode is required", 400);
      return;
    }

    const resolvedRoomId = resolveRoomId(roomCode);
    if (!resolvedRoomId) {
      sendWsError(client, `Room not found: ${roomCode}`, 404);
      return;
    }
    const room = getRoomByRef(resolvedRoomId);
    if (!room) {
      sendWsError(client, `Room not found: ${roomCode}`, 404);
      return;
    }

    let viewerRole = null;
    const playerId = String(payload?.playerId ?? "").trim();
    if (playerId) {
      const player = getRoomPlayer(room.id, playerId);
      if (!player) {
        sendWsError(client, `Player not found: ${playerId}`, 404);
        return;
      }

      const token = String(payload?.token ?? "").trim();
      const boundUserId = String(player.userId ?? "").trim();
      if (boundUserId) {
        if (!token) {
          sendWsError(client, "Authentication required for this player", 401);
          return;
        }

        let authUser;
        try {
          authUser = verifyToken(token);
        } catch (error) {
          const status = Number(error?.status ?? 401);
          sendWsError(client, error?.message ?? "Invalid or expired token", status);
          return;
        }

        const access = authorizePlayerIdentity(room.id, playerId, authUser);
        if (!access.ok) {
          sendWsError(client, access.message, access.status);
          return;
        }
      }

      viewerRole = player.role;
    }

    let sync;
    try {
      sync = getRoomRealtimeSync(roomCode, payload?.sinceCursor ?? null, {
        viewerRole,
      });
    } catch (error) {
      const status = Number(error?.status ?? 400);
      sendWsError(client, error?.message ?? "Subscribe failed", status);
      return;
    }

    client.roomId = sync.roomId;
    client.roomCode = sync.roomCode;
    client.cursorNumber = toCursorNumber(sync.cursor);
    client.viewerRole = viewerRole;
    client.playerId = playerId || null;

    sendJson(client.socket, {
      type: "SNAPSHOT",
      roomCode: sync.roomCode,
      projection: sync.projection,
      cursor: sync.cursor,
    });

    for (const item of sync.catchUpEvents) {
      sendEventAppend(client, item.event, item.cursor, sync.roomCode);
    }
  }

  function handleClientMessage(client, message) {
    if (message?.type === "SUBSCRIBE") {
      handleSubscribe(client, message);
      return;
    }
    sendWsError(client, `Unsupported message type: ${String(message?.type ?? "")}`, 400);
  }

  function handleTextFrame(client, payload) {
    let message;
    try {
      message = JSON.parse(payload.toString("utf8"));
    } catch {
      sendWsError(client, "Frame payload must be valid JSON", 400);
      return;
    }
    handleClientMessage(client, message);
  }

  function handleFrame(client, frame) {
    if (!frame.fin) {
      sendClose(client.socket, 1003, "Fragmented frames are not supported");
      closeClient(client);
      return;
    }

    if (frame.opcode === OPCODE_CLOSE) {
      sendClose(client.socket, 1000, "Bye");
      closeClient(client);
      return;
    }
    if (frame.opcode === OPCODE_PING) {
      sendFrame(client.socket, OPCODE_PONG, frame.payload);
      return;
    }
    if (frame.opcode === OPCODE_PONG) {
      return;
    }
    if (frame.opcode !== OPCODE_TEXT) {
      sendClose(client.socket, 1003, "Only text frames are supported");
      closeClient(client);
      return;
    }
    if (!frame.masked) {
      sendClose(client.socket, 1002, "Client frames must be masked");
      closeClient(client);
      return;
    }
    handleTextFrame(client, frame.payload);
  }

  httpServer.on("upgrade", (req, socket) => {
    const requestUrl = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const pathname = normalizeWsPath(requestUrl.pathname);
    if (pathname !== wsPath) {
      writeHttpError(socket, 404, "Not Found");
      return;
    }

    const key = req.headers["sec-websocket-key"];
    const connectionHeader = String(req.headers.connection ?? "").toLowerCase();
    const upgradeHeader = String(req.headers.upgrade ?? "").toLowerCase();
    const version = String(req.headers["sec-websocket-version"] ?? "13");

    if (typeof key !== "string" || key.trim().length === 0) {
      writeHttpError(socket, 400, "Missing Sec-WebSocket-Key");
      return;
    }
    if (!connectionHeader.includes("upgrade") || upgradeHeader !== "websocket") {
      writeHttpError(socket, 400, "Invalid upgrade headers");
      return;
    }
    if (version !== "13") {
      writeHttpError(socket, 426, "Unsupported WebSocket Version");
      return;
    }

    const accept = wsAcceptValue(key.trim());
    const responseHeaders = [
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${accept}`,
      "",
      "",
    ];
    socket.write(responseHeaders.join("\r\n"));

    const client = {
      socket,
      roomId: null,
      roomCode: null,
      playerId: null,
      viewerRole: null,
      cursorNumber: null,
      readBuffer: Buffer.alloc(0),
    };

    clients.add(client);

    socket.on("data", (chunk) => {
      if (!Buffer.isBuffer(chunk)) {
        return;
      }
      client.readBuffer = Buffer.concat([client.readBuffer, chunk]);

      let decoded;
      try {
        decoded = decodeFrames(client.readBuffer);
      } catch {
        sendClose(client.socket, 1009, "Frame too large");
        closeClient(client);
        return;
      }

      client.readBuffer = decoded.remainder;
      for (const frame of decoded.frames) {
        handleFrame(client, frame);
        if (!clients.has(client)) {
          return;
        }
      }
    });

    socket.on("close", () => {
      closeClient(client);
    });
    socket.on("end", () => {
      closeClient(client);
    });
    socket.on("error", () => {
      closeClient(client);
    });
  });

  httpServer.on("close", () => {
    unsubscribe();
    for (const client of [...clients]) {
      sendClose(client.socket, 1001, "Server shutdown");
      closeClient(client);
    }
  });
}
