import Foundation
import Testing

@testable import GalleyRemote

@Suite struct PaddingTests {
    @Test func goldenPadding() throws {
        let doc = try Fixtures.golden(
            "padding.json",
            keys: ["fixture", "description", "minPaddedLen", "maxPlaintextLen", "maxPayloadLen", "sizes", "example"])
        #expect(try int(doc["minPaddedLen"]) == Padding.minPaddedLength)
        #expect(try int(doc["maxPlaintextLen"]) == Padding.maxPlaintextLength)
        #expect(try int(doc["maxPayloadLen"]) == Padding.maxPayloadLength)
        for size in try array(doc["sizes"]) {
            try expectKeys(size, ["payloadLen", "paddedLen"], "sizes")
            let len = try int(size["payloadLen"])
            #expect(Padding.paddedLength(payloadLength: len) == (try int(size["paddedLen"])), "payload \(len)")
        }
        try expectKeys(doc["example"], ["payload", "padded"], "example")
        let payload = try hex(doc["example"]?["payload"])
        let padded = try hex(doc["example"]?["padded"])
        #expect(try Padding.pad(payload) == padded)
        #expect(try Padding.unpad(padded) == payload)
    }

    // MARK: Mirrors of the Rust unit tests (`src/padding.rs`)

    @Test func padmeMatchesThePaper() {
        let cases = [(0, 0), (1, 1), (2, 2), (3, 3), (9, 10), (257, 272), (300, 304), (1000, 1024), (5000, 5120), (65519, 65536)]
        for (len, want) in cases {
            #expect(Padding.padme(len) == want, "padme(\(len))")
        }
        // One #expect per property, not per length: 70k expectations are slow.
        let tooSmall = (2..<70_000).first { Padding.padme($0) < $0 }
        let overhead = (2..<70_000).first { (Padding.padme($0) - $0) * 100 > $0 * 12 }
        let notIdempotent = (2..<70_000).first { Padding.padme(Padding.padme($0)) != Padding.padme($0) }
        #expect(tooSmall == nil)
        #expect(overhead == nil, "overhead above 12%")
        #expect(notIdempotent == nil, "padme is idempotent")
    }

    @Test func paddedSizes() {
        #expect(Padding.paddedLength(payloadLength: 0) == 256)
        #expect(Padding.paddedLength(payloadLength: 254) == 256)
        #expect(Padding.paddedLength(payloadLength: 255) == 272)
        #expect(Padding.paddedLength(payloadLength: Padding.maxPayloadLength) == Padding.maxPlaintextLength)
        #expect(Padding.paddedLength(payloadLength: Padding.maxPayloadLength + 1) == nil)
        var previous = 0
        var firstBad: Int?
        for len in 0...Padding.maxPayloadLength {
            let total = Padding.paddedLength(payloadLength: len)!
            let ok = total >= len + Padding.lengthPrefix && total <= Padding.maxPlaintextLength && total >= previous
            if !ok && firstBad == nil { firstBad = len }
            previous = total
        }
        #expect(firstBad == nil, "fits, within the cap, and monotonic")
    }

    @Test func roundTrip() throws {
        for len in [0, 1, 200, 254, 255, 1000, 40_000, Padding.maxPayloadLength] {
            let payload = Data((0..<len).map { UInt8($0 % 251 + 1) })
            let padded = try Padding.pad(payload)
            #expect(padded.count == Padding.paddedLength(payloadLength: len))
            #expect(try Padding.unpad(padded) == payload)
        }
        #expect(
            thrown { () throws(PaddingError) in try Padding.pad(Data(count: Padding.maxPayloadLength + 1)) }
                == .tooLarge(len: Padding.maxPayloadLength + 1, max: Padding.maxPayloadLength))
    }

    @Test func unpadIsStrict() throws {
        let padded = try Padding.pad(Data("hello".utf8))
        #expect(thrown { () throws(PaddingError) in try Padding.unpad(Data()) } == .truncated)
        #expect(thrown { () throws(PaddingError) in try Padding.unpad(Data([0])) } == .truncated)
        var nonzero = padded
        nonzero[255] = 1
        #expect(thrown { () throws(PaddingError) in try Padding.unpad(nonzero) } == .nonZeroPadding)
        var longLength = padded
        longLength[0] = 0x01
        #expect(
            thrown { () throws(PaddingError) in try Padding.unpad(longLength) }
                == .lengthOutOfRange(declared: 0x0105, available: 254))
        #expect(
            thrown { () throws(PaddingError) in try Padding.unpad(padded.prefix(200)) }
                == .nonCanonicalSize(expected: 256, actual: 200))
        #expect(
            thrown { () throws(PaddingError) in try Padding.unpad(padded + Data([0])) }
                == .nonCanonicalSize(expected: 256, actual: 257))
        // A slice that does not start at index 0 unpads the same.
        let offset = (Data([9, 9]) + padded).dropFirst(2)
        #expect(try Padding.unpad(offset) == Data("hello".utf8))
    }

    @Test func fixedSizeVariant() throws {
        let padded = try Padding.pad(Data("abc".utf8), to: 64)
        #expect(padded.count == 64)
        #expect(try Padding.unpad(padded, exactly: 64) == Data("abc".utf8))
        #expect(thrown { () throws(PaddingError) in try Padding.unpad(padded, exactly: 65) } != nil)
        #expect(thrown { () throws(PaddingError) in try Padding.pad(Data(count: 63), to: 64) } == .tooLarge(len: 63, max: 62))
        #expect(try Padding.pad(Data(repeating: 1, count: 62), to: 64).count == 64)
    }
}
