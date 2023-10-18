// (c) 2023 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.18;

import {IMaliciousDexMock} from "./mocksInterfaces/IMaliciousDexMock.sol";

contract MaliciousDexMock is IMaliciousDexMock {
    // Mock of possible malicious dex, that returns value but doesn't swap anything
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256,
        address[] calldata,
        address,
        uint256
    ) external virtual override returns (uint256[] memory amounts) {
        amounts = new uint256[](2);
        amounts[0] = amountIn;
        amounts[1] = 1 ether;
    }
}
