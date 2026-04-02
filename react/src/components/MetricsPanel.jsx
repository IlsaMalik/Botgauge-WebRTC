import { useState, useEffect, useRef } from "react";

export default function MetricsPanel({ peerConnection }) {
  const [stats, setStats] = useState({
    connectionState: "new",
    iceState: "new",
    fps: 0,
    bitrate: 0,
    packetsLost: 0,
    jitter: 0,
  });

  const [logs, setLogs] = useState([]);
  const prevBytesRef = useRef(0);
  const prevTimeRef = useRef(Date.now());

  function addLog(msg) {
    const time = new Date().toLocaleTimeString();
    setLogs((prev) => [`[${time}] ${msg}`, ...prev].slice(0, 50));
  }

  useEffect(() => {
    if (!peerConnection) return;

    const onConnectionChange = () => {
      setStats((prev) => ({ ...prev, connectionState: peerConnection.connectionState }));
      addLog(`Connection state: ${peerConnection.connectionState}`);
    };

    const onIceChange = () => {
      setStats((prev) => ({ ...prev, iceState: peerConnection.iceConnectionState }));
      addLog(`ICE state: ${peerConnection.iceConnectionState}`);
    };

    peerConnection.addEventListener("connectionstatechange", onConnectionChange);
    peerConnection.addEventListener("iceconnectionstatechange", onIceChange);

    const statsInterval = setInterval(async () => {
      const report = await peerConnection.getStats();
      report.forEach((s) => {
        if (s.type === "inbound-rtp" && s.kind === "video") {
          const now = Date.now();
          const elapsed = (now - prevTimeRef.current) / 1000;
          const bytesDiff = s.bytesReceived - prevBytesRef.current;
          const bitrate = Math.round((bytesDiff * 8) / elapsed / 1000);
          prevBytesRef.current = s.bytesReceived;
          prevTimeRef.current = now;
          setStats((prev) => ({
            ...prev,
            fps: s.framesPerSecond ?? 0,
            bitrate,
            packetsLost: s.packetsLost ?? 0,
            jitter: Math.round((s.jitter ?? 0) * 1000),
          }));
        }
      });
    }, 2000);

    return () => {
      peerConnection.removeEventListener("connectionstatechange", onConnectionChange);
      peerConnection.removeEventListener("iceconnectionstatechange", onIceChange);
      clearInterval(statsInterval);
    };
  }, [peerConnection]);

  return (
    <div className="font-mono text-xs bg-[#1a1a1a] text-[#e0e0e0] p-3 rounded-lg w-[300px]">
      <div className="mb-4">
        <h3 className="text-sm text-white mb-2">Live Metrics</h3>
        <p>Connection: <b>{stats.connectionState}</b></p>
        <p>ICE: <b>{stats.iceState}</b></p>
        <p>FPS: <b>{stats.fps}</b></p>
        <p>Bitrate: <b>{stats.bitrate} kbps</b></p>
        <p>Packets Lost: <b>{stats.packetsLost}</b></p>
        <p>Jitter: <b>{stats.jitter} ms</b></p>
      </div>
      <div>
        <h3 className="text-sm text-white mb-2">Debug Log</h3>
        <div className="max-h-[200px] overflow-y-auto bg-[#111] p-2 rounded">
          {logs.map((log, i) => (
            <p key={i} className="my-0.5 text-[#a0a0a0]">{log}</p>
          ))}
        </div>
      </div>
    </div>
  );
}