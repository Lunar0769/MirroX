"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import Hls from "hls.js";
import { getSocket, disconnectSocket } from "../lib/socket";

type Status = "joining" | "waiting" | "buffering" | "watching" | "ended" | "error";

export default function ViewerRoom({ roomId }: { roomId: string }) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("joining");
  const [errorMsg, setErrorMsg] = useState("");
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const socketRef = useRef(getSocket());
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryCountRef = useRef(0);
  const MAX_HLS_RETRIES = 5;
  const HLS_RETRY_DELAY_MS = 2000;
  const HLS_INITIAL_DELAY_MS = 3000;

  // HLS URL for this room (served by NMS on port 8000 or custom deployed media server)
  const mediaServerUrl = process.env.NEXT_PUBLIC_MEDIA_SERVER_URL || "http://localhost:8000";
  const hlsUrl = `${mediaServerUrl}/live/${roomId}/index.m3u8`;

  const loadHLS = () => {
    if (!videoRef.current) return;
    const video = videoRef.current;

    // Clean up old instance
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    if (Hls.isSupported()) {
      const hls = new Hls({
        liveSyncDurationCount: 3,
        liveMaxLatencyDurationCount: 6,
        enableWorker: true,
      });
      hlsRef.current = hls;
      hls.loadSource(hlsUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        video.play().catch(() => {
          // Autoplay blocked — user needs to click
        });
        setStatus("watching");
        setIsPlaying(true);
        retryCountRef.current = 0; // reset for future retries
      });
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) {
          console.warn("[hls] fatal error:", data.type, "— retry", retryCountRef.current + 1);
          hls.destroy();
          hlsRef.current = null;

          // Retry: FFmpeg may not have produced the .m3u8 yet
          if (retryCountRef.current < MAX_HLS_RETRIES) {
            retryCountRef.current++;
            retryTimerRef.current = setTimeout(loadHLS, HLS_RETRY_DELAY_MS);
          }
        }
      });
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      // Safari native HLS
      video.src = hlsUrl;
      video.addEventListener("loadedmetadata", () => {
        video.play();
        setStatus("watching");
        setIsPlaying(true);
      });
    }
  };

  /** Called when the server says the stream just went live */
  const startHLSWithDelay = () => {
    setStatus("buffering");
    retryCountRef.current = 0;
    // Wait for FFmpeg to produce the first .m3u8 segment (~3s)
    retryTimerRef.current = setTimeout(loadHLS, HLS_INITIAL_DELAY_MS);
  };

  // Join room on mount
  useEffect(() => {
    const socket = socketRef.current;
    const password = sessionStorage.getItem(`room-pwd-${roomId}`) ?? "";

    const doJoin = () => {
      socket.emit(
        "join-room",
        { roomId, password },
        (res: { success: boolean; error?: string; isLive?: boolean }) => {
          if (!res.success) {
            setErrorMsg(res.error ?? "Could not join room.");
            setStatus("error");
            return;
          }
          if (res.isLive) {
            // Stream already running — give FFmpeg time, then load HLS
            startHLSWithDelay();
          } else {
            setStatus("waiting");
          }
        }
      );
    };

    if (socket.connected) doJoin();
    else socket.once("connect", doJoin);

    // When OBS starts streaming
    socket.on("stream-live", () => {
      startHLSWithDelay();
    });

    // When OBS stops
    socket.on("stream-ended", () => {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      hlsRef.current?.destroy();
      hlsRef.current = null;
      if (videoRef.current) videoRef.current.src = "";
      setStatus("ended");
      setIsPlaying(false);
    });

    return () => {
      socket.off("stream-live");
      socket.off("stream-ended");
      socket.off("connect", doJoin);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  // Fullscreen listener
  useEffect(() => {
    const handler = () => { if (!document.fullscreenElement) setIsFullscreen(false); };
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  // Cleanup HLS + retry timers on unmount
  useEffect(() => {
    return () => {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      hlsRef.current?.destroy();
    };
  }, []);

  const toggleFullscreen = async () => {
    if (!document.fullscreenElement) {
      await containerRef.current?.requestFullscreen();
      setIsFullscreen(true);
    } else {
      await document.exitFullscreen();
    }
  };

  const handleVolume = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseFloat(e.target.value);
    setVolume(v);
    if (videoRef.current) videoRef.current.volume = v;
    if (v === 0) setMuted(true);
    else setMuted(false);
  };

  const toggleMute = () => {
    if (!videoRef.current) return;
    const next = !muted;
    setMuted(next);
    videoRef.current.muted = next;
  };

  const togglePlay = () => {
    if (!videoRef.current) return;
    if (videoRef.current.paused) { videoRef.current.play(); setIsPlaying(true); }
    else { videoRef.current.pause(); setIsPlaying(false); }
  };

  const leave = () => {
    hlsRef.current?.destroy();
    disconnectSocket();
    router.push("/");
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
            <span className="font-mono text-sm text-gray-500">{roomId}</span>
          </div>

          <div className="flex items-center gap-3">
            {status === "watching" && (
              <div className="flex items-center gap-2 fade-in">
                <span className="w-2 h-2 rounded-full bg-red-500 pulse-ring inline-block" />
                <span className="text-xs text-red-400 font-medium">LIVE</span>
              </div>
            )}
            <button onClick={leave} className="px-3 py-1.5 text-sm text-gray-500 hover:text-white border border-gray-800 hover:border-gray-600 rounded-lg transition">
              Leave
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-6xl mx-auto w-full px-6 py-6 flex flex-col gap-4">

        {/* Status overlays */}
        {status === "joining" && (
          <StatusCard icon="⟳" title="Connecting to room…" animate />
        )}
        {status === "waiting" && (
          <StatusCard icon="⏳" title="Waiting for host to go live" subtitle="The host hasn't started streaming from OBS yet. This page will update automatically." animate />
        )}
        {status === "buffering" && (
          <StatusCard icon="📡" title="Loading stream…" subtitle="The host is live! Buffering the first few seconds of video…" animate />
        )}
        {status === "ended" && (
          <StatusCard icon="🛑" title="Stream ended" subtitle="The host stopped their OBS stream.">
            <button onClick={leave} className="mt-4 px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold rounded-xl transition">
              Back to Home
            </button>
          </StatusCard>
        )}
        {status === "error" && (
          <StatusCard icon="✕" title="Could not join" subtitle={errorMsg} error>
            <button onClick={leave} className="mt-4 px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold rounded-xl transition">
              Go Back
            </button>
          </StatusCard>
        )}

        {/* Video player */}
        <div
          ref={containerRef}
          className={`relative w-full rounded-2xl overflow-hidden border transition-all duration-300 group ${
            status === "watching"
              ? "border-indigo-500/40 shadow-2xl shadow-indigo-500/10"
              : "border-gray-800 opacity-20 pointer-events-none"
          }`}
          style={{ aspectRatio: "16/9", background: "#07070d" }}
        >
          <video
            ref={videoRef}
            className="w-full h-full object-contain"
            playsInline
          />

          {/* Custom controls overlay */}
          {status === "watching" && (
            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent px-4 pb-4 pt-10 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
              <div className="flex items-center gap-3">
                {/* Play/Pause */}
                <button onClick={togglePlay} className="text-white hover:text-indigo-300 transition">
                  {isPlaying ? (
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
                    </svg>
                  ) : (
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  )}
                </button>

                {/* Mute */}
                <button onClick={toggleMute} className="text-white hover:text-indigo-300 transition">
                  {muted || volume === 0 ? (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15zM17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
                    </svg>
                  ) : (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072M12 6v12m-3.536-9.536a5 5 0 000 7.072" />
                    </svg>
                  )}
                </button>

                {/* Volume slider */}
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={muted ? 0 : volume}
                  onChange={handleVolume}
                  className="w-24 accent-indigo-500"
                />

                <div className="flex-1" />

                {/* Live badge */}
                <span className="text-xs bg-red-500/20 text-red-400 px-2 py-0.5 rounded-full border border-red-500/30 font-medium">
                  LIVE
                </span>

                {/* Fullscreen */}
                <button onClick={toggleFullscreen} className="text-white hover:text-indigo-300 transition">
                  {isFullscreen ? (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5l5.25 5.25" />
                    </svg>
                  ) : (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
                    </svg>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>

        {status === "watching" && (
          <p className="text-xs text-gray-700 text-center">
            HLS stream · ~4s latency · hover over player for controls
          </p>
        )}
      </main>
    </div>
  );
}

function StatusCard({
  icon, title, subtitle, animate, error, children,
}: {
  icon: string; title: string; subtitle?: string; animate?: boolean; error?: boolean; children?: React.ReactNode;
}) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center py-24 text-center fade-in">
      <div className={`text-4xl mb-4 ${animate ? "animate-pulse" : ""}`}>{icon}</div>
      <h2 className={`text-lg font-semibold ${error ? "text-red-400" : "text-gray-300"}`}>{title}</h2>
      {subtitle && <p className="text-sm text-gray-600 mt-1 max-w-sm">{subtitle}</p>}
      {children}
    </div>
  );
}
