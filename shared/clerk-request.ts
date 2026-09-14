type TokenGetter = (options?: {
  skipCache?: boolean;
}) => Promise<string | null>;

export class InventorySessionError extends Error {
  constructor() {
    super(
      "Your sign-in could not be verified. Retry the connection or sign out and sign in again.",
    );
    this.name = "InventorySessionError";
  }
}

// Only a rejected authentication request is retried. The server's authentication
// gate returns 401 before an inventory operation runs, including count saves.
export function createClerkRequest(getToken: TokenGetter, send = fetch) {
  return async (url: string, init: RequestInit = {}): Promise<Response> => {
    const request = async (skipCache: boolean) => {
      const token = await getToken(skipCache ? { skipCache: true } : undefined);
      if (!token) throw new InventorySessionError();
      const headers = new Headers(init.headers);
      headers.set("Authorization", `Bearer ${token}`);
      return send(url, { ...init, headers });
    };
    let response = await request(false);
    if (response.status === 401) response = await request(true);
    if (response.status === 401) throw new InventorySessionError();
    return response;
  };
}
