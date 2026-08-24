function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(
    /=+$/,
    "",
  );
}

function decodeBase64Url(value: string): Uint8Array | undefined {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return undefined;
  try {
    const padded = value.replaceAll("-", "+").replaceAll("_", "/") +
      "=".repeat((4 - value.length % 4) % 4);
    return Uint8Array.from(
      atob(padded),
      (character) => character.charCodeAt(0),
    );
  } catch {
    return undefined;
  }
}

export class WebCryptoApiTokenSecrets {
  async create(): Promise<{ readonly hash: string; readonly raw: string }> {
    const raw = base64Url(crypto.getRandomValues(new Uint8Array(32)));
    return { hash: await this.hash(raw), raw };
  }

  async matches(raw: string, hash: string): Promise<boolean> {
    const actual = decodeBase64Url(await this.hash(raw));
    const expected = decodeBase64Url(hash);
    if (!actual || !expected || actual.length !== expected.length) return false;
    let difference = 0;
    for (let index = 0; index < actual.length; index += 1) {
      difference |= actual[index]! ^ expected[index]!;
    }
    return difference === 0;
  }

  private async hash(raw: string): Promise<string> {
    return base64Url(
      new Uint8Array(
        await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(raw),
        ),
      ),
    );
  }
}
