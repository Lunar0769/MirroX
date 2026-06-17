"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { v4 as uuidv4 } from "uuid";
import { getSocket } from "../lib/socket";

type Tab = "create" | "join";

export default function LandingPage() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("create");

  // Create
  const [createPassword, setCreatePassword] = useState("");
  const [createError, setCreateError] = useState("");
  const [creating, setCreating] = useState(false);
  const [showCreatePwd, setShowCreatePwd] = useState(false);
  const [createdRoom, setCreatedRoom] = useState<{ roomId: string; password: string } | null>(null);
  const [copiedId, setCopiedId] = useState(false);
  const [copiedKey, setCopiedKey] = useState(false);

  // Join
  const [joinRoomId, setJoinRoomId] = useState("");
  const [joinPassword, setJoinPassword] = useState("");
  const [joinError, setJoinError] = useState("");
  const [joining, setJoining] = useState(false);
  const [showJoinPwd, setShowJoinPwd] = useState(false);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createPassword.trim()) { setCreateError("Password is required."); return; }
    setCreating(true);
    setCreateError("");

    const roomId = uuidv4().slice(0, 8).toUpperCase();
    const socket = getSocket();

    socket.emit(
      "create-room",
      { roomId, password: createPassword },
      (res: { success: boolean; error?: string }) => {
        setCreating(false);
        if (res.success) {
          sessionStorage.setItem(`room-pwd-${roomId}`, createPassword);
          setCreatedRoom({ roomId, password: createPassword });
        } else {
          setCreateError(res.error || "Failed to create room.");
        }
      }
    );
  };

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    const rid = joinRoomId.trim().toUpperCase();
    if (!rid) { setJoinError("Enter a Room ID."); return; }
    if (!joinPassword.trim()) { setJoinError("Enter the password."); return; }
    setJoining(true);
    setJoinError("");

    const socket = getSocket();
    socket.emit(
      "join-room",
      { roomId: rid, password: joinPassword },
      (res: { success: boolean; error?: string }) => {
        setJoining(false);
        if (res.success) {
          sessionStorage.setItem(`room-pwd-${rid}`, joinPassword);
          router.push(`/room/${rid}?role=viewer`);
        } else {
          setJoinError(res.error || "Failed to join.");
        }
      }
    );
  };

  const copy = (text: string, which: "id" | "key") => {
    navigator.clipboard.writeText(text);
    if (which === "id") { setCopiedId(true); setTimeout(() => setCopiedId(false), 2000); }
    else { setCopiedKey(true); setTimeout(() => setCopiedKey(false), 2000); }
  };

  const goToRoom = () => {
    if (createdRoom) router.push(`/room/${createdRoom.roomId}?role=host`);
  };

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col">
      <header className="border-b border-gray-800 px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center gap-3">
          <div className="w-8 h-8 bg-indigo-500 rounded-lg flex items-center justify-center">
            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.069A1 1 0 0121 8.868V15.132a1 1 0 01-1.447.9L15 14M3 8a2 2 0 012-2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" />
            </svg>
          </div>
          <span className="text-lg font-semibold text-white">ScreenCast</span>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center px-4 py-16">
        <div className="w-full max-w-md">

          {/* Hero */}
          <div className="text-center mb-10">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-indigo-500/15 border border-indigo-500/30 mb-4">
              <svg className="w-8 h-8 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.069A1 1 0 0121 8.868V15.132a1 1 0 01-1.447.9L15 14M3 8a2 2 0 012-2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" />
              </svg>
            </div>
            <h1 className="text-3xl font-bold text-white">ScreenCast</h1>
            <p className="text-gray-500 mt-2 text-sm">
              Stream from OBS to a private, password-protected room
            </p>
          </div>

          {/* ── Created Room card ── */}
          {createdRoom ? (
            <div className="space-y-4 fade-in">
              <div className="p-5 rounded-2xl bg-green-500/10 border border-green-500/30">
                <div className="flex items-center gap-2 mb-4">
                  <span className="w-2 h-2 rounded-full bg-green-500" />
                  <span className="text-sm font-semibold text-green-400">Room created!</span>
                </div>

                {/* Room ID */}
                <div className="mb-3">
                  <p className="text-xs text-gray-600 mb-1">Room ID — share this with viewers</p>
                  <div className="flex items-center gap-2 bg-gray-900 rounded-xl px-4 py-3 border border-gray-800">
                    <span className="flex-1 font-mono text-xl font-bold text-white tracking-widest">
                      {createdRoom.roomId}
                    </span>
                    <button
                      onClick={() => copy(createdRoom.roomId, "id")}
                      className="text-gray-500 hover:text-white transition"
                    >
                      {copiedId
                        ? <svg className="w-4 h-4 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                        : <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>}
                    </button>
                  </div>
                </div>

                {/* OBS Stream Key */}
                <div className="mb-4">
                  <p className="text-xs text-gray-600 mb-1">OBS Stream Key</p>
                  <div className="flex items-center gap-2 bg-gray-900 rounded-xl px-4 py-3 border border-gray-800">
                    <span className="flex-1 font-mono text-sm text-indigo-300 tracking-widest truncate">
                      {createdRoom.roomId}
                    </span>
                    <button
                      onClick={() => copy(createdRoom.roomId, "key")}
                      className="text-gray-500 hover:text-white transition shrink-0"
                    >
                      {copiedKey
                        ? <svg className="w-4 h-4 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                        : <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>}
                    </button>
                  </div>
                </div>

                {/* OBS setup steps */}
                <div className="bg-gray-900/60 rounded-xl p-4 border border-gray-800 mb-4">
                  <p className="text-xs font-semibold text-gray-400 mb-3 flex items-center gap-1.5">
                    <span>🎬</span> OBS Setup
                  </p>
                  <ol className="space-y-2 text-xs text-gray-500">
                    <li className="flex gap-2">
                      <span className="text-indigo-400 font-bold shrink-0">1</span>
                      Open OBS → <strong className="text-gray-400">Settings → Stream</strong>
                    </li>
                    <li className="flex gap-2">
                      <span className="text-indigo-400 font-bold shrink-0">2</span>
                      Service: <strong className="text-gray-400">Custom…</strong>
                    </li>
                    <li className="flex gap-2">
                      <span className="text-indigo-400 font-bold shrink-0">3</span>
                      Server: <code className="bg-gray-800 px-1.5 py-0.5 rounded text-indigo-300">rtmp://localhost/live</code>
                    </li>
                    <li className="flex gap-2">
                      <span className="text-indigo-400 font-bold shrink-0">4</span>
                      Stream Key: <code className="bg-gray-800 px-1.5 py-0.5 rounded text-indigo-300">{createdRoom.roomId}</code>
                    </li>
                    <li className="flex gap-2">
                      <span className="text-indigo-400 font-bold shrink-0">5</span>
                      Click <strong className="text-gray-400">Apply → OK</strong>, then press <strong className="text-gray-400">Start Streaming</strong> in OBS
                    </li>
                  </ol>
                </div>

                <button
                  onClick={goToRoom}
                  className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded-xl transition text-sm flex items-center justify-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Go to Room Dashboard
                </button>
              </div>

              <button
                onClick={() => setCreatedRoom(null)}
                className="w-full text-sm text-gray-600 hover:text-gray-400 transition"
              >
                ← Create a different room
              </button>
            </div>
          ) : (
            <>
              {/* Tab switcher */}
              <div className="flex rounded-xl bg-gray-900 border border-gray-800 p-1 mb-6">
                {(["create", "join"] as Tab[]).map((t) => (
                  <button
                    key={t}
                    onClick={() => setTab(t)}
                    className={`flex-1 py-2 text-sm font-medium rounded-lg transition-all ${
                      tab === t
                        ? "bg-indigo-600 text-white shadow"
                        : "text-gray-500 hover:text-gray-300"
                    }`}
                  >
                    {t === "create" ? "🎙 Create Room" : "🔗 Join Room"}
                  </button>
                ))}
              </div>

              {/* Create */}
              {tab === "create" && (
                <form onSubmit={handleCreate} className="space-y-4 fade-in">
                  <div className="p-4 rounded-xl bg-indigo-500/5 border border-indigo-500/20 text-sm text-indigo-300/80 flex gap-3">
                    <span className="text-base shrink-0">📡</span>
                    <p>Create a room, then point OBS to the RTMP server. Viewers join with the Room ID + password you set.</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-400 mb-1.5">Room Password</label>
                    <div className="relative">
                      <input
                        type={showCreatePwd ? "text" : "password"}
                        value={createPassword}
                        onChange={(e) => setCreatePassword(e.target.value)}
                        placeholder="Choose a password for viewers"
                        className="w-full bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500 transition pr-10"
                      />
                      <button type="button" onClick={() => setShowCreatePwd(v => !v)} className="absolute right-3 top-3.5 text-gray-500 hover:text-gray-300">
                        {showCreatePwd ? <EyeOffIcon /> : <EyeIcon />}
                      </button>
                    </div>
                  </div>
                  {createError && <ErrorBanner msg={createError} />}
                  <button
                    type="submit"
                    disabled={creating}
                    className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold rounded-xl transition flex items-center justify-center gap-2"
                  >
                    {creating ? <><Spinner /> Creating…</> : "Create Room"}
                  </button>
                </form>
              )}

              {/* Join */}
              {tab === "join" && (
                <form onSubmit={handleJoin} className="space-y-4 fade-in">
                  <div>
                    <label className="block text-sm font-medium text-gray-400 mb-1.5">Room ID</label>
                    <input
                      type="text"
                      value={joinRoomId}
                      onChange={(e) => setJoinRoomId(e.target.value.toUpperCase())}
                      placeholder="e.g. 3F9A1B2C"
                      maxLength={8}
                      className="w-full bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500 transition font-mono tracking-widest"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-400 mb-1.5">Password</label>
                    <div className="relative">
                      <input
                        type={showJoinPwd ? "text" : "password"}
                        value={joinPassword}
                        onChange={(e) => setJoinPassword(e.target.value)}
                        placeholder="Enter room password"
                        className="w-full bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500 transition pr-10"
                      />
                      <button type="button" onClick={() => setShowJoinPwd(v => !v)} className="absolute right-3 top-3.5 text-gray-500 hover:text-gray-300">
                        {showJoinPwd ? <EyeOffIcon /> : <EyeIcon />}
                      </button>
                    </div>
                  </div>
                  {joinError && <ErrorBanner msg={joinError} />}
                  <button
                    type="submit"
                    disabled={joining}
                    className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold rounded-xl transition flex items-center justify-center gap-2"
                  >
                    {joining ? <><Spinner /> Joining…</> : "Join Room"}
                  </button>
                </form>
              )}
            </>
          )}
        </div>
      </main>

      <footer className="border-t border-gray-800 py-4 text-center text-gray-700 text-xs">
        ScreenCast · OBS → RTMP → HLS · End-to-end private streaming
      </footer>
    </div>
  );
}

function ErrorBanner({ msg }: { msg: string }) {
  return (
    <div className="flex items-center gap-2 px-4 py-3 bg-red-500/10 border border-red-500/30 rounded-xl text-sm text-red-400">
      <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      {msg}
    </div>
  );
}
function Spinner() {
  return (
    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}
function EyeIcon() {
  return <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>;
}
function EyeOffIcon() {
  return <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" /></svg>;
}
