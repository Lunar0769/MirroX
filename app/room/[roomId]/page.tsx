import { Suspense } from "react";
import HostRoom from "../../components/HostRoom";
import ViewerRoom from "../../components/ViewerRoom";

function Spinner() {
  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

export default async function RoomPage({
  params,
  searchParams,
}: {
  params: Promise<{ roomId: string }>;
  searchParams: Promise<{ role?: string }>;
}) {
  const { roomId } = await params;
  const { role } = await searchParams;

  if (role === "host") {
    return (
      <Suspense fallback={<Spinner />}>
        <HostRoom roomId={roomId} />
      </Suspense>
    );
  }

  return (
    <Suspense fallback={<Spinner />}>
      <ViewerRoom roomId={roomId} />
    </Suspense>
  );
}
