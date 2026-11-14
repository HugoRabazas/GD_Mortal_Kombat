// A direct connection between two browsers (WebRTC data channel).
//
// Once two players have found each other through the bus, the game data flows
// straight from one browser to the other: it is faster than going through a
// server, and it costs nothing however many matches are being played.
//
// Opening it takes a short negotiation ("signalling"): the two sides exchange
// a description of themselves and the network routes they can be reached on.
// Those few messages travel over the bus (`signal` out, `handle` in).
//
// Some networks do not allow direct connections. The caller watches `isOpen()`
// and, if the link never opens, relays the game data over the bus instead.

const ICE = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }];

// initiator: true on the host's side, which opens the data channel.
export function createLink({ initiator, signal, onMessage }) {
  const pc = new RTCPeerConnection({ iceServers: ICE });
  let dc = null;
  const pending = []; // routes that arrived before the description did

  const adopt = (channel) => {
    dc = channel;
    dc.onmessage = (e) => onMessage(e.data);
  };

  pc.onicecandidate = (e) => {
    if (e.candidate) signal({ ice: e.candidate.toJSON() });
  };
  pc.ondatachannel = (e) => adopt(e.channel);

  if (initiator) {
    // Game data is sent "fire and forget": a late snapshot is worthless, so
    // it is better dropped than delivered out of date.
    adopt(pc.createDataChannel('game', { ordered: false, maxRetransmits: 0 }));
    pc.createOffer()
      .then((offer) => pc.setLocalDescription(offer))
      .then(() => signal({ sdp: pc.localDescription.toJSON() }))
      .catch(() => {});
  }

  return {
    async handle(msg) {
      try {
        if (msg.sdp) {
          await pc.setRemoteDescription(msg.sdp);
          for (const c of pending.splice(0)) await pc.addIceCandidate(c);
          if (msg.sdp.type === 'offer') {
            await pc.setLocalDescription(await pc.createAnswer());
            signal({ sdp: pc.localDescription.toJSON() });
          }
        } else if (msg.ice) {
          if (pc.remoteDescription) await pc.addIceCandidate(msg.ice);
          else pending.push(msg.ice);
        }
      } catch {
        // a failed negotiation simply leaves the link closed; the relay takes over
      }
    },
    isOpen: () => !!dc && dc.readyState === 'open',
    send(text) {
      if (!dc || dc.readyState !== 'open') return false;
      try {
        dc.send(text);
        return true;
      } catch {
        return false;
      }
    },
    close() {
      try {
        pc.close();
      } catch {
        // already closed
      }
    },
  };
}
