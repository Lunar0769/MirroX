"use client";

import Peer from "peerjs";

// Map of active peer instances keyed by peer ID
const peerInstances = new Map<string, Peer>();

export function getPeer(id?: string): Promise<Peer> {
  return new Promise((resolve, reject) => {
    // Normalize peer ID: PeerJS only accepts [0-9a-z_-]
    const peerId = id ? id.toLowerCase() : "";

    // Reuse if alive
    const existing = peerId ? peerInstances.get(peerId) : null;
    if (existing && !existing.destroyed) {
      if (existing.open) {
        resolve(existing);
      } else {
        existing.once("open", () => resolve(existing));
        existing.once("error", reject);
      }
      return;
    }

    const peer = new Peer(peerId ? peerId : (undefined as unknown as string), {
      debug: 1,
    });

    peer.once("open", (assignedId) => {
      peerInstances.set(assignedId, peer);
      resolve(peer);
    });

    peer.once("error", (err) => {
      console.error("[PeerJS] Error:", err);
      peerInstances.delete(peerId);
      reject(err);
    });
  });
}

export function destroyPeer(id: string) {
  const key = id.toLowerCase();
  const peer = peerInstances.get(key);
  if (peer) {
    peer.destroy();
    peerInstances.delete(key);
  }
}

export function getCurrentPeer(id: string): Peer | null {
  return peerInstances.get(id.toLowerCase()) ?? null;
}
