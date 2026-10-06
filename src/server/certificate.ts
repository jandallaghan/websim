import { createHash, createPublicKey } from "node:crypto";
import { generate } from "selfsigned";

let certificate: ReturnType<typeof generate> | undefined;

/** One ephemeral identity per runner; never installed in the host trust store. */
export function simulationCertificate() {
  return (certificate ??= generate(
    [{ name: "commonName", value: "websim.invalid" }],
    { algorithm: "sha256" },
  ));
}

export async function simulationCertificatePin(): Promise<string> {
  const pem = await simulationCertificate();
  const publicKey = createPublicKey(pem.public).export({
    type: "spki",
    format: "der",
  });
  return createHash("sha256").update(publicKey).digest("base64");
}
