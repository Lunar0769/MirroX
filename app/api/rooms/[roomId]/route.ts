import { NextResponse } from "next/server";
import { rooms, cleanExpiredRooms } from "../../../lib/rooms";

// DELETE /api/rooms/[roomId] — Delete/cleanup a room (host leaving)
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ roomId: string }> }
) {
  const { roomId } = await params;

  cleanExpiredRooms();
  rooms.delete(roomId);

  return NextResponse.json({ success: true });
}

// GET /api/rooms/[roomId] — Get room status
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ roomId: string }> }
) {
  const { roomId } = await params;

  cleanExpiredRooms();
  const room = rooms.get(roomId);

  if (!room) {
    return NextResponse.json(
      { exists: false },
      { status: 404 }
    );
  }

  return NextResponse.json({
    exists: true,
    viewerCount: room.viewerCount,
  });
}
