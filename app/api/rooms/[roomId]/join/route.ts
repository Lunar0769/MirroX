import { NextResponse } from "next/server";
import { rooms, cleanExpiredRooms } from "../../../../lib/rooms";

// POST /api/rooms/[roomId]/join — Join a room with password
export async function POST(
  request: Request,
  { params }: { params: Promise<{ roomId: string }> }
) {
  const { roomId } = await params;
  const body = await request.json();
  const { password } = body;

  if (!password) {
    return NextResponse.json(
      { success: false, error: "Password is required." },
      { status: 400 }
    );
  }

  cleanExpiredRooms();
  const room = rooms.get(roomId);

  if (!room) {
    return NextResponse.json(
      { success: false, error: "Room not found." },
      { status: 404 }
    );
  }

  if (room.password !== password) {
    return NextResponse.json(
      { success: false, error: "Incorrect password." },
      { status: 401 }
    );
  }

  room.viewerCount++;

  return NextResponse.json({
    success: true,
    hostPeerId: room.hostPeerId,
  });
}
