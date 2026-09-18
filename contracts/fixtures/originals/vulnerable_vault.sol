// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/// Test contract with 3 PLANTED vulnerabilities for the audit agent.
/// DO NOT DEPLOY.
contract VulnerableVault {
    mapping(address => uint256) public balances;
    address public owner;

    constructor() {
        owner = msg.sender;
    }

    function deposit() public payable {
        balances[msg.sender] += msg.value;
    }

    // BUG 1: Reentrancy — external call before state update (SWC-107)
    function withdraw() public {
        uint256 bal = balances[msg.sender];
        require(bal > 0, "no balance");
        (bool ok, ) = msg.sender.call{value: bal}("");
        require(ok, "transfer failed");
        balances[msg.sender] = 0; // state updated AFTER the call — exploitable
    }

    // BUG 2: tx.origin used for authorization (SWC-115)
    function emergencyDrain(address payable to) public {
        require(tx.origin == owner, "not owner");
        to.transfer(address(this).balance);
    }

    // BUG 3: Unchecked low-level call return value (SWC-104)
    function payOut(address payable to, uint256 amount) public {
        require(msg.sender == owner, "not owner");
        to.call{value: amount}(""); // return value ignored
    }

    receive() external payable {}
}
