import pytest
import json

SDK_VER = "v0.2.12"

def _setup_test_balances(vm, client, client_amt, freelancer, freelancer_amt, contract_addr, escrow_amt):
    """Sets up account and contract balances in direct_vm."""
    vm.deal(client, client_amt - escrow_amt)
    vm.deal(freelancer, freelancer_amt)
    c_bytes = contract_addr.as_bytes if hasattr(contract_addr, "as_bytes") else (contract_addr if isinstance(contract_addr, bytes) else bytes(contract_addr))
    vm._balances[c_bytes] = escrow_amt

    def gl_call_hook(vm_ctx, request):
        if isinstance(request, dict) and "PostMessage" in request:
            pm = request["PostMessage"]
            val = int(pm.get("value", 0))
            if val > 0:
                to_addr = pm.get("address")
                to_bytes = to_addr.as_bytes if hasattr(to_addr, "as_bytes") else (to_addr if isinstance(to_addr, bytes) else bytes(to_addr))
                cb = vm_ctx._contract_address.as_bytes if hasattr(vm_ctx._contract_address, "as_bytes") else bytes(vm_ctx._contract_address)
                
                vm_ctx._balances[cb] = vm_ctx._balances.get(cb, 0) - val
                vm_ctx._balances[to_bytes] = vm_ctx._balances.get(to_bytes, 0) + val
            return {"ok": None}
        return None
    vm._gl_call_hook = gl_call_hook

def get_balance(vm, addr: bytes) -> int:
    return vm._balances.get(addr, 0)

def test_escrow_happy_path(direct_vm, direct_deploy, direct_alice, direct_bob):
    amount = 1000
    direct_vm.sender = direct_alice
    direct_vm.value = amount
    contract = direct_deploy("contracts/escrow.py", direct_bob, amount, "Build a website", sdk_version=SDK_VER)
    
    contract_bytes = bytes(direct_vm._contract_address)
    _setup_test_balances(direct_vm, direct_alice, 5000, direct_bob, 1000, contract_bytes, amount)

    state = contract.get_escrow_state()
    assert state["client"].lower() == ("0x" + direct_alice.hex()).lower()
    assert state["freelancer"].lower() == ("0x" + direct_bob.hex()).lower()
    assert state["amount"] == amount
    assert state["state"] == "PENDING"
    assert get_balance(direct_vm, direct_alice) == 4000

    # Freelancer delivers
    direct_vm.sender = direct_bob
    direct_vm.value = 0
    contract.deliver_work("https://example.com/site")
    assert contract.get_escrow_state()["state"] == "DELIVERED"

    # Client accepts work
    direct_vm.sender = direct_alice
    contract.accept_work()
    assert contract.get_escrow_state()["state"] == "ACCEPTED"

    # Fund movement assertions
    assert get_balance(direct_vm, direct_bob) == 2000   # Freelancer received +1000
    assert get_balance(direct_vm, direct_alice) == 4000  # Client stays at 4000
    assert get_balance(direct_vm, contract_bytes) == 0  # Contract balance is 0

def test_escrow_contract_balance_drained_on_acceptance(direct_vm, direct_deploy, direct_alice, direct_bob):
    """Explicitly asserts contract balance drops to 0 after accept_work()."""
    amount = 1000
    direct_vm.sender = direct_alice
    direct_vm.value = amount
    contract = direct_deploy("contracts/escrow.py", direct_bob, amount, "Build a website", sdk_version=SDK_VER)

    contract_bytes = bytes(direct_vm._contract_address)
    _setup_test_balances(direct_vm, direct_alice, 5000, direct_bob, 1000, contract_bytes, amount)

    # Assert contract held initial deposit
    assert contract.get_escrow_state()["contract_balance"] == 1000

    # Freelancer delivers & Client accepts
    direct_vm.sender = direct_bob
    direct_vm.value = 0
    contract.deliver_work("https://example.com/site")

    direct_vm.sender = direct_alice
    contract.accept_work()

    # Explicitly assert contract balance is drained to 0
    assert contract.get_escrow_state()["contract_balance"] == 0

def test_escrow_insufficient_deposit(direct_vm, direct_deploy, direct_alice, direct_bob):
    amount = 1000
    direct_vm.deal(direct_alice, 5000)
    direct_vm.sender = direct_alice
    direct_vm.value = 500  # Less than required 1000

    with direct_vm.expect_revert("Sent value (500) is less than escrow amount (1000)"):
        direct_deploy("contracts/escrow.py", direct_bob, amount, "Build a website", sdk_version=SDK_VER)

def test_escrow_access_control(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    amount = 1000
    direct_vm.sender = direct_alice
    direct_vm.value = amount
    contract = direct_deploy("contracts/escrow.py", direct_bob, amount, "Build a website", sdk_version=SDK_VER)

    direct_vm.sender = direct_bob
    direct_vm.value = 0
    contract.deliver_work("https://example.com/site")

    # Unauthorized third party (Charlie) tries to resolve dispute
    direct_vm.sender = direct_charlie
    with direct_vm.expect_revert("Only client or freelancer can initiate dispute resolution"):
        contract.resolve_dispute()

def test_escrow_split_decision(direct_vm, direct_deploy, direct_alice, direct_bob):
    amount = 1000
    direct_vm.sender = direct_alice
    direct_vm.value = amount
    # appeal_window_seconds = 0 so finalize_ruling can be called immediately without time warp issue
    contract = direct_deploy("contracts/escrow.py", direct_bob, amount, "Build a website", 604800, 0, sdk_version=SDK_VER)

    contract_bytes = bytes(direct_vm._contract_address)
    _setup_test_balances(direct_vm, direct_alice, 5000, direct_bob, 1000, contract_bytes, amount)

    direct_vm.sender = direct_bob
    direct_vm.value = 0
    contract.deliver_work("Partial implementation delivered.")

    # Dispute resolution by client -> SPLIT
    direct_vm.sender = direct_alice
    direct_vm.mock_llm(
        r"(?s).*impartial AI arbitrator.*",
        json.dumps({"decision": "SPLIT", "reasoning": "Work is partially completed."})
    )

    decision = contract.resolve_dispute()
    assert decision == "SPLIT"
    assert contract.get_escrow_state()["state"] == "DISPUTE_RULED"

    # Finalize ruling (appeal window is 0s)
    contract.finalize_ruling()
    assert contract.get_escrow_state()["state"] == "SPLIT"

    # Fund movement assertions: 50/50 split (500 to freelancer, 500 to client)
    assert get_balance(direct_vm, direct_bob) == 1500   # 1000 + 500
    assert get_balance(direct_vm, direct_alice) == 4500 # 4000 + 500
    assert contract.get_escrow_state()["contract_balance"] == 0

def test_escrow_finalize_race_condition(direct_vm, direct_deploy, direct_alice, direct_bob):
    """Proves winning party CANNOT finalize ruling before appeal window passes."""
    amount = 1000
    direct_vm.sender = direct_alice
    direct_vm.value = amount
    appeal_window = 86400  # 24 hours
    contract = direct_deploy("contracts/escrow.py", direct_bob, amount, "Build a website", 604800, appeal_window, sdk_version=SDK_VER)

    direct_vm.sender = direct_bob
    direct_vm.value = 0
    contract.deliver_work("Disputed delivery")

    # Client disputes -> Winning ruling RESOLVED_CLIENT
    direct_vm.sender = direct_alice
    direct_vm.mock_llm(
        r"(?s).*impartial AI arbitrator.*",
        json.dumps({"decision": "RESOLVED_CLIENT", "reasoning": "Work failed spec."})
    )
    contract.resolve_dispute()
    assert contract.get_escrow_state()["state"] == "DISPUTE_RULED"
    assert contract.get_escrow_state()["ruling_decision"] == "RESOLVED_CLIENT"

    # Winning party (Client) attempts to finalize IMMEDIATELY before appeal window passes -> REVERTS!
    with direct_vm.expect_revert("Appeal window has not expired yet"):
        contract.finalize_ruling()

    # Freelancer also attempts to finalize immediately -> REVERTS!
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("Appeal window has not expired yet"):
        contract.finalize_ruling()

def test_escrow_appeal_flow(direct_vm, direct_deploy, direct_alice, direct_bob):
    amount = 1000
    direct_vm.sender = direct_alice
    direct_vm.value = amount
    contract = direct_deploy("contracts/escrow.py", direct_bob, amount, "Build a website", 604800, 86400, sdk_version=SDK_VER)

    contract_bytes = bytes(direct_vm._contract_address)
    _setup_test_balances(direct_vm, direct_alice, 5000, direct_bob, 1000, contract_bytes, amount)

    direct_vm.sender = direct_bob
    direct_vm.value = 0
    contract.deliver_work("Disputed delivery")

    # Initial dispute ruling -> RESOLVED_CLIENT
    direct_vm.sender = direct_alice
    direct_vm.mock_llm(
        r"(?s).*impartial AI arbitrator.*",
        json.dumps({"decision": "RESOLVED_CLIENT", "reasoning": "Initial assessment failed."})
    )
    contract.resolve_dispute()
    assert contract.get_escrow_state()["state"] == "DISPUTE_RULED"
    assert contract.get_escrow_state()["ruling_decision"] == "RESOLVED_CLIENT"

    # Freelancer appeals within appeal window
    direct_vm.sender = direct_bob
    direct_vm.clear_mocks()
    direct_vm.mock_llm(
        r"(?s).*APPEAL EVALUATION.*",
        json.dumps({"decision": "RESOLVED_FREELANCER", "reasoning": "Upon extra scrutiny, delivery satisfies requirements."})
    )

    final_decision = contract.appeal()
    assert final_decision == "RESOLVED_FREELANCER"
    assert contract.get_escrow_state()["state"] == "RESOLVED_FREELANCER"
    assert contract.get_escrow_state()["is_appealed"] is True

    # Fund movement assertions: Freelancer gets full amount
    assert get_balance(direct_vm, direct_bob) == 2000  # 1000 + 1000
    assert contract.get_escrow_state()["contract_balance"] == 0

    # Attempt second appeal -> Reverts
    with direct_vm.expect_revert("Contract is not in DISPUTE_RULED state"):
        contract.appeal()

def test_escrow_timeout_autorelease(direct_vm, direct_deploy, direct_alice, direct_bob):
    amount = 1000
    direct_vm.sender = direct_alice
    direct_vm.value = amount
    timeout = 0  # 0 seconds timeout for immediate auto-release test
    contract = direct_deploy("contracts/escrow.py", direct_bob, amount, "Build a website", timeout, 300, sdk_version=SDK_VER)

    contract_bytes = bytes(direct_vm._contract_address)
    _setup_test_balances(direct_vm, direct_alice, 5000, direct_bob, 1000, contract_bytes, amount)

    # Freelancer delivers
    direct_vm.sender = direct_bob
    direct_vm.value = 0
    contract.deliver_work("Work completed")

    # Trigger auto release (timeout is 0s)
    contract.auto_release_funds()
    assert contract.get_escrow_state()["state"] == "ACCEPTED"

    # Fund movement assertions: Freelancer gets full amount upon auto-release
    assert get_balance(direct_vm, direct_bob) == 2000  # 1000 + 1000
    assert contract.get_escrow_state()["contract_balance"] == 0
