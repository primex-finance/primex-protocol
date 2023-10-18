// (c) 2023 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.18;

import {SwapManager} from "../../SwapManager.sol";
import {IUpgradeInterface} from "./IUpgradeInterface.sol";

contract SwapManagerV2 is IUpgradeInterface, SwapManager {
    uint256 public value;

    constructor(
        address _registry,
        address _primexDNS,
        address payable _traderBalanceVault,
        address _priceOracle,
        address _whiteBlackList
    ) SwapManager(_registry, _primexDNS, _traderBalanceVault, _priceOracle, _whiteBlackList) {}

    function testUpgrade() external pure override returns (string memory) {
        return "SwapManagerV2";
    }

    function setValue(uint256 _value) external override {
        value = _value;
    }
}
