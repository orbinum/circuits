#!/usr/bin/env -S cargo +nightly -Zscript
---cargo
[dependencies]
ark-circom = "0.5.0"
ark-bn254 = "0.5.0"
ark-serialize = "0.5.0"
---

use ark_circom::read_zkey;
use ark_serialize::CanonicalSerialize;
use std::env;
use std::fs::File;
use std::io::{self, BufReader, BufWriter};

fn main() -> io::Result<()> {
    let args: Vec<String> = env::args().collect();
    
    if args.len() != 3 {
        eprintln!("Usage: {} <input.zkey> <output.ark>", args[0]);
        eprintln!("");
        eprintln!("Converts a snarkjs .zkey file to arkworks .ark format");
        eprintln!("using ark-circom library for optimal Rust performance.");
        std::process::exit(1);
    }
    
    let zkey_path = &args[1];
    let ark_path = &args[2];
    
    println!("🔄 Converting {} to {}", zkey_path, ark_path);
    println!("📖 Reading .zkey file...");
    
    // Read .zkey file
    let zkey_file = File::open(zkey_path)
        .map_err(|e| io::Error::new(io::ErrorKind::NotFound, 
            format!("Failed to open {}: {}", zkey_path, e)))?;
    let mut reader = BufReader::new(zkey_file);
    
    let (proving_key, _matrices) = read_zkey(&mut reader)
        .map_err(|e| io::Error::new(io::ErrorKind::InvalidData,
            format!("Failed to parse .zkey: {}", e)))?;
    
    println!("✓ Successfully parsed proving key");
    println!("💾 Serializing to .ark format...");
    
    // Serialize proving key to .ark file
    let ark_file = File::create(ark_path)
        .map_err(|e| io::Error::new(io::ErrorKind::PermissionDenied,
            format!("Failed to create {}: {}", ark_path, e)))?;
    let mut writer = BufWriter::new(ark_file);
    
    proving_key.serialize_compressed(&mut writer)
        .map_err(|e| io::Error::new(io::ErrorKind::Other,
            format!("Failed to serialize proving key: {}", e)))?;
    
    println!("✓ Successfully created {}", ark_path);
    
    // Show file sizes
    let zkey_size = std::fs::metadata(zkey_path)?.len();
    let ark_size = std::fs::metadata(ark_path)?.len();
    
    println!("");
    println!("📊 File sizes:");
    println!("  .zkey: {} bytes ({:.2} KB)", zkey_size, zkey_size as f64 / 1024.0);
    println!("  .ark:  {} bytes ({:.2} KB)", ark_size, ark_size as f64 / 1024.0);
    println!("  Ratio: {:.1}%", (ark_size as f64 / zkey_size as f64) * 100.0);
    
    Ok(())
}
