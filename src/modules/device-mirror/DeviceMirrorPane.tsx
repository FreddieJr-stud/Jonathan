import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type WheelEvent,
} from "react";
import {
  ArrowLeft01Icon,
  SmartPhone01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  adbConnect,
  AndroidKeyCode,
  AndroidKeyEventAction,
  AndroidKeyEventMeta,
  AndroidMotionEventAction,
  listAdbDevices,
  startMirrorSession,
  type MirrorSession,
} from "./lib/mirrorSession";

const ENDPOINT_KEY = "terax.mirror.endpoint";

type Phase =
  | { kind: "scanning" }
  | { kind: "offline"; error?: string }
  | { kind: "starting"; serial: string }
  | { kind: "streaming"; serial: string; model?: string | null }
  | { kind: "error"; message: string };

function keyMeta(e: KeyboardEvent): number {
  let meta = 0;
  if (e.shiftKey) meta |= AndroidKeyEventMeta.Shift;
  if (e.ctrlKey) meta |= AndroidKeyEventMeta.Ctrl;
  if (e.altKey) meta |= AndroidKeyEventMeta.Alt;
  return meta;
}

export function DeviceMirrorPane({ visible }: { visible: boolean }) {
  const [phase, setPhase] = useState<Phase>({ kind: "scanning" });
  const [endpoint, setEndpoint] = useState(
    () => localStorage.getItem(ENDPOINT_KEY) ?? "",
  );
  const [connectBusy, setConnectBusy] = useState(false);
  const [stats, setStats] = useState("");
  const sessionRef = useRef<MirrorSession | null>(null);
  const canvasHostRef = useRef<HTMLDivElement>(null);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const visibleRef = useRef(visible);
  visibleRef.current = visible;

  const stopSession = useCallback(async () => {
    const s = sessionRef.current;
    sessionRef.current = null;
    if (s) {
      s.canvas.remove();
      await s.stop();
    }
  }, []);

  const startForSerial = useCallback(
    async (serial: string, model?: string | null) => {
      setPhase({ kind: "starting", serial });
      try {
        const session = await startMirrorSession({
          serial,
          onDisconnect: () => {
            // Stream died underneath us (USB unplug, server exit, ...).
            sessionRef.current?.canvas.remove();
            sessionRef.current = null;
            setPhase({ kind: "offline", error: "stream disconnected" });
          },
        });
        sessionRef.current = session;
        setPhase({ kind: "streaming", serial, model });
      } catch (e) {
        setPhase({
          kind: "error",
          message: e instanceof Error ? e.message : String(e),
        });
      }
    },
    [],
  );

  // Device scan loop: while not streaming, look for a usable device and
  // auto-start on the first one. Runs only while the tab is visible.
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    const tick = async () => {
      const p = phaseRef.current;
      if (p.kind !== "scanning" && p.kind !== "offline") return;
      try {
        const devices = await listAdbDevices();
        if (cancelled) return;
        const ready = devices.find((d) => d.state === "device");
        if (ready) {
          void startForSerial(ready.serial, ready.model);
        } else if (p.kind === "scanning") {
          setPhase({ kind: "offline" });
        }
      } catch (e) {
        if (!cancelled) {
          setPhase({
            kind: "offline",
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
    };
    void tick();
    const timer = setInterval(tick, 3_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [visible, startForSerial]);

  // Attach the decoder's canvas once the streaming branch (and thus the host
  // div) is actually mounted — during startForSerial the ref is still null.
  useEffect(() => {
    if (phase.kind !== "streaming") return;
    const s = sessionRef.current;
    const host = canvasHostRef.current;
    if (!s || !host) return;
    s.canvas.className = "max-h-full max-w-full object-contain outline-none";
    host.replaceChildren(s.canvas);
  }, [phase.kind]);

  // Live pipeline stats while streaming — doubles as connection debugging.
  useEffect(() => {
    if (phase.kind !== "streaming") {
      setStats("");
      return;
    }
    const timer = setInterval(() => {
      const s = sessionRef.current;
      if (!s) return;
      const { packets, bytes, framesRendered, framesSkipped } = s.stats();
      setStats(
        `pkt ${packets} · ${(bytes / 1024 / 1024).toFixed(1)}MB · frames ${framesRendered}${framesSkipped ? ` (skip ${framesSkipped})` : ""}`,
      );
    }, 1000);
    return () => clearInterval(timer);
  }, [phase.kind]);

  // Kill the on-device server when the tab unmounts (close).
  useEffect(() => {
    return () => {
      void stopSession();
    };
  }, [stopSession]);

  const handleQuickConnect = useCallback(async () => {
    const target = endpoint.trim();
    if (!target) return;
    localStorage.setItem(ENDPOINT_KEY, target);
    setConnectBusy(true);
    try {
      await adbConnect(target);
      setPhase({ kind: "scanning" });
    } catch (e) {
      setPhase({
        kind: "offline",
        error: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setConnectBusy(false);
    }
  }, [endpoint]);

  // --- input forwarding -----------------------------------------------------

  const toDevice = useCallback((e: PointerEvent | WheelEvent) => {
    const s = sessionRef.current;
    const canvas = s?.canvas;
    if (!s || !canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    const { width, height } = s.videoSize();
    const x = ((e.clientX - rect.left) / rect.width) * width;
    const y = ((e.clientY - rect.top) / rect.height) * height;
    return {
      x: Math.max(0, Math.min(width, x)),
      y: Math.max(0, Math.min(height, y)),
    };
  }, []);

  const onPointer = useCallback(
    (action: AndroidMotionEventAction) => (e: PointerEvent<HTMLDivElement>) => {
      const s = sessionRef.current;
      const pos = toDevice(e);
      if (!s || !pos) return;
      if (action === AndroidMotionEventAction.Down) {
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        e.currentTarget.focus();
      }
      if (action === AndroidMotionEventAction.Move && e.buttons === 0) return;
      s.injectTouch({
        action,
        pointerX: pos.x,
        pointerY: pos.y,
        buttons: e.buttons,
      });
      e.preventDefault();
    },
    [toDevice],
  );

  const onWheel = useCallback(
    (e: WheelEvent<HTMLDivElement>) => {
      const s = sessionRef.current;
      const pos = toDevice(e);
      if (!s || !pos) return;
      s.injectScroll({
        pointerX: pos.x,
        pointerY: pos.y,
        scrollX: -e.deltaX / 100,
        scrollY: -e.deltaY / 100,
        buttons: 0,
      });
    },
    [toDevice],
  );

  const onKey = useCallback(
    (action: AndroidKeyEventAction) => (e: KeyboardEvent<HTMLDivElement>) => {
      const s = sessionRef.current;
      if (!s) return;
      // Printable characters go as text on keydown (correct layout/symbols);
      // everything else (Enter, Backspace, arrows, ...) as key codes.
      const printable =
        e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey;
      if (printable) {
        if (action === AndroidKeyEventAction.Down) s.injectText(e.key);
        e.preventDefault();
        return;
      }
      const keyCode = AndroidKeyCode[e.code as keyof typeof AndroidKeyCode];
      if (!keyCode) return;
      s.injectKeyCode({ action, keyCode, metaState: keyMeta(e) });
      e.preventDefault();
    },
    [],
  );

  // --- render ---------------------------------------------------------------

  const streaming = phase.kind === "streaming";

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-background">
      <div className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-xs text-muted-foreground">
        <HugeiconsIcon icon={SmartPhone01Icon} size={14} strokeWidth={2} />
        {streaming ? (
          <>
            <span className="text-foreground">
              {phase.model ?? phase.serial}
            </span>
            <span>· mirroring</span>
            {stats && <span className="tabular-nums">· {stats}</span>}
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto h-6 px-2"
              onClick={() => sessionRef.current?.backOrScreenOn()}
              title="Android Back"
            >
              <HugeiconsIcon icon={ArrowLeft01Icon} size={14} strokeWidth={2} />
            </Button>
          </>
        ) : (
          <span>
            {phase.kind === "starting"
              ? "starting mirror…"
              : phase.kind === "scanning"
                ? "looking for device…"
                : "no device connected"}
          </span>
        )}
      </div>

      {streaming ? (
        <div
          ref={canvasHostRef}
          tabIndex={0}
          className="flex min-h-0 flex-1 items-center justify-center bg-black outline-none"
          onPointerDown={onPointer(AndroidMotionEventAction.Down)}
          onPointerMove={onPointer(AndroidMotionEventAction.Move)}
          onPointerUp={onPointer(AndroidMotionEventAction.Up)}
          onWheel={onWheel}
          onKeyDown={onKey(AndroidKeyEventAction.Down)}
          onKeyUp={onKey(AndroidKeyEventAction.Up)}
        />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-6 text-sm">
          <HugeiconsIcon
            icon={SmartPhone01Icon}
            size={32}
            strokeWidth={1.5}
            className="text-muted-foreground"
          />
          <div className="text-muted-foreground">
            {phase.kind === "error"
              ? phase.message
              : phase.kind === "offline" && phase.error
                ? phase.error
                : "Connect your phone over USB, or reach it over the network."}
          </div>
          <div className="flex w-full max-w-sm items-center gap-2">
            <Input
              value={endpoint}
              placeholder="phone-ip-or-tailnet-name:5555"
              onChange={(e) => setEndpoint(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleQuickConnect();
              }}
            />
            <Button
              size="sm"
              disabled={connectBusy || !endpoint.trim()}
              onClick={() => void handleQuickConnect()}
            >
              {connectBusy ? "Connecting…" : "Connect"}
            </Button>
          </div>
          <div className="text-xs text-muted-foreground">
            Wireless needs a one-time <code>adb tcpip 5555</code> over USB
            (repeat after phone reboot).
          </div>
          {(phase.kind === "error" || phase.kind === "offline") && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPhase({ kind: "scanning" })}
            >
              Retry
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
