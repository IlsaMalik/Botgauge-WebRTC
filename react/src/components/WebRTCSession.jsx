import { useState, useEffect, useRef } from "react";
import { PeerSession } from "../lib/peerSession.js";
import { ReconnectManager } from "../lib/reconnectManager.js";
import { attachInputCapture } from "../lib/inputCapture.js";

const BASE = "";
async function fetchToken() {
  const res = await fetch(`${BASE}/sessions/demo-token?user_id=demo-user-1`);
  const data = await res.json();
  return (data.token || "").replace(/^Bearer\s+/i, "").trim();
}

async function createSession(jwt) {
  const res = await fetch(`${BASE}/sessions`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${jwt}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ metadata: { source: "frontend" }, diagnostic: false }),
  });
  const data = await res.json();
  return data.session_id;
}

async function fetchBootstrap(sessionId, jwt) {
  const res = await fetch(
    `${BASE}/sessions/${sessionId}/bootstrap?token=${jwt}`,
    { method: "POST" }
  );
  return await res.json();
}

async function waitForReady(sessionId, jwt) {
  const timeoutMs = 20000;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await fetch(`/sessions/${sessionId}`, {
      headers: { "Authorization": `Bearer ${jwt}` },
    });
    if (res.ok) {
      const data = await res.json();
      const state = data.state || data.session_state || "";
      if (state === "READY" || state === "ACTIVE") return;
      if (state === "FAILED") throw new Error("Pod failed to start");
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error("Pod not ready (timeout)");
}

export default function WebRTCSession() {
  const [status, setStatus]             = useState("Initializing...");
  const [isError, setIsError]           = useState(false);
  const [isReady, setIsReady]           = useState(false);
  const [isMuted, setIsMuted]           = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [sessionId, setSessionId]       = useState(null);
  const [duration, setDuration]         = useState(0);
  const [metrics, setMetrics]           = useState({
    fps: 0, bitrate: 0, packetsLost: 0,
    jitter: 0, connectionState: "new", iceState: "new",
  });

  const videoRef     = useRef(null);
  const videoWrapRef = useRef(null);
  const sessionRef   = useRef(null);
  const cleanupRef   = useRef(null);
  const managerRef   = useRef(null);
  const pcRef        = useRef(null);

  useEffect(() => {
    if (!isReady) return;
    const timer = setInterval(() => setDuration((d) => d + 1), 1000);
    return () => clearInterval(timer);
  }, [isReady]);
  useEffect(() => {
  const handleBeforeUnload = () => {
    sessionRef.current?.stop();
  };
  window.addEventListener("beforeunload", handleBeforeUnload);
  return () => window.removeEventListener("beforeunload", handleBeforeUnload);
}, []);


  useEffect(() => {
    if (!isReady || !pcRef.current) return;
    let prevBytes = 0;
    let prevTime  = Date.now();

    const interval = setInterval(async () => {
      if (!pcRef.current) return;
      const report = await pcRef.current.getStats();
      report.forEach((stat) => {
        if (stat.type === "inbound-rtp" && stat.kind === "video") {
          const now     = Date.now();
          const elapsed = (now - prevTime) / 1000;
          const diff    = stat.bytesReceived - prevBytes;
          prevBytes     = stat.bytesReceived;
          prevTime      = now;
          setMetrics({
            fps:             Math.round(stat.framesPerSecond ?? 0),
            bitrate:         Math.round((diff * 8) / elapsed / 1000),
            packetsLost:     stat.packetsLost ?? 0,
            jitter:          Math.round((stat.jitter ?? 0) * 1000),
            connectionState: pcRef.current?.connectionState ?? "—",
            iceState:        pcRef.current?.iceConnectionState ?? "—",
          });
        }
      });
    }, 2000);

    return () => clearInterval(interval);
  }, [isReady]);

  useEffect(() => {
    async function startSession() {
        cleanupRef.current?.();
  sessionRef.current?.stop();
  pcRef.current = null;
      try {
        setIsError(false);

        setStatus("Getting token...");
        const jwt = await fetchToken();

        setStatus("Creating session...");
        const sid = await createSession(jwt);
        setSessionId(sid);

        setStatus("Fetching bootstrap...");
        const boot = await fetchBootstrap(sid, jwt);
        const signalingUrl = boot.signalingUrl || boot.signaling_url;
        const iceServers   = boot.iceServers   || boot.ice_servers || [];

        setStatus("Waiting for pod...");
        await waitForReady(sid, jwt);

        setStatus("Connecting...");

        const session = new PeerSession(signalingUrl, iceServers);
        sessionRef.current = session;

        session.onTrack = (stream) => {
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
            videoRef.current.play().catch(() => {});
            setIsReady(true);
            setStatus("Connected");
          }
        };

        session.onInputChannelOpen = () => {
          if (videoRef.current && session.inputChannel) {
            cleanupRef.current = attachInputCapture(
              videoRef.current,
              session.inputChannel
            );
          }
        };

        session.onInputChannelClose = () => {
          cleanupRef.current?.();
          cleanupRef.current = null;
        };

        await session.start(sid);
        pcRef.current = session.pc;

      } catch (err) {
        setIsError(true);
        setStatus(`Error: ${err.message}`);
        throw err;
      }
    }

    const manager = new ReconnectManager(startSession, {
      maxRetries: 3,
      baseDelay: 3000,
    });
    managerRef.current = manager;
    manager.run();

    return () => {
      manager.stop();
      cleanupRef.current?.();
      sessionRef.current?.stop();
      pcRef.current = null;  
    };
  }, []);

  const formatDuration = (sec) => {
    const m  = Math.floor(sec / 60).toString().padStart(2, "0");
    const s2 = (sec % 60).toString().padStart(2, "0");
    return `${m}:${s2}`;
  };

  const shortId = sessionId
    ? sessionId.split("-")[0].toUpperCase()
    : "—";

  function toggleMute() {
    if (videoRef.current) {
      videoRef.current.muted = !videoRef.current.muted;
      setIsMuted(videoRef.current.muted);
    }
  }

  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      videoWrapRef.current?.requestFullscreen();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  }

  function handleDisconnect() {
    cleanupRef.current?.();
    sessionRef.current?.stop();
    managerRef.current?.stop();
    setIsReady(false);
    setStatus("Disconnected");
  }

  return (
    <div className="h-screen flex flex-col bg-gray-100 overflow-hidden font-sans">

      <div className="h-14 bg-white border-b border-gray-200 flex items-center justify-between px-6 flex-shrink-0 shadow-sm z-10">
        <div className="flex items-center gap-3">
          <span className="text-green-200 text-lg">|</span>
          <span className="text-sm text-gray-500 font-medium">Remote Session</span>
        </div>
        <div className="flex items-center gap-3">
          <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium ${
            isError
              ? "bg-red-100 text-red-600"
              : isReady
              ? "bg-green-100 text-green-800"
              : "bg-green-100 text-green-600"
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
              isError
                ? "bg-red-500"
                : isReady
                ? "bg-[#12b97b]"
                : "bg-[#12b97b] animate-pulse"
            }`} />
            {status}
          </div>
        </div>
      </div>

      {!isReady && (
        <div className="fixed inset-0 flex items-center justify-center bg-white z-50">
          <div className="bg-white rounded-2xl px-10 py-12 w-[340px] text-center shadow-[0_8px_40px_rgba(18,185,123,0.12)] border border-green-100">
            <div className="text-5xl text-[#12b97b] mb-3">⬡</div>
            <h2 className="text-xl font-bold text-gray-900 mb-6">BotGauge Remote</h2>
            <div className="w-9 h-9 border-[3px] border-green-100 border-t-[#12b97b] rounded-full animate-spin mx-auto mb-5" />
            <p className={`text-sm font-medium ${isError ? "text-red-500" : "text-[#12b97b]"}`}>
              {status}
            </p>
            {isError && (
              <button
                className="mt-4 px-6 py-2.5 bg-[#12b97b] text-white rounded-lg text-sm font-semibold hover:bg-green-600 transition-colors"
                onClick={() => managerRef.current?.run()}
              >
                Retry
              </button>
            )}
          </div>
        </div>
      )}

      <div className="flex-1 flex gap-5 p-6 overflow-hidden">
        <div className="flex-1 flex flex-col min-w-0">
          <div
            ref={videoWrapRef}
            className="relative w-full aspect-video bg-[#0f0f0f] rounded-t-2xl overflow-hidden shadow-lg"
          >
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-contain block"
            />
          </div>

          <div className="bg-white rounded-b-2xl border-t border-gray-200 px-5 py-3 flex items-center justify-between shadow-sm">
            <div className="flex-1 flex items-center">
              <span className="text-sm font-semibold text-gray-900 font-mono">
                {formatDuration(duration)}
              </span>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={toggleMute}
                title={isMuted ? "Unmute" : "Mute"}
                className={`w-10 h-10 rounded-full border flex items-center justify-center text-base transition-all ${
                  isMuted
                    ? "bg-red-50 border-red-500"
                    : "bg-white border-gray-200 hover:border-[#12b97b]"
                }`}
              >
                {isMuted ? "🔇" : "🔊"}
              </button>

              <button
                onClick={handleDisconnect}
                title="End Session"
                className="w-12 h-12 rounded-full bg-red-600 hover:bg-red-700 text-white flex items-center justify-center text-base font-bold transition-colors"
              >
                ✕
              </button>

              <button
                onClick={toggleFullscreen}
                title="Fullscreen"
                className={`w-10 h-10 rounded-full border flex items-center justify-center text-base transition-all ${
                  isFullscreen
                    ? "bg-[#12b97b] border-[#12b97b]"
                    : "bg-white border-gray-200 hover:border-[#12b97b]"
                }`}
              >
                {isFullscreen ? "⊠" : "⛶"}
              </button>
            </div>

            <div className="flex-1 flex items-center justify-end">
              <span className={`text-sm font-medium ${isReady ? "text-[#12b97b]" : "text-gray-400"}`}>
                {isReady ? "● Live" : "○ Offline"}
              </span>
            </div>
          </div>
        </div>

        <div className="w-[280px] flex-shrink-0 flex flex-col gap-4 overflow-y-auto">
          <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-200">
            <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-4">
              Session Info
            </div>
            {[
              { label: "Session ID", value: shortId },
              { label: "Duration",   value: formatDuration(duration) },
              {
                label: "Status",
                value: isReady ? "Active" : isError ? "Failed" : "Connecting",
                color: isReady ? "text-[#12b97b]" : isError ? "text-red-500" : "text-gray-900",
              },
              { label: "Connection", value: metrics.connectionState },
              { label: "ICE",        value: metrics.iceState },
            ].map(({ label, value, color }) => (
              <div key={label} className="flex justify-between items-center py-2 border-b border-gray-50 last:border-0 text-sm">
                <span className="text-gray-500 font-medium">{label}</span>
                <span className={`font-semibold font-mono text-xs ${color ?? "text-gray-900"}`}>
                  {value}
                </span>
              </div>
            ))}
          </div>

          <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-200">
            <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-4">
              Live Metrics
            </div>
            {[
              { label: "FPS",          value: metrics.fps },
              { label: "Bitrate",      value: `${metrics.bitrate} kbps` },
              { label: "Packets Lost", value: metrics.packetsLost },
              { label: "Jitter",       value: `${metrics.jitter} ms` },
            ].map(({ label, value }) => (
              <div key={label} className="flex justify-between items-center py-2 border-b border-gray-50 last:border-0 text-sm">
                <span className="text-gray-500 font-medium">{label}</span>
                <span className="font-bold font-mono text-gray-900">{value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}