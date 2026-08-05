import { createClient, createAccount } from 'genlayer-js';
import { localnet } from 'genlayer-js/chains';
import { TransactionStatus, ExecutionResult } from 'genlayer-js/types';

// Standard pre-funded localnet dev account private keys
const DEFAULT_CLIENT_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const DEFAULT_FREELANCER_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';

// Initialize pre-funded accounts
let clientAccount = createAccount(DEFAULT_CLIENT_KEY);
let freelancerAccount = createAccount(DEFAULT_FREELANCER_KEY);

// Create GenLayer client
const client = createClient({
    chain: localnet
});

const logEl = document.getElementById('log');
function log(msg, type = 'info') {
    console.log(`[${type.toUpperCase()}] ${msg}`);
    const time = new Date().toLocaleTimeString();
    logEl.textContent += `\n[${time}] ${msg}`;
    logEl.scrollTop = logEl.scrollHeight;
}

let escrowAddress = null;
let currentContractState = null;

// UI Elements
const btnDeploy = document.getElementById('btnDeploy');
const sectionDeploy = document.getElementById('section-deploy');
const sectionInteract = document.getElementById('section-interact');
const contractAddressEl = document.getElementById('contractAddress');
const contractStatusEl = document.getElementById('contractStatus');

// State Summary Elements
const valClient = document.getElementById('valClient');
const valFreelancer = document.getElementById('valFreelancer');
const valAmount = document.getElementById('valAmount');
const valBalance = document.getElementById('valBalance');
const valDeliveryRef = document.getElementById('valDeliveryRef');
const valIsAppealed = document.getElementById('valIsAppealed');
const valRulingDecision = document.getElementById('valRulingDecision');

// Actions
const actionDeliver = document.getElementById('action-deliver');
const actionReview = document.getElementById('action-review');
const actionAppeal = document.getElementById('action-appeal');

const btnDeliver = document.getElementById('btnDeliver');
const btnAccept = document.getElementById('btnAccept');
const btnDispute = document.getElementById('btnDispute');
const btnAutoRelease = document.getElementById('btnAutoRelease');
const btnAppeal = document.getElementById('btnAppeal');
const btnFinalize = document.getElementById('btnFinalize');
const btnRefresh = document.getElementById('btnRefresh');

// Contract source loader
async function fetchContractCode() {
    try {
        const response = await fetch('/contracts/escrow.py');
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.text();
    } catch (err) {
        log(`Failed to fetch contract code from server: ${err.message}`, 'error');
        throw err;
    }
}

// Transaction execution helper
async function sendWriteTransaction(account, functionName, args = [], value = 0n) {
    log(`Submitting transaction '${functionName}' from ${account.address}...`);
    try {
        const txHash = await client.writeContract({
            account: account,
            address: escrowAddress,
            functionName: functionName,
            args: args,
            value: BigInt(value)
        });
        log(`Transaction submitted! Hash: ${txHash}. Waiting for consensus (FINALIZED)...`);
        
        const receipt = await client.waitForTransactionReceipt({
            hash: txHash,
            status: TransactionStatus.FINALIZED
        });

        if (receipt.txExecutionResultName === ExecutionResult.FINISHED_WITH_ERROR) {
            log(`Transaction execution FAILED on-chain: ${receipt.executionResultError || 'Contract error'}`, 'error');
            throw new Error(`Execution error: ${receipt.executionResultError || 'Reverted'}`);
        } else if (receipt.txExecutionResultName === ExecutionResult.FINISHED_WITH_RETURN) {
            log(`Transaction '${functionName}' finalized successfully!`);
            return receipt;
        } else {
            log(`Transaction status: ${receipt.txExecutionResultName}`);
            return receipt;
        }
    } catch (err) {
        log(`Transaction error: ${err.message}`, 'error');
        throw err;
    }
}

// Fetch and display latest on-chain state
async function refreshState() {
    if (!escrowAddress) return;
    try {
        log(`Reading on-chain state for contract ${escrowAddress}...`);
        const state = await client.readContract({
            address: escrowAddress,
            functionName: 'get_escrow_state',
            args: []
        });

        currentContractState = state;
        log(`Current state: ${state.state}`);

        // Update UI Badges & Summary
        contractStatusEl.textContent = state.state;
        contractStatusEl.className = 'status-badge ' + state.state.toLowerCase();

        valClient.textContent = state.client;
        valFreelancer.textContent = state.freelancer;
        valAmount.textContent = `${state.amount} WEI`;
        valBalance.textContent = `${state.contract_balance} WEI`;
        valDeliveryRef.textContent = state.delivery_ref || 'None';
        valIsAppealed.textContent = state.is_appealed ? 'Appealed' : 'Not Appealed';
        valRulingDecision.textContent = state.ruling_decision || 'N/A';

        // Toggle action panels based on actual on-chain state
        actionDeliver.classList.add('hidden');
        actionReview.classList.add('hidden');
        actionAppeal.classList.add('hidden');

        if (state.state === 'PENDING') {
            actionDeliver.classList.remove('hidden');
        } else if (state.state === 'DELIVERED') {
            actionReview.classList.remove('hidden');
        } else if (state.state === 'DISPUTE_RULED') {
            actionAppeal.classList.remove('hidden');
            btnAppeal.disabled = state.is_appealed;
        }
    } catch (err) {
        log(`Error reading state: ${err.message}`, 'error');
    }
}

// 1. Deploy Contract
btnDeploy.addEventListener('click', async () => {
    try {
        const clientKey = document.getElementById('clientPrivateKey').value || DEFAULT_CLIENT_KEY;
        const freelancerKey = document.getElementById('freelancerPrivateKey').value || DEFAULT_FREELANCER_KEY;

        // Re-initialize pre-funded accounts from key inputs
        clientAccount = createAccount(clientKey);
        freelancerAccount = createAccount(freelancerKey);

        const freelancerAddr = freelancerAccount.address;
        const amount = document.getElementById('amount').value;
        const timeoutSec = document.getElementById('timeoutSeconds').value;
        const appealSec = document.getElementById('appealWindowSeconds').value;
        const spec = document.getElementById('spec').value;

        btnDeploy.disabled = true;
        btnDeploy.textContent = 'Deploying Contract...';

        log(`Client account: ${clientAccount.address}`);
        log(`Freelancer account: ${freelancerAccount.address}`);
        log('Loading contract source code...');
        const code = await fetchContractCode();

        log(`Deploying EscrowContract from Client (${clientAccount.address}). Value: ${amount} WEI...`);
        const txHash = await client.deployContract({
            account: clientAccount,
            code: code,
            args: [freelancerAddr, parseInt(amount), spec, parseInt(timeoutSec), parseInt(appealSec)],
            value: BigInt(amount)
        });

        log(`Deploy tx submitted: ${txHash}. Waiting for FINALIZED receipt...`);
        const receipt = await client.waitForTransactionReceipt({
            hash: txHash,
            status: TransactionStatus.FINALIZED
        });

        if (receipt.txExecutionResultName === ExecutionResult.FINISHED_WITH_ERROR) {
            throw new Error(`Deployment failed: ${receipt.executionResultError || 'Reverted'}`);
        }

        escrowAddress = receipt.contractAddress;
        log(`EscrowContract successfully deployed at address: ${escrowAddress}`);

        sectionDeploy.classList.add('hidden');
        sectionInteract.classList.remove('hidden');
        contractAddressEl.textContent = escrowAddress;

        await refreshState();
    } catch (err) {
        log(`Deployment Error: ${err.message}`, 'error');
        btnDeploy.disabled = false;
        btnDeploy.textContent = 'Deploy & Deposit Escrow';
    }
});

// 2. Deliver Work
btnDeliver.addEventListener('click', async () => {
    try {
        const deliveryRef = document.getElementById('deliveryRef').value;
        btnDeliver.disabled = true;
        btnDeliver.textContent = 'Submitting Delivery...';

        await sendWriteTransaction(freelancerAccount, 'deliver_work', [deliveryRef]);
        await refreshState();
    } catch (err) {
        btnDeliver.disabled = false;
        btnDeliver.textContent = 'Submit Work (As Freelancer)';
    }
});

// 3. Accept Work
btnAccept.addEventListener('click', async () => {
    try {
        btnAccept.disabled = true;
        btnDispute.disabled = true;
        btnAccept.textContent = 'Accepting...';

        await sendWriteTransaction(clientAccount, 'accept_work', []);
        await refreshState();
    } catch (err) {
        btnAccept.disabled = false;
        btnDispute.disabled = false;
        btnAccept.textContent = 'Accept Work & Release Funds';
    }
});

// 4. Initiate Dispute
btnDispute.addEventListener('click', async () => {
    try {
        btnAccept.disabled = true;
        btnDispute.disabled = true;
        btnDispute.textContent = 'Arbitrating (GenLayer LLM)...';

        await sendWriteTransaction(clientAccount, 'resolve_dispute', []);
        await refreshState();
    } catch (err) {
        btnAccept.disabled = false;
        btnDispute.disabled = false;
        btnDispute.textContent = 'Initiate AI Dispute Resolution';
    }
});

// 5. Trigger Timeout Auto-Release
btnAutoRelease.addEventListener('click', async () => {
    try {
        btnAutoRelease.disabled = true;
        btnAutoRelease.textContent = 'Checking Timeout...';

        await sendWriteTransaction(freelancerAccount, 'auto_release_funds', []);
        await refreshState();
    } catch (err) {
        btnAutoRelease.disabled = false;
        btnAutoRelease.textContent = 'Trigger Timeout Auto-Release (If Timeout Expired)';
    }
});

// 6. Appeal Ruling
btnAppeal.addEventListener('click', async () => {
    try {
        btnAppeal.disabled = true;
        btnFinalize.disabled = true;
        btnAppeal.textContent = 'Appealing (Re-Arbitrating)...';

        await sendWriteTransaction(clientAccount, 'appeal', []);
        await refreshState();
    } catch (err) {
        btnAppeal.disabled = false;
        btnFinalize.disabled = false;
        btnAppeal.textContent = 'Appeal Ruling (AI Re-Arbitration)';
    }
});

// 7. Finalize Ruling Settlement
btnFinalize.addEventListener('click', async () => {
    try {
        btnAppeal.disabled = true;
        btnFinalize.disabled = true;
        btnFinalize.textContent = 'Finalizing Settlement...';

        await sendWriteTransaction(clientAccount, 'finalize_ruling', []);
        await refreshState();
    } catch (err) {
        btnAppeal.disabled = false;
        btnFinalize.disabled = false;
        btnFinalize.textContent = 'Finalize Settlement Payout';
    }
});

// 8. Refresh State
btnRefresh.addEventListener('click', refreshState);
