import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from 'genlayer-js';
import { studionet } from 'genlayer-js/chains';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const txHash = '0xe694e60fcc4af7cc5064062a8a85e207b7808416bf9fffc2f9602725237cf66a';

async function main() {
    console.log(`Checking transaction status for: ${txHash} on Studionet...`);
    const client = createClient({ chain: studionet });

    try {
        const receipt = await client.getTransactionReceipt({ hash: txHash });
        console.log('Receipt received:', JSON.stringify(receipt, (key, value) =>
            typeof value === 'bigint' ? value.toString() : value, 2));

        if (receipt && receipt.contractAddress) {
            console.log(`\n🎉 Contract Address found: ${receipt.contractAddress}`);

            const deploymentData = {
                network: 'studionet',
                chainId: studionet.id,
                contractAddress: receipt.contractAddress,
                deployTxHash: txHash,
                deployedAt: new Date().toISOString(),
                client: {
                    address: '0x7A50696C0Be26D9CbC9BD21c2dd113b4F07f2035',
                    privateKey: '0x238449ed138609b5c837224c9de37aff053b9797e41a8d3dc05010e5f561e73b'
                },
                freelancer: {
                    address: '0x8cf1A2c9f67299eAF0Cf592518b9547e88d2B09d',
                    privateKey: '0xf460015c1fd424b01829310863c1c2176864ba546fdfdbe6f5511c73b77f9739'
                }
            };

            const outputPath = path.resolve(__dirname, '../deployed_contract.json');
            fs.writeFileSync(outputPath, JSON.stringify(deploymentData, null, 2), 'utf8');
            console.log(`Saved deployment metadata to ${outputPath}`);
        }
    } catch (err) {
        console.error('Error fetching receipt:', err);
    }
}

main();
