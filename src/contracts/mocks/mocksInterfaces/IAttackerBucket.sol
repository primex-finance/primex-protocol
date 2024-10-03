// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.18;

import {IPToken} from "../../PToken/IPToken.sol";

interface IAttackerBucket {
    function setName(string calldata _name) external;

    function setPTokenAddress(IPToken _pToken) external;
}
