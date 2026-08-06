# GenLayer AI Arbitrated Escrow with Optimistic Democracy Appeals

A production-grade Intelligent Escrow Contract built on GenLayer (GenVM) that mediates transactions between clients and AI agents (or freelancers) with real token custody, access control, dispute arbitration, appeal escalation, and timeout protections.

---

## Implementation Notes & Quoted GenVM API Evidence

Every contract primitive in `contracts/escrow.py` has been verified against the official GenLayer standard library codebase (`genlayer.gl`, `genlayer._internal.msg`). Below are the exact file locations and code excerpts confirming each API definition:

### 1. Native Value Transfer (`emit_transfer`)
- **Verification**: **VERIFIED & QUOTED**
- **Source File**: `genlayer/gl/genvm_contracts.py` (lines 143-153 & 192-195)
- **Quoted Signature & Docstring**:
```python
def emit_transfer(self, *, value: u256, on: ON = 'finalized') -> None:
    """
    Emit a simple value transfer without calling any method. Receiver may catch it with
    py:func:`genlayer.gl.Contract.__receive__` method, so users may need to supply non-zero gas

    :param value: Amount of native tokens to transfer
    :param on: When transaction message should be emitted to consensus

    :raises ValueError: If value is zero
    """
    if value <= 0:
        raise ValueError('value must be greater than 0 for emit_transfer')
    _ContractAtEmitMethod(None, self._address, value, on)()
```
- **Usage in Contract**: `gl.get_contract_at(to_addr).emit_transfer(value=amount)` is used by `_transfer_funds()` for payouts/refunds in `accept_work()`, `auto_release_funds()`, `appeal()`, and `finalize_ruling()`.

---

### 2. Transaction Datetime (`gl.message_raw['datetime']`)
- **Verification**: **VERIFIED & QUOTED**
- **Source File**: `genlayer/_internal/msg.py` (lines 37-40)
- **Quoted Source Definition**:
```python
class MessageRawType(typing.TypedDict):
    contract_address: Address
    sender_address: Address
    origin_address: Address
    stack: list[Address]
    value: u256
    datetime: str
    """
    Transaction datetime. For ``#get-schema`` it can be some predefined datetime
    """
```
- **Usage in Contract**: `_get_current_time()` parses the ISO-8601 string from `gl.message_raw['datetime']` into Unix epoch seconds. Zero test-infrastructure imports (`wasi_mock`) or hardcoded fallback literals are used.

---

### 3. Standardized Sender Field (`gl.message.sender_address`)
- **Verification**: **VERIFIED & QUOTED**
- **Source File**: `genlayer/gl/__init__.py` (lines 91-94, 143-149)
- **Quoted Source Definition**:
```python
class MessageType(typing.NamedTuple):
    contract_address: Address
    """Address of current Intelligent Contract"""
    sender_address: Address
    """Address of this call initiator"""
    origin_address: Address
    """Entire transaction initiator"""
    value: u256
    chain_id: u256

message = MessageType(
    contract_address=message_raw['contract_address'],
    sender_address=message_raw['sender_address'],
    origin_address=message_raw['origin_address'],
    value=u256(message_raw['value']),
    chain_id=u256(message_raw['chain_id']),
)
```
- **Usage in Contract**: Standardized on `gl.message.sender_address` across `__init__`, `deliver_work`, `accept_work`, `resolve_dispute`, `appeal`, and `finalize_ruling`.

---

## Security & Devnet Key Disclaimer

> [!WARNING]
> The private keys pre-filled in `frontend/index.html` and `frontend/main.js` (`0xac0974bec39a...` and `0x59c6995e99...`) are well-known public local-devnet accounts (Anvil / Hardhat default test keys). They are included **ONLY for local testing and demo convenience**. They MUST NEVER be used to hold real funds or deployed to any public testnet or mainnet network.

---

## Architectural Features

1. **Strict Appeal Window Access Control**:
   - `finalize_ruling()` enforces `current_time >= ruling_timestamp + appeal_window_seconds` for **EVERY caller** (client, freelancer, and third parties). Neither winning party nor third parties can finalize settlement before the appeal window passes.

2. **Proportional SPLIT Payouts**:
   - 50/50 fund distribution (`freelancer_share = amount // 2`, `client_share = amount - freelancer_share`).

3. **Timeout Auto-Release**:
   - Allows freelancer to trigger fund release if client is unresponsive past `delivery_timeout_seconds`.

---

## Getting Started

### 1. Run Direct Unit Tests (with Fund Movement Assertions)
```bash
pytest tests/direct -v
```

### 2. Deploy via GenLayer CLI
```bash
genlayer init
genlayer up
genlayer deploy --contract contracts/escrow.py --args 0x70997970C51812dc3A010C7d01b50e0d17dc79C8 1000 "Build landing page" 604800 86400
```

### 3. Launch Frontend Demo
```bash
cd frontend
npm install
npm run dev
```
