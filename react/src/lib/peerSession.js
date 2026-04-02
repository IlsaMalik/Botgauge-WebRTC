import { SignalingClient } from "./signalingClient.js";

export class PeerSession {
  constructor(signalingUrl, iceServers) {
    this.signalingUrl = signalingUrl;
    this.iceServers = iceServers;
    this.pc = null;
    this.inputChannel = null;
    this.signaling = null;
    this.sessionId = null;
    this.onTrack = null;
    this.onInputChannelOpen = null;
    this.onInputChannelClose = null;
  }

  async start(sessionId) {
    this.sessionId = sessionId;

    this.pc = new RTCPeerConnection({ iceServers: this.iceServers });

    this.inputChannel = this.pc.createDataChannel("input", { ordered: true });

    this.inputChannel.onopen  = () => this.onInputChannelOpen?.();
    this.inputChannel.onclose = () => this.onInputChannelClose?.();

    this.pc.ontrack = (e) => {
      if (e.streams && e.streams[0]) {
        this.onTrack?.(e.streams[0]);
      }
    };

    this.signaling = new SignalingClient(this.signalingUrl);

    const pendingCandidates = [];
    let offerAcked = false;

    this.pc.onicecandidate = (e) => {
      if (!e.candidate) return;
      const payload = {
        type: "candidate",
        candidate: e.candidate.candidate,
        sdp_mid: e.candidate.sdpMid ?? "",
        sdp_mline_index: e.candidate.sdpMLineIndex ?? 0,
        session_id: this.sessionId,
      };
      if (!offerAcked || this.signaling.ws?.readyState !== WebSocket.OPEN) {
        pendingCandidates.push(payload);
        return;
      }
      this.signaling.send(payload);
    };

    this.signaling.on("message", async (msg) => {
      if (msg.type === "answer") {
        await this.pc.setRemoteDescription({ type: "answer", sdp: msg.sdp });
        offerAcked = true;
        while (pendingCandidates.length) {
          this.signaling.send(pendingCandidates.shift());
        }
      } else if (msg.type === "candidate") {
        try {
          await this.pc.addIceCandidate(new RTCIceCandidate({
            candidate: msg.candidate,
            sdpMid: msg.sdp_mid ?? "0",
            sdpMLineIndex: msg.sdp_mline_index ?? 0,
          }));
        } catch (_) {}
      }
    });

    await new Promise((resolve, reject) => {
      this.signaling.on("open",  resolve);
      this.signaling.on("error", reject);
      this.signaling.connect();
    });

    const offer = await this.pc.createOffer({ offerToReceiveVideo: true });
    await this.pc.setLocalDescription(offer);

    this.signaling.send({
      type: "offer",
      sdp: offer.sdp,
      session_id: this.sessionId,
    });
  }

  stop() {
    this.signaling?.disconnect();
    this.inputChannel?.close();
    this.pc?.close();
    this.pc = null;
    this.inputChannel = null;
    this.signaling = null;
  }
}