import { SignalingClient } from "./signalingClient.js";

export class PeerSession {
  constructor(signalingUrl) {
    this.signalingUrl        = signalingUrl;
    this.pc                  = null;
    this.inputChannel        = null;
    this.signaling           = null;
    this.sessionId           = null;
    this.onTrack             = null;
    this.onInputChannelOpen  = null;
    this.onInputChannelClose = null;
  }

  async start(sessionId, plan) {
    this.sessionId = sessionId;

    const {
      iceServers         = [],
      iceTransportPolicy = "all",
      timeoutMs          = 15000,
      stageName          = "unknown",
    } = plan;

    console.log(`[PeerSession][${stageName}] ▶ start()`, {
      sessionId,
      iceServers,
      iceTransportPolicy,
      timeoutMs,
      signalingUrl: this.signalingUrl,
    });

    this.pc = new RTCPeerConnection({
      iceServers,
      iceTransportPolicy,
      bundlePolicy: "max-bundle",
    });

    this.inputChannel          = this.pc.createDataChannel("input", { ordered: true });
    this.inputChannel.onopen   = () => {
      console.log(`[PeerSession][${stageName}] ✅ inputChannel OPEN`);
      this.onInputChannelOpen?.();
    };
    this.inputChannel.onclose  = () => {
      console.log(`[PeerSession][${stageName}] ⚠️ inputChannel CLOSED`);
      this.onInputChannelClose?.();
    };

    this.pc.ontrack = (e) => {
      console.log(`[PeerSession][${stageName}] 🎥 ontrack`, e.streams);
      if (e.streams?.[0]) this.onTrack?.(e.streams[0]);
    };

    const remoteQueue  = [];
    let remoteDescSet  = false;
    let attemptSettled = false;
    let resolveAttempt, rejectAttempt;

    const attemptPromise = new Promise((res, rej) => {
      resolveAttempt = res;
      rejectAttempt  = rej;
    });

    console.log(`[PeerSession][${stageName}] 🔌 Connecting WebSocket to: ${this.signalingUrl}`);
    this.signaling = new SignalingClient(this.signalingUrl);

    await new Promise((resolve, reject) => {
      this.signaling.on("open",  () => {
        console.log(`[PeerSession][${stageName}] ✅ WebSocket OPEN`);
        resolve();
      });
      this.signaling.on("error", (err) => {
        console.error(`[PeerSession][${stageName}] ❌ WebSocket ERROR`, err);
        reject(new Error("WebSocket connection failed"));
      });
      this.signaling.connect();
    });

    this.signaling.on("close", (code) => {
      console.warn(`[PeerSession][${stageName}] 🔴 WebSocket CLOSED code=${code}`);
      if (!attemptSettled) {
        attemptSettled = true;
        rejectAttempt(new Error(`WebSocket closed before connected (code=${code}), stage=${stageName}`));
      }
    });

    this.signaling.on("message", async (msg) => {
      console.log(`[PeerSession][${stageName}] 📨 WS message received:`, msg.type, msg);

      if (msg.type === "answer") {
        console.log(`[PeerSession][${stageName}] 📝 Setting remote description (answer)`);
        await this.pc.setRemoteDescription({ type: "answer", sdp: msg.sdp });
        remoteDescSet = true;
        console.log(`[PeerSession][${stageName}] 🧊 Flushing ${remoteQueue.length} queued ICE candidates`);
        for (const c of remoteQueue) {
          try { await this.pc.addIceCandidate(c); } catch (_) {}
        }
        remoteQueue.length = 0;

      } else if (msg.type === "candidate") {
        const candidate = msg.candidate
          ? new RTCIceCandidate({
              candidate:     msg.candidate,
              sdpMid:        msg.sdpMid        ?? msg.sdp_mid         ?? "0",
              sdpMLineIndex: msg.sdpMLineIndex ?? msg.sdp_mline_index ?? 0,
            })
          : null;

        if (!remoteDescSet) {
          console.log(`[PeerSession][${stageName}] 🧊 Queuing ICE candidate (remote desc not set yet)`);
          remoteQueue.push(candidate);
        } else {
          console.log(`[PeerSession][${stageName}] 🧊 Adding ICE candidate immediately`);
          try { await this.pc.addIceCandidate(candidate); } catch (_) {}
        }

      } else if (msg.type === "offer") {
        console.log(`[PeerSession][${stageName}] 📝 Server sent offer — setting remote desc, creating answer`);
        await this.pc.setRemoteDescription({ type: "offer", sdp: msg.sdp });
        const answer = await this.pc.createAnswer();
        await this.pc.setLocalDescription(answer);
        const reply = {
          type:       "answer",
          session_id: this.sessionId,
          sdp:        this.pc.localDescription.sdp,
        };
        if (msg.operation_id) reply.operation_id = msg.operation_id;
        console.log(`[PeerSession][${stageName}] 📤 Sending answer back to server`, reply);
        this.signaling.send(reply);

      } else if (msg.type === "error") {
        console.error(`[PeerSession][${stageName}] ❌ Server error message:`, msg);
        if (!attemptSettled) {
          attemptSettled = true;
          rejectAttempt(new Error(`Server error: ${msg.message}, stage=${stageName}`));
        }

      } else if (msg.type === "state") {
        console.log(`[PeerSession][${stageName}] 🔄 Server state:`, msg.state);
        if (msg.state === "FAILED" && !attemptSettled) {
          attemptSettled = true;
          rejectAttempt(new Error(`Pod state=FAILED, stage=${stageName}`));
        }

      } else if (msg.type === "pong") {
        console.log(`[PeerSession][${stageName}] 🏓 Pong received`);

      } else {
        console.warn(`[PeerSession][${stageName}] ❓ Unknown message type:`, msg.type, msg);
      }
    });

    this.pc.onicecandidate = ({ candidate }) => {
      console.log(`[PeerSession][${stageName}] 🧊 Local ICE candidate:`, candidate?.candidate ?? "null (end-of-candidates)");
      this.signaling.send({
        type:          "candidate",
        session_id:    this.sessionId,
        candidate:     candidate?.candidate     ?? null,
        sdpMid:        candidate?.sdpMid        ?? null,
        sdpMLineIndex: candidate?.sdpMLineIndex ?? null,
      });
    };

    this.pc.onicegatheringstatechange = () => {
      console.log(`[PeerSession][${stageName}] 🧊 ICE gathering state:`, this.pc.iceGatheringState);
    };

    this.pc.oniceconnectionstatechange = () => {
      console.log(`[PeerSession][${stageName}] 🧊 ICE connection state:`, this.pc.iceConnectionState);
    };

    this.pc.onsignalingstatechange = () => {
      console.log(`[PeerSession][${stageName}] 🔔 Signaling state:`, this.pc.signalingState);
    };

    this.pc.onconnectionstatechange = () => {
      const state = this.pc?.connectionState;
      console.log(`[PeerSession][${stageName}] 🔗 connectionState:`, state);

      if (state === "connected" && !attemptSettled) {
        console.log(`[PeerSession][${stageName}] ✅✅ CONNECTED via ${stageName}`);
        attemptSettled = true;
        resolveAttempt();
      }

      if ((state === "failed" || state === "closed") && !attemptSettled) {
        console.error(`[PeerSession][${stageName}] ❌ Connection ${state}`);
        attemptSettled = true;
        rejectAttempt(new Error(`connectionState=${state}, stage=${stageName}`));
      }

      if (state === "disconnected" && !attemptSettled) {
        console.warn(`[PeerSession][${stageName}] ⚠️ Disconnected — waiting 3s to see if it recovers`);
        setTimeout(() => {
          if (this.pc?.connectionState !== "connected" && !attemptSettled) {
            console.error(`[PeerSession][${stageName}] ❌ Did not recover from disconnected`);
            attemptSettled = true;
            rejectAttempt(new Error(`disconnected and did not recover, stage=${stageName}`));
          }
        }, 3000);
      }
    };

    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(
        () => {
          console.error(`[PeerSession][${stageName}] ⏰ TIMEOUT after ${timeoutMs}ms`);
          reject(new Error(`Timeout after ${timeoutMs}ms, stage=${stageName}`));
        },
        timeoutMs
      )
    );

    console.log(`[PeerSession][${stageName}] 📝 Creating offer...`);
    const offer = await this.pc.createOffer({ offerToReceiveVideo: true });
    await this.pc.setLocalDescription(offer);
    console.log(`[PeerSession][${stageName}] 📤 Sending offer to server`, {
      type: "offer",
      session_id: this.sessionId,
      sdp_length: offer.sdp?.length,
    });

    this.signaling.send({
      type:       "offer",
      sdp:        offer.sdp,
      session_id: this.sessionId,
    });

    console.log(`[PeerSession][${stageName}] ⏳ Waiting for connection (timeout: ${timeoutMs}ms)...`);
    await Promise.race([attemptPromise, timeoutPromise]);
  }

  stop() {
    console.log(`[PeerSession] 🛑 stop() called`);
    this.signaling?.disconnect();
    this.inputChannel?.close();
    this.pc?.close();
    this.pc           = null;
    this.inputChannel = null;
    this.signaling    = null;
  }
}