//! The vendored cacophony vectors (`tests/vectors/`), run against the snow
//! build this crate uses (same version, same feature set). The NNpsk0
//! vector also runs through the crate's own session builder, in
//! `src/noise.rs`.

use galley_remote_protocol::noise::NOISE_PARAMS;
use serde_json::Value;

fn bytes(v: &Value) -> Vec<u8> {
    hex::decode(v.as_str().expect("hex string")).expect("valid hex")
}

fn key32(v: &Value) -> [u8; 32] {
    bytes(v).try_into().expect("32-byte key")
}

/// Where each vendored suite puts its PSK (none for `KK`).
fn psk_location(protocol: &str) -> Option<u8> {
    match protocol {
        "Noise_NNpsk0_25519_ChaChaPoly_SHA256" => Some(0),
        "Noise_XXpsk3_25519_ChaChaPoly_SHA256" => Some(3),
        "Noise_KK_25519_ChaChaPoly_SHA256" => None,
        other => panic!("unexpected vendored suite {other}"),
    }
}

fn run_vector(vector: &Value) {
    let protocol = vector["protocol_name"].as_str().unwrap();
    let side = |prefix: &str, initiator: bool| {
        let params: snow::params::NoiseParams = protocol.parse().unwrap();
        let prologue = bytes(&vector[format!("{prefix}_prologue")]);
        let ephemeral = key32(&vector[format!("{prefix}_ephemeral")]);
        let psk = psk_location(protocol).map(|_| key32(&vector[format!("{prefix}_psks")][0]));
        let local_static = vector.get(format!("{prefix}_static")).map(key32);
        let remote_static = vector.get(format!("{prefix}_remote_static")).map(key32);
        let mut builder = snow::Builder::new(params)
            .prologue(&prologue)
            .unwrap()
            .fixed_ephemeral_key_for_testing_only(&ephemeral);
        if let (Some(location), Some(psk)) = (psk_location(protocol), psk.as_ref()) {
            builder = builder.psk(location, psk).unwrap();
        }
        if let Some(s) = local_static.as_ref() {
            builder = builder.local_private_key(s).unwrap();
        }
        if let Some(rs) = remote_static.as_ref() {
            builder = builder.remote_public_key(rs).unwrap();
        }
        if initiator {
            builder.build_initiator().unwrap()
        } else {
            builder.build_responder().unwrap()
        }
    };
    let mut init = side("init", true);
    let mut resp = side("resp", false);
    let messages = vector["messages"].as_array().unwrap();
    let mut buf = vec![0u8; 65535];
    let mut out = vec![0u8; 65535];
    let mut iter = messages.iter().enumerate();
    while !init.is_handshake_finished() {
        let (i, m) = iter.next().expect("handshake fits the vector");
        let (send, recv) = if i % 2 == 0 {
            (&mut init, &mut resp)
        } else {
            (&mut resp, &mut init)
        };
        let payload = bytes(&m["payload"]);
        let n = send.write_message(&payload, &mut buf).unwrap();
        assert_eq!(
            hex::encode(&buf[..n]),
            m["ciphertext"].as_str().unwrap(),
            "{protocol} message {i}"
        );
        let k = recv.read_message(&buf[..n], &mut out).unwrap();
        assert_eq!(out[..k], payload[..], "{protocol} message {i}");
    }
    assert!(resp.is_handshake_finished());
    assert_eq!(
        hex::encode(init.get_handshake_hash()),
        vector["handshake_hash"].as_str().unwrap(),
        "{protocol} handshake hash"
    );
    assert_eq!(init.get_handshake_hash(), resp.get_handshake_hash());
    let mut init = init.into_transport_mode().unwrap();
    let mut resp = resp.into_transport_mode().unwrap();
    for (i, m) in iter {
        let (send, recv) = if i % 2 == 0 {
            (&mut init, &mut resp)
        } else {
            (&mut resp, &mut init)
        };
        let payload = bytes(&m["payload"]);
        let n = send.write_message(&payload, &mut buf).unwrap();
        assert_eq!(
            hex::encode(&buf[..n]),
            m["ciphertext"].as_str().unwrap(),
            "{protocol} message {i}"
        );
        let k = recv.read_message(&buf[..n], &mut out).unwrap();
        assert_eq!(out[..k], payload[..], "{protocol} message {i}");
    }
}

#[test]
fn vendored_vectors_pass_against_snow() {
    let file: Value = serde_json::from_str(include_str!("vectors/cacophony-subset.json")).unwrap();
    let vectors = file["vectors"].as_array().unwrap();
    let names: Vec<&str> = vectors
        .iter()
        .map(|v| v["protocol_name"].as_str().unwrap())
        .collect();
    assert_eq!(
        names,
        [
            NOISE_PARAMS,
            "Noise_XXpsk3_25519_ChaChaPoly_SHA256",
            "Noise_KK_25519_ChaChaPoly_SHA256",
        ]
    );
    for vector in vectors {
        assert_eq!(vector["messages"].as_array().unwrap().len(), 6);
        run_vector(vector);
    }
}
