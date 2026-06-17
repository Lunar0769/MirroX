"use client";

import { io, Socket } from "socket.io-client";

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    const serverUrl = process.env.NEXT_PUBLIC_MEDIA_SERVER_URL || "";
    socket = io(serverUrl, {
      path: "/socket.io",
      transports: ["websocket", "polling"],
    });
  }
  return socket;
}

export function disconnectSocket(): void {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
