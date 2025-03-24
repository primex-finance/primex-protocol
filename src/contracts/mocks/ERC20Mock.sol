// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {IERC20Mock} from "../interfaces/IERC20Mock.sol";

// mock class using ERC20
contract ERC20Mock is ERC20, Ownable, IERC20Mock {
    uint8 public dec;
    bool public isTimeLimitedMinting;
    mapping(address => uint256) public timeToUnlockMinting;
    uint256 public immutable mintingAmount;

    constructor(
        string memory _name,
        string memory _symbol,
        uint8 _decimals,
        address[] memory _initialAccounts,
        uint256[] memory _initialBalances,
        uint256 _mintingAmount
    ) ERC20(_name, _symbol) {
        require(
            _initialAccounts.length == _initialBalances.length,
            "ERC20Mock::constructor:number of initial accounts and balances does not match"
        );
        for (uint256 i; i < _initialAccounts.length; i++) {
            _mint(_initialAccounts[i], _initialBalances[i]);
        }
        dec = _decimals;
        mintingAmount = _mintingAmount;
    }

    function setMintTimeLimit(bool _isLimited) external override onlyOwner {
        isTimeLimitedMinting = _isLimited;
    }

    function mint(address _account, uint256 _amount) public override {
        if (isTimeLimitedMinting) {
            // slither-disable-next-line timestamp
            require(timeToUnlockMinting[msg.sender] <= block.timestamp, "mint tokens possible once a day");
            timeToUnlockMinting[msg.sender] = block.timestamp + 1 days;
            _mint(msg.sender, mintingAmount);
        } else {
            _mint(_account, _amount);
        }
    }

    function burn(uint256 _amount) public override {
        _burn(msg.sender, _amount);
    }

    function decimals() public view override returns (uint8) {
        return dec;
    }
}
