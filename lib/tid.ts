const TID_ALPHABET = "234567abcdefghijklmnopqrstuvwxyz";
const TID_RE = /^[234567abcdefghij][234567abcdefghijklmnopqrstuvwxyz]{12}$/;

let lastTidValue = 0n;

export function isAtprotoTid(value: string): boolean {
  return TID_RE.test(value);
}

export function createAtprotoTid(nowMs = Date.now()): string {
  const clock = new Uint16Array(1);
  crypto.getRandomValues(clock);
  const micros = BigInt(Math.max(0, Math.floor(nowMs))) * 1000n;
  let value = (micros << 10n) | BigInt(clock[0] & 0x03ff);
  if (value <= lastTidValue) value = lastTidValue + 1n;
  lastTidValue = value;
  return encodeTidValue(value);
}

function encodeTidValue(value: bigint): string {
  let n = value;
  const chars = Array<string>(13);
  for (let index = 12; index >= 0; index--) {
    chars[index] = TID_ALPHABET[Number(n & 31n)];
    n >>= 5n;
  }
  return chars.join("");
}
