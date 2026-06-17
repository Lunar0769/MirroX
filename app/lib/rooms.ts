// In-memory room store for API routes
// On Vercel serverless, this resets per cold start — but rooms are ephemeral anyway.
// For production, use Upstash Redis. This works for MVP.

export interface Room {
  password: string;
  hostPeerId: string;
  createdAt: number;
  viewerCount: number;
}

// Global store (survives across API route invocations in the same process)
const globalForRooms = globalThis as unknown as { rooms?: Map<string, Room> };
export const rooms: Map<string, Room> = globalForRooms.rooms ?? new Map();
globalForRooms.rooms = rooms;

// Auto-expire rooms after 4 hours
const ROOM_TTL_MS = 4 * 60 * 60 * 1000;

export function cleanExpiredRooms() {
  const now = Date.now();
  for (const [id, room] of rooms) {
    if (now - room.createdAt > ROOM_TTL_MS) {
      rooms.delete(id);
    }
  }
}
