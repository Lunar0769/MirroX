"use client";

import { useSearchParams, useParams } from "next/navigation";
import HostRoom from "./HostRoom";
import ViewerRoom from "./ViewerRoom";

export default function RoomPage() {
  const params = useParams();
  const searchParams = useSearchParams();

  const roomId = (params?.roomId as string) ?? "";
  const role = searchParams?.get("role");

  if (role === "host") return <HostRoom roomId={roomId} />;
  if (role === "viewer") return <ViewerRoom roomId={roomId} />;

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center text-gray-400">
      Invalid room link.
    </div>
  );
}
