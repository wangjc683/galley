// swift-tools-version: 6.0
//
// GalleyRemote: the phone side of Galley's remote-access wire protocol
// (ticket 07a). Pure Swift on Apple CryptoKit, no dependencies, no UI, no
// networking. Byte-for-byte compatible with the Rust crate in
// `../../remote-protocol`, whose golden fixtures the tests decode.

import PackageDescription

let package = Package(
    name: "GalleyRemote",
    platforms: [
        // PRD ruling 12: the app supports iOS 26 and later.
        .iOS("26.0"),
        // Only so `swift test` runs on a Mac; nothing here needs more than
        // CryptoKit's HKDF (macOS 11).
        .macOS(.v14),
    ],
    products: [
        .library(name: "GalleyRemote", targets: ["GalleyRemote"]),
    ],
    targets: [
        .target(name: "GalleyRemote"),
        .testTarget(name: "GalleyRemoteTests", dependencies: ["GalleyRemote"]),
    ]
)
