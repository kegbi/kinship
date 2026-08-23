export class WebCryptoFileIdentifiers {
  next(): string {
    return crypto.randomUUID();
  }
}

export class WebCryptoObjectKeys {
  next(): string {
    return `objects/${crypto.randomUUID()}`;
  }
}
