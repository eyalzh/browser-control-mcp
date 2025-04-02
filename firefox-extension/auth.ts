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
