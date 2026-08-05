import { invoke } from "@tauri-apps/api/core";
import {
  AndroidKeyCode,
  AndroidKeyEventAction,
  AndroidKeyEventMeta,
  AndroidMotionEventAction,
  ScrcpyControlMessageSerializer,
  ScrcpyInstanceId,
  ScrcpyOptionsLatest,
  ScrcpyPointerId,
  ScrcpyVideoCodecId,
  type ScrcpyMediaStreamPacket,
} from "@yume-chan/scrcpy";
import {
  BitmapVideoFrameRenderer,
  WebCodecsVideoDecoder,
  WebGLVideoFrameRenderer,
} from "@yume-chan/scrcpy-decoder-webcodecs";
import { ReadableStream, TransformStream } from "@yume-chan/stream-extra";

const SERVER_VERSION = "3.3.3";

export type AdbDevice = {
  serial: string;
  state: string;
  model?: string | null;
};

type MirrorStartInfo = {
  scid: string;
  wsPort: number;
};

export type MirrorSession = {
  canvas: HTMLCanvasElement;
  videoSize: () => { width: number; height: number };
  stats: () => {
    packets: number;
    bytes: number;
    framesRendered: number;
    framesSkipped: number;
  };
  injectTouch: (msg: {
    action: AndroidMotionEventAction;
    pointerX: number;
    pointerY: number;
    buttons: number;
  }) => void;
  injectScroll: (msg: {
    pointerX: number;
    pointerY: number;
    scrollX: number;
    scrollY: number;
    buttons: number;
  }) => void;
  injectKeyCode: (msg: {
    action: AndroidKeyEventAction;
    keyCode: AndroidKeyCode;
    metaState: number;
  }) => void;
  injectText: (text: string) => void;
  backOrScreenOn: () => void;
  stop: () => Promise<void>;
};

export function listAdbDevices(): Promise<AdbDevice[]> {
  return invoke<AdbDevice[]>("mirror_adb_devices");
}

export function adbConnect(endpoint: string): Promise<string> {
  return invoke<string>("mirror_adb_connect", { endpoint });
}

/**
 * Opens a WebSocket to the Rust WS<->TCP proxy and waits for it to be usable.
 * scrcpy assigns socket roles by connect order, so callers must await the
 * video socket before opening the control socket.
 */
function openSocket(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.binaryType = "arraybuffer";
    ws.onopen = () => resolve(ws);
    ws.onerror = () => reject(new Error("mirror proxy connection failed"));
  });
}

/**
 * Waits for the first message. With `tunnelForward` the server sends a 0x00
 * dummy byte on the first socket once it is truly up — the proxy's TCP leg
 * closing without one means the server isn't listening yet.
 */
function firstMessage(ws: WebSocket, timeoutMs: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("timed out waiting for scrcpy server"));
    }, timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      ws.onmessage = null;
      ws.onclose = null;
    };
    ws.onmessage = (ev) => {
      cleanup();
      resolve(new Uint8Array(ev.data as ArrayBuffer));
    };
    ws.onclose = () => {
      cleanup();
      reject(new Error("scrcpy server not ready"));
    };
  });
}

function wsToReadable(
  ws: WebSocket,
  head: Uint8Array,
  onClose: () => void,
): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      if (head.length > 0) controller.enqueue(head);
      ws.onmessage = (ev) => {
        controller.enqueue(new Uint8Array(ev.data as ArrayBuffer));
      };
      ws.onclose = () => {
        try {
          controller.close();
        } catch {
          // already errored/closed
        }
        onClose();
      };
    },
    cancel() {
      ws.close();
    },
  });
}

export async function startMirrorSession(opts: {
  serial: string;
  /** Called when the stream drops for any reason after a successful start. */
  onDisconnect: () => void;
}): Promise<MirrorSession> {
  const scid = ScrcpyInstanceId.random();
  const scidHex = scid.value.toString(16).padStart(8, "0");

  const options = new ScrcpyOptionsLatest({
    scid: scidHex,
    video: true,
    audio: false,
    control: true,
    tunnelForward: true,
    // No device/codec metadata: the codec is pinned to H.264 below, so the
    // stream starts directly with sendFrameMeta-framed packets.
    sendDeviceMeta: false,
    sendCodecMeta: false,
    videoCodec: "h264",
    maxSize: 1600,
    videoBitRate: 6_000_000,
    clipboardAutosync: false,
  });

  const info = await invoke<MirrorStartInfo>("mirror_start", {
    serial: opts.serial,
    scid: scidHex,
    serverVersion: SERVER_VERSION,
    serverArgs: options.serialize(),
  });

  // The server needs a moment after spawn before it listens; each attempt's
  // TCP leg simply closes when it isn't, so retry until the dummy byte lands.
  let videoWs: WebSocket | undefined;
  let head: Uint8Array | undefined;
  const deadline = Date.now() + 10_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      videoWs = await openSocket(info.wsPort);
      head = await firstMessage(videoWs, 3_000);
      break;
    } catch (e) {
      lastError = e;
      videoWs?.close();
      videoWs = undefined;
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  if (!videoWs || !head) {
    await invoke("mirror_stop", { scid: scidHex }).catch(() => {});
    throw lastError ?? new Error("could not reach scrcpy server");
  }
  head = head.subarray(1); // dummy byte

  let stopped = false;
  const handleDisconnect = () => {
    if (stopped) return;
    stopped = true;
    opts.onDisconnect();
  };

  let renderer: WebGLVideoFrameRenderer | BitmapVideoFrameRenderer;
  try {
    renderer = new WebGLVideoFrameRenderer();
  } catch {
    renderer = new BitmapVideoFrameRenderer();
  }
  const decoder = new WebCodecsVideoDecoder({
    codec: ScrcpyVideoCodecId.H264,
    renderer,
  });

  let packets = 0;
  let bytes = 0;
  const videoStream = wsToReadable(videoWs, head, handleDisconnect);
  videoStream
    .pipeThrough(options.createMediaStreamTransformer())
    .pipeThrough(
      new TransformStream<ScrcpyMediaStreamPacket, ScrcpyMediaStreamPacket>({
        transform(packet, controller) {
          packets += 1;
          bytes += packet.data.byteLength;
          controller.enqueue(packet);
        },
      }),
    )
    .pipeTo(decoder.writable)
    .catch((e) => {
      console.error("[mirror] video pipeline failed", e);
      handleDisconnect();
    });

  const controlWs = await openSocket(info.wsPort);
  // Device->client control messages (clipboard etc.) must be drained.
  controlWs.onmessage = () => {};
  controlWs.onclose = handleDisconnect;

  const serializer = new ScrcpyControlMessageSerializer(options);
  const send = (msg: Uint8Array | undefined) => {
    if (msg && controlWs.readyState === WebSocket.OPEN) {
      controlWs.send(msg as Uint8Array<ArrayBuffer>);
    }
  };
  const videoSize = () => ({
    width: decoder.width || 1,
    height: decoder.height || 1,
  });

  const stop = async () => {
    stopped = true;
    videoWs.onclose = null;
    controlWs.onclose = null;
    videoWs.close();
    controlWs.close();
    decoder.dispose();
    await invoke("mirror_stop", { scid: scidHex }).catch(() => {});
  };

  return {
    canvas: renderer.canvas as HTMLCanvasElement,
    videoSize,
    stats: () => ({
      packets,
      bytes,
      framesRendered: decoder.framesRendered,
      framesSkipped: decoder.framesSkipped,
    }),
    injectTouch: (msg) =>
      send(
        serializer.injectTouch({
          ...msg,
          pointerId: ScrcpyPointerId.Mouse,
          pressure: msg.action === AndroidMotionEventAction.Up ? 0 : 1,
          actionButton: 0,
          videoWidth: videoSize().width,
          videoHeight: videoSize().height,
        }),
      ),
    injectScroll: (msg) =>
      send(
        serializer.injectScroll({
          ...msg,
          videoWidth: videoSize().width,
          videoHeight: videoSize().height,
        }),
      ),
    injectKeyCode: (msg) =>
      send(
        serializer.injectKeyCode({
          ...msg,
          // Bitwise-OR of modifier flags widens to number.
          metaState: msg.metaState as AndroidKeyEventMeta,
          repeat: 0,
        }),
      ),
    injectText: (text) => send(serializer.injectText(text)),
    backOrScreenOn: () => {
      send(serializer.backOrScreenOn(AndroidKeyEventAction.Down));
      send(serializer.backOrScreenOn(AndroidKeyEventAction.Up));
    },
    stop,
  };
}

export { AndroidKeyCode, AndroidKeyEventAction, AndroidKeyEventMeta, AndroidMotionEventAction };
