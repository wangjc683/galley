#!/bin/sh
# Run the package's tests: `ios/GalleyRemote/swift-test.sh [swift test args]`.
#
# With Xcode (CI, most Macs) this is plain `swift test`. With only the
# Command Line Tools, SwiftPM 6.2 does not put the CLT's Testing.framework
# on the test target's search paths ("no such module 'Testing'"), and the
# framework's `_Testing_Foundation` cross-import overlay ships without a
# module; pass the paths and turn cross-import overlays off.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
clt=/Library/Developer/CommandLineTools
frameworks=$clt/Library/Developer/Frameworks
if [ "$(xcode-select -p 2>/dev/null)" = "$clt" ] && [ -d "$frameworks/Testing.framework" ]; then
    exec swift test --package-path "$here" \
        -Xswiftc -F -Xswiftc "$frameworks" \
        -Xswiftc -Xfrontend -Xswiftc -disable-cross-import-overlays \
        -Xlinker -F -Xlinker "$frameworks" \
        -Xlinker -rpath -Xlinker "$frameworks" \
        "$@"
fi
exec swift test --package-path "$here" "$@"
