#![no_std]
#![no_builtins]
#![allow(dead_code, unused_imports)]

#[cfg(test)]
#[macro_use]
extern crate std;

extern crate chacha20poly1305;
extern crate core;

mod aead;
mod bolos;
mod commitments;
mod constants;
mod parser;
mod pedersen;
mod tests_crypto;
mod zeccrypto;
mod zip32;
mod zxformat;

pub use parser::{_getItem, _getNumItems, _parser_init, _read};
pub use zxformat::{fpi64_to_str, fpu64_to_str};

use crate::bolos::{c_check_app_canary, c_zemu_log_stack};
use blake2s_simd::{blake2s, Hash as Blake2sHash, Params as Blake2sParams};
use jubjub::{AffineNielsPoint, AffinePoint, ExtendedNielsPoint, ExtendedPoint, Fq, Fr};

fn debug(_msg: &str) {}

use core::convert::TryInto;
use core::mem;

#[cfg(not(test))]
use core::panic::PanicInfo;

#[cfg(test)]
extern crate hex;

#[cfg(not(test))]
#[panic_handler]
fn panic(_info: &PanicInfo) -> ! {
    loop {}
}
