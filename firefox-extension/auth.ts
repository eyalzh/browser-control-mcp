function buf2hex(buffer: ArrayBuffer) {
  return Array.from(new Uint8Array(buffer))
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}

export async function getMessageSignature(
  message: string,
  secretKey: string
): Promise<string> {
  if (secretKey.length === 0) {
    throw new Error("Secret key is empty");
  }

  const encoder = new TextEncoder();
  const keyData = encoder.encode(secretKey);
  const messageData = encoder.encode(message);

  const key = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const rawSignature = await crypto.subtle.sign(
    { name: "HMAC" },
    key,
    messageData
  );

  return buf2hex(rawSignature);
}

export async function verifyMessageSignature(
  message: string,
  signature: unknown,
  secretKey: string
): Promise<boolean> {
  if (!secretKey || typeof signature !== "string" || !/^[a-f0-9]{64}$/.test(signature)) return false;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(secretKey), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]
  );
  const bytes = Uint8Array.from(signature.match(/../g)!, byte => parseInt(byte, 16));
  return crypto.subtle.verify("HMAC", key, bytes, encoder.encode(message));
}
