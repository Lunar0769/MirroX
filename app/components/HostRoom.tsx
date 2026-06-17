"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { getSocket, disconnectSocket } from "../lib/socket";

type StreamStatus = "offline" | "live" | "ended";

export default function HostRoom({ roomId }: { roomId: string }) {
  const router = useRouter();
  const [streamStatus, setStreamStatus] = useState<StreamStatus>("offline");
  const [viewerCount, setViewerCount] = useState(0);
  const [duration, setDuration] = useState(0);
  const [copiedServer, setCopiedServer] = useState(false);
  const [copiedKey, setCopiedKey] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const socketRef = useRef(getSocket());

  const mediaServerUrl = process.env.NEXT_PUBLIC_MEDIA_SERVER_URL || "http://localhost:8000";
  let rtmpHostname = "localhost";
  try {
    if (process.env.NEXT_PUBLIC_MEDIA_SERVER_URL) {
      const url = new URL(process.env.NEXT_PUBLIC_MEDIA_SERVER_URL);
      rtmpHostname = url.hostname;
    }
  } catch (e) {
    console.error("Failed to parse media server URL:", e);
  }
  const rtmpServer = process.env.NEXT_PUBLIC_RTMP_SERVER_URL || `rtmp://${rtmpHostname}/live`;
  const streamKey = roomId;
  const hlsUrl = `${mediaServerUrl}/live/${roomId}/index.m3u8`;

  // Listen for RTMP stream events from server
  useEffect(() => {
    const socket = socketRef.current;

    socket.on("stream-live", () => {
      setStreamStatus("live");
    });

    socket.on("stream-ended", () => {
      setStreamStatus("ended");
    });

    socket.on("viewer-joined", () => {
      setViewerCount((c) => c + 1);
    });

    socket.on("viewer-left", () => {
      setViewerCount((c) => Math.max(0, c - 1));
    });

    // On mount, check if the RTMP stream is already live
    // (handles the race where OBS started before this component mounted)
    const checkStatus = () => {
      socket.emit(
        "check-stream-status",
        { roomId },
        (res: { isLive: boolean }) => {
          if (res.isLive) setStreamStatus("live");
        }
      );
    };

    if (socket.connected) checkStatus();
    else socket.once("connect", checkStatus);

    return () => {
      socket.off("stream-live");
      socket.off("stream-ended");
      socket.off("viewer-joined");
      socket.off("viewer-left");
      socket.off("connect", checkStatus);
    };
  }, [roomId]);

  // Duration timer — starts when stream goes live
  useEffect(() => {
    if (streamStatus === "live") {
      setDuration(0);
      timerRef.current = setInterval(() => setDuration((d) => d + 1), 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [streamStatus]);

  const copy = useCallback((text: string, which: "server" | "key") => {
    navigator.clipboard.writeText(text);
    if (which === "server") { setCopiedServer(true); setTimeout(() => setCopiedServer(false), 2000); }
    else { setCopiedKey(true); setTimeout(() => setCopiedKey(false), 2000); }
  }, []);

  const leaveRoom = () => {
    socketRef.current.emit("host-stopped");
    disconnectSocket();
    router.push("/");
  };

  const fmt = (s: number) => {
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return h > 0
      ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
      : `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  };

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col">
      {/* Header */}
      <header className="border-b border-gray-800 px-6 py-3">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 bg-indigo-500 rounded-lg flex items-center justify-center">
              <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.069A1 1 0 0121 8.868V15.132a1 1 0 01-1.447.9L15 14M3 8a2 2 0 012-2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" />
              </svg>
            </div>
            <span className="font-semibold text-white">ScreenCast</span>
            <span className="text-gray-600 text-sm">·</span>
            <span className="text-gray-500 text-sm">Host Dashboard</span>
          </div>

          <div className="flex items-center gap-3">
            {streamStatus === "live" && (
              <div className="flex items-center gap-2 fade-in">
                <span className="w-2 h-2 rounded-full bg-red-500 pulse-ring inline-block" />
                <span className="text-sm font-mono text-gray-300">{fmt(duration)}</span>
                <span className="text-xs bg-red-500/20 text-red-400 px-2 py-0.5 rounded-full border border-red-500/30 font-medium">
                  LIVE
                </span>
              </div>
            )}
            <button onClick={leaveRoom} className="px-3 py-1.5 text-sm text-gray-500 hover:text-white border border-gray-800 hover:border-gray-600 rounded-lg transition">
              End Room
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-6xl mx-auto w-full px-6 py-8 grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Left — stream status + viewer info */}
        <div className="lg:col-span-2 flex flex-col gap-5">

          {/* Stream status card */}
          <div className={`rounded-2xl border p-8 flex flex-col items-center justify-center text-center transition-all duration-500 ${
            streamStatus === "live"
              ? "border-red-500/40 bg-red-500/5 shadow-2xl shadow-red-500/10"
              : streamStatus === "ended"
              ? "border-gray-700 bg-gray-900/50"
              : "border-gray-800 bg-gray-900/30"
          }`} style={{ minHeight: 280 }}>

            {streamStatus === "offline" && (
              <>
                <div className="w-16 h-16 rounded-2xl bg-gray-800 border border-gray-700 flex items-center justify-center mb-4">
                  <svg className="w-8 h-8 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.069A1 1 0 0121 8.868V15.132a1 1 0 01-1.447.9L15 14M3 8a2 2 0 012-2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" />
                  </svg>
                </div>
                <h2 className="text-lg font-semibold text-gray-400">Waiting for OBS stream</h2>
                <p className="text-sm text-gray-600 mt-1 max-w-xs">
                  Configure OBS with the settings on the right, then click <strong className="text-gray-500">Start Streaming</strong> in OBS
                </p>
                <div className="mt-4 flex items-center gap-2 text-xs text-gray-600">
                  <span className="w-1.5 h-1.5 rounded-full bg-gray-700 animate-pulse" />
                  Listening on RTMP port 1935…
                </div>
              </>
            )}

            {streamStatus === "live" && (
              <>
                <div className="w-16 h-16 rounded-2xl bg-red-500/20 border border-red-500/40 flex items-center justify-center mb-4">
                  <svg className="w-8 h-8 text-red-400" fill="currentColor" viewBox="0 0 24 24">
                    <circle cx="12" cy="12" r="6" />
                  </svg>
                </div>
                <h2 className="text-2xl font-bold text-white">Stream is LIVE</h2>
                <p className="text-sm text-gray-500 mt-1">OBS is streaming · viewers are watching via HLS</p>
                <div className="mt-4 flex items-center gap-4 text-sm">
                  <div className="flex items-center gap-2 text-gray-400">
                    <svg className="w-4 h-4 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                    {viewerCount} {viewerCount === 1 ? "viewer" : "viewers"}
                  </div>
                  <div className="flex items-center gap-2 text-gray-400">
                    <svg className="w-4 h-4 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    {fmt(duration)}
                  </div>
                </div>
              </>
            )}

            {streamStatus === "ended" && (
              <>
                <div className="w-16 h-16 rounded-2xl bg-gray-800 border border-gray-700 flex items-center justify-center mb-4">
                  <svg className="w-8 h-8 text-gray-500" fill="currentColor" viewBox="0 0 24 24">
                    <rect x="6" y="6" width="12" height="12" rx="2" />
                  </svg>
                </div>
                <h2 className="text-lg font-semibold text-gray-400">Stream ended</h2>
                <p className="text-sm text-gray-600 mt-1">OBS stopped streaming. Start it again to go live.</p>
              </>
            )}
          </div>

          {/* HLS preview URL */}
          {streamStatus === "live" && (
            <div className="p-4 rounded-xl bg-gray-900 border border-gray-800 fade-in">
              <p className="text-xs text-gray-600 mb-1.5">HLS Stream URL (internal)</p>
              <code className="text-xs text-indigo-300 break-all">{hlsUrl}</code>
            </div>
          )}
        </div>

        {/* Right — OBS config + room info */}
        <div className="flex flex-col gap-4">

          {/* Room info */}
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-3">Room</p>
            <div className="flex items-center gap-2 mb-2">
              <span className="font-mono text-xl font-bold text-white tracking-widest flex-1">{roomId}</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-gray-600">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
              Password protected
            </div>
            <div className="mt-3 pt-3 border-t border-gray-800 flex items-center gap-2 text-sm">
              <div className={`w-2 h-2 rounded-full transition-colors ${viewerCount > 0 ? "bg-green-500" : "bg-gray-700"}`} />
              <span className="text-gray-500 text-xs">
                {viewerCount === 0 ? "No viewers" : `${viewerCount} watching`}
              </span>
            </div>
          </div>

          {/* OBS Config */}
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-4">OBS Settings</p>

            <div className="space-y-3">
              <ConfigRow
                label="Service"
                value="Custom…"
              />

              <div>
                <p className="text-xs text-gray-600 mb-1">Server</p>
                <div className="flex items-center gap-2 bg-gray-800 rounded-lg px-3 py-2">
                  <code className="text-xs text-indigo-300 flex-1 truncate">{rtmpServer}</code>
                  <button onClick={() => copy(rtmpServer, "server")} className="text-gray-600 hover:text-white transition shrink-0">
                    {copiedServer
                      ? <svg className="w-3.5 h-3.5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                      : <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>}
                  </button>
                </div>
              </div>

              <div>
                <p className="text-xs text-gray-600 mb-1">Stream Key</p>
                <div className="flex items-center gap-2 bg-gray-800 rounded-lg px-3 py-2">
                  <code className="text-xs text-indigo-300 flex-1 font-mono tracking-widest">{streamKey}</code>
                  <button onClick={() => copy(streamKey, "key")} className="text-gray-600 hover:text-white transition shrink-0">
                    {copiedKey
                      ? <svg className="w-3.5 h-3.5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                      : <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>}
                  </button>
                </div>
              </div>

              <ConfigRow label="Encoder" value="x264 or NVENC" />
              <ConfigRow label="Bitrate" value="2500–6000 kbps" />
              <ConfigRow label="Keyframe Interval" value="2 seconds" />
            </div>

            <div className="mt-4 pt-4 border-t border-gray-800 text-xs text-gray-600 leading-relaxed">
              After saving settings, press <strong className="text-gray-500">Start Streaming</strong> in OBS. This dashboard will update automatically.
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

function ConfigRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-gray-600 mb-1">{label}</p>
      <div className="bg-gray-800 rounded-lg px-3 py-2">
        <span className="text-xs text-gray-300">{value}</span>
      </div>
    </div>
  );
}
