import { NextResponse } from "next/server";
import { rooms, cleanExpiredRooms } from "../../lib/rooms";

// POST /api/rooms — Create a new room
export async function POST(request: Request) {
  const body = await request.json();
  const { roomId, password, hostPeerId } = body;

  if (!roomId || !password || !hostPeerId) {
    return NextResponse.json(
      { success: false, error: "Missing roomId, password, or hostPeerId." },
      { status: 400 }
    );
  }

  cleanExpiredRooms();

  if (rooms.has(roomId)) {
    return NextResponse.json(
      { success: false, error: "Room ID already exists. Choose another." },
      { status: 409 }
    );
  }

  rooms.set(roomId, {
    password,
    hostPeerId,
    createdAt: Date.now(),
    viewerCount: 0,
  });

  return NextResponse.json({ success: true });
}

// GET /api/rooms?roomId=XYZ — Check if room exists
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const roomId = searchParams.get("roomId");

  if (!roomId) {
    return NextResponse.json(
      { success: false, error: "Missing roomId." },
      { status: 400 }
    );
  }

  cleanExpiredRooms();
  const room = rooms.get(roomId);

  if (!room) {
    return NextResponse.json({ exists: false });
  }

  return NextResponse.json({
    exists: true,
    viewerCount: room.viewerCount,
  });
}
