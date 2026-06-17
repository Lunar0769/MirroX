'use client';

import { useState, useRef, useEffect, useCallback } from 'react';

type ShareStatus = 'idle' | 'requesting' | 'sharing' | 'error';

interface AudioLevels {
  mic: number;
  system: number;
}

export default function ScreenShare() {
  const [status, setStatus] = useState<ShareStatus>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [micEnabled, setMicEnabled] = useState(true);
  const [systemAudioEnabled, setSystemAudioEnabled] = useState(true);
  const [isMuted, setIsMuted] = useState(false);
  const [duration, setDuration] = useState(0);
  const [audioLevels, setAudioLevels] = useState<AudioLevels>({ mic: 0, system: 0 });
  const [isFullscreen, setIsFullscreen] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Track all active streams and audio context for cleanup
  const screenStreamRef = useRef<MediaStream | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserMicRef = useRef<AnalyserNode | null>(null);
  const analyserSysRef = useRef<AnalyserNode | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const micGainRef = useRef<GainNode | null>(null);

  // Timer for session duration
  useEffect(() => {
    if (status === 'sharing') {
      setDuration(0);
      timerRef.current = setInterval(() => setDuration((d) => d + 1), 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [status]);

  // Audio level visualizer loop
  const updateAudioLevels = useCallback(() => {
    const getLevel = (analyser: AnalyserNode | null): number => {
      if (!analyser) return 0;
      const data = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteFrequencyData(data);
      const avg = data.reduce((a, b) => a + b, 0) / data.length;
      return Math.min(100, (avg / 128) * 100);
    };

    setAudioLevels({
      mic: getLevel(analyserMicRef.current),
      system: getLevel(analyserSysRef.current),
    });

    animFrameRef.current = requestAnimationFrame(updateAudioLevels);
  }, []);

  useEffect(() => {
    if (status === 'sharing') {
      animFrameRef.current = requestAnimationFrame(updateAudioLevels);
    } else {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      setAudioLevels({ mic: 0, system: 0 });
    }
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [status, updateAudioLevels]);

  const stopShare = useCallback(() => {
    // Stop all tracks
    if (videoRef.current?.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach((t) => t.stop());
      videoRef.current.srcObject = null;
    }
    screenStreamRef.current?.getTracks().forEach((t) => t.stop());
    audioStreamRef.current?.getTracks().forEach((t) => t.stop());
    audioContextRef.current?.close();

    screenStreamRef.current = null;
    audioStreamRef.current = null;
    audioContextRef.current = null;
    analyserMicRef.current = null;
    analyserSysRef.current = null;
    micGainRef.current = null;

    setStatus('idle');
    setIsMuted(false);
    setIsFullscreen(false);
  }, []);

  const startShare = async () => {
    setStatus('requesting');
    setErrorMsg('');

    try {
      // 1. Capture screen (+ system audio if available)
      const screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 30 } },
        audio: systemAudioEnabled,
      });
      screenStreamRef.current = screenStream;

      // 2. Capture microphone if enabled
      let audioStream: MediaStream | null = null;
      if (micEnabled) {
        try {
          audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
          audioStreamRef.current = audioStream;
        } catch {
          // Mic denied — continue without it
          console.warn('Microphone access denied, continuing without mic');
        }
      }

      // 3. Set up Web Audio API for mixing + analysis
      const audioContext = new AudioContext();
      audioContextRef.current = audioContext;
      const destination = audioContext.createMediaStreamDestination();

      if (screenStream.getAudioTracks().length > 0) {
        const sysSource = audioContext.createMediaStreamSource(screenStream);
        const sysAnalyser = audioContext.createAnalyser();
        sysAnalyser.fftSize = 256;
        analyserSysRef.current = sysAnalyser;
        sysSource.connect(sysAnalyser);
        sysAnalyser.connect(destination);
      }

      if (audioStream && audioStream.getAudioTracks().length > 0) {
        const micSource = audioContext.createMediaStreamSource(audioStream);
        const micGain = audioContext.createGain();
        micGainRef.current = micGain;
        const micAnalyser = audioContext.createAnalyser();
        micAnalyser.fftSize = 256;
        analyserMicRef.current = micAnalyser;
        micSource.connect(micGain);
        micGain.connect(micAnalyser);
        micAnalyser.connect(destination);
      }

      // 4. Combine video + mixed audio
      const combined = new MediaStream([
        ...screenStream.getVideoTracks(),
        ...destination.stream.getAudioTracks(),
      ]);

      if (videoRef.current) {
        videoRef.current.srcObject = combined;
      }

      setStatus('sharing');

      // Auto-stop when user ends via browser native UI
      screenStream.getVideoTracks()[0].addEventListener('ended', stopShare);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      if (msg.includes('Permission denied') || msg.includes('NotAllowedError')) {
        setErrorMsg('Screen share permission was denied. Please allow access and try again.');
      } else if (msg.includes('NotFoundError')) {
        setErrorMsg('No screen found to share. Make sure you have a display available.');
      } else {
        setErrorMsg('Failed to start screen share. Please try again.');
      }
      setStatus('error');
      screenStreamRef.current?.getTracks().forEach((t) => t.stop());
    }
  };

  const toggleMute = () => {
    if (micGainRef.current) {
      const newMuted = !isMuted;
      micGainRef.current.gain.value = newMuted ? 0 : 1;
      setIsMuted(newMuted);
    }
  };

  const toggleFullscreen = async () => {
    if (!document.fullscreenElement) {
      await containerRef.current?.requestFullscreen();
      setIsFullscreen(true);
    } else {
      await document.exitFullscreen();
      setIsFullscreen(false);
    }
  };

  useEffect(() => {
    const handler = () => {
      if (!document.fullscreenElement) setIsFullscreen(false);
    };
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  const formatDuration = (s: number) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
    return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  };

  const isSharing = status === 'sharing';

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col">
      {/* Header */}
      <header className="border-b border-gray-800 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-indigo-500 rounded-lg flex items-center justify-center">
              <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </div>
            <span className="text-lg font-semibold text-white">ScreenCast</span>
          </div>

          {isSharing && (
            <div className="flex items-center gap-2 fade-in">
              <span className="w-2 h-2 rounded-full bg-red-500 pulse-ring inline-block" />
              <span className="text-sm font-mono text-gray-300">{formatDuration(duration)}</span>
              <span className="text-xs bg-red-500/20 text-red-400 px-2 py-0.5 rounded-full border border-red-500/30 font-medium">
                LIVE
              </span>
            </div>
          )}
        </div>
      </header>

      <main className="flex-1 max-w-6xl mx-auto w-full px-6 py-8 flex flex-col gap-8">
        {/* Video Preview */}
        <div
          ref={containerRef}
          className={`relative w-full rounded-2xl overflow-hidden border transition-all duration-300 ${
            isSharing
              ? 'border-indigo-500/50 shadow-2xl shadow-indigo-500/10'
              : 'border-gray-800'
          }`}
          style={{ aspectRatio: '16/9', background: '#0a0a0f' }}
        >
          {/* Idle placeholder */}
          {!isSharing && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 text-gray-600">
              <div className="w-16 h-16 rounded-2xl bg-gray-900 border border-gray-800 flex items-center justify-center">
                <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              </div>
              <div className="text-center">
                <p className="text-gray-400 font-medium">No screen being shared</p>
                <p className="text-gray-600 text-sm mt-1">Click &quot;Start Sharing&quot; below to begin</p>
              </div>
            </div>
          )}

          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className={`w-full h-full object-contain transition-opacity duration-300 ${isSharing ? 'opacity-100' : 'opacity-0'}`}
          />

          {/* Fullscreen controls overlay (only while sharing) */}
          {isSharing && (
            <div className="absolute bottom-4 right-4 flex gap-2">
              {micGainRef.current && (
                <button
                  onClick={toggleMute}
                  className={`p-2 rounded-lg backdrop-blur-sm border transition-all ${
                    isMuted
                      ? 'bg-red-500/20 border-red-500/40 text-red-400'
                      : 'bg-black/40 border-white/10 text-white hover:bg-black/60'
                  }`}
                  title={isMuted ? 'Unmute mic' : 'Mute mic'}
                >
                  {isMuted ? (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072M12 6v12m-3.536-9.536a5 5 0 000 7.072M8.464 8.464a5 5 0 000 7.072" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18.75a.75.75 0 100-1.5.75.75 0 000 1.5z" />
                    </svg>
                  )}
                </button>
              )}
              <button
                onClick={toggleFullscreen}
                className="p-2 rounded-lg backdrop-blur-sm bg-black/40 border border-white/10 text-white hover:bg-black/60 transition-all"
                title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
              >
                {isFullscreen ? (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5l5.25 5.25" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
                  </svg>
                )}
              </button>
            </div>
          )}
        </div>

        {/* Audio Meters (shown while sharing) */}
        {isSharing && (
          <div className="grid grid-cols-2 gap-4 fade-in">
            <AudioMeter label="Microphone" level={audioLevels.mic} color="indigo" icon="mic" muted={isMuted} />
            <AudioMeter label="System Audio" level={audioLevels.system} color="violet" icon="system" muted={false} />
          </div>
        )}

        {/* Controls */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-4">
          {/* Settings (only when idle) */}
          {!isSharing && (
            <div className="flex gap-3 flex-1 fade-in">
              <ToggleCard
                label="Microphone"
                description="Mix your voice"
                enabled={micEnabled}
                onChange={setMicEnabled}
                icon={
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                  </svg>
                }
              />
              <ToggleCard
                label="System Audio"
                description="Tab / app sound"
                enabled={systemAudioEnabled}
                onChange={setSystemAudioEnabled}
                icon={
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072M12 6v12m-3.536-9.536a5 5 0 000 7.072" />
                  </svg>
                }
              />
            </div>
          )}

          {/* Action buttons */}
          <div className="flex gap-3">
            {!isSharing ? (
              <button
                onClick={startShare}
                disabled={status === 'requesting'}
                className="flex items-center gap-2 px-6 py-3 bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white font-semibold rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-indigo-500/20 hover:shadow-indigo-500/30"
              >
                {status === 'requesting' ? (
                  <>
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Requesting Access...
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                    Start Sharing
                  </>
                )}
              </button>
            ) : (
              <button
                onClick={stopShare}
                className="flex items-center gap-2 px-6 py-3 bg-red-600 hover:bg-red-500 active:bg-red-700 text-white font-semibold rounded-xl transition-all shadow-lg shadow-red-500/20 hover:shadow-red-500/30 pulse-ring"
              >
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <rect x="6" y="6" width="12" height="12" rx="2" />
                </svg>
                Stop Sharing
              </button>
            )}
          </div>
        </div>

        {/* Error message */}
        {status === 'error' && (
          <div className="flex items-start gap-3 p-4 bg-red-500/10 border border-red-500/30 rounded-xl fade-in">
            <svg className="w-5 h-5 text-red-400 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <div>
              <p className="text-red-400 font-medium text-sm">Share failed</p>
              <p className="text-red-400/70 text-sm mt-0.5">{errorMsg}</p>
            </div>
          </div>
        )}

        {/* Info cards */}
        {!isSharing && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 fade-in">
            <InfoCard
              icon={
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.955 11.955 0 003 12c0 3.43 1.44 6.525 3.75 8.718M20.25 12c0-1.643-.317-3.214-.89-4.653m-2.06-2.387A11.965 11.965 0 0012 3c-.694 0-1.372.06-2.033.176" />
                </svg>
              }
              title="Browser Native"
              description="Uses the Web Screen Capture API. No extensions or installs needed."
            />
            <InfoCard
              icon={
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.348 14.651a3.75 3.75 0 010-5.303m5.304 0a3.75 3.75 0 010 5.303m-7.425 2.122a6.75 6.75 0 010-9.546m9.546 0a6.75 6.75 0 010 9.546M5.106 18.894c-3.808-3.808-3.808-9.98 0-13.789m13.788 0c3.808 3.808 3.808 9.981 0 13.79" />
                </svg>
              }
              title="Mixed Audio"
              description="Captures mic and system audio simultaneously using Web Audio API."
            />
            <InfoCard
              icon={
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                </svg>
              }
              title="Private & Local"
              description="Everything stays in your browser. Nothing is uploaded to any server."
            />
          </div>
        )}
      </main>

      <footer className="border-t border-gray-800 py-4 px-6 text-center text-gray-600 text-sm">
        ScreenCast — Works best in Chrome or Edge
      </footer>
    </div>
  );
}

// --- Sub-components ---

function AudioMeter({
  label,
  level,
  color,
  icon,
  muted,
}: {
  label: string;
  level: number;
  color: 'indigo' | 'violet';
  icon: 'mic' | 'system';
  muted: boolean;
}) {
  const colorMap = {
    indigo: { bar: 'bg-indigo-500', bg: 'bg-indigo-500/10', border: 'border-indigo-500/20', text: 'text-indigo-400' },
    violet: { bar: 'bg-violet-500', bg: 'bg-violet-500/10', border: 'border-violet-500/20', text: 'text-violet-400' },
  };
  const c = colorMap[color];

  return (
    <div className={`p-4 rounded-xl border ${c.bg} ${c.border}`}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className={`${c.text}`}>
            {icon === 'mic' ? (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072M12 6v12m-3.536-9.536a5 5 0 000 7.072" />
              </svg>
            )}
          </div>
          <span className="text-sm font-medium text-gray-300">{label}</span>
        </div>
        {muted && (
          <span className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 px-2 py-0.5 rounded-full">
            Muted
          </span>
        )}
      </div>
      <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
        <div
          className={`h-full ${c.bar} rounded-full transition-all duration-75`}
          style={{ width: `${muted ? 0 : level}%` }}
        />
      </div>
      <div className="mt-1 text-right text-xs text-gray-600 font-mono">
        {muted ? '—' : `${Math.round(level)}%`}
      </div>
    </div>
  );
}

function ToggleCard({
  label,
  description,
  enabled,
  onChange,
  icon,
}: {
  label: string;
  description: string;
  enabled: boolean;
  onChange: (v: boolean) => void;
  icon: React.ReactNode;
}) {
  return (
    <button
      onClick={() => onChange(!enabled)}
      className={`flex-1 flex items-center gap-3 p-3 rounded-xl border text-left transition-all ${
        enabled
          ? 'bg-indigo-500/10 border-indigo-500/30 text-indigo-300'
          : 'bg-gray-900 border-gray-800 text-gray-500 hover:border-gray-700'
      }`}
    >
      <div
        className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-colors ${
          enabled ? 'bg-indigo-500/20' : 'bg-gray-800'
        }`}
      >
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-sm font-medium truncate">{label}</p>
        <p className="text-xs text-gray-600 truncate">{description}</p>
      </div>
      <div
        className={`ml-auto w-8 h-4 rounded-full transition-colors shrink-0 relative ${
          enabled ? 'bg-indigo-500' : 'bg-gray-700'
        }`}
      >
        <span
          className={`absolute top-0.5 w-3 h-3 bg-white rounded-full transition-transform shadow-sm ${
            enabled ? 'translate-x-4' : 'translate-x-0.5'
          }`}
        />
      </div>
    </button>
  );
}

function InfoCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="p-4 rounded-xl border border-gray-800 bg-gray-900/50">
      <div className="w-8 h-8 rounded-lg bg-gray-800 flex items-center justify-center text-gray-400 mb-3">
        {icon}
      </div>
      <p className="text-sm font-semibold text-gray-300">{title}</p>
      <p className="text-xs text-gray-600 mt-1 leading-relaxed">{description}</p>
    </div>
  );
}
