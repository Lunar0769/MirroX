"use client";

import { useRef, useCallback } from "react";
import Peer, { MediaConnection } from "peerjs";

export interface ViewerInfo {
  peerId: string;
  username: string;
}

export function useHostPeer() {
  const callsRef        = useRef<Map<string, MediaConnection>>(new Map());
  const screenCallsRef  = useRef<Map<string, MediaConnection>>(new Map());
  const connsRef        = useRef<Map<string, any>>(new Map());
  const screenStreamRef = useRef<MediaStream | null>(null);
  const peerRef         = useRef<Peer | null>(null);
  const viewerNamesRef  = useRef<Map<string, string>>(new Map());

  // ── helpers (not hooks, safe to define inside useCallback scope) ──────────

  const sendScreenToViewer = useCallback(
    (peer: Peer, viewerPeerId: string, stream: MediaStream) => {
      screenCallsRef.current.get(viewerPeerId)?.close();
      screenCallsRef.current.delete(viewerPeerId);

      const sc = peer.call(viewerPeerId, stream, { metadata: { type: "SCREEN" } });
      screenCallsRef.current.set(viewerPeerId, sc);
      sc.on("close", () => screenCallsRef.current.delete(viewerPeerId));
      sc.on("error", (e) => {
        console.error("[Host] Screen call error →", viewerPeerId, e);
        screenCallsRef.current.delete(viewerPeerId);
      });
    },
    []
  );

  // ── main setup ────────────────────────────────────────────────────────────

  const setupHostListeners = useCallback(
    (
      peer: Peer,
      myStream: MediaStream,
      expectedPassword: string,
      onViewerUpdate: (viewers: ViewerInfo[]) => void,
      onViewerLeft:   (peerId: string) => void,
      onViewerStream: (peerId: string, stream: MediaStream) => void
    ) => {
      peerRef.current = peer;

      const emitViewers = () => {
        onViewerUpdate(
          Array.from(connsRef.current.keys()).map((pid) => ({
            peerId: pid,
            username: viewerNamesRef.current.get(pid) ?? "Viewer",
          }))
        );
      };

      const removeViewer = (peerId: string) => {
        connsRef.current.delete(peerId);
        viewerNamesRef.current.delete(peerId);
        connsRef.current.forEach((c) => c.send({ type: "PEER_LEFT", peerId }));
        onViewerLeft(peerId);
        emitViewers();
      };

      // Remove stale listeners (React Strict Mode double-invoke guard)
      peer.removeAllListeners("call");
      peer.removeAllListeners("connection");

      // ── incoming voice call from viewer ──────────────────────────────────
      peer.on("call", (call) => {
        const pwd = (call.metadata?.password as string) ?? "";
        if (expectedPassword && pwd !== expectedPassword) {
          console.warn("[Host] Bad password on voice call from", call.peer);
          setTimeout(() => call.close(), 300);
          return;
        }

        callsRef.current.get(call.peer)?.close();
        callsRef.current.set(call.peer, call);
        call.answer(myStream);

        call.on("stream",  (s) => onViewerStream(call.peer, s));
        call.on("close",   () => callsRef.current.delete(call.peer));
        call.on("error",   () => callsRef.current.delete(call.peer));
      });

      // ── incoming data connection (signaling) ──────────────────────────────
      peer.on("connection", (conn) => {
        const pwd = (conn.metadata?.password as string) ?? "";
        if (expectedPassword && pwd !== expectedPassword) {
          console.warn("[Host] Bad password on data conn from", conn.peer);
          setTimeout(() => conn.close(), 300);
          return;
        }

        conn.on("open", () => {
          const username: string = (conn.metadata?.username as string) ?? "Viewer";
          viewerNamesRef.current.set(conn.peer, username);

          // Tell newcomer about existing viewers
          const existing = Array.from(connsRef.current.keys()).map((pid) => ({
            peerId: pid,
            username: viewerNamesRef.current.get(pid) ?? "Viewer",
          }));
          conn.send({ type: "PEERS_LIST", peers: existing });

          // Tell existing viewers about newcomer
          connsRef.current.forEach((c) =>
            c.send({ type: "NEW_PEER", peerId: conn.peer, username })
          );

          connsRef.current.set(conn.peer, conn);
          emitViewers();

          // If screen is already being shared, send it to this viewer now
          if (screenStreamRef.current) {
            console.log("[Host] Sending screen to late-joining viewer", conn.peer);
            sendScreenToViewer(peer, conn.peer, screenStreamRef.current);
          }
        });

        conn.on("close", () => removeViewer(conn.peer));
        conn.on("error", () => removeViewer(conn.peer));
      });
    },
    [sendScreenToViewer]
  );

  // ── called by HostRoom on Start Share / Stop Share ────────────────────────
  const setScreenStream = useCallback(
    (stream: MediaStream | null) => {
      screenStreamRef.current = stream;
      const peer = peerRef.current;

      if (stream && peer) {
        // Close stale screen calls
        screenCallsRef.current.forEach((c) => c.close());
        screenCallsRef.current.clear();

        // Push to every connected viewer
        console.log("[Host] Broadcasting screen to", connsRef.current.size, "viewer(s)");
        connsRef.current.forEach((_conn, viewerPeerId) => {
          sendScreenToViewer(peer, viewerPeerId, stream);
        });
      } else {
        screenCallsRef.current.forEach((c) => c.close());
        screenCallsRef.current.clear();
      }
    },
    [sendScreenToViewer]
  );

  const closeAll = useCallback(() => {
    callsRef.current.forEach((c)       => c.close());
    callsRef.current.clear();
    screenCallsRef.current.forEach((c) => c.close());
    screenCallsRef.current.clear();
    connsRef.current.forEach((c)       => c.close());
    connsRef.current.clear();
    viewerNamesRef.current.clear();
    peerRef.current = null;
  }, []);

  const getViewerCount = useCallback(() => connsRef.current.size, []);

  return { setupHostListeners, setScreenStream, closeAll, getViewerCount } as const;
}
