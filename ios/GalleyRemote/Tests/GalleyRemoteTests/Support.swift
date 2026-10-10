import Foundation
import Testing

@testable import GalleyRemote

/// The Rust crate's fixtures, read in place: the Swift side never keeps a
/// copy, so a regenerated golden file reaches these tests unchanged.
enum Fixtures {
    /// `<repo>/ios/GalleyRemote/Tests/GalleyRemoteTests/Support.swift` → `<repo>`.
    static let repoRoot: URL = {
        var url = URL(fileURLWithPath: #filePath)
        for _ in 0..<5 { url.deleteLastPathComponent() }
        return url
    }()

    static let goldenDirectory = repoRoot.appending(path: "remote-protocol/tests/golden")
    static let vectorsFile = repoRoot.appending(path: "remote-protocol/tests/vectors/cacophony-subset.json")

    /// Every golden file the Swift side mirrors, with its `fixture` id.
    static let goldenFiles: [String: String] = [
        "app-messages.json": "galley-remote/app",
        "frames.json": "galley-remote/frames",
        "keys.json": "galley-remote/keys",
        "noise-nnpsk0.json": "galley-remote/noise",
        "padding.json": "galley-remote/padding",
        "push.json": "galley-remote/push",
    ]

    static func load(_ url: URL) throws -> JSONValue {
        try JSONValue(parsing: Data(contentsOf: url))
    }

    /// A golden file, after checking its `fixture` id and that its top
    /// level has exactly `keys`: a section the Rust side adds fails here
    /// until the Swift side checks it too.
    static func golden(_ file: String, keys: Set<String>) throws -> JSONValue {
        let doc = try load(goldenDirectory.appending(path: file))
        #expect(doc["fixture"]?.stringValue == goldenFiles[file], "\(file) fixture id")
        try expectKeys(doc, keys, file)
        return doc
    }
}

struct FixtureError: Error, CustomStringConvertible {
    let description: String
    init(_ description: String) { self.description = description }
}

/// Fails when `value`'s object keys differ from `keys`.
func expectKeys(_ value: JSONValue?, _ keys: Set<String>, _ context: String) throws {
    let object = try #require(value?.objectValue, "\(context) is not an object")
    let actual = Set(object.keys)
    #expect(actual == keys, "\(context): unknown \(actual.subtracting(keys).sorted()), missing \(keys.subtracting(actual).sorted())")
}

func hex(_ value: JSONValue?) throws -> Data {
    let text = try #require(value?.stringValue, "not a hex string")
    return try #require(Hex.decode(text), "bad hex \(text)")
}

func hex(_ text: String) -> Data {
    Hex.decode(text)!
}

func string(_ value: JSONValue?) throws -> String {
    try #require(value?.stringValue, "not a string")
}

func int(_ value: JSONValue?) throws -> Int {
    try #require(value?.intValue, "not an integer")
}

func array(_ value: JSONValue?) throws -> [JSONValue] {
    try #require(value?.arrayValue, "not an array")
}

func json(_ text: String) -> JSONValue {
    try! JSONValue(parsing: Data(text.utf8))
}

/// The master key of every fixture: bytes 0x00...0x1f.
func fixtureMasterKey() -> MasterKey {
    try! MasterKey(bytes: Data((0..<32).map { UInt8($0) }))
}

/// Rust's `{:?}` of the matching Rust error, so a fixture's `rustError`
/// can be compared with what Swift threw.
func rustDebug(_ error: QRError) -> String {
    func quoted(_ s: String) -> String {
        var out = ""
        JSONWriter.writeString(s, into: &out)
        return out
    }
    switch error {
    case .badPrefix: return "BadPrefix"
    case .tooLong: return "TooLong"
    case .malformedQuery: return "MalformedQuery"
    case .unknownKey(let key): return "UnknownKey(\(quoted(key)))"
    case .duplicateKey(let key): return "DuplicateKey(\(quoted(key)))"
    case .missingKey(let key): return "MissingKey(\(quoted(key)))"
    case .badPercentEncoding: return "BadPercentEncoding"
    case .badUTF8: return "BadUtf8"
    case .badMasterKey(let e): return "BadMasterKey(\(rustDebug(e)))"
    case .badRelayURL(let e): return "BadRelayUrl(\(rustDebug(e)))"
    case .badDesktopName: return "BadDesktopName"
    }
}

func rustDebug(_ error: KeyError) -> String {
    switch error {
    case .random: return "Random"
    case .badBase64: return "BadBase64"
    case .badLength(let expected, let actual): return "BadLength { expected: \(expected), actual: \(actual) }"
    }
}

func rustDebug(_ error: RelayURLError) -> String {
    switch error {
    case .tooLong: return "TooLong"
    case .badScheme: return "BadScheme"
    case .insecureRemote: return "InsecureRemote"
    case .badCharacter: return "BadCharacter"
    case .badHost: return "BadHost"
    case .badPort: return "BadPort"
    case .badPath: return "BadPath"
    }
}

/// The error a typed-throws call threw, or `nil` if it returned.
func thrown<T, E: Error>(_ body: () throws(E) -> T) -> E? {
    do {
        _ = try body()
        return nil
    } catch {
        return error
    }
}
