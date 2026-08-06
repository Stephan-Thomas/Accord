import { createClient } from 'genlayer-js';
import { studionet } from 'genlayer-js/chains';

const txHash = '0xfeec772836a2722ad9c017ec2d0a3dc53ec08c089fe9ecf0cacc7d23e6b14e33';

async function main() {
    const client = createClient({ chain: studionet });
    const receipt = await client.getTransactionReceipt({ hash: txHash });
    console.log('KEYS:', Object.keys(receipt));
    console.log('FULL RECEIPT:', JSON.stringify(receipt, (key, value) => typeof value === 'bigint' ? value.toString() : value, 2));
}

main();
