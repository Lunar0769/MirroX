import path from "path";
import fs from "fs";
import { Server as SocketIOServer } from "socket.io";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const NodeMediaServer = require("node-media-server");

const RTMP_PORT = parseInt(process.env.RTMP_PORT || "1935", 10);
const HTTP_PORT = parseInt(process.env.HTTP_PORT || "8000", 10); // NMS HTTP server + Socket.io
const MEDIA_ROOT = "media";

if (!fs.existsSync(MEDIA_ROOT)) {
  fs.mkdirSync(MEDIA_ROOT, { recursive: true });
}

const nmsConfig = {
  logType: 4, // 4 = FFDEBUG
  rtmp: {
    port: RTMP_PORT,
    chunk_size: 60000,
    gop_cache: true,
    ping: 30,
    ping_timeout: 60,
  },
  http: {
    port: HTTP_PORT,
    mediaroot: MEDIA_ROOT,
    allow_origin: "*",
  },
  trans: {
    ffmpeg: process.env.FFMPEG_PATH || "ffmpeg",
    tasks: [
      {
        app: "live",
        hls: true,
        hlsFlags: "[hls_time=2:hls_list_size=6:hls_flags=delete_segments]",
        dash: false,
        vcParam: [],
        acParam: [],
      },
    ],
  },
};

// ── In-memory room store ──────────────────────────────────────────────────────
interface Room {
  password: string;
  hostSocketId: string;
  streamKey: string;
  isLive: boolean;
  viewers: Set<string>;
}

const rooms = new Map<string, Room>();

const nms = new NodeMediaServer(nmsConfig);
nms.run();

console.log(`📡 RTMP  → rtmp://localhost:${RTMP_PORT}/live/<room-id>`);
console.log(`🎞  HLS   → http://localhost:${HTTP_PORT}/live/<room-id>/index.m3u8`);

// ── Socket.io ─────────────────────────────────────────────────────────────────
const io = new SocketIOServer(nms.nhs.httpServer, {
  cors: { origin: "*", methods: ["GET", "POST"] },
});

io.on("connection", (socket) => {
  // Create room (host)
  socket.on(
    "create-room",
    ({ roomId, password }: { roomId: string; password: string }, cb: any) => {
      if (rooms.has(roomId)) {
        return cb({ success: false, error: "Room ID already in use." });
      }
      rooms.set(roomId, {
        password,
        hostSocketId: socket.id,
        streamKey: roomId,
        isLive: false,
        viewers: new Set(),
      });
      socket.join(roomId);
      socket.data.roomId = roomId;
      socket.data.role = "host";
      console.log(`[room] created: ${roomId}`);
      cb({ success: true });
    }
  );

  // Join room (viewer)
  socket.on(
    "join-room",
    ({ roomId, password }: { roomId: string; password: string }, cb: any) => {
      const room = rooms.get(roomId);
      if (!room) return cb({ success: false, error: "Room not found." });
      if (room.password !== password) return cb({ success: false, error: "Incorrect password." });

      room.viewers.add(socket.id);
      socket.join(roomId);
      socket.data.roomId = roomId;
      socket.data.role = "viewer";
      console.log(`[room] viewer ${socket.id} joined ${roomId}`);
      cb({ success: true, isLive: room.isLive });
    }
  );

  // Host manually ending the room
  socket.on("host-stopped", () => {
    const roomId = socket.data.roomId;
    if (roomId) io.to(roomId).emit("stream-ended");
  });

  // Host or viewer can query current stream status on mount
  socket.on(
    "check-stream-status",
    ({ roomId }: { roomId: string }, cb: any) => {
      const room = rooms.get(roomId);
      cb({ isLive: room?.isLive ?? false });
    }
  );

  // Disconnect cleanup
  socket.on("disconnect", () => {
    const { roomId, role } = socket.data;
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room) return;

    if (role === "host") {
      io.to(roomId).emit("stream-ended");
      rooms.delete(roomId);
      console.log(`[room] deleted: ${roomId} (host disconnected)`);
    } else {
      room.viewers.delete(socket.id);
    }
  });
});

// NMS v2 event: (id, StreamPath, args)
nms.on("prePublish", (id: string, StreamPath: string) => {
  const parts = (StreamPath || "").split("/").filter(Boolean);
  const streamKey = parts[parts.length - 1] ?? "";

  console.log(`[rtmp] prePublish  path="${StreamPath}"  key="${streamKey}"`);

  if (!rooms.has(streamKey)) {
    console.warn(`[rtmp] auto-creating ad-hoc room for key "${streamKey}"`);
    rooms.set(streamKey, {
      password: "",
      hostSocketId: "",
      streamKey,
      isLive: true,
      viewers: new Set(),
    });
  } else {
    rooms.get(streamKey)!.isLive = true;
  }

  console.log(`[rtmp] ▶  LIVE: ${streamKey}`);
  io.to(streamKey).emit("stream-live", { streamKey });

  setTimeout(() => {
    const r = rooms.get(streamKey);
    if (r?.isLive) {
      io.to(streamKey).emit("stream-live", { streamKey });
    }
  }, 2000);
});

nms.on("donePublish", (id: string, StreamPath: string) => {
  const parts = (StreamPath || "").split("/").filter(Boolean);
  const streamKey = parts[parts.length - 1] ?? "";
  const room = rooms.get(streamKey);
  if (room) {
    room.isLive = false;
    io.to(streamKey).emit("stream-ended");
  }
  console.log(`[rtmp] ■  ended: ${streamKey}`);
});
