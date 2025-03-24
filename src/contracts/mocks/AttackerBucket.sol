// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.26;

import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

import {IPToken} from "../PToken/IPToken.sol";
import {IAttackerBucket} from "./mocksInterfaces/IAttackerBucket.sol";

contract AttackerBucket is IAttackerBucket, IERC165 {
    string public name;
    IPToken public pToken;

    function setName(string calldata _name) external override {
        name = _name;
    }

    function setPTokenAddress(IPToken _pToken) external override {
        pToken = _pToken;
    }

    // solhint-disable-next-line no-unused-vars
    function supportsInterface(bytes4) public view virtual override returns (bool) {
        return true;
    }
}
