import './style.css';
import { createClient, createAccount } from 'genlayer-js';
import { localnet, studionet } from 'genlayer-js/chains';
import { TransactionStatus, ExecutionResult } from 'genlayer-js/types';

// Default Keys
const LOCAL_CLIENT_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const LOCAL_FREELANCER_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';

let currentChain = studionet;
let client = createClient({ chain: currentChain });

let clientAccount = null;
let freelancerAccount = null;
let escrowAddress = null;
let currentContractState = null;

// UI Elements
const networkSelect = document.getElementById('networkSelect');
const netBadge = document.getElementById('netBadge');
const terminalChainLabel = document.getElementById('terminalChainLabel');
const clientPrivateKeyInput = document.getElementById('clientPrivateKey');
const freelancerPrivateKeyInput = document.getElementById('freelancerPrivateKey');
const existingContractAddressInput = document.getElementById('existingContractAddress');
const btnLoadContract = document.getElementById('btnLoadContract');

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
const btnSwitchContract = document.getElementById('btnSwitchContract');

const logEl = document.getElementById('log');

function log(msg, type = 'info') {
    console.log(`[${type.toUpperCase()}] ${msg}`);
    const time = new Date().toLocaleTimeString();
    logEl.textContent += `\n[${time}] ${msg}`;
    logEl.scrollTop = logEl.scrollHeight;
}

// Contract source loader
async function fetchContractCode() {
    try {
        const response = await fetch('/contracts/escrow.py');
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.text();
    } catch (err) {
        log(`Failed to fetch contract code: ${err.message}`, 'error');
        throw err;
    }
}

// Load deployed_contract.json if available
async function loadDeployedContractMetadata() {
    try {
        const response = await fetch('/deployed_contract.json');
        if (response.ok) {
            const data = await response.json();
            log(`Loaded deployment metadata for contract on ${data.network}!`);
            if (data.contractAddress) {
                existingContractAddressInput.value = data.contractAddress;
            }
            if (data.client && data.client.privateKey) {
                clientPrivateKeyInput.value = data.client.privateKey;
            }
            if (data.freelancer && data.freelancer.privateKey) {
                freelancerPrivateKeyInput.value = data.freelancer.privateKey;
            }
            return data;
        }
    } catch (err) {
        // Fallback to defaults
    }
    
    // Default values if no deployed_contract.json
    clientPrivateKeyInput.value = LOCAL_CLIENT_KEY;
    freelancerPrivateKeyInput.value = LOCAL_FREELANCER_KEY;
    return null;
}

// Initialize Client & Accounts
function updateNetwork(networkName) {
    if (networkName === 'studionet') {
        currentChain = studionet;
        netBadge.textContent = 'STUDIONET';
        netBadge.className = 'status-badge delivered';
        terminalChainLabel.textContent = 'studionet-terminal ~ bash';
    } else {
        currentChain = localnet;
        netBadge.textContent = 'LOCALNET';
        netBadge.className = 'status-badge pending';
        terminalChainLabel.textContent = 'localnet-terminal ~ bash';
    }
    client = createClient({ chain: currentChain });
    log(`Switched active chain to: ${currentChain.name} (${currentChain.id})`);
}

networkSelect.addEventListener('change', (e) => {
    updateNetwork(e.target.value);
});

// Setup accounts from input keys
function setupAccounts() {
    const clientKey = clientPrivateKeyInput.value.trim() || LOCAL_CLIENT_KEY;
    const freelancerKey = freelancerPrivateKeyInput.value.trim() || LOCAL_FREELANCER_KEY;

    clientAccount = createAccount(clientKey);
    freelancerAccount = createAccount(freelancerKey);
}

// Transaction execution helper
async function sendWriteTransaction(account, functionName, args = [], value = 0n) {
    log(`Submitting '${functionName}' from ${account.address} on ${currentChain.name}...`);
    try {
        const txHash = await client.writeContract({
            account: account,
            address: escrowAddress,
            functionName: functionName,
            args: args,
            value: BigInt(value)
        });
        log(`Tx submitted! Hash: ${txHash}. Waiting for FINALIZED consensus...`);
        
        const receipt = await client.waitForTransactionReceipt({
            hash: txHash,
            status: TransactionStatus.FINALIZED
        });

        if (receipt.txExecutionResultName === ExecutionResult.FINISHED_WITH_ERROR) {
            log(`Transaction FAILED on-chain: ${receipt.executionResultError || 'Contract error'}`, 'error');
            throw new Error(`Execution error: ${receipt.executionResultError || 'Reverted'}`);
        } else {
            log(`Transaction '${functionName}' FINALIZED successfully!`);
            return receipt;
        }
    } catch (err) {
        log(`Transaction error: ${err.message}`, 'error');
        throw err;
    }
}

// Read on-chain state
async function refreshState() {
    if (!escrowAddress) return;
    try {
        log(`Reading state for contract ${escrowAddress} on ${currentChain.name}...`);
        const state = await client.readContract({
            address: escrowAddress,
            functionName: 'get_escrow_state',
            args: []
        });

        currentContractState = state;
        log(`On-chain state: ${state.state}`);

        // Update UI
        contractStatusEl.textContent = state.state;
        contractStatusEl.className = 'status-badge ' + state.state.toLowerCase();

        valClient.textContent = state.client;
        valFreelancer.textContent = state.freelancer;
        valAmount.textContent = `${state.amount} WEI`;
        valBalance.textContent = `${state.contract_balance} WEI`;
        valDeliveryRef.textContent = state.delivery_ref || 'None';
        valIsAppealed.textContent = state.is_appealed ? 'Appealed' : 'Not Appealed';
        valRulingDecision.textContent = state.ruling_decision || 'N/A';

        // Toggle action panels
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

// Connect to existing contract
btnLoadContract.addEventListener('click', async () => {
    const addr = existingContractAddressInput.value.trim();
    if (!addr) {
        log('Please enter a valid contract address.', 'error');
        return;
    }
    setupAccounts();
    escrowAddress = addr;
    log(`Connecting to existing contract at: ${escrowAddress}`);

    sectionDeploy.classList.add('hidden');
    sectionInteract.classList.remove('hidden');
    contractAddressEl.textContent = escrowAddress;

    await refreshState();
});

// Deploy Contract
btnDeploy.addEventListener('click', async () => {
    try {
        setupAccounts();

        const amount = document.getElementById('amount').value;
        const timeoutSec = document.getElementById('timeoutSeconds').value;
        const appealSec = document.getElementById('appealWindowSeconds').value;
        const spec = document.getElementById('spec').value;

        btnDeploy.disabled = true;
        btnDeploy.textContent = 'Deploying to GenLayer...';

        log(`Deployer: ${clientAccount.address}`);
        log(`Freelancer: ${freelancerAccount.address}`);
        log('Fetching contract source...');
        const code = await fetchContractCode();

        log(`Deploying EscrowContract to ${currentChain.name}... Value: ${amount} WEI`);
        const txHash = await client.deployContract({
            account: clientAccount,
            code: code,
            args: [freelancerAccount.address, parseInt(amount), spec, parseInt(timeoutSec), parseInt(appealSec)],
            value: BigInt(amount)
        });

        log(`Deploy tx submitted: ${txHash}. Waiting for consensus receipt on ${currentChain.name}...`);
        const receipt = await client.waitForTransactionReceipt({
            hash: txHash,
            status: TransactionStatus.ACCEPTED
        });

        if (receipt.txExecutionResultName === ExecutionResult.FINISHED_WITH_ERROR) {
            throw new Error(`Deployment failed: ${receipt.executionResultError || 'Reverted'}`);
        }

        escrowAddress = receipt.contractAddress || receipt.recipient;
        log(`EscrowContract successfully deployed at: ${escrowAddress}`);

        sectionDeploy.classList.add('hidden');
        sectionInteract.classList.remove('hidden');
        contractAddressEl.textContent = escrowAddress;

        await refreshState();
    } catch (err) {
        log(`Deployment Error: ${err.message}`, 'error');
    } finally {
        btnDeploy.disabled = false;
        btnDeploy.textContent = 'Initialize New Escrow Contract';
    }
});

// Actions
btnDeliver.addEventListener('click', async () => {
    try {
        const deliveryRef = document.getElementById('deliveryRef').value;
        btnDeliver.disabled = true;
        btnDeliver.textContent = 'Submitting...';

        await sendWriteTransaction(freelancerAccount, 'deliver_work', [deliveryRef]);
        await refreshState();
    } catch (err) {
    } finally {
        btnDeliver.disabled = false;
        btnDeliver.textContent = 'Submit Work (As Freelancer)';
    }
});

btnAccept.addEventListener('click', async () => {
    try {
        btnAccept.disabled = true;
        btnDispute.disabled = true;
        btnAccept.textContent = 'Accepting...';

        await sendWriteTransaction(clientAccount, 'accept_work', []);
        await refreshState();
    } catch (err) {
    } finally {
        btnAccept.disabled = false;
        btnDispute.disabled = false;
        btnAccept.textContent = 'Accept Work';
    }
});

btnDispute.addEventListener('click', async () => {
    try {
        btnAccept.disabled = true;
        btnDispute.disabled = true;
        btnDispute.textContent = 'Arbitrating (GenLayer LLM)...';

        await sendWriteTransaction(clientAccount, 'resolve_dispute', []);
        await refreshState();
    } catch (err) {
    } finally {
        btnAccept.disabled = false;
        btnDispute.disabled = false;
        btnDispute.textContent = 'Initiate AI Dispute';
    }
});

btnAutoRelease.addEventListener('click', async () => {
    try {
        btnAutoRelease.disabled = true;
        btnAutoRelease.textContent = 'Checking Timeout...';

        await sendWriteTransaction(freelancerAccount, 'auto_release_funds', []);
        await refreshState();
    } catch (err) {
    } finally {
        btnAutoRelease.disabled = false;
        btnAutoRelease.textContent = 'Trigger Timeout Release';
    }
});

btnAppeal.addEventListener('click', async () => {
    try {
        btnAppeal.disabled = true;
        btnFinalize.disabled = true;
        btnAppeal.textContent = 'Appealing (Re-Arbitrating)...';

        await sendWriteTransaction(clientAccount, 'appeal', []);
        await refreshState();
    } catch (err) {
    } finally {
        btnAppeal.disabled = false;
        btnFinalize.disabled = false;
        btnAppeal.textContent = 'Appeal Ruling';
    }
});

btnFinalize.addEventListener('click', async () => {
    try {
        btnAppeal.disabled = true;
        btnFinalize.disabled = true;
        btnFinalize.textContent = 'Finalizing...';

        await sendWriteTransaction(clientAccount, 'finalize_ruling', []);
        await refreshState();
    } catch (err) {
    } finally {
        btnAppeal.disabled = false;
        btnFinalize.disabled = false;
        btnFinalize.textContent = 'Finalize Settlement';
    }
});

btnRefresh.addEventListener('click', refreshState);

btnSwitchContract.addEventListener('click', () => {
    sectionInteract.classList.add('hidden');
    sectionDeploy.classList.remove('hidden');
});

// Initialization
updateNetwork('studionet');
loadDeployedContractMetadata();
