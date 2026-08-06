import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { createClient, createAccount } from 'genlayer-js';
import { studionet } from 'genlayer-js/chains';
import { TransactionStatus, ExecutionResult } from 'genlayer-js/types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Helper to generate a new EVM private key
function generateNewPrivateKey() {
    return '0x' + crypto.randomBytes(32).toString('hex');
}

async function main() {
    console.log('=== GenLayer Studionet Wallet Generation & Deployment ===\n');

    // 1. Generate new wallets
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

    // 2. Initialize GenLayer Client for Studionet
    console.log('\n🌐 Connecting to GenLayer Studionet (https://studio.genlayer.com/api)...');
    const client = createClient({
        chain: studionet
    });

    // 3. Read contract code
    const contractPath = path.resolve(__dirname, '../contracts/escrow.py');
    console.log(`\n📄 Reading contract from: ${contractPath}`);
    const contractCode = fs.readFileSync(contractPath, 'utf8');

    // 4. Contract deployment parameters
    const escrowAmount = 1000n;
    const timeoutSec = 604800; // 7 days
    const appealSec = 86400;   // 24 hours
    const jobSpec = 'Build responsive landing page with AI escrow dispute resolution on GenLayer Studionet.';

    console.log(`\n🚀 Deploying EscrowContract to Studionet...`);
    console.log(`   Deployer (Client): ${clientAccount.address}`);
    console.log(`   Freelancer:       ${freelancerAccount.address}`);
    console.log(`   Deposit Value:    ${escrowAmount} WEI`);

    try {
        const txHash = await client.deployContract({
            account: clientAccount,
            code: contractCode,
            args: [freelancerAccount.address, Number(escrowAmount), jobSpec, timeoutSec, appealSec],
            value: escrowAmount
        });

        console.log(`\n⏳ Deployment tx submitted. Hash: ${txHash}`);
        console.log('   Waiting for FINALIZED consensus receipt on Studionet...');

        const receipt = await client.waitForTransactionReceipt({
            hash: txHash,
            status: TransactionStatus.FINALIZED
        });

        if (receipt.txExecutionResultName === ExecutionResult.FINISHED_WITH_ERROR) {
            throw new Error(`Deployment failed on Studionet: ${receipt.executionResultError || 'Reverted'}`);
        }

        const contractAddress = receipt.contractAddress;
        console.log(`\n✅ Contract Successfully Deployed on Studionet!`);
        console.log(`   Contract Address: ${contractAddress}`);
        console.log(`   Tx Hash:          ${txHash}`);

        // 5. Save deployment metadata
        const deploymentData = {
            network: 'studionet',
            chainId: studionet.id,
            contractAddress: contractAddress,
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

    } catch (err) {
        console.error(`\n❌ Deployment Failed:`, err);
        process.exit(1);
    }
}

main();
