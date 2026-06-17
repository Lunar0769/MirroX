import { createServer } from "http";
import { parse } from "url";
import path from "path";
import fs from "fs";
import next from "next";
import { Server as SocketIOServer, Socket } from "socket.io";
// NMS v2 — has full HLS transcoding via ffmpeg
// eslint-disable-next-line @typescript-eslint/no-require-imports
const NodeMediaServer = require("node-media-server");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ffmpegStatic = require("ffmpeg-static");

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOST || "localhost";
const port = parseInt(process.env.PORT || "3000", 10);
const RTMP_PORT = 1935;
const HTTP_PORT = 8000; // NMS HTTP server (serves HLS)

// NMS v2 writes HLS segments under <mediaroot>/hls/<app>/<streamKey>/
// We serve them via NMS's own HTTP server on port 8000
// The public URL becomes: http://localhost:8000/hls/<streamKey>/index.m3u8
// NMS uses path: <mediaroot>/live/<streamKey>/ but outputs HLS to <mediaroot>/hls/live/<streamKey>/
const MEDIA_ROOT = "media";
if (!fs.existsSync(MEDIA_ROOT)) {
  fs.mkdirSync(MEDIA_ROOT, { recursive: true });
}

// ── NMS v2 config ─────────────────────────────────────────────────────────────
const nmsConfig = {
  logType: 4, // 4 = FFDEBUG for detailed FFmpeg logs in console
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
    ffmpeg: process.env.FFMPEG_PATH || ffmpegStatic,
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

// ── Next.js ───────────────────────────────────────────────────────────────────
const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const httpServer = createServer((req, res) => {
    const parsedUrl = parse(req.url!, true);
    handle(req, res, parsedUrl);
  });

  // ── Socket.io ─────────────────────────────────────────────────────────────
  const io = new SocketIOServer(httpServer, {
    cors: { origin: "*", methods: ["GET", "POST"] },
  });

  io.on("connection", (socket: Socket) => {
    // Create room (host)
    socket.on(
      "create-room",
      (
        { roomId, password }: { roomId: string; password: string },
        cb: (r: { success: boolean; error?: string }) => void
      ) => {
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
      (
        { roomId, password }: { roomId: string; password: string },
        cb: (r: { success: boolean; error?: string; isLive?: boolean }) => void
      ) => {
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
    // (solves the race where stream-live fires before the React component mounts)
    socket.on(
      "check-stream-status",
      (
        { roomId }: { roomId: string },
        cb: (r: { isLive: boolean }) => void
      ) => {
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

  // ── Start HTTP server ─────────────────────────────────────────────────────
  httpServer.listen(port, hostname, () => {
    console.log(`\n▲  Next.js  → http://${hostname}:${port}`);
  });

  // ── NMS v2 RTMP + HLS ─────────────────────────────────────────────────────
  const nms = new NodeMediaServer(nmsConfig);

  // NMS v2 event: (id, StreamPath, args)
  nms.on("prePublish", (id: string, StreamPath: string) => {
    const parts = (StreamPath || "").split("/").filter(Boolean);
    const streamKey = parts[parts.length - 1] ?? "";

    console.log(`[rtmp] prePublish  path="${StreamPath}"  key="${streamKey}"`);
    console.log(`[rtmp] known rooms: [${Array.from(rooms.keys()).join(", ")}]`);

    // If no room exists for this key yet (OBS started before room was created),
    // auto-create an ad-hoc room so HLS transcoding still runs.
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

    // Re-emit after 2s to catch React components that mount after the first emit
    setTimeout(() => {
      const r = rooms.get(streamKey);
      if (r?.isLive) {
        io.to(streamKey).emit("stream-live", { streamKey });
      }
    }, 2000);
  });

  nms.on("donePublish", (_id: string, StreamPath: string) => {
    const parts = (StreamPath || "").split("/").filter(Boolean);
    const streamKey = parts[parts.length - 1] ?? "";
    const room = rooms.get(streamKey);
    if (room) {
      room.isLive = false;
      io.to(streamKey).emit("stream-ended");
    }
    console.log(`[rtmp] ■  ended: ${streamKey}`);
  });

  nms.run();

  console.log(`📡 RTMP  → rtmp://${hostname}:${RTMP_PORT}/live/<room-id>`);
  console.log(`🎞  HLS   → http://${hostname}:${HTTP_PORT}/hls/<room-id>/index.m3u8\n`);
});
