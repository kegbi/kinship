export interface RandomSource {
  bytes(length: number): Uint8Array;
}

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(password: string, encoded: string): Promise<boolean>;
  needsUpgrade(encoded: string): boolean;
}
