import {
  packMove,
  packButton,
  packWheel,
  packKey,
  getModifierFlags,
  clamp,
  OPCODES,
} from "./inputProtocol.js";

export function attachInputCapture(videoEl, channel) {

  function send(buf) {
    if (channel.readyState !== "open") return;
    try {
      channel.send(buf);
    } catch (_) {}
  }

  let latestPointer = null;

  function getCoords(e) {
    const rect = videoEl.getBoundingClientRect();
    const w = videoEl.videoWidth  || 1280;
    const h = videoEl.videoHeight || 720;

    // Account for letterbox/pillarbox from object-fit: contain
    const elementAspect = rect.width / rect.height;
    const videoAspect   = w / h;

    let renderW, renderH, offsetX, offsetY;

    if (elementAspect > videoAspect) {
      // Pillarbox — black bars on left and right
      renderH = rect.height;
      renderW = rect.height * videoAspect;
      offsetX = (rect.width - renderW) / 2;
      offsetY = 0;
    } else {
      // Letterbox — black bars on top and bottom
      renderW = rect.width;
      renderH = rect.width / videoAspect;
      offsetX = 0;
      offsetY = (rect.height - renderH) / 2;
    }

    const x = clamp(Math.round(((e.clientX - rect.left - offsetX) / renderW) * w), 0, w - 1);
    const y = clamp(Math.round(((e.clientY - rect.top  - offsetY) / renderH) * h), 0, h - 1);

    return { x, y };
  }

  function onMouseMove(e) {
    latestPointer = getCoords(e);
  }

  const pointerLoop = setInterval(() => {
    if (latestPointer) send(packMove(latestPointer.x, latestPointer.y));
  }, 16);

  function onMouseDown(e) {
    const { x, y } = getCoords(e);
    send(packButton(OPCODES.POINTER_BUTTON_DOWN, x, y, e.button + 1, getModifierFlags(e)));
  }

  function onMouseUp(e) {
    const { x, y } = getCoords(e);
    send(packButton(OPCODES.POINTER_BUTTON_UP, x, y, e.button + 1, getModifierFlags(e)));
  }

  function onWheel(e) {
    e.preventDefault();
    const { x, y } = getCoords(e);
    const dx = clamp(Math.round(e.deltaX), -120, 120);
    const dy = clamp(Math.round(e.deltaY), -120, 120);
    send(packWheel(x, y, dx, dy, getModifierFlags(e)));
  }

  function onKeyDown(e) {
    e.preventDefault();
    send(packKey(OPCODES.KEY_DOWN, e.keyCode || 0, e.key || "", e.code || "", getModifierFlags(e)));
  }

  function onKeyUp(e) {
    send(packKey(OPCODES.KEY_UP, e.keyCode || 0, e.key || "", e.code || "", getModifierFlags(e)));
  }

  function onVideoClick() {
    videoEl.focus();
  }

  videoEl.tabIndex = 0;
  videoEl.addEventListener("mousemove", onMouseMove);
  videoEl.addEventListener("mousedown", onMouseDown);
  videoEl.addEventListener("mouseup",   onMouseUp);
  videoEl.addEventListener("wheel",     onWheel, { passive: false });
  videoEl.addEventListener("keydown",   onKeyDown);
  videoEl.addEventListener("keyup",     onKeyUp);
  videoEl.addEventListener("click",     onVideoClick);

  return function cleanup() {
    clearInterval(pointerLoop);
    videoEl.removeEventListener("mousemove", onMouseMove);
    videoEl.removeEventListener("mousedown", onMouseDown);
    videoEl.removeEventListener("mouseup",   onMouseUp);
    videoEl.removeEventListener("wheel",     onWheel);
    videoEl.removeEventListener("keydown",   onKeyDown);
    videoEl.removeEventListener("keyup",     onKeyUp);
    videoEl.removeEventListener("click",     onVideoClick);
  };
}