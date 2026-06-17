"use client";

import { useRef, useCallback } from "react";
import Peer, { MediaConnection } from "peerjs";

export interface PeerInfo {
  peerId: string;
  username: string;
  stream: MediaStream | null;
}

/**
 * Create a minimal dummy MediaStream with one silent audio track + one black
 * video track.  Chrome requires a *real* answer stream whose SDP matches the
 * offer's m-lines (video + audio).  An empty MediaStream() causes ICE to fail
 * on Chrome because the answer SDP has no media sections.
 */
function createDummyAnswerStream(): MediaStream {
  // --- video: tiny black canvas at 1 fps ---
  const canvas = document.createElement("canvas");
  canvas.width = 2;
  canvas.height = 2;
  const ctx = canvas.getContext("2d");
  if (ctx) { ctx.fillStyle = "#000"; ctx.fillRect(0, 0, 2, 2); }
  const intervalId = setInterval(() => {
    if (ctx) ctx.fillRect(0, 0, 2, 2);
  }, 1000);
  const videoStream = (canvas as any).captureStream(1) as MediaStream;

  // --- audio: silent oscillator via Web Audio ---
  let audioTrack: MediaStreamTrack | null = null;
  try {
    const ac = new AudioContext();
    const dest = ac.createMediaStreamDestination();
    // Oscillator at 0 gain = silence, but it IS a live audio track
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    gain.gain.value = 0;
    osc.connect(gain);
    gain.connect(dest);
    osc.start();
    audioTrack = dest.stream.getAudioTracks()[0];
  } catch {
    // AudioContext blocked (unlikely but handle gracefully)
  }

  const tracks: MediaStreamTrack[] = [...videoStream.getVideoTracks()];
  if (audioTrack) tracks.push(audioTrack);

  // Cleanup when all tracks end
  const dummy = new MediaStream(tracks);
  dummy.addEventListener("removetrack", () => {
    clearInterval(intervalId);
  });

  return dummy;
}

export function useViewerPeer() {
  const hostCallRef  = useRef<MediaConnection | null>(null);
  const hostConnRef  = useRef<any>(null);
  const peerCallsRef = useRef<Map<string, MediaConnection>>(new Map());
  // Keep screen audio playing via a hidden <audio> element
  const screenAudioRef = useRef<HTMLAudioElement | null>(null);

  const connectToHost = useCallback(
    (
      peer: Peer,
      hostPeerId: string,
      password: string,
      username: string,
      myStream: MediaStream,
      onHostAudio:    (stream: MediaStream) => void,
      onScreenStream: (stream: MediaStream | null) => void,
      onPeerUpdate:   (peers: PeerInfo[]) => void,
      onClose:        () => void
    ) => {
      const peerNames   = new Map<string, string>();
      const peerStreams  = new Map<string, MediaStream | null>();

      const emitPeers = () => {
        onPeerUpdate(
          Array.from(peerNames.keys()).map((pid) => ({
            peerId:   pid,
            username: peerNames.get(pid) ?? "Viewer",
            stream:   peerStreams.get(pid) ?? null,
          }))
        );
      };

      const callPeer = (pid: string, pName: string) => {
        if (pid === peer.id) return;
        peerCallsRef.current.get(pid)?.close();
        const c = peer.call(pid, myStream);
        c.on("stream", (s) => { peerStreams.set(pid, s); emitPeers(); });
        c.on("close",  () => { peerCallsRef.current.delete(pid); peerNames.delete(pid); peerStreams.delete(pid); emitPeers(); });
        c.on("error",  () => { peerCallsRef.current.delete(pid); peerNames.delete(pid); peerStreams.delete(pid); emitPeers(); });
        peerCallsRef.current.set(pid, c);
        peerNames.set(pid, pName);
        peerStreams.set(pid, null);
        emitPeers();
      };

      // ── MUST register peer.on("call") FIRST ─────────────────────────────
      // The host sends the screen call the moment the data conn opens.
      // Any delay here = missed call.
      peer.removeAllListeners("call");

      peer.on("call", (incoming) => {
        if (incoming.metadata?.type === "SCREEN") {
          // Answer with a real dummy stream so Chrome's SDP negotiation
          // includes both video AND audio m-lines (matching the host's offer).
          const dummy = createDummyAnswerStream();
          incoming.answer(dummy);

          incoming.on("stream", (screenStream) => {
            console.log(
              "[Viewer] Screen stream received. Tracks:",
              screenStream.getTracks().map((t) => `${t.kind}(${t.label})`).join(", ")
            );

            // ── Screen AUDIO fix ──────────────────────────────────────────
            // The <video> element on the viewer page is `muted` (required by
            // Chrome autoplay policy). That means screen audio is silenced.
            // Route audio tracks from the screen stream through a separate
            // hidden <audio> element which IS allowed to play unmuted after
            // the user has interacted with the page.
            const audioTracks = screenStream.getAudioTracks();
            if (audioTracks.length > 0) {
              // Detach old audio element if any
              if (screenAudioRef.current) {
                screenAudioRef.current.srcObject = null;
                screenAudioRef.current.remove();
              }
              const audioOnly = new MediaStream(audioTracks);
              const audioEl   = document.createElement("audio");
              audioEl.srcObject = audioOnly;
              audioEl.autoplay  = true;
              audioEl.style.display = "none";
              document.body.appendChild(audioEl);
              audioEl.play().catch((e) =>
                console.warn("[Viewer] Screen audio autoplay blocked:", e)
              );
              screenAudioRef.current = audioEl;
            }

            onScreenStream(screenStream);
          });

          incoming.on("close", () => {
            if (screenAudioRef.current) {
              screenAudioRef.current.srcObject = null;
              screenAudioRef.current.remove();
              screenAudioRef.current = null;
            }
            onScreenStream(null);
          });
          incoming.on("error", (e) => {
            console.error("[Viewer] Screen call error:", e);
            onScreenStream(null);
          });

        } else {
          // Peer-to-peer voice call from another viewer
          incoming.answer(myStream);
          incoming.on("stream", (s) => { peerStreams.set(incoming.peer, s); emitPeers(); });
          incoming.on("close",  () => { peerCallsRef.current.delete(incoming.peer); peerNames.delete(incoming.peer); peerStreams.delete(incoming.peer); emitPeers(); });
          incoming.on("error",  () => { peerCallsRef.current.delete(incoming.peer); peerNames.delete(incoming.peer); peerStreams.delete(incoming.peer); emitPeers(); });
          peerCallsRef.current.set(incoming.peer, incoming);
        }
      });

      // ── Voice call to host ───────────────────────────────────────────────
      const voiceCall = peer.call(hostPeerId, myStream, { metadata: { password, username } });
      hostCallRef.current = voiceCall;

      voiceCall.on("stream", (s) => {
        console.log("[Viewer] Host audio stream received");
        onHostAudio(s);
      });
      // Only fire onClose when the call genuinely errors — not on normal close
      // events that happen when the host stops sharing (PeerJS fires close on
      // the *screen* call, not the voice call, in that case).
      voiceCall.on("close", () => {
        console.log("[Viewer] Host voice call closed — treating as disconnect");
        onClose();
      });
      voiceCall.on("error", (e) => {
        console.error("[Viewer] Host voice call error:", e);
        onClose();
      });

      // ── Data connection (mesh signaling) ─────────────────────────────────
      const conn = peer.connect(hostPeerId, { metadata: { password, username } });
      hostConnRef.current = conn;

      conn.on("open", () => console.log("[Viewer] Data conn open"));

      conn.on("data", (data: any) => {
        if (data.type === "PEERS_LIST") {
          (data.peers as { peerId: string; username: string }[]).forEach((p) =>
            callPeer(p.peerId, p.username)
          );
        } else if (data.type === "NEW_PEER") {
          peerNames.set(data.peerId, data.username ?? "Viewer");
          peerStreams.set(data.peerId, null);
          emitPeers();
        } else if (data.type === "PEER_LEFT") {
          peerCallsRef.current.get(data.peerId)?.close();
          peerCallsRef.current.delete(data.peerId);
          peerNames.delete(data.peerId);
          peerStreams.delete(data.peerId);
          emitPeers();
        }
      });

      // Data conn errors are non-fatal for viewer status
      conn.on("error", (e) => console.error("[Viewer] Data conn error:", e));
      conn.on("close", () => console.log("[Viewer] Data conn closed"));
    },
    []
  );

  const close = useCallback(() => {
    hostCallRef.current?.close();
    hostCallRef.current = null;
    hostConnRef.current?.close();
    hostConnRef.current = null;
    peerCallsRef.current.forEach((c) => c.close());
    peerCallsRef.current.clear();
    // Cleanup screen audio element
    if (screenAudioRef.current) {
      screenAudioRef.current.srcObject = null;
      screenAudioRef.current.remove();
      screenAudioRef.current = null;
    }
  }, []);

  return { connectToHost, close };
}
