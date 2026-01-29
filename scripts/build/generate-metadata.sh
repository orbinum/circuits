#!/bin/bash
# Generate circuit metadata JSON files from R1CS
# This allows benchmarks to run without requiring R1CS files at runtime

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

echo "📊 Generating Circuit Metadata"
echo "================================"

# Check if snarkjs is available
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed"
    exit 1
fi

if [ ! -d "node_modules/snarkjs" ]; then
    echo "❌ snarkjs not found. Run: npm install"
    exit 1
fi

# Generate metadata for each circuit
CIRCUITS=("transfer" "unshield" "disclosure")

for CIRCUIT in "${CIRCUITS[@]}"; do
    R1CS_FILE="build/${CIRCUIT}.r1cs"
    METADATA_FILE="build/${CIRCUIT}_metadata.json"

    if [ ! -f "$R1CS_FILE" ]; then
        echo "⚠️  $R1CS_FILE not found - skipping $CIRCUIT"
        continue
    fi

    echo ""
    echo "📝 Processing $CIRCUIT..."

    # Create temporary Node.js script in the circuits directory
    TEMP_SCRIPT="build/gen_metadata_$CIRCUIT.js"
    cat > "$TEMP_SCRIPT" << 'NODESCRIPT'
const snarkjs = require('snarkjs');
const fs = require('fs');

const r1csFile = process.argv[2];
const metadataFile = process.argv[3];
const circuitName = process.argv[4];

(async () => {
    try {
        const r1cs = await snarkjs.r1cs.info(r1csFile);
        const metadata = {
            circuit: circuitName,
            constraints: r1cs.nConstraints,
            privateInputs: r1cs.nPrvInputs,
            publicInputs: r1cs.nPubInputs,
            labels: r1cs.nLabels,
            outputs: r1cs.nOutputs,
            generated: new Date().toISOString(),
            source: `Generated from ${r1csFile}`
        };
        fs.writeFileSync(metadataFile, JSON.stringify(metadata, null, 2));
        console.log(`   ✓ Generated ${metadataFile}`);
        console.log(`   ✓ Constraints: ${r1cs.nConstraints.toLocaleString()}`);
        console.log(`   ✓ Public Inputs: ${r1cs.nPubInputs}`);
        console.log(`   ✓ Private Inputs: ${r1cs.nPrvInputs}`);
        process.exit(0);
    } catch (error) {
        console.error(`   ❌ Failed: ${error.message}`);
        process.exit(1);
    }
})();
NODESCRIPT

    # Run the script from circuits directory
    node "$TEMP_SCRIPT" "$R1CS_FILE" "$METADATA_FILE" "$CIRCUIT"
    EXIT_CODE=$?

    # Clean up
    rm -f "$TEMP_SCRIPT"

    if [ $EXIT_CODE -ne 0 ]; then
        echo "   ❌ Failed to generate metadata for $CIRCUIT"
        exit 1
    fi
done

echo ""
echo "✅ Metadata generation complete!"
echo ""
echo "Generated files:"
ls -lh build/*_metadata.json 2>/dev/null || echo "   No metadata files generated"
