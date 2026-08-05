import { IS_WINDOWS } from "@/lib/platform";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  isPermissionGranted,
  onAction,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";

let granted = false;

async function ensurePermission(): Promise<boolean> {
  // Cache only the positive result: a transient denial (e.g. the OS prompt
  // dismissed while unfocused) must not disable notifications for the session.
  if (granted) return true;
  let ok = await isPermissionGranted();
  if (!ok) ok = (await requestPermission()) === "granted";
  granted = ok;
  return ok;
}

// Clicking an OS notification must navigate to the instance even when the
// app is unfocused, so each notification gets a numeric id mapped to the
// activate callback that was passed to osNotify.
let notifSeq = 0;
const pendingActivations = new Map<number, () => void>();
let actionListenerReady = false;

async function ensureActionListener(): Promise<void> {
  if (actionListenerReady) return;
  actionListenerReady = true;
  try {
    await onAction((notification) => {
      if (notification.id == null) return;
      const cb = pendingActivations.get(notification.id);
      pendingActivations.delete(notification.id);
      cb?.();
    });
  } catch (e) {
    console.warn("[terax] notification action listener failed:", e);
  }
}

// tauri-plugin-notification's Windows backend doesn't route toast clicks
// back into the app, so on Windows we bypass it and talk to the native
// Windows Toast API directly (src-tauri/src/modules/toast.rs), which does.
let winActivationSeq = 0;
const winPendingActivations = new Map<number, () => void>();
let winListenerReady = false;

async function ensureWinListener(): Promise<void> {
  if (winListenerReady) return;
  winListenerReady = true;
  try {
    await listen<string>("terax:toast-activated", (e) => {
      const id = Number(e.payload);
      const cb = winPendingActivations.get(id);
      winPendingActivations.delete(id);
      console.info("[terax] native toast activated:", id, cb ? "callback found" : "no callback (stale?)");
      cb?.();
    });
  } catch (e) {
    console.warn("[terax] native toast activation listener failed:", e);
  }
}

async function osNotifyWindows(
  title: string,
  body: string,
  onActivate?: () => void,
): Promise<void> {
  try {
    void ensureWinListener();
    const id = ++winActivationSeq;
    if (onActivate) winPendingActivations.set(id, onActivate);
    await invoke("show_native_toast", { title, body, launchArg: String(id) });
  } catch (e) {
    console.warn("[terax] native toast failed:", e);
  }
}

export async function osNotify(
  title: string,
  body: string,
  onActivate?: () => void,
): Promise<void> {
  if (IS_WINDOWS) return osNotifyWindows(title, body, onActivate);

  try {
    if (!(await ensurePermission())) return;
    void ensureActionListener();
    const id = ++notifSeq;
    if (onActivate) pendingActivations.set(id, onActivate);
    sendNotification({ id, title, body });
  } catch (e) {
    console.warn("[terax] os notification failed:", e);
  }
}
