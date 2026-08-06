import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { createClient, createAccount } from 'genlayer-js';
import { studionet } from 'genlayer-js/chains';
import { TransactionStatus, ExecutionResult } from 'genlayer-js/types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function generateNewPrivateKey() {
    return '0x' + crypto.randomBytes(32).toString('hex');
}

async function main() {
    console.log('=== GenLayer Studionet Wallet Generation & Deployment ===\n');

    const clientPrivateKey = generateNewPrivateKey();
    const freelancerPrivateKey = generateNewPrivateKey();

    const clientAccount = createAccount(clientPrivateKey);
    const freelancerAccount = createAccount(freelancerPrivateKey);

    console.log('🔑 New Client Wallet Generated:');
    console.log('   Address:    ', clientAccount.address);
    console.log('   Private Key:', clientPrivateKey);

    console.log('\n🔑 New Freelancer Wallet Generated:');
    console.log('   Address:    ', freelancerAccount.address);
    console.log('   Private Key:', freelancerPrivateKey);

    console.log('\n🌐 Connecting to GenLayer Studionet (https://studio.genlayer.com/api)...');
    const client = createClient({
        chain: studionet
    });

    const contractPath = path.resolve(__dirname, '../contracts/escrow.py');
    const contractCode = fs.readFileSync(contractPath, 'utf8');

    const escrowAmount = 1000n;
    const timeoutSec = 604800;
    const appealSec = 86400;
    const jobSpec = 'Build landing page with AI escrow dispute resolution on GenLayer Studionet.';

    console.log(`\n🚀 Deploying EscrowContract to Studionet...`);
    console.log(`   Deployer (Client): ${clientAccount.address}`);
    console.log(`   Freelancer:       ${freelancerAccount.address}`);

    const txHash = await client.deployContract({
        account: clientAccount,
        code: contractCode,
        args: [freelancerAccount.address, Number(escrowAmount), jobSpec, timeoutSec, appealSec],
        value: escrowAmount
    });

    console.log(`\n⏳ Deployment tx submitted. Hash: ${txHash}`);
    console.log('   Waiting for ACCEPTED status receipt on Studionet...');

    const receipt = await client.waitForTransactionReceipt({
        hash: txHash,
        status: TransactionStatus.ACCEPTED
    });

    console.log('\nReceipt details:', JSON.stringify(receipt, (key, value) => typeof value === 'bigint' ? value.toString() : value, 2));

    // Poll for contract address or read status
    let contractAddress = receipt.contractAddress;
    
    // Write deployment metadata
    const deploymentData = {
        network: 'studionet',
        chainId: studionet.id,
        contractAddress: contractAddress || '',
        deployTxHash: txHash,
        deployedAt: new Date().toISOString(),
        client: {
            address: clientAccount.address,
            privateKey: clientPrivateKey
        },
        freelancer: {
            address: freelancerAccount.address,
            privateKey: freelancerPrivateKey
        },
        params: {
            amount: escrowAmount.toString(),
            spec: jobSpec,
            timeoutSec: timeoutSec,
            appealSec: appealSec
        }
    };

    const outputPath = path.resolve(__dirname, '../deployed_contract.json');
    fs.writeFileSync(outputPath, JSON.stringify(deploymentData, null, 2), 'utf8');
    console.log(`\n💾 Saved deployment metadata to: ${outputPath}`);
}

main().catch(console.error);
