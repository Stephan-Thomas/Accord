# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

from genlayer import *
import json

ERROR_EXPECTED  = "[EXPECTED]"
ERROR_LLM       = "[LLM_ERROR]"

def _get_current_time() -> u256:
    raw = gl.message_raw.get("datetime")
    if not raw:
        raise gl.vm.UserError(f"{ERROR_EXPECTED} Chain datetime unavailable")

    dt_str = str(raw)
    if dt_str.endswith("Z"):
        dt_str = dt_str[:-1] + "+00:00"

    import datetime as _dt
    return u256(int(_dt.datetime.fromisoformat(dt_str).timestamp()))

def _transfer_funds(to: Address | bytes | str, amount: u256) -> None:
    if amount == u256(0):
        return
    to_addr = Address(to) if isinstance(to, (bytes, str)) else to
    gl.get_contract_at(to_addr).emit_transfer(value=amount)

class EscrowContract(gl.Contract):
    client: Address
    freelancer: Address
    amount: u256
    spec: str
    delivery_ref: str
    state: str  # PENDING, DELIVERED, ACCEPTED, DISPUTE_RULED, RESOLVED_CLIENT, RESOLVED_FREELANCER, SPLIT
    
    delivery_timeout_seconds: u256
    appeal_window_seconds: u256
    delivered_at: u256
    ruling_timestamp: u256
    ruling_decision: str
    is_appealed: bool

    def __init__(
        self, 
        freelancer: Address, 
        amount: int, 
        spec: str, 
        delivery_timeout_seconds: int = 604800,  # Default 7 days
        appeal_window_seconds: int = 86400      # Default 24 hours
    ):
        req_amount = u256(amount)
        if gl.message.value < req_amount:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Sent value ({gl.message.value}) is less than escrow amount ({req_amount})")

        self.client = Address(gl.message.sender_address) if isinstance(gl.message.sender_address, (bytes, str)) else gl.message.sender_address
        self.freelancer = Address(freelancer) if isinstance(freelancer, (bytes, str)) else freelancer
        self.amount = req_amount
        self.spec = spec
        self.delivery_ref = ""
        self.state = "PENDING"
        self.delivery_timeout_seconds = u256(delivery_timeout_seconds)
        self.appeal_window_seconds = u256(appeal_window_seconds)
        self.delivered_at = u256(0)
        self.ruling_timestamp = u256(0)
        self.ruling_decision = ""
        self.is_appealed = False

    @gl.public.view
    def get_escrow_state(self) -> dict:
        return {
            "client": self.client.as_hex,
            "freelancer": self.freelancer.as_hex,
            "amount": int(self.amount),
            "spec": self.spec,
            "delivery_ref": self.delivery_ref,
            "state": self.state,
            "delivery_timeout_seconds": int(self.delivery_timeout_seconds),
            "appeal_window_seconds": int(self.appeal_window_seconds),
            "delivered_at": int(self.delivered_at),
            "ruling_timestamp": int(self.ruling_timestamp),
            "ruling_decision": self.ruling_decision,
            "is_appealed": self.is_appealed,
            "contract_balance": int(gl.get_contract_at(gl.message.contract_address).balance)
        }

    @gl.public.write
    def deliver_work(self, delivery_ref: str) -> None:
        if gl.message.sender_address != self.freelancer:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Only freelancer can deliver work")
        if self.state != "PENDING":
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Invalid state for delivery")

        self.delivery_ref = delivery_ref
        self.state = "DELIVERED"
        self.delivered_at = _get_current_time()

    @gl.public.write
    def accept_work(self) -> None:
        if gl.message.sender_address != self.client:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Only client can accept work")
        if self.state != "DELIVERED":
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Invalid state for acceptance")

        self.state = "ACCEPTED"
        _transfer_funds(self.freelancer, self.amount)

    @gl.public.write
    def auto_release_funds(self) -> None:
        """Allows freelancer (or anyone) to trigger fund release if client has not responded within the timeout window."""
        if self.state != "DELIVERED":
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Invalid state for auto release")
        
        current_time = _get_current_time()
        if current_time < self.delivered_at + self.delivery_timeout_seconds:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Delivery timeout window has not expired yet")

        self.state = "ACCEPTED"
        _transfer_funds(self.freelancer, self.amount)

    def _execute_ai_arbitration(self, is_appeal_mode: bool = False) -> dict:
        def leader_fn():
            appeal_header = "[APPEAL EVALUATION - EXTRA SCRUTINY REQUIRED]\n" if is_appeal_mode else ""
            prompt = f"""
{appeal_header}You are an impartial AI arbitrator evaluating a dispute between a client and a freelancer.
Client Specification:
{self.spec}

Freelancer Delivery:
{self.delivery_ref}

Evaluate if the freelancer's delivery satisfies the client's specification.
Return a JSON object with two fields:
- "decision": one of "RESOLVED_CLIENT", "RESOLVED_FREELANCER", "SPLIT"
- "reasoning": a string explaining your decision

Rule definitions:
- Use "RESOLVED_FREELANCER" if the work meets the spec satisfactorily.
- Use "RESOLVED_CLIENT" if the work clearly fails to meet the spec.
- Use "SPLIT" if the work partially meets the spec (e.g. minor defects or partial fulfillment).
"""
            analysis = gl.nondet.exec_prompt(prompt, response_format="json")
            if not isinstance(analysis, dict):
                raise gl.vm.UserError(f"{ERROR_LLM} Non-dict response")
                
            decision = analysis.get("decision")
            if decision not in ["RESOLVED_CLIENT", "RESOLVED_FREELANCER", "SPLIT"]:
                raise gl.vm.UserError(f"{ERROR_LLM} Invalid decision: {decision}")
                
            return {"decision": decision, "reasoning": str(analysis.get("reasoning", ""))}

        def validator_fn(leaders_res: gl.vm.Result) -> bool:
            if not isinstance(leaders_res, gl.vm.Return):
                leader_msg = leaders_res.message if hasattr(leaders_res, 'message') else ''
                try:
                    leader_fn()
                    return False
                except gl.vm.UserError as e:
                    validator_msg = e.message if hasattr(e, 'message') else str(e)
                    if validator_msg.startswith(ERROR_EXPECTED):
                        return validator_msg == leader_msg
                    return False
                except Exception:
                    return False

            validator_result = leader_fn()
            return leaders_res.calldata["decision"] == validator_result["decision"]

        return gl.vm.run_nondet_unsafe(leader_fn, validator_fn)

    def _payout_by_decision(self, decision: str) -> None:
        if decision == "RESOLVED_FREELANCER":
            _transfer_funds(self.freelancer, self.amount)
        elif decision == "RESOLVED_CLIENT":
            _transfer_funds(self.client, self.amount)
        elif decision == "SPLIT":
            freelancer_share = self.amount // u256(2)
            client_share = self.amount - freelancer_share
            _transfer_funds(self.freelancer, freelancer_share)
            _transfer_funds(self.client, client_share)

    @gl.public.write
    def resolve_dispute(self) -> str:
        if gl.message.sender_address != self.client and gl.message.sender_address != self.freelancer:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Only client or freelancer can initiate dispute resolution")
        if self.state != "DELIVERED":
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Invalid state for dispute resolution")

        result = self._execute_ai_arbitration(is_appeal_mode=False)
        decision = result["decision"]
        
        self.ruling_decision = decision
        self.ruling_timestamp = _get_current_time()
        self.state = "DISPUTE_RULED"
        
        return decision

    @gl.public.write
    def appeal(self) -> str:
        """Allows either party to appeal the initial dispute ruling within appeal_window_seconds."""
        if gl.message.sender_address != self.client and gl.message.sender_address != self.freelancer:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Only client or freelancer can appeal")
        if self.state != "DISPUTE_RULED":
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Contract is not in DISPUTE_RULED state")
        if self.is_appealed:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} An appeal has already been conducted for this contract")

        current_time = _get_current_time()
        if current_time > self.ruling_timestamp + self.appeal_window_seconds:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Appeal window has expired")

        self.is_appealed = True
        result = self._execute_ai_arbitration(is_appeal_mode=True)
        final_decision = result["decision"]

        self.state = final_decision
        self._payout_by_decision(final_decision)
        return final_decision

    @gl.public.write
    def finalize_ruling(self) -> str:
        """Finalizes payout after the initial ruling once the appeal window has passed."""
        if self.state != "DISPUTE_RULED":
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Contract is not in DISPUTE_RULED state")

        current_time = _get_current_time()
        if current_time < self.ruling_timestamp + self.appeal_window_seconds:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Appeal window has not expired yet")

        decision = self.ruling_decision
        self.state = decision
        self._payout_by_decision(decision)
        return decision
