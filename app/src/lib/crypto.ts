import { bundleSchema, type DataBundle, type Payload } from './schema'

/**
 * Clientseitige Entschluesselung der data.json (WebCrypto, AES-GCM).
 * Gegenstueck zu scripts/build-data.ts — Parameter muessen synchron bleiben.
 */

const b64ToBytes = (b64: string): Uint8Array =>
  Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))

export async function decryptBundle(payload: Payload, passphrase: string): Promise<DataBundle> {
  if (!payload.encrypted) return bundleSchema.parse(payload.bundle)

  const enc = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  )
  const key = await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      hash: payload.kdf.hash,
      salt: b64ToBytes(payload.kdf.salt) as BufferSource,
      iterations: payload.kdf.iterations,
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt'],
  )
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: b64ToBytes(payload.cipher.iv) as BufferSource },
    key,
    b64ToBytes(payload.ct) as BufferSource,
  )
  return bundleSchema.parse(JSON.parse(new TextDecoder().decode(plain)))
}
