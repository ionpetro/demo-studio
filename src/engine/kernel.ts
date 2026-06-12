import Kernel from "@onkernel/sdk";

let client: Kernel | null = null;

export function kernelClient(): Kernel {
  if (!client) {
    const apiKey = process.env.KERNEL_API_KEY;
    if (!apiKey) throw new Error("KERNEL_API_KEY is not set");
    client = new Kernel({ apiKey });
  }
  return client;
}

export interface KernelBrowser {
  sessionId: string;
  cdpWsUrl: string;
  liveViewUrl?: string;
}

export async function createKernelBrowser(viewport?: { width: number; height: number }): Promise<KernelBrowser> {
  const created = await kernelClient().browsers.create({
    // 10 min idle timeout — a stuck job shouldn't burn browser hours
    timeout_seconds: 600,
  });
  if (viewport) {
    try {
      await kernelClient().browsers.update(created.session_id, { viewport });
    } catch {
      // viewport update is cosmetic; screencast maxWidth/maxHeight bounds output anyway
    }
  }
  return {
    sessionId: created.session_id,
    cdpWsUrl: created.cdp_ws_url,
    liveViewUrl: created.browser_live_view_url,
  };
}

export async function deleteKernelBrowser(sessionId: string): Promise<void> {
  try {
    await kernelClient().browsers.deleteByID(sessionId);
  } catch {
    // best-effort cleanup; Kernel's idle timeout reaps it regardless
  }
}
