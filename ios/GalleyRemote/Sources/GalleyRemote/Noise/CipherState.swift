import CryptoKit
import Foundation

// The Noise Protocol Framework, revision 34
// (https://noiseprotocol.org/noise.html), for the one suite Galley uses:
// 25519_ChaChaPoly_SHA256. Section numbers below are the spec's.
//
// CryptoKit supplies every primitive (§4):
// - DH: Curve25519.KeyAgreement (X25519, RFC 7748; DHLEN = 32).
// - Cipher: ChaChaPoly (RFC 8439 AEAD); the 96-bit nonce is 32 zero bits
//   followed by the 64-bit counter n, little-endian (§12.3).
// - Hash: SHA256 (HASHLEN = 32, BLOCKLEN = 64); HMAC<SHA256>.
// - HKDF: the spec's own §4.3 construction over HMAC-HASH, not RFC 5869's
//   (no info, outputs chained with a counter byte). CryptoKit's
//   HKDF<SHA256> is RFC 5869 and only used for the pairing keys.

/// Failures inside the Noise state machines. The session layer maps them
/// to ``NoiseError`` the way the Rust crate maps snow's errors.
enum NoiseProtocolError: Error, Equatable {
    /// AEAD authentication failed.
    case decrypt
    /// Sending or receiving the 2^64 - 1st message (§5.1).
    case nonceExhausted
    /// A message too short, too long, or out of turn; a missing key.
    case invalid(String)
}

enum NoisePrimitives {
    static let dhLength = 32
    static let hashLength = 32
    static let tagLength = 16
    static let maxMessageLength = 65535

    /// §4.3 HKDF(chaining_key, input_key_material, num_outputs).
    static func hkdf(chainingKey: Data, inputKeyMaterial: Data, outputs: Int) -> [Data] {
        precondition(outputs == 2 || outputs == 3)
        let tempKey = SymmetricKey(data: hmac(key: chainingKey, data: inputKeyMaterial))
        var results = [Data]()
        var previous = Data()
        for counter in 1...outputs {
            var input = previous
            input.append(UInt8(counter))
            previous = Data(HMAC<SHA256>.authenticationCode(for: input, using: tempKey))
            results.append(previous)
        }
        return results
    }

    static func hmac(key: Data, data: Data) -> Data {
        Data(HMAC<SHA256>.authenticationCode(for: data, using: SymmetricKey(data: key)))
    }

    static func hash(_ data: Data) -> Data {
        Data(SHA256.hash(data: data))
    }

    /// §5.1 / §12.3: 4 zero bytes ‖ n as 64-bit little-endian.
    static func nonce(_ n: UInt64) -> ChaChaPoly.Nonce {
        var bytes = Data(count: 4)
        withUnsafeBytes(of: n.littleEndian) { bytes.append(contentsOf: $0) }
        // 12 bytes is always a valid ChaChaPoly nonce.
        return try! ChaChaPoly.Nonce(data: bytes)
    }

    /// DH(key_pair, public_key): the raw 32-byte X25519 output.
    static func dh(
        _ privateKey: Curve25519.KeyAgreement.PrivateKey,
        _ publicKey: Curve25519.KeyAgreement.PublicKey
    ) throws(NoiseProtocolError) -> Data {
        do {
            let shared = try privateKey.sharedSecretFromKeyAgreement(with: publicKey)
            return shared.withUnsafeBytes { Data($0) }
        } catch {
            throw .invalid("X25519 failed")
        }
    }
}

/// §5.1 CipherState: a key `k` (or none) and a nonce counter `n`.
struct CipherState {
    private(set) var key: SymmetricKey?
    private(set) var n: UInt64 = 0

    init(key: SymmetricKey? = nil) {
        self.key = key
    }

    var hasKey: Bool { key != nil }

    mutating func initializeKey(_ key: SymmetricKey?) {
        self.key = key
        n = 0
    }

    mutating func setNonce(_ nonce: UInt64) {
        n = nonce
    }

    /// ENCRYPT(k, n++, ad, plaintext), or the plaintext when there is no key.
    mutating func encrypt(ad: Data, plaintext: Data) throws(NoiseProtocolError) -> Data {
        guard let key else { return plaintext }
        guard n != UInt64.max else { throw .nonceExhausted }
        let box: ChaChaPoly.SealedBox
        do {
            box = try ChaChaPoly.seal(
                plaintext, using: key, nonce: NoisePrimitives.nonce(n), authenticating: ad)
        } catch {
            throw .invalid("ChaChaPoly seal failed")
        }
        n += 1
        // `box.ciphertext` is a slice of nonce ‖ ciphertext ‖ tag (it starts
        // at index 12); copy so callers get zero-based indices.
        var out = Data(box.ciphertext)
        out.append(box.tag)
        return out
    }

    /// DECRYPT(k, n++, ad, ciphertext); `n` does not advance on failure.
    mutating func decrypt(ad: Data, ciphertext: Data) throws(NoiseProtocolError) -> Data {
        guard let key else { return ciphertext }
        guard n != UInt64.max else { throw .nonceExhausted }
        guard ciphertext.count >= NoisePrimitives.tagLength else { throw .decrypt }
        let split = ciphertext.endIndex - NoisePrimitives.tagLength
        let plaintext: Data
        do {
            let box = try ChaChaPoly.SealedBox(
                nonce: NoisePrimitives.nonce(n), ciphertext: ciphertext[ciphertext.startIndex..<split],
                tag: ciphertext[split...])
            plaintext = try ChaChaPoly.open(box, using: key, authenticating: ad)
        } catch {
            throw .decrypt
        }
        n += 1
        return plaintext
    }

    /// §4.2 REKEY(k): the first 32 bytes of ENCRYPT(k, maxnonce, zerolen, zeros).
    mutating func rekey() {
        guard let key else { return }
        let zeros = Data(count: 32)
        let box = try! ChaChaPoly.seal(
            zeros, using: key, nonce: NoisePrimitives.nonce(UInt64.max), authenticating: Data())
        self.key = SymmetricKey(data: box.ciphertext.prefix(32))
    }
}

/// §5.2 SymmetricState: chaining key `ck`, handshake hash `h`, and a
/// CipherState.
struct SymmetricState {
    private(set) var cipher = CipherState()
    private(set) var ck: Data
    private(set) var h: Data

    /// InitializeSymmetric(protocol_name).
    init(protocolName: String) {
        let name = Data(protocolName.utf8)
        if name.count <= NoisePrimitives.hashLength {
            h = name + Data(count: NoisePrimitives.hashLength - name.count)
        } else {
            h = NoisePrimitives.hash(name)
        }
        ck = h
    }

    mutating func mixKey(_ inputKeyMaterial: Data) {
        let out = NoisePrimitives.hkdf(chainingKey: ck, inputKeyMaterial: inputKeyMaterial, outputs: 2)
        ck = out[0]
        // HASHLEN is 32, so temp_k needs no truncation.
        cipher.initializeKey(SymmetricKey(data: out[1]))
    }

    mutating func mixHash(_ data: Data) {
        h = NoisePrimitives.hash(h + data)
    }

    mutating func mixKeyAndHash(_ inputKeyMaterial: Data) {
        let out = NoisePrimitives.hkdf(chainingKey: ck, inputKeyMaterial: inputKeyMaterial, outputs: 3)
        ck = out[0]
        mixHash(out[1])
        cipher.initializeKey(SymmetricKey(data: out[2]))
    }

    mutating func encryptAndHash(_ plaintext: Data) throws(NoiseProtocolError) -> Data {
        let ciphertext = try cipher.encrypt(ad: h, plaintext: plaintext)
        mixHash(ciphertext)
        return ciphertext
    }

    mutating func decryptAndHash(_ ciphertext: Data) throws(NoiseProtocolError) -> Data {
        let plaintext = try cipher.decrypt(ad: h, ciphertext: ciphertext)
        mixHash(ciphertext)
        return plaintext
    }

    /// Split(): the initiator→responder and responder→initiator ciphers.
    func split() -> (CipherState, CipherState) {
        let out = NoisePrimitives.hkdf(chainingKey: ck, inputKeyMaterial: Data(), outputs: 2)
        return (CipherState(key: SymmetricKey(data: out[0])), CipherState(key: SymmetricKey(data: out[1])))
    }
}
