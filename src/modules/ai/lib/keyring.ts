import { invoke } from "@tauri-apps/api/core";
import {
  getProvider,
  KEYRING_SERVICE,
  PROVIDERS,
  providerSupportsKey,
  type CustomEndpoint,
  type ProviderId,
} from "../config";

export type ProviderKeys = Record<ProviderId, string | null>;
export type CustomEndpointKeys = Record<string, string | null>;

export const EMPTY_PROVIDER_KEYS: ProviderKeys = {
  openai: null,
  anthropic: null,
  google: null,
  xai: null,
  cerebras: null,
  groq: null,
  deepseek: null,
  mistral: null,
  openrouter: null,
  "openai-compatible": null,
  lmstudio: null,
  mlx: null,
};

export async function getKey(provider: ProviderId): Promise<string | null> {
  if (!providerSupportsKey(provider)) return null;
  try {
    const v = await invoke<string | null>("secrets_get", {
      service: KEYRING_SERVICE,
      account: getProvider(provider).keyringAccount,
    });
    return v && v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

export async function setKey(provider: ProviderId, key: string): Promise<void> {
  if (!providerSupportsKey(provider)) {
    throw new Error(`${provider} does not use an API key`);
  }
  const trimmed = key.trim();
  if (!trimmed) throw new Error("API key is empty");
  await invoke("secrets_set", {
    service: KEYRING_SERVICE,
    account: getProvider(provider).keyringAccount,
    password: trimmed,
  });
}

export async function clearKey(provider: ProviderId): Promise<void> {
  if (!providerSupportsKey(provider)) return;
  try {
    await invoke("secrets_delete", {
      service: KEYRING_SERVICE,
      account: getProvider(provider).keyringAccount,
    });
  } catch {
    // already absent — fine
  }
}

export async function getAllKeys(): Promise<ProviderKeys> {
  const out = { ...EMPTY_PROVIDER_KEYS };
  const need = PROVIDERS.filter((p) => providerSupportsKey(p.id));
  try {
    const results = await invoke<(string | null)[]>("secrets_get_all", {
      service: KEYRING_SERVICE,
      accounts: need.map((p) => p.keyringAccount),
    });
    need.forEach((p, i) => {
      const v = results[i];
      out[p.id] = v && v.length > 0 ? v : null;
    });
    return out;
  } catch {
    const entries = await Promise.all(
      need.map(async (p) => [p.id, await getKey(p.id)] as const),
    );
    for (const [id, v] of entries) out[id] = v;
    return out;
  }
}

export function hasAnyKey(keys: ProviderKeys): boolean {
  return PROVIDERS.some((p) => providerSupportsKey(p.id) && !!keys[p.id]);
}

/** Provider keys seeded into the keyring at startup when their slot is empty.
 *  A user-entered key always wins — we only seed when nothing is stored.
 *  Set `VITE_OPENROUTER_API_KEY` in `.env.local` (gitignored) for local dev. */
const ENV_SEED_KEYS: Partial<Record<ProviderId, string | undefined>> = {
  openrouter: import.meta.env.VITE_OPENROUTER_API_KEY as string | undefined,
};

/** Seed any configured env keys into the keyring when their slot is empty.
 *  Idempotent: re-running is a cheap no-op once a key is present. Returns true
 *  if at least one key was newly written. */
export async function seedEnvKeys(): Promise<boolean> {
  let seeded = false;
  for (const [id, val] of Object.entries(ENV_SEED_KEYS)) {
    if (!val || !val.trim()) continue;
    const provider = id as ProviderId;
    if (await getKey(provider)) continue; // never clobber a user-entered key
    try {
      await setKey(provider, val);
      seeded = true;
    } catch {
      // keyring write failed — fall through; user can still paste in Settings
    }
  }
  return seeded;
}

function compatKeyringAccount(endpointId: string): string {
  return `compat-${endpointId}-api-key`;
}

export async function getCustomEndpointKey(
  endpointId: string,
): Promise<string | null> {
  try {
    const v = await invoke<string | null>("secrets_get", {
      service: KEYRING_SERVICE,
      account: compatKeyringAccount(endpointId),
    });
    return v && v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

export async function setCustomEndpointKey(
  endpointId: string,
  key: string,
): Promise<void> {
  const trimmed = key.trim();
  if (!trimmed) throw new Error("API key is empty");
  await invoke("secrets_set", {
    service: KEYRING_SERVICE,
    account: compatKeyringAccount(endpointId),
    password: trimmed,
  });
}

export async function clearCustomEndpointKey(
  endpointId: string,
): Promise<void> {
  try {
    await invoke("secrets_delete", {
      service: KEYRING_SERVICE,
      account: compatKeyringAccount(endpointId),
    });
  } catch {}
}

export async function getAllCustomEndpointKeys(
  endpoints: readonly CustomEndpoint[],
): Promise<CustomEndpointKeys> {
  if (endpoints.length === 0) return {};
  const out: CustomEndpointKeys = {};
  try {
    const accounts = endpoints.map((e) => compatKeyringAccount(e.id));
    const results = await invoke<(string | null)[]>("secrets_get_all", {
      service: KEYRING_SERVICE,
      accounts,
    });
    endpoints.forEach((e, i) => {
      const v = results[i];
      out[e.id] = v && v.length > 0 ? v : null;
    });
  } catch {
    for (const e of endpoints) {
      out[e.id] = await getCustomEndpointKey(e.id);
    }
  }
  return out;
}
