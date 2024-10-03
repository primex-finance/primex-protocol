// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.18;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IERC20Mock is IERC20 {
    function setMintTimeLimit(bool _isLimited) external;

    function mint(address _account, uint256 _amount) external;

    function burn(uint256 amount) external;
}
