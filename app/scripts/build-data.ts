/**
 * Buendelt /data/*.json zu app/public/data.json.
 *
 * Ist die Umgebungsvariable DATA_PASSPHRASE gesetzt, wird das Buendel mit
 * AES-256-GCM verschluesselt (Schluessel via PBKDF2-SHA256 aus der Passphrase).
 * Das Dashboard fragt die Passphrase beim Oeffnen ab und entschluesselt
 * komplett im Browser — auf GitHub Pages liegt dann nur Ciphertext.
 *
 * Ohne DATA_PASSPHRASE wird im Klartext gebuendelt (Entwicklung / Demo).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { webcrypto as crypto } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { bundleSchema } from '../src/lib/schema'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (f: string) => JSON.parse(readFileSync(join(root, 'data', f), 'utf8'))

const bundle = bundleSchema.parse({
  settings: read('settings.json'),
  invoices: read('invoices.json'),
  readings: read('readings.json'),
  generatedAt: new Date().toISOString(),
})

const plaintext = JSON.stringify(bundle)
const passphrase = process.env.DATA_PASSPHRASE

const toB64 = (b: ArrayBuffer | Uint8Array) => Buffer.from(b as Uint8Array).toString('base64')

async function main() {
  let payload: unknown
  if (passphrase) {
    const iterations = 310_000
    const salt = crypto.getRandomValues(new Uint8Array(16))
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(passphrase),
      'PBKDF2',
      false,
      ['deriveKey'],
    )
    const key = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt'],
    )
    const ct = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      new TextEncoder().encode(plaintext),
    )
    payload = {
      v: 1,
      encrypted: true,
      kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations, salt: toB64(salt) },
      cipher: { name: 'AES-GCM', iv: toB64(iv) },
      ct: toB64(ct),
    }
    console.log(`data.json: verschluesselt (${bundle.invoices.length} Belege, ${bundle.readings.length} Zaehlerstaende)`)
  } else {
    payload = { v: 1, encrypted: false, bundle }
    console.warn(
      'WARNUNG: DATA_PASSPHRASE nicht gesetzt — data.json wird im KLARTEXT gebaut. ' +
        'Fuer den oeffentlichen Deploy das Repository-Secret DATA_PASSPHRASE setzen.',
    )
  }
  const out = join(root, 'app', 'public', 'data.json')
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, JSON.stringify(payload))
  console.log(`geschrieben: ${out}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
